#!/usr/bin/env python3
# Never prints credentials. Only changes this project's explicitly named services/state.
import argparse, grp, json, os, pathlib, re, secrets, subprocess, sys
ETC=pathlib.Path('/etc/mcp-pc-bridge');STATE=pathlib.Path('/var/lib/mcp-pc-bridge/gateway')
SERVICE='mcp-pc-bridge-gateway.service'
def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['add-redirect','revoke-all']);p.add_argument('value',nargs='?');a=p.parse_args()
    if sys.platform!='linux' or os.geteuid()!=0:raise RuntimeError('Use an authorized root SSH terminal')
    if a.action=='revoke-all':
        subprocess.run(['systemctl','stop',SERVICE],check=True)
        state=STATE/'tokens.json'
        if state.exists():state.rename(STATE/('revoked-'+secrets.token_hex(8)+'.json'))
        subprocess.run(['systemctl','start',SERVICE],check=True)
        print('All OAuth grants revoked. Already-started computer processes are not undone or guaranteed to stop.')
        return
    uri=a.value or ''
    if uri!='https://chatgpt.com/connector_platform_oauth_redirect' and not re.fullmatch(r'https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]+',uri):
        raise ValueError('Only the exact HTTPS ChatGPT callback from the connection screen is accepted')
    path=ETC/'gateway.json';c=json.loads(path.read_text())
    if uri in c['redirectUris']:print('Callback already allowed');return
    if len(c['redirectUris'])>=8:raise ValueError('Inspect existing callback allowlist before adding more')
    c['redirectUris'].append(uri);tmp=ETC/('.gateway-'+secrets.token_hex(8))
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o640)
    with os.fdopen(fd,'w') as f:json.dump(c,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    os.chown(tmp,0,grp.getgrnam('mcp-pc-bridge-gateway').gr_gid);os.chmod(tmp,0o640);os.replace(tmp,path)
    subprocess.run(['systemctl','restart',SERVICE],check=True);print('Exact callback added; gateway restarted')
if __name__=='__main__':
    try:main()
    except Exception as e:print('STOPPED: '+str(e),file=sys.stderr);sys.exit(1)
