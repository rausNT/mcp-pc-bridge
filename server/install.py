#!/usr/bin/env python3
# Fresh isolated installation only. Never run this against a production predecessor.
import argparse, grp, importlib.util, json, os, pathlib, pwd, shutil, socket, subprocess, sys, time, urllib.request
from configuration import BASE, ETC, STATE, generate, validate_domain
SOURCE=pathlib.Path(__file__).resolve().parent
BASE,ETC,STATE=map(pathlib.Path,(BASE,ETC,STATE))
RELAY='mcp-pc-bridge-relay';GATEWAY='mcp-pc-bridge-gateway'
SERVICES=[RELAY+'.service',GATEWAY+'.service','mcp-pc-bridge-cert-sync.service','mcp-pc-bridge-cert-sync.timer']

def run(args, **kwargs):
    return subprocess.run([str(x) for x in args],check=True,**kwargs)

def cert_module():
    s=importlib.util.spec_from_file_location('certs',SOURCE/'stage2/deploy/certs.py')
    m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def write(path,data,mode=0o600,gid=0):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,mode)
    with os.fdopen(fd,'w',encoding='utf-8') as f:f.write(data)
    os.chown(path,0,gid);os.chmod(path,mode)

def chown_tree(path,user):
    account=pwd.getpwnam(user)
    for root,dirs,files in os.walk(path):
        os.chown(root,account.pw_uid,account.pw_gid)
        for name in files:os.chown(pathlib.Path(root)/name,account.pw_uid,account.pw_gid)

def service(user,node,command,workdir,environment=None,network=False):
    lines=['[Unit]','Description=MCP PC Bridge '+user,'After=network.target','StartLimitIntervalSec=60','StartLimitBurst=5',
      '[Service]','Type=simple','User='+user,'Group='+user,'WorkingDirectory='+str(workdir)]
    if environment:lines+=['EnvironmentFile='+str(environment)]
    lines+=['ExecStart='+str(node)+' --max-old-space-size=128 '+command,'Restart=on-failure','RestartSec=5','TimeoutStopSec=10',
      'NoNewPrivileges=yes','PrivateTmp=yes','ProtectSystem=strict','ProtectHome=yes','ProtectKernelTunables=yes',
      'ProtectKernelModules=yes','ProtectControlGroups=yes','RestrictSUIDSGID=yes','LockPersonality=yes',
      'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX','UMask=0077','MemoryMax=256M','TasksMax=128','LimitNOFILE=1024',
      'LogRateLimitIntervalSec=30s','LogRateLimitBurst=60','ReadWritePaths='+str(STATE/('gateway' if network else 'relay'))]
    lines+=['AmbientCapabilities=CAP_NET_BIND_SERVICE','CapabilityBoundingSet=CAP_NET_BIND_SERVICE'] if network else ['CapabilityBoundingSet=']
    return '\n'.join(lines+['[Install]','WantedBy=multi-user.target',''])

def preflight(a):
    if sys.platform!='linux' or sys.version_info<(3,12):raise RuntimeError('Ubuntu 24.04/systemd and Python 3.12+ required')
    validate_domain(a.domain)
    if not a.cert.is_absolute() or not a.key.is_absolute():raise ValueError('Use absolute certificate and key paths')
    generate(a.domain,a.device_id) # Validate identifiers; discard temporary credentials, never log them.
    for cmd in ['systemctl','ss','openssl','useradd','getent','runuser','tar']:
        if not shutil.which(cmd):raise RuntimeError('Missing prerequisite: '+cmd)
    for p in [BASE,ETC,STATE]+[pathlib.Path('/etc/systemd/system')/s for s in SERVICES]:
        if p.exists() or p.is_symlink():raise RuntimeError('Refusing to overwrite existing installation path: '+str(p))
    for u in [RELAY,GATEWAY]:
        try:pwd.getpwnam(u)
        except KeyError:pass
        else:raise RuntimeError('Service user already exists; inspect before reuse: '+u)
    for port in (443,8787):
        listeners=run(['ss','-H','-lnt','sport = :'+str(port)],capture_output=True,text=True).stdout
        if listeners.strip():raise RuntimeError('TCP '+str(port)+' already used; no existing service will be stopped')
    cert_module().check_pair(a.cert,a.key,a.domain)
    if shutil.disk_usage('/opt').free<1024**3:raise RuntimeError('Need at least 1 GiB free under /opt')
    lock=json.loads((SOURCE/'stage1/package-lock.json').read_text())
    for name,entry in lock['packages'].items():
        if not name:continue
        if not entry.get('resolved','').startswith('https://registry.npmjs.org/') or not entry.get('integrity','').startswith('sha512-'):
            raise RuntimeError('Dependency lacks official-registry integrity: '+name)
        if entry.get('hasInstallScript'):raise RuntimeError('Unexpected dependency install hook: '+name)

