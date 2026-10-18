#!/usr/bin/env python3
"""Check final assets, manifests, hashes and payloads extracted by the GUI itself."""
import argparse, hashlib, json, pathlib, re, subprocess, sys, tarfile, tempfile, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
NAMES={'pc-bridge.exe','pc-bridge-core.exe','mcp-pc-bridge-windows-amd64.zip','mcp-pc-bridge-plugin-template.zip','mcp-pc-bridge-server.tar.gz','mcp-pc-bridge-source.zip'}
FORBIDDEN={'.git','.local','local-only','node_modules','bin','obj','__pycache__','START_HERE.md','CODEX_TASK.md'}
def digest(data):return hashlib.sha256(data).hexdigest()
def safe(name):
    p=pathlib.PurePosixPath(name)
    assert not p.is_absolute() and '..' not in p.parts and not FORBIDDEN.intersection(p.parts), 'Unexpected archive path: '+name
def verify():
    out=ROOT/'dist';lines=(out/'SHA256SUMS').read_text().splitlines();found={}
    for line in lines:
        sha,name=line.split('  ',1);assert name in NAMES and name not in found;found[name]=sha
        assert digest((out/name).read_bytes())==sha,'Checksum mismatch: '+name
    assert set(found)==NAMES
    assert {p.name for p in out.iterdir() if p.is_file()}==NAMES|{'SHA256SUMS'},'Stale/unlisted dist files'
    for archive in sorted(out.glob('*.zip')):
        with zipfile.ZipFile(archive) as z:
            assert z.testzip() is None
            assert len(z.namelist())==len(set(z.namelist()))
            for name in z.namelist():safe(name)
            if 'plugin-template' in archive.name:
                root=json.loads(z.read('plugin.json'));legacy=json.loads(z.read('.codex-plugin/plugin.json'))
                assert root['name']==legacy['name']=='mcp-pc-bridge'
                assert root['version']==legacy['version']=='0.2.0-preview.1'
                assert root['extensions']['com.openai']['interface']==legacy['interface']
                for name in ('mcp.json','.mcp.json'):
                    assert json.loads(z.read(name))['mcpServers']['desktop-bridge']['url']=='https://mcp.example.invalid/mcp'
                    assert 'clientSecret' not in z.read(name).decode()
            if '-windows-' in archive.name:
                for name in ('pc-bridge.exe','pc-bridge-core.exe'):assert digest(z.read(name))==found[name]
                for name in ('licenses/dotnet-runtime-license.txt','licenses/dotnet-runtime-third-party.txt','licenses/dotnet-windowsdesktop-license.txt'):assert name in z.namelist()
            if '-source' in archive.name:
                for name in z.namelist():
                    assert not pathlib.PurePosixPath(name).suffix.lower() in {'.exe','.dll','.pdb','.dpapi','.key','.pem','.log'},name
                    z.read(name).decode('utf-8-sig')
    with tarfile.open(out/'mcp-pc-bridge-server.tar.gz') as tf:
        for item in tf.getmembers():safe(item.name);assert item.isfile() and not item.issym() and not item.islnk()
        assert 'mcp-pc-bridge/server/wizard-install.py' in tf.getnames()
    if sys.platform=='win32':
        result=subprocess.run([str(out/'pc-bridge-core.exe'),'version'],capture_output=True,text=True,check=True)
        assert result.stdout.strip()=='MCP PC Bridge 0.2.0-preview.1'
        (ROOT/'.local').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='release-verification-',dir=ROOT/'.local') as d:
            target=pathlib.Path(d)/'embedded'
            subprocess.run([str(out/'pc-bridge.exe'),'--verify-release',str(target)],check=True,timeout=60)
            for name in ('pc-bridge-core.exe','mcp-pc-bridge-server.tar.gz','mcp-pc-bridge-plugin-template.zip'):
                assert digest((target/name).read_bytes())==found[name],'GUI embeds a different payload: '+name
    print('RELEASE_VERIFICATION_PASSED: archives, manifests, licenses, checksums and embedded GUI payloads')
if __name__=='__main__':verify()
