#!/usr/bin/env python3
"""Real installation test ONLY on an ephemeral GitHub-hosted Ubuntu runner.
Uses synthetic TLS/SSH keys; never targets an external host or a user's server.
"""
import json, os, pathlib, socket, subprocess, sys, tempfile, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
def run(args,**kwargs):return subprocess.run([str(x) for x in args],check=True,**kwargs)
def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def main():
    if sys.platform!='linux' or os.geteuid()!=0 or os.getenv('GITHUB_ACTIONS')!='true' or os.getenv('RUNNER_ENVIRONMENT') not in ('github-hosted',None):
        raise RuntimeError('This script is restricted to disposable GitHub-hosted Linux CI')
    if pathlib.Path('/opt/mcp-pc-bridge').exists():raise RuntimeError('Existing installation: refusing test')
    stage=pathlib.Path(tempfile.mkdtemp(prefix='pc-bridge-ci-'));os.chmod(stage,0o755)
    key=stage/'cert.key';cert=stage/'cert.pem'
    run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','4','-subj','/CN=mcp.example.invalid','-addext','subjectAltName=DNS:mcp.example.invalid'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    args=[sys.executable,ROOT/'server/install.py','--domain','mcp.example.invalid','--device-id','ci-desktop','--cert',cert,'--key',key]
    run(args+['--check']);run(args+['--install','--accept-remote-command-access'])
    # A second installation must fail without replacing any credentials.
    original=(pathlib.Path('/etc/mcp-pc-bridge')/'owner-setup.json').read_bytes()
    result=subprocess.run([str(x) for x in args+['--install','--accept-remote-command-access']],capture_output=True)
    assert result.returncode!=0 and original==(pathlib.Path('/etc/mcp-pc-bridge')/'owner-setup.json').read_bytes()
    run(['systemctl','is-active','--quiet','mcp-pc-bridge-relay','mcp-pc-bridge-gateway'])
    run(['systemctl','start','ssh'])
    device=stage/'device';run(['ssh-keygen','-t','ed25519','-N','','-f',device],stdout=subprocess.DEVNULL)
    run([sys.executable,ROOT/'server/authorize-device.py','--public-key-file',str(device)+'.pub','--configure-ssh'])
    # Trust is derived from this disposable server's console/files, not TOFU or a bypass.
    known=stage/'known_hosts'
    hostkey=pathlib.Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()
    known.write_text('127.0.0.1 '+hostkey[0]+' '+hostkey[1]+'\n')
    base=['ssh','-T','-i',str(device),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(known),'-o','ConnectTimeout=5']
    destination='mcp-pc-bridge-agent@127.0.0.1';port=free_port()
    forward=subprocess.Popen(base+['-N','-o','ExitOnForwardFailure=yes','-L',f'127.0.0.1:{port}:127.0.0.1:8787',destination],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        healthy=False
        for _ in range(50):
            try:
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f'http://127.0.0.1:{port}/healthz',timeout=1) as r:healthy=json.load(r)['ok']
                if healthy:break
            except OSError:time.sleep(.1)
        assert healthy,'Authorized local forwarding failed'
        shell=subprocess.run(base+[destination,'true'],capture_output=True,timeout=10);assert shell.returncode!=0,'Shell unexpectedly allowed'
        reverse=subprocess.run(base+['-N','-o','ExitOnForwardFailure=yes','-R',f'127.0.0.1:{free_port()}:127.0.0.1:8787',destination],capture_output=True,timeout=10)
        assert reverse.returncode!=0 and b'forwarding failed' in reverse.stderr,'Reverse TCP forwarding not rejected'
        unix=subprocess.run(base+['-N','-o','ExitOnForwardFailure=yes','-R',str(stage/'forbidden.sock')+':127.0.0.1:8787',destination],capture_output=True,timeout=10)
        assert unix.returncode!=0 and b'forwarding failed' in unix.stderr,'Unix socket forwarding not rejected'
        print('CI_SERVER_ACCEPTANCE_PASSED: fresh install, duplicate refusal, services, real local forwarding, shell/reverse/unix denial. Synthetic certificate; no public DNS or ChatGPT OAuth claimed.')
    finally:
        forward.terminate()
        try:forward.wait(timeout=5)
        except subprocess.TimeoutExpired:forward.kill();forward.wait()
if __name__=='__main__':main()
