#!/usr/bin/env python3
# Builds reviewed sources only; .NET restore may use NuGet. No setup/deployment/publication.
import argparse, gzip, hashlib, json, os, pathlib, shutil, subprocess, tarfile, zipfile
from package_plugin import package
ROOT=pathlib.Path(__file__).resolve().parents[1]
VERSION='0.2.0-preview.1'
SKIP={'.git','node_modules','__pycache__','dist','.local','bin','obj'}
def source_files():
    return sorted(p for p in ROOT.rglob('*') if p.is_file() and not any(x in SKIP for x in p.relative_to(ROOT).parts))
def zip_files(target,items):
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
        for p,name in items:z.write(p,name)
def server_archive(target,files):
    with target.open('wb') as f,gzip.GzipFile(fileobj=f,mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as tf:
        for p in files:
            rel=p.relative_to(ROOT).as_posix()
            if not (rel.startswith(('server/','licenses/','docs/')) or rel in ['LICENSE','THIRD_PARTY_NOTICES.md','SECURITY.md','README.md']):continue
            info=tf.gettarinfo(str(p),arcname='mcp-pc-bridge/'+rel);info.uid=info.gid=0;info.uname=info.gname='';info.mtime=0
            info.mode=0o755 if p.suffix=='.sh' else 0o644
            with p.open('rb') as stream:tf.addfile(info,stream)
def main():
    a=argparse.ArgumentParser();a.add_argument('--go',default=shutil.which('go'));a.add_argument('--dotnet',default=shutil.which('dotnet'));a.add_argument('--payloads-only',action='store_true');args=a.parse_args()
    out=ROOT/'dist';out.mkdir(exist_ok=True)
    if args.payloads_only:
        package('https://mcp.example.invalid/mcp',out/'mcp-pc-bridge-plugin-template.zip')
        server_archive(out/'mcp-pc-bridge-server.tar.gz',source_files());return
    if not args.go:a.error('Go is required; install it yourself or pass --go PATH')
    if not args.dotnet:a.error('.NET 10 SDK is required; install it yourself or pass --dotnet PATH')
    subprocess.run([os.sys.executable,str(ROOT/'tools/check_public_tree.py')],check=True)
    subprocess.run([os.sys.executable,str(ROOT/'tools/check_dependencies.py')],check=True)
    out=ROOT/'dist';out.mkdir(exist_ok=True);exe=out/'pc-bridge-core.exe'
    env={**os.environ,'GOOS':'windows','GOARCH':'amd64','CGO_ENABLED':'0'}
    subprocess.run([args.go,'build','-trimpath','-ldflags=-s -w','-o',str(exe),'.'],cwd=ROOT/'windows/client',env=env,check=True)
    package('https://mcp.example.invalid/mcp',out/'mcp-pc-bridge-plugin-template.zip')
    server_archive(out/'mcp-pc-bridge-server.tar.gz',source_files())
    publish=ROOT/'.local/gui-publish';publish.mkdir(parents=True,exist_ok=True)
    subprocess.run([args.dotnet,'publish',str(ROOT/'windows/gui/PcBridge.Gui.csproj'),'-c','Release','-r','win-x64','--self-contained','true','-p:PublishSingleFile=true','-p:IncludeNativeLibrariesForSelfExtract=true','-p:DebugType=None','-p:DebugSymbols=false',f'-p:PathMap={ROOT}=/_/src','-o',str(publish),'--nologo'],check=True)
    gui=out/'pc-bridge.exe';shutil.copyfile(publish/gui.name,gui)
    common=[(ROOT/name,name) for name in ['LICENSE','THIRD_PARTY_NOTICES.md','SECURITY.md']]
    common += [(p,p.relative_to(ROOT).as_posix()) for p in (ROOT/'licenses').glob('*') if p.is_file()]
    zip_files(out/'mcp-pc-bridge-windows-amd64.zip',[(gui,gui.name),(exe,exe.name),(ROOT/'windows/README.md','README.md'),(ROOT/'docs/DEPLOYMENT.md','docs/DEPLOYMENT.md'),(ROOT/'docs/VERIFICATION.md','docs/VERIFICATION.md')]+common)
    files=source_files()
    zip_files(out/'mcp-pc-bridge-source.zip',[(p,'mcp-pc-bridge/'+p.relative_to(ROOT).as_posix()) for p in files])
    names=['pc-bridge.exe','pc-bridge-core.exe','mcp-pc-bridge-windows-amd64.zip','mcp-pc-bridge-plugin-template.zip','mcp-pc-bridge-server.tar.gz','mcp-pc-bridge-source.zip']
    sums=[]
    for name in names:
        with (out/name).open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
        sums.append(sha+'  '+name)
    (out/'SHA256SUMS').write_text('\n'.join(sums)+'\n',encoding='utf-8')
    print('ARTIFACTS_PREPARED',VERSION)
    print('No repository/release published by this build. Clean-machine installation and public OAuth remain separate acceptance checks.')
if __name__=='__main__':main()
