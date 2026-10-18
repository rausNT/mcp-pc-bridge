import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildGateway } from '../src/gateway.mjs';
import { random, digest, challenge } from '../src/auth.mjs';

test('real TLS: OAuth UI + consent + PKCE + MCP proxy, negatives and refresh',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'dc-https-'));
 const owner=random(),secret=random(),verifier=random();let hits=0,gotHeaders=null,gotBody=null;
 const upstream=createServer((req,res)=>{hits++;gotHeaders=req.headers;const chunks=[];req.on('data',x=>chunks.push(x));req.on('end',()=>{gotBody=Buffer.concat(chunks).toString();res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n');});});
 let gateway;
 try{
  execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-days','1',
   '-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-subj','/CN=mcp.example.invalid','-addext','subjectAltName=DNS:mcp.example.invalid'],{stdio:'ignore'});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const c={issuer:'https://mcp.example.invalid',resource:'https://mcp.example.invalid/mcp',clientId:'dc-'+ 'a'.repeat(32),
   clientSecretHash:digest(secret),ownerPasswordHash:digest(owner),mcpToken:'b'.repeat(64),
   redirectUris:['https://chatgpt.com/connector_platform_oauth_redirect'],upstream:`http://127.0.0.1:${upstream.address().port}/mcp`};
  const built=buildGateway(c,{tls:{key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))}});gateway=built.server;
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
  const call=(path,method='GET',data='',headers={})=>new Promise((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port:gateway.address().port,servername:'mcp.example.invalid',
    ca:readFileSync(join(dir,'cert.pem')),path,method,headers:{Host:'mcp.example.invalid',...headers}},res=>{
     const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));});
   req.on('error',reject);req.end(data);
  });
  await t.test('metadata accessible; no client secret advertised',async()=>{const r=await call('/.well-known/oauth-authorization-server');assert.equal(r.status,200);assert.ok(!r.text.includes(secret));assert.ok(JSON.parse(r.text).authorization_response_iss_parameter_supported);});
  await t.test('MCP without token never reaches relay',async()=>{const r=await call('/mcp','POST','{}',{'Content-Type':'application/json'});assert.equal(r.status,401);assert.ok(r.headers['www-authenticate'].includes('/.well-known/oauth-protected-resource/mcp'));assert.equal(hits,0);});
  await t.test('raw internal MCP token cannot bypass OAuth',async()=>{const r=await call('/mcp','POST','{}',{Authorization:'Bearer '+c.mcpToken});assert.equal(r.status,401);assert.equal(hits,0);});
  await t.test('wrong Host and foreign Origin rejected',async()=>{assert.equal((await call('/','GET','',{Host:'evil.invalid'})).status,421);assert.equal((await call('/','GET','',{Origin:'https://evil.invalid'})).status,403);});
  await t.test('device WS route not publicly exposed',async()=>assert.equal((await call('/device/ws')).status,404));
  const q=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUris[0],response_type:'code',code_challenge_method:'S256',code_challenge:challenge(verifier),resource:c.resource,scope:'desktop',state:random()});
  const login=await call('/oauth/authorize?'+q);assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'][0].split(';')[0], tx=/name="tx" value="([^"]+)"/.exec(login.text)[1],csrf=/name="csrf" value="([^"]+)"/.exec(login.text)[1];
  await t.test('login cookie has Secure/HttpOnly/SameSite protections',()=>{for(const s of ['Secure','HttpOnly','SameSite=Lax'])assert.ok(login.headers['set-cookie'][0].includes(s));});
  const form=new URLSearchParams({tx,csrf,password:owner,decision:'allow'}).toString();
  await t.test('consent without cookie rejected',async()=>assert.equal((await call('/oauth/consent','POST',form,{'Content-Type':'application/x-www-form-urlencoded',Origin:c.issuer})).status,403));
  const allowed=await call('/oauth/consent','POST',form,{'Content-Type':'application/x-www-form-urlencoded',Origin:c.issuer,Cookie:cookie});assert.equal(allowed.status,303);
  const code=new URL(allowed.headers.location).searchParams.get('code');
  const tok=await call('/oauth/token','POST',new URLSearchParams({client_id:c.clientId,client_secret:secret,resource:c.resource,grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:c.redirectUris[0]}).toString(),{'Content-Type':'application/x-www-form-urlencoded'});
  assert.equal(tok.status,200);const tokens=JSON.parse(tok.text);
  await t.test('valid OAuth token streams MCP and uses separate internal token',async()=>{const r=await call('/mcp','POST','{"jsonrpc":"2.0","id":1,"method":"tools/list"}',{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',Cookie:'must_not_leak=abc','X-Forwarded-Host':'evil.invalid'});assert.equal(r.status,200);assert.ok(r.text.includes('event: message'));assert.equal(hits,1);assert.equal(gotHeaders.authorization,'Bearer '+c.mcpToken);assert.ok(!gotHeaders.cookie);assert.ok(!gotHeaders['x-forwarded-host']);assert.equal(JSON.parse(gotBody).method,'tools/list');});
  await t.test('malformed/duplicate OAuth fields fail closed',async()=>{const r=await call('/oauth/token','POST','grant_type=refresh_token&grant_type=password',{'Content-Type':'application/x-www-form-urlencoded'});assert.equal(r.status,400);});
  await t.test('oversized OAuth body rejected',async()=>assert.equal((await call('/oauth/token','POST','a'.repeat(17000),{'Content-Type':'application/x-www-form-urlencoded'})).status,413));
  await t.test('real HTTP refresh rotates tokens; reuse revokes session',async()=>{
   const body=new URLSearchParams({client_id:c.clientId,client_secret:secret,resource:c.resource,grant_type:'refresh_token',refresh_token:tokens.refresh_token}).toString();
   const r=await call('/oauth/token','POST',body,{'Content-Type':'application/x-www-form-urlencoded'});assert.equal(r.status,200);const fresh=JSON.parse(r.text);
   assert.notEqual(fresh.refresh_token,tokens.refresh_token);
   const replay=await call('/oauth/token','POST',body,{'Content-Type':'application/x-www-form-urlencoded'});assert.equal(replay.status,400);
   const denied=await call('/mcp','POST','{}',{Authorization:'Bearer '+fresh.access_token});assert.equal(denied.status,401);assert.equal(hits,1);
  });
  await t.test('public login metadata contains no runtime secrets',()=>{for(const s of [owner,secret,c.mcpToken])assert.ok(!login.text.includes(s));});
 }finally{
  if(gateway){gateway.closeAllConnections();await new Promise(r=>gateway.close(r));}
  upstream.closeAllConnections();await new Promise(r=>upstream.close(r));rmSync(dir,{recursive:true,force:true});
 }
});
