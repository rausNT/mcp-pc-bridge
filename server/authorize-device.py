#!/usr/bin/env python3
# Explicit, single-purpose SSH authorization on your own fresh test/server installation.
import argparse, base64, os, pathlib, shutil, subprocess, sys, tempfile
USER='mcp-pc-bridge-agent';HOME=pathlib.Path('/var/lib/mcp-pc-bridge-agent')
DROP=pathlib.Path('/etc/ssh/sshd_config.d/90-mcp-pc-bridge.conf')
POLICY='\n'.join(['Match User '+USER,'    AuthenticationMethods publickey','    PubkeyAuthentication yes',
  '    PasswordAuthentication no','    KbdInteractiveAuthentication no','    AllowTcpForwarding local',
  '    AllowStreamLocalForwarding no','    PermitOpen 127.0.0.1:8787','    PermitListen none','    PermitTTY no',
  '    X11Forwarding no','    AllowAgentForwarding no','    PermitUserRC no','    MaxSessions 0','    ForceCommand /bin/false','Match all',''])

def restricted_key(raw):
    lines=[x.strip() for x in raw.splitlines() if x.strip()]
    if len(lines)!=1:raise ValueError('Expected exactly one PUBLIC Ed25519 key')
    parts=lines[0].split()
    if len(parts)<2 or parts[0]!='ssh-ed25519':raise ValueError('Expected ssh-ed25519 PUBLIC key; never pass a private key')
    blob=base64.b64decode(parts[1],validate=True)
    if len(blob)!=51 or blob[:19]!=bytes.fromhex('0000000b7373682d6564323535313900000020'):
        raise ValueError('Invalid Ed25519 public-key encoding')
    return 'restrict,port-forwarding,permitopen="127.0.0.1:8787",command="/bin/false" '+parts[0]+' '+parts[1]+' mcp-pc-bridge-device'

def main():
    p=argparse.ArgumentParser();p.add_argument('--public-key-file',type=pathlib.Path,required=True)
    p.add_argument('--configure-ssh',action='store_true');a=p.parse_args()
    line=restricted_key(a.public_key_file.read_text(encoding='utf-8-sig'))
    if not a.configure_ssh:print('PUBLIC_KEY_VALID. Pass --configure-ssh to authorize it on this server.');return
    if sys.platform!='linux' or os.geteuid()!=0:raise RuntimeError('Use an authorized root terminal on your own Linux server')
    if not pathlib.Path('/etc/mcp-pc-bridge/relay.env').is_file():raise RuntimeError('Install this project server first')
    sshd=shutil.which('sshd') or '/usr/sbin/sshd'
    if not DROP.parent.is_dir():raise RuntimeError('sshd_config.d is required; do not rewrite global SSH configuration blindly')
    if DROP.exists() and DROP.read_text()!=POLICY:raise RuntimeError('Existing policy differs; inspect it manually')
    import pwd
    try:account=pwd.getpwnam(USER)
    except KeyError:
        subprocess.run(['useradd','--create-home','--home-dir',str(HOME),'--shell','/bin/false','--password','NP',USER],check=True)
        account=pwd.getpwnam(USER)
    if account.pw_dir!=str(HOME) or account.pw_shell!='/bin/false':raise RuntimeError('Unexpected existing account; not modified')
    created=not DROP.exists()
    if created:DROP.write_text(POLICY);os.chmod(DROP,0o644)
    try:
        subprocess.run([sshd,'-t'],check=True)
        effective=subprocess.check_output([sshd,'-T','-C','user='+USER+',host=localhost,addr=127.0.0.1'],text=True)
        settings=dict(x.split(' ',1) for x in effective.splitlines() if ' ' in x)
        for key,want in {'allowtcpforwarding':'local','allowstreamlocalforwarding':'no','permitopen':'127.0.0.1:8787',
          'permitlisten':'none','passwordauthentication':'no','kbdinteractiveauthentication':'no','maxsessions':'0','forcecommand':'/bin/false'}.items():
            if settings.get(key)!=want:raise RuntimeError('SSH policy not effective: '+key+'; no SSH reload performed')
    except Exception:
        if created:DROP.unlink()
        raise
    directory=HOME/'.ssh';directory.mkdir(mode=0o700,exist_ok=True);os.chown(directory,account.pw_uid,account.pw_gid);os.chmod(directory,0o700)
    target=directory/'authorized_keys';existing=target.read_text() if target.exists() else ''
    if line not in existing.splitlines():
        fd,tmp=tempfile.mkstemp(prefix='.authorized-',dir=directory)
        with os.fdopen(fd,'w') as f:f.write(existing.rstrip()+'\n'+line+'\n' if existing else line+'\n')
        os.chown(tmp,account.pw_uid,account.pw_gid);os.chmod(tmp,0o600);os.replace(tmp,target)
    result=subprocess.run(['systemctl','reload','ssh.service'])
    if result.returncode:subprocess.run(['systemctl','reload','sshd.service'],check=True)
    print('KEY_AUTHORIZED. Verify an actual SSH tunnel AND rejected shell/remote-forward attempts before release.')
if __name__=='__main__':
    try:main()
    except Exception as e:print('STOPPED: '+str(e),file=sys.stderr);sys.exit(1)
