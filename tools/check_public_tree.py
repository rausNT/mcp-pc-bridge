#!/usr/bin/env python3
# Heuristic preflight, not a security certification. Reports locations, never secret values.
import argparse, ipaddress, pathlib, re, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
SKIP={'.git','node_modules','__pycache__','dist','.local','bin','obj'}
PRIVATE_NAMES={'owner-setup.json','gateway.json','config.json','tokens.json','relay.env','agent.lock','PUBLISH_LOCAL.md'}
PATTERNS=[(kind,re.compile(pattern,re.I if kind=="personal-Windows-path" else 0)) for kind,pattern in [('private-key', '-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----'), ('github-token', '(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})'), ('api-key', 'sk-(?:proj-)?[A-Za-z0-9_-]{32,}'), ('personal-Windows-path', '[A-Za-z]:\\\\Users\\\\[^\\s"<>]+'), ('credential-in-URL', 'https?://[^\\s/"\']+:[^\\s/"\'@]+@')]]

def check(root,deny=()):
    problems=[]
    for p in root.rglob('*'):
        rel=p.relative_to(root)
        if any(part in SKIP for part in rel.parts):continue
        if p.is_symlink():problems.append((str(rel),0,'symlink'));continue
        if not p.is_file():continue
        if p.name in PRIVATE_NAMES or p.suffix.lower() in {'.dpapi','.pem','.key','.pfx','.p12','.log'} or (p.name.startswith('.env') and not p.name.endswith('.example')):
            problems.append((str(rel),0,'runtime-or-secret-file'))
        raw=p.read_bytes()
        try:text=raw.decode('utf-8-sig')
        except UnicodeDecodeError:problems.append((str(rel),0,'unexpected-binary-in-source'));continue
        for number,line in enumerate(text.splitlines(),1):
            for kind,pattern in PATTERNS:
                if pattern.search(line):problems.append((str(rel),number,kind))
            if any(value and value.lower() in line.lower() for value in deny):problems.append((str(rel),number,'private-deny-value'))
    return problems

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,default=ROOT);p.add_argument('--deny-values-file',type=pathlib.Path);a=p.parse_args()
    deny=a.deny_values_file.read_text(encoding='utf-8').splitlines() if a.deny_values_file else []
    found=check(a.root,deny)
    for path,line,kind in found:print(f'{path}:{line}: {kind}; value suppressed')
    print('PUBLIC_TREE_PREFLIGHT_'+('FAILED' if found else 'PASSED'))
    print('Also review Git history, GitHub assets, archives and binaries with a dedicated secret scanner before publication.')
    sys.exit(bool(found))
