#!/usr/bin/env python3
"""Copy only an existing deployed certificate pair; never writes to ACME/VPN paths."""
from __future__ import annotations
import argparse, hashlib, json, os, pathlib, re, secrets, shutil, ssl, subprocess, tempfile

DOMAIN='mcp.example.invalid'
ETC=pathlib.Path('/etc/mcp-pc-bridge')

def config_values(path: pathlib.Path) -> dict[str,str]:
    out={}
    for line in path.read_text().splitlines():
        m=re.fullmatch(r"(Le_[A-Za-z0-9_]+)='([^']*)'", line.strip())
        if m:out[m[1]]=m[2]
    return out

def check_pair(cert: pathlib.Path, key: pathlib.Path, domain: str=DOMAIN) -> None:
    if not cert.is_file() or not key.is_file():raise RuntimeError('Certificate/key source not found')
    if cert.stat().st_size>256*1024 or key.stat().st_size>64*1024:raise RuntimeError('Unexpected certificate/key size')
    child_env={**os.environ,'LC_ALL':'C','LANG':'C'}
    r=subprocess.run(['openssl','x509','-in',str(cert),'-noout','-checkend','172800'],
                     capture_output=True,timeout=10,env=child_env)
    if r.returncode:raise RuntimeError('Certificate validity check failed')
    r=subprocess.run(['openssl','x509','-in',str(cert),'-noout','-checkhost',domain],
                     capture_output=True,timeout=10,env=child_env)
    expected=('Hostname '+domain+' does match certificate').encode('ascii')
    if r.returncode != 0 or r.stdout.strip() != expected:
        raise RuntimeError('Certificate hostname check failed')
    ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(cert),str(key),password=lambda: "") # rejects mismatched key
    if b'PRIVATE KEY' in cert.read_bytes():raise RuntimeError('Private key embedded in certificate file')

def sync(source_file: pathlib.Path, tls_root: pathlib.Path, gid: int, notify: bool=True) -> bool:
    conf=json.loads(source_file.read_text())
    cert,key=pathlib.Path(conf['cert']),pathlib.Path(conf['key'])
    # Validate copies, not a live pair that ACME might rewrite between read and use.
    tmp=pathlib.Path(tempfile.mkdtemp(prefix='.pair-',dir=tls_root))
    try:
        os.chown(tmp,0,gid);os.chmod(tmp,0o750)
        cp=tmp/'fullchain.pem';kp=tmp/'privkey.pem'
        cp.write_bytes(cert.read_bytes());kp.write_bytes(key.read_bytes())
        os.chown(cp,0,gid);os.chown(kp,0,gid);os.chmod(cp,0o640);os.chmod(kp,0o640)
        check_pair(cp,kp,conf.get('domain',DOMAIN))
        h=hashlib.sha256(cp.read_bytes()+b'\0'+kp.read_bytes()).hexdigest()
        current=tls_root/'current'
        if current.is_symlink() and (current/'fingerprint').read_text()==h:
            return False
        (tmp/'fingerprint').write_text(h);os.chmod(tmp/'fingerprint',0o640);os.chown(tmp/'fingerprint',0,gid)
        target=tls_root/('pair-'+secrets.token_hex(8));tmp.rename(target)
        new=tls_root/('.current-'+secrets.token_hex(8));new.symlink_to(target.name);os.replace(new,current)
        if notify:
            r=subprocess.run(['systemctl','kill','--kill-who=main','--signal=HUP','mcp-pc-bridge-gateway.service'],capture_output=True)
            if r.returncode:raise RuntimeError('Certificate copied; gateway reload failed')
        # Deliberately don't delete previous pairs automatically; monthly growth is only a few KB.
        return True
    finally:
        if tmp.exists():shutil.rmtree(tmp)

if __name__=='__main__':
    import grp,sys
    try:
        changed=sync(ETC/'cert-source.json',ETC/'tls',grp.getgrnam('mcp-pc-bridge-gateway').gr_gid,'--initial' not in sys.argv)
        print('CERTIFICATE_SYNC_CHANGED' if changed else 'CERTIFICATE_SYNC_UNCHANGED')
    except Exception as e:
        print('CERTIFICATE_CHECK_FAILED: '+str(e),file=sys.stderr);sys.exit(1)