def install(a):
    if os.geteuid()!=0:raise RuntimeError('Installation requires an authorized root terminal')
    if not a.accept_remote_command_access:raise RuntimeError('Read SECURITY.md and pass --accept-remote-command-access explicitly')
    preflight(a)
    for d,mode in [(BASE,0o755),(ETC,0o750),(STATE,0o755)]:d.mkdir(mode=mode)
    for user,sub in [(RELAY,'relay'),(GATEWAY,'gateway')]:
        run(['useradd','--system','--user-group','--home-dir',STATE/sub,'--shell','/usr/sbin/nologin',user])
        (STATE/sub).mkdir(mode=0o700);chown_tree(STATE/sub,user)
    gateway_gid=grp.getgrnam(GATEWAY).gr_gid
    os.chown(ETC,0,gateway_gid);os.chmod(ETC,0o750)
    for stage in ['stage1','stage2']:
        shutil.copytree(SOURCE/stage,BASE/stage,ignore=shutil.ignore_patterns('node_modules','__pycache__','.git','*.pyc'))
    (BASE/'admin').mkdir(mode=0o755)
    for name in ['admin.py','authorize-device.py','show-setup.py','configuration.py']:
        shutil.copyfile(SOURCE/name,BASE/'admin'/name);os.chmod(BASE/'admin'/name,0o644)
    chown_tree(BASE/'stage1',RELAY)
    runtime=run([sys.executable,SOURCE/'stage1/deploy/get-node.py',BASE/'runtime'],capture_output=True,text=True).stdout.strip()
    node=pathlib.Path(runtime)/'bin/node';npm=pathlib.Path(runtime)/'bin/npm'
    for root,dirs,files in os.walk(BASE/'runtime'):
        os.chmod(root,0o755)
        for name in files:
            p=pathlib.Path(root)/name;os.chmod(p,0o755 if os.access(p,os.X_OK) else 0o644)
    env=['env','-i','PATH='+str(node.parent)+':/usr/bin:/bin','HOME='+str(STATE/'relay'),'npm_config_cache='+str(STATE/'relay/npm-cache')]
    run(['runuser','-u',RELAY,'--']+env+[str(npm),'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],cwd=BASE/'stage1')
    run(['runuser','-u',RELAY,'--']+env+[str(npm),'test'],cwd=BASE/'stage1')
    chown_tree(BASE/'stage1','root')
    relay,gateway,owner=generate(a.domain,a.device_id)
    write(ETC/'relay.env',relay)
    write(ETC/'gateway.json',json.dumps(gateway,indent=2)+'\n',0o640,gateway_gid)
    write(ETC/'owner-setup.json',json.dumps(owner,indent=2)+'\n')
    write(ETC/'cert-source.json',json.dumps({'domain':a.domain,'cert':str(a.cert),'key':str(a.key)},indent=2)+'\n')
    (ETC/'tls').mkdir(mode=0o750);os.chown(ETC/'tls',0,gateway_gid)
    cert_module().sync(ETC/'cert-source.json',ETC/'tls',gateway_gid,False)
    units={RELAY+'.service':service(RELAY,node,str(BASE/'stage1/src/server.mjs'),BASE/'stage1',ETC/'relay.env'),
      GATEWAY+'.service':service(GATEWAY,node,str(BASE/'stage2/src/gateway.mjs')+' '+str(ETC/'gateway.json'),BASE/'stage2',network=True)}
    units['mcp-pc-bridge-cert-sync.service']='\n'.join(['[Unit]','Description=Copy renewed certificate to MCP PC Bridge',
      '[Service]','Type=oneshot','ExecStart=/usr/bin/python3 '+str(BASE/'stage2/deploy/certs.py'),'UMask=0077',
      'PrivateTmp=yes','ProtectSystem=strict','ProtectHome=read-only','ReadWritePaths='+str(ETC/'tls'),
      'PrivateNetwork=yes','NoNewPrivileges=yes','MemoryMax=64M',''])
    units['mcp-pc-bridge-cert-sync.timer']='\n'.join(['[Unit]','Description=Check MCP PC Bridge certificate copy',
      '[Timer]','OnBootSec=5min','OnUnitActiveSec=1h','[Install]','WantedBy=timers.target',''])
    for name,text in units.items():write(pathlib.Path('/etc/systemd/system')/name,text,0o644)
    run(['systemctl','daemon-reload'])
    for name in [RELAY+'.service',GATEWAY+'.service','mcp-pc-bridge-cert-sync.timer']:run(['systemctl','enable','--now',name])
    for i in range(30):
        try:
            op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with op.open('http://127.0.0.1:8787/healthz',timeout=2) as r:health=json.load(r)
            if health.get('ok'):break
        except OSError:time.sleep(0.5)
    else:raise RuntimeError('Relay health check failed')
    run(['systemctl','is-active','--quiet',GATEWAY+'.service'])
    print('LOCAL_SERVICES_READY. MCP URL: https://'+a.domain+'/mcp')
    print('Credentials: /etc/mcp-pc-bridge/owner-setup.json (root only). Do not paste them into a chat.')
    print('Next: authorize the Windows SSH key, verify external TLS, then connect ChatGPT. These have NOT been verified here.')

def main():
    p=argparse.ArgumentParser(description='Fresh single-owner Linux installation; never upgrades an existing bridge')
    mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--check',action='store_true');mode.add_argument('--install',action='store_true')
    p.add_argument('--domain',required=True);p.add_argument('--device-id',default='desktop')
    p.add_argument('--cert',type=pathlib.Path,required=True);p.add_argument('--key',type=pathlib.Path,required=True)
    p.add_argument('--accept-remote-command-access',action='store_true');a=p.parse_args()
    try:
        if a.check:preflight(a);print('PREFLIGHT_OK. No installation files written; no services modified.')
        else:install(a)
    except Exception as e:
        print('INSTALLATION_STOPPED: '+str(e),file=sys.stderr)
        print('Inspect any partial new installation before retrying. No existing bridge is upgraded.',file=sys.stderr)
        return 1
    return 0
if __name__=='__main__':sys.exit(main())
