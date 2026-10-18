import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Auth, random, digest, challenge, fields } from '../src/auth.mjs';
import { validate } from '../src/gateway.mjs';
const owner=random(),secret=random(),verifier=random();
const c={issuer:'https://mcp.example.invalid',resource:'https://mcp.example.invalid/mcp',upstream:'http://127.0.0.1:8787/mcp',
  clientId:'dc-'+'a'.repeat(32),clientSecretHash:digest(secret),ownerPasswordHash:digest(owner),mcpToken:'b'.repeat(64),
  redirectUris:['https://chatgpt.com/connector_platform_oauth_redirect']};
const p=()=>({client_id:c.clientId,redirect_uri:c.redirectUris[0],response_type:'code',code_challenge_method:'S256',
  code_challenge:challenge(verifier),resource:c.resource,scope:'desktop',state:random()});
const base=()=>({client_id:c.clientId,client_secret:secret,resource:c.resource});
function login(a){const x=a.begin(p());return new URL(a.consent(x.id,x.csrf,x.cookie,owner,true)).searchParams.get('code');}
function tokens(a){return a.token({...base(),grant_type:'authorization_code',code:login(a),redirect_uri:c.redirectUris[0],code_verifier:verifier});}

test('valid fixed configuration accepted',()=>assert.equal(validate(c),c));
for(const [name,patch] of [ ['public/upstream injection',{upstream:'http://example.org/'}],['wrong resource',{resource:c.issuer}],
  ['wildcard callback',{redirectUris:['https://chatgpt.com/*']}],['missing secret',{clientSecretHash:''}] ])
  test('config rejects '+name,()=>assert.throws(()=>validate({...c,...patch})));
test('duplicate OAuth fields rejected',()=>assert.throws(()=>fields(new URLSearchParams('state=a&state=b'))));
for(const [name,patch] of [ ['foreign redirect',{redirect_uri:'https://evil.invalid/cb'}], ['redirect prefix bypass',{redirect_uri:c.redirectUris[0]+'.evil'}],
  ['plain PKCE',{code_challenge_method:'plain'}], ['missing PKCE',{code_challenge:''}],['wrong audience',{resource:c.issuer}],
  ['unknown client',{client_id:'other'}],['wrong scope',{scope:'admin'}],['implicit flow',{response_type:'token'}],['missing state',{state:''}] ])
  test('authorize rejects '+name,()=>assert.throws(()=>new Auth(c).begin({...p(),...patch})));
test('login requires matching cookie',()=>{const a=new Auth(c),x=a.begin(p());assert.throws(()=>a.consent(x.id,x.csrf,'wrong',owner,true));});
test('login requires CSRF',()=>{const a=new Auth(c),x=a.begin(p());assert.throws(()=>a.consent(x.id,'wrong',x.cookie,owner,true));});
test('login wrong password consumes transaction',()=>{const a=new Auth(c),x=a.begin(p());assert.throws(()=>a.consent(x.id,x.csrf,x.cookie,'wrong',true));assert.throws(()=>a.consent(x.id,x.csrf,x.cookie,owner,true));});
test('consent returns exact redirect with state and issuer',()=>{const a=new Auth(c),q=p(),x=a.begin(q);const u=new URL(a.consent(x.id,x.csrf,x.cookie,owner,true));assert.equal(u.origin+u.pathname,c.redirectUris[0]);assert.equal(u.searchParams.get('iss'),c.issuer);assert.equal(u.searchParams.get('state'),q.state);assert.ok(u.searchParams.get('code'));});
test('denial returns issuer, not code',()=>{const a=new Auth(c),x=a.begin(p());const u=new URL(a.consent(x.id,x.csrf,x.cookie,owner,false));assert.equal(u.searchParams.get('error'),'access_denied');assert.equal(u.searchParams.get('iss'),c.issuer);assert.ok(!u.searchParams.has('code'));});
test('expired login fails',()=>{let now=0;const a=new Auth(c,null,()=>now),x=a.begin(p());now=301;assert.throws(()=>a.consent(x.id,x.csrf,x.cookie,owner,true));});
test('wrong verifier fails and consumes code',()=>{const a=new Auth(c),code=login(a),q={...base(),grant_type:'authorization_code',code,redirect_uri:c.redirectUris[0],code_verifier:random()};assert.throws(()=>a.token(q));assert.throws(()=>a.token({...q,code_verifier:verifier}));});
test('code cannot be exchanged twice',()=>{const a=new Auth(c),q={...base(),grant_type:'authorization_code',code:login(a),redirect_uri:c.redirectUris[0],code_verifier:verifier};assert.ok(a.token(q).access_token);assert.throws(()=>a.token(q));});
test('client secret required',()=>{const a=new Auth(c);assert.throws(()=>a.token({...base(),client_secret:'wrong',grant_type:'refresh_token'}));});
test('Basic client authentication supported',()=>{const a=new Auth(c);const h='Basic '+Buffer.from(c.clientId+':'+secret).toString('base64');assert.doesNotThrow(()=>a.client({},h));});
test('mixed client methods rejected',()=>{const a=new Auth(c);assert.throws(()=>a.client(base(),'Basic '+Buffer.from(c.clientId+':'+secret).toString('base64')));});
test('correct token accepted; random, device/client secret and refresh denied',()=>{const a=new Auth(c),t=tokens(a);assert.ok(a.access(t.access_token));for(const x of [random(),secret,c.mcpToken,t.refresh_token,undefined])assert.equal(a.access(x),false);});
test('access expires after one hour',()=>{let now=100;const a=new Auth(c,null,()=>now),t=tokens(a);now+=3601;assert.equal(a.access(t.access_token),false);});
test('refresh rotates, reuse revokes whole grant',()=>{const a=new Auth(c),t=tokens(a),q={...base(),grant_type:'refresh_token',refresh_token:t.refresh_token};const t2=a.token(q);assert.ok(a.access(t2.access_token));assert.throws(()=>a.token(q));assert.equal(a.access(t2.access_token),false);assert.equal(a.access(t.access_token),false);});
test('refresh resource mismatch rejected without use',()=>{const a=new Auth(c),t=tokens(a),q={...base(),grant_type:'refresh_token',refresh_token:t.refresh_token};assert.throws(()=>a.token({...q,resource:'https://other.invalid'}));assert.ok(a.token(q).access_token);});
test('revocation invalidates access and refresh',()=>{const a=new Auth(c),t=tokens(a);a.revoke({...base(),token:t.access_token});assert.equal(a.access(t.access_token),false);assert.throws(()=>a.token({...base(),grant_type:'refresh_token',refresh_token:t.refresh_token}));});
test('persistent state contains no bearer tokens or passwords; survives restart',()=>{const dir=mkdtempSync(join(tmpdir(),'dc-auth-'));try{const path=join(dir,'state.json'),a=new Auth(c,path),t=tokens(a);const raw=readFileSync(path,'utf8');for(const s of [t.access_token,t.refresh_token,owner,secret])assert.ok(!raw.includes(s));assert.equal(statSync(path).mode&0o777,0o600);const a2=new Auth(c,path);assert.ok(a2.access(t.access_token));assert.ok(a2.token({...base(),grant_type:'refresh_token',refresh_token:t.refresh_token}).access_token);}finally{rmSync(dir,{recursive:true,force:true});}});
test('metadata advertises PKCE and issuer identification but no public registration',()=>{const a=new Auth(c),m=a.metadata();assert.deepEqual(m.code_challenge_methods_supported,['S256']);assert.equal(m.authorization_response_iss_parameter_supported,true);assert.equal(m.registration_endpoint,undefined);assert.equal(a.resource().resource,c.resource);});
