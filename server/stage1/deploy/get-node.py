#!/usr/bin/env python3
"""Fetch an official Node 24 LTS Linux binary into a private runtime directory.
No OS package manager or system node is modified. Verify SHA256 before unpacking.
"""
import hashlib,json,pathlib,platform,re,sys,tarfile,urllib.request
root=pathlib.Path(sys.argv[1]).resolve()
arch={'x86_64':'x64','aarch64':'arm64'}.get(platform.machine())
if not arch: raise SystemExit('Unsupported architecture')
headers={'User-Agent':'mcp-pc-bridge-installer/0.2.0-preview.1'}
def fetch(url):
    if not url.startswith('https://nodejs.org/dist/'): raise ValueError('untrusted download URL')
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=90) as r:return r.read()
version='v24.21.0' # Reviewed release; do not silently adopt a newer runtime.
name=f'node-{version}-linux-{arch}'; filename=name+'.tar.xz'
url=f'https://nodejs.org/dist/{version}/'
checks=fetch(url+'SHASUMS256.txt').decode('ascii')
expected=next((line.split()[0] for line in checks.splitlines() if line.split()[-1:]==[filename]),None)
if not expected or not re.fullmatch('[0-9a-f]{64}',expected): raise SystemExit('Archive missing from checksums')
root.mkdir(parents=True,exist_ok=True); target=root/name
if target.exists(): raise SystemExit('Runtime target exists; refusing to overwrite')
archive=root/filename
raw=fetch(url+filename)
if hashlib.sha256(raw).hexdigest()!=expected: raise SystemExit('Node archive checksum mismatch')
archive.write_bytes(raw)
with tarfile.open(archive,'r:xz') as tf:
    for m in tf.getmembers():
        p=pathlib.PurePosixPath(m.name)
        if p.is_absolute() or '..' in p.parts or p.parts[0]!=name or m.isdev():raise SystemExit('Unsafe archive entry')
    # Ubuntu 24.04 Python supports the safe data extraction filter.
    tf.extractall(root,filter='data')
(root/'RUNTIME_PROVENANCE.json').write_text(json.dumps({'version':version,'url':url+filename,'sha256':expected},indent=2)+'\n')
archive.unlink()
print(str(target))
