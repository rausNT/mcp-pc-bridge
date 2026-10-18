#!/usr/bin/env python3
# Produces a customized public plugin package. Never accepts credentials.
import argparse, json, pathlib, re, urllib.parse, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
def validate_url(value):
    u=urllib.parse.urlsplit(value)
    if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path!='/mcp' or u.port:
        raise ValueError('Use https://your-domain/mcp without credentials, query, fragment or nonstandard port')
    if value!='https://'+u.hostname+'/mcp':raise ValueError('Use a canonical lowercase HTTPS endpoint')
    return value

def package(url,output,client_id=None):
    if client_id is not None and not re.fullmatch(r'[A-Za-z0-9._-]{1,128}',client_id):raise ValueError('Invalid public OAuth client ID')
    validate_url(url);output=pathlib.Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted((ROOT/'plugin').rglob('*')):
            if not p.is_file() or 'dist' in p.relative_to(ROOT/'plugin').parts:continue
            name=p.relative_to(ROOT/'plugin').as_posix();data=p.read_bytes()
            if name in ['mcp.json','.mcp.json']:
                obj=json.loads(data);obj['mcpServers']['desktop-bridge']['url']=url
                if client_id:
                    obj['mcpServers']['desktop-bridge']['extensions']={'com.openai':{'auth':{'type':'oauth','client':{'mode':'provided','clientId':client_id,'tokenEndpointAuthMethod':'client_secret_basic'},'baseScopes':['desktop']}}}
                data=(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode()
            z.writestr(name,data)
        z.writestr('LICENSE',(ROOT/'LICENSE').read_bytes())
    return output
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--client-id');a=p.parse_args()
    try:print(package(a.url,a.output,a.client_id))
    except Exception as e:p.exit(1,'ERROR: '+str(e)+'\n')
