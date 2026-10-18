#!/usr/bin/env python3
"""Explicit fresh-server wizard entry point. Never upgrades an existing bridge."""
import argparse, importlib.util, os, pathlib, re, shutil, socket, subprocess, sys
from configuration import validate_domain

def validate_request(domain, device_id, email, cert, key, accept_acme):
    domain=validate_domain(domain)
    if domain.endswith('.invalid'):raise ValueError('Use your own publicly reachable domain')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}',device_id):raise ValueError('Invalid device id')
    if bool(cert)!=bool(key):raise ValueError('Supply both certificate and key')
    if cert:
        if not pathlib.PurePosixPath(cert).is_absolute() or not pathlib.PurePosixPath(key).is_absolute():raise ValueError('TLS paths must be absolute')
    elif not accept_acme or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email or ''):
        raise ValueError('Automatic TLS requires an email and explicit acceptance of Let\'s Encrypt terms')
    return domain

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--domain',required=True);p.add_argument('--device-id',default='desktop')
    p.add_argument('--email');p.add_argument('--cert');p.add_argument('--key')
    p.add_argument('--accept-acme-terms',action='store_true')
    p.add_argument('--install',action='store_true');p.add_argument('--accept-remote-command-access',action='store_true')
    a=p.parse_args();a.domain=validate_request(a.domain,a.device_id,a.email,a.cert,a.key,a.accept_acme_terms)
    if sys.platform!='linux' or os.geteuid()!=0:raise RuntimeError('Use root on a fresh Ubuntu 24.04 server')
    release=dict(line.strip().split('=',1) for line in pathlib.Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if release.get('ID','').strip('"')!='ubuntu' or release.get('VERSION_ID','').strip('"')!='24.04':raise RuntimeError('The wizard currently supports Ubuntu 24.04 only')
    if not pathlib.Path('/run/systemd/system').is_dir():raise RuntimeError('A running systemd installation is required')
    # Refuse occupied project paths and public ports BEFORE installing packages.
    for name in ['/opt/mcp-pc-bridge','/etc/mcp-pc-bridge','/var/lib/mcp-pc-bridge','/etc/systemd/system/mcp-pc-bridge-relay.service','/etc/systemd/system/mcp-pc-bridge-gateway.service']:
        if os.path.lexists(name):raise RuntimeError('Existing installation; inspect before retrying: '+name)
    import pwd
    for user in ['mcp-pc-bridge-relay','mcp-pc-bridge-gateway','mcp-pc-bridge-agent']:
        try:pwd.getpwnam(user)
        except KeyError:pass
        else:raise RuntimeError('Existing project identity; inspect before retrying: '+user)
    for port in ([80,443,8787] if not a.cert else [443,8787]):
        with socket.socket() as probe:probe.bind(('0.0.0.0',port))
    if shutil.disk_usage('/opt').free<1024**3:raise RuntimeError('At least 1 GiB free under /opt is required')
    socket.getaddrinfo(a.domain,443,type=socket.SOCK_STREAM)
    if a.cert:
        spec=importlib.util.spec_from_file_location('wizard_certs',pathlib.Path(__file__).resolve().parent/'stage2/deploy/certs.py')
        certs=importlib.util.module_from_spec(spec);spec.loader.exec_module(certs)
        certs.check_pair(pathlib.Path(a.cert),pathlib.Path(a.key),a.domain)
    if not a.install:
        print('WIZARD_PREFLIGHT_OK. No packages, certificates or services changed.');return
    if not a.accept_remote_command_access:raise RuntimeError('Explicit remote-command access acceptance is required')
    packages=['python3','openssl','openssh-server','iproute2','tar','xz-utils','ca-certificates']
    if not a.cert:packages.append('certbot')
    subprocess.run(['apt-get','update'],check=True)
    subprocess.run(['apt-get','install','-y','--no-install-recommends']+packages,check=True,env={**os.environ,'DEBIAN_FRONTEND':'noninteractive'})
    if not a.cert:
        subprocess.run(['certbot','certonly','--standalone','--non-interactive','--agree-tos','--email',a.email,'-d',a.domain,'--cert-name','mcp-pc-bridge'],check=True)
        a.cert='/etc/letsencrypt/live/mcp-pc-bridge/fullchain.pem';a.key='/etc/letsencrypt/live/mcp-pc-bridge/privkey.pem'
    source=pathlib.Path(__file__).resolve().parent
    subprocess.run([sys.executable,str(source/'install.py'),'--install','--accept-remote-command-access','--domain',a.domain,'--device-id',a.device_id,'--cert',a.cert,'--key',a.key],check=True)
    if a.accept_acme_terms and a.cert.startswith('/etc/letsencrypt/live/mcp-pc-bridge/'):
        # Certbot HTTP-01 renewal needs TCP 80 to remain reachable and unused.
        subprocess.run(['systemctl','enable','--now','certbot.timer'],check=True)
    print('WIZARD_SERVER_INSTALLED. Complete Windows pairing and ChatGPT OAuth; neither is implied by this result.')

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('WIZARD_STOPPED: '+str(e),file=sys.stderr)
        print('A partial install may exist. Inspect state before retrying; never delete unrelated services.',file=sys.stderr)
        sys.exit(1)
