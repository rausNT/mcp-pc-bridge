#!/usr/bin/env python3
"""Fail closed on unreviewed npm versions, origins, licenses or notice changes.

--record is an explicit maintainer action after reviewing the installed packages;
it is never run by CI or the build. Install both lockfiles with npm ci first.
"""
import argparse, hashlib, json, pathlib, sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
TREES=('windows/client','server/stage1')
ALLOWED={'MIT','ISC','BSD-3-Clause','Apache-2.0'}
INVENTORY=ROOT/'licenses/npm-inventory.json'
NOTICES=ROOT/'licenses/npm-THIRD-PARTY.txt'

def digest(data):return hashlib.sha256(data).hexdigest()

def inspect(root=ROOT, installed=False):
    records=[];texts={}
    for tree in TREES:
        lock=json.loads((root/tree/'package-lock.json').read_text(encoding='utf-8'))
        package=json.loads((root/tree/'package.json').read_text(encoding='utf-8'))
        if package.get('dependencies',{})!=lock['packages'][''].get('dependencies',{}):raise ValueError('Manifest/lock mismatch: '+tree)
        for location,entry in sorted(lock['packages'].items()):
            if not location:continue
            if entry.get('license') not in ALLOWED:raise ValueError('Unreviewed license: '+tree+'/'+location)
            if not entry.get('resolved','').startswith('https://registry.npmjs.org/') or not entry.get('integrity','').startswith('sha512-'):
                raise ValueError('Missing official-registry integrity: '+tree+'/'+location)
            if entry.get('link') or entry.get('hasInstallScript'):raise ValueError('Local link/install hook is not allowed: '+location)
            record={key:entry[key] for key in ('version','license','resolved','integrity')}
            record.update(tree=tree,location=location)
            if installed:
                base=root/tree/location;meta=json.loads((base/'package.json').read_text(encoding='utf-8'))
                if meta['version']!=entry['version'] or meta.get('license')!=entry['license']:raise ValueError('Installed metadata mismatch: '+location)
                files=sorted(p for p in base.iterdir() if p.is_file() and p.name.lower().startswith(('license','licence','copying','notice','copyright','authors')))
                if not files:raise ValueError('No license text: '+location)
                record['notices']={}
                for p in files:
                    content=p.read_bytes();content.decode('utf-8')
                    record['notices'][p.name]=digest(content)
                    # Preserve upstream bytes, copyright holders and complete mixed-license notices.
                    texts[(meta['name'],meta['version'],p.name)]=content
            records.append(record)
    return records,texts

def notice_bundle(texts):
    data=b'Third-party npm notices. Unmodified upstream license texts follow.\n'
    for (name,version,filename),content in sorted(texts.items()):
        data+=f'\n===== {name}@{version} / {filename} =====\n'.encode()+content+b'\n'
    return data

def check(root=ROOT, installed=False):
    actual,texts=inspect(root,installed)
    approved=json.loads((root/'licenses/npm-inventory.json').read_text(encoding='utf-8'))
    expected=approved['packages']
    if not installed:expected=[{k:v for k,v in item.items() if k!='notices'} for item in expected]
    if actual!=expected:raise ValueError('Dependency inventory changed; review exact packages/licenses before recording a new inventory')
    notices=(root/'licenses/npm-THIRD-PARTY.txt').read_bytes()
    if digest(notices)!=approved['noticeBundleSha256']:raise ValueError('Third-party notice bundle changed')
    if installed and notice_bundle(texts)!=notices:raise ValueError('Installed license texts differ from preserved notices')
    return len(actual)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--installed',action='store_true',help='Also compare actual npm license files after npm ci')
    parser.add_argument('--record',action='store_true',help='Explicitly record already reviewed installed dependencies; never used automatically')
    args=parser.parse_args()
    try:
        if args.record:
            packages,texts=inspect(installed=True);bundle=notice_bundle(texts)
            NOTICES.write_bytes(bundle)
            INVENTORY.write_text(json.dumps({'schema':1,'noticeBundleSha256':digest(bundle),'packages':packages},indent=2)+'\n',encoding='utf-8')
        count=check(installed=args.installed or args.record)
        print(f'DEPENDENCIES_OK: {count} lockfile entries match the reviewed inventory; no unknown licenses or install hooks.')
    except (ValueError,OSError,KeyError) as error:
        print('DEPENDENCIES_REJECTED: '+str(error),file=sys.stderr);return 1
    return 0

if __name__=='__main__':sys.exit(main())
