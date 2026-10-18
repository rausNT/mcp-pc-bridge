// HTTPS/OAuth facade for the existing, unchanged loopback stage-1 MCP relay.
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Auth, OAuthError, fields } from './auth.mjs';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = (res, code, obj) => { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); };
async function body(req, limit) {
  const chunks = []; let n=0;
  if (Number(req.headers['content-length'] || 0)>limit) throw new OAuthError('body_too_large',413);
  if (req.headers['content-encoding']) throw new OAuthError('content_encoding_not_allowed',415);
  for await (const chunk of req) { n += chunk.length; if(n>limit) throw new OAuthError('body_too_large',413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function form(req, raw) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/x-www-form-urlencoded')) throw new OAuthError('form_required',415);
  return fields(new URLSearchParams(raw.toString('utf8')));
}
function cookie(req) {
  return (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-dc-auth='))?.slice(15) || '';
}
export function validate(c) {
  let issuer;
  try { issuer = new URL(c.issuer); } catch { throw new Error('CONFIG_ENDPOINT_INVALID'); }
  if(issuer.protocol !== 'https:' || issuer.origin !== c.issuer || issuer.username || issuer.password || issuer.port ||
      !/^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+$/i.test(issuer.hostname) ||
      c.resource !== c.issuer+'/mcp' || c.upstream !== 'http://127.0.0.1:8787/mcp') throw new Error('CONFIG_ENDPOINT_INVALID');
  if(!/^[a-f0-9]{64}$/.test(c.mcpToken) || !/^[a-f0-9]{64}$/.test(c.clientSecretHash) || !/^[a-f0-9]{64}$/.test(c.ownerPasswordHash)) throw new Error('CONFIG_SECRET_INVALID');
  if(!/^dc-[a-f0-9]{32}$/.test(c.clientId)) throw new Error('CONFIG_CLIENT_INVALID');
  if(!Array.isArray(c.redirectUris) || c.redirectUris.length < 1 || c.redirectUris.some(x => x !== 'https://chatgpt.com/connector_platform_oauth_redirect' && !/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(x))) throw new Error('CONFIG_REDIRECT_INVALID');
  return c;
}
export function buildGateway(config, { stateFile, tls, auth = new Auth(config,stateFile) } = {}) {
  const c=config, issuerHost=new URL(c.issuer).host;
  let active=0;
  const counts = new Map();
  let allWindow = 0, allCount = 0;
  function rate(req, group, max) {
    const window = Math.floor(Date.now()/60000);
    if (window!==allWindow) { allWindow=window; allCount=0; counts.clear(); }
    if (++allCount>3000) throw new OAuthError('rate_limited',429);
    const key=group+'|'+req.socket.remoteAddress;
    if(!counts.has(key) && counts.size>=4096) throw new OAuthError('rate_limited',429);
    const n=(counts.get(key)||0)+1; counts.set(key,n);
    if(n>max) throw new OAuthError('rate_limited',429);
  }
  const server=createServer({ ...tls, minVersion:'TLSv1.2', maxHeaderSize:16384, ALPNProtocols:['http/1.1'] }, async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Pragma','no-cache');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    // No HSTS preload/includeSubDomains: don't change policy for the existing VPN/web domain.
    try {
      if(![issuerHost,issuerHost+':443'].includes(req.headers.host)) throw new OAuthError('wrong_host',421);
      if(req.url.length>8192 || !req.url.startsWith('/') || req.url.startsWith('//')) throw new OAuthError('invalid_request');
      const u=new URL(req.url,c.issuer), path=u.pathname, origin=req.headers.origin;
      if(origin && ![c.issuer,'https://chatgpt.com'].includes(origin)) throw new OAuthError('origin_denied',403);
      if(origin) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); }
      if(req.method==='OPTIONS' && path==='/mcp') {
        rate(req,'other',180);
        res.writeHead(204, {'Access-Control-Allow-Methods':'POST, GET, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, MCP-Session-Id, Last-Event-ID'});res.end();return;
      }
      if(req.method==='GET' && (path==='/.well-known/oauth-protected-resource' || path==='/.well-known/oauth-protected-resource/mcp')) {
        rate(req,'metadata',240); json(res,200,auth.resource());return;
      }
      if(req.method==='GET' && path==='/.well-known/oauth-authorization-server') {
        rate(req,'metadata',240);json(res,200,auth.metadata());return;
      }
      if(req.method==='GET' && path==='/') {
        rate(req,'other',120);json(res,200,{service:'Private MCP gateway',authentication:'OAuth required'});return;
      }
      if(path==='/oauth/authorize' && req.method==='GET') {
        rate(req,'authorize',30);
        const tx=auth.begin(fields(u.searchParams));
        // Preserve Origin on same-site consent POST without leaking path/query.
        res.setHeader('Referrer-Policy','strict-origin');
        res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${tx.redirect}; frame-ancestors 'none'; base-uri 'none'`);
        res.setHeader('Set-Cookie',`__Host-dc-auth=${tx.cookie}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Доступ к вашему компьютеру</title><style>body{font:18px system-ui;max-width:660px;margin:60px auto;padding:20px;background:#f4f6f8;color:#162331}form{background:white;padding:26px;border-radius:14px}input,button{font:inherit;padding:12px;box-sizing:border-box}input[type=password]{width:100%}button{margin:16px 8px 0 0}small{overflow-wrap:anywhere}p{line-height:1.5}</style><h1>Ваш компьютер</h1><form method="post" action="/oauth/consent"><p><b>Разрешить ChatGPT работу с компьютером?</b></p><p>Разрешение включает чтение и изменение файлов и выполнение команд от имени вашего пользователя Windows. Подтверждайте только подключение, которое вы сами начали в ChatGPT.</p><p><small>Возврат: ${esc(tx.redirect)}</small></p><input type="hidden" name="tx" value="${tx.id}"><input type="hidden" name="csrf" value="${tx.csrf}"><label>Отдельный пароль владельца MCP (не пароль Ubuntu)<input type="password" name="password" required autocomplete="off" maxlength="256"></label><button name="decision" value="allow">Разрешить доступ на 30 дней</button><button name="decision" value="deny">Отказать</button></form></html>`);return;
      }
      if(path==='/oauth/consent' && req.method==='POST') {
        rate(req,'login',10);
        if(origin!==c.issuer) throw new OAuthError('origin_required',403);
        const p=form(req,await body(req,16384));
        if(!['allow','deny'].includes(p.decision)) throw new OAuthError('invalid_decision');
        const location=auth.consent(p.tx,p.csrf,cookie(req),p.password,p.decision==='allow');
        res.setHeader('Set-Cookie','__Host-dc-auth=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        res.writeHead(303,{Location:location});res.end();return;
      }
      if(path==='/oauth/token' && req.method==='POST') {
        rate(req,'token',60);
        json(res,200,auth.token(form(req,await body(req,16384)),req.headers.authorization));return;
      }
      if(path==='/oauth/revoke' && req.method==='POST') {
        rate(req,'token',60); auth.revoke(form(req,await body(req,16384)),req.headers.authorization);json(res,200,{});return;
      }
      if(path==='/mcp' && ['GET','POST','DELETE'].includes(req.method)) {
        rate(req,'mcp',600);
        if(u.search) throw new OAuthError('query_not_allowed');
        const authorization=req.headers.authorization || '';
        if(!authorization.startsWith('Bearer ') || !auth.access(authorization.slice(7))) {
          res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${c.issuer}/.well-known/oauth-protected-resource/mcp", scope="desktop"`);
          json(res,401,{error:'unauthorized'});return;
        }
        if(active>=4) throw new OAuthError('busy',503);
        active++;
        let done=false;const release=()=>{if(!done){done=true;active--;}};
        res.once('close',release);res.once('finish',release);
        // Buffer bounded requests before submission. Responses (including SSE) are streamed.
        // Never retry a submitted MCP request: it may already have had side effects.
        const raw=await body(req,8*1024*1024);
        const headers={Authorization:`Bearer ${c.mcpToken}`,Host:'127.0.0.1:8787','Content-Length':raw.length};
        for(const h of ['accept','content-type','mcp-protocol-version','mcp-method','mcp-name','mcp-session-id','last-event-id']) if(req.headers[h]) headers[h]=req.headers[h];
        const upstream=httpRequest(c.upstream,{method:req.method,headers},r=>{
          if(res.destroyed){r.destroy();return;}
          for(const h of ['content-type','mcp-session-id','mcp-protocol-version']) if(r.headers[h])res.setHeader(h,r.headers[h]);
          res.setHeader('Access-Control-Expose-Headers','MCP-Session-Id, MCP-Protocol-Version');
          res.writeHead(r.statusCode || 502);r.pipe(res);
          r.on('error',()=>res.destroy());
        });
        upstream.setTimeout(135000,()=>upstream.destroy(new Error('upstream_timeout')));
        upstream.on('error',()=>{if(!res.headersSent && !res.destroyed)json(res,502,{error:'upstream_failed',repeat:false});else res.destroy();});
        res.once('close',()=>upstream.destroy());upstream.end(raw);return;
      }
      rate(req,'other',120);json(res,404,{error:'not_found'});
    } catch(e) {
      // Do not log URLs, headers, passwords, authorization codes or tool content.
      if(res.destroyed)return;
      const status=e instanceof OAuthError ? e.status : 500;
      if(status===429)res.setHeader('Retry-After','60');
      if(!res.headersSent)json(res,status,{error:e instanceof OAuthError ? e.code : 'internal_error'});
      else res.destroy();
    }
  });
  server.headersTimeout=15000;server.requestTimeout=30000;server.keepAliveTimeout=5000;
  server.maxConnections=96; server.maxRequestsPerSocket=100;
  // No public WebSocket forwarding: the Windows agent remains on its existing SSH channel.
  server.on('upgrade',(_r,s)=>s.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'));
  server.on('clientError',(_e,s)=>s.destroy());
  return {server,auth};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const config=validate(JSON.parse(readFileSync(process.argv[2],'utf8')));
  const loadTls=()=>({key:readFileSync(config.tlsDir+'/privkey.pem'),cert:readFileSync(config.tlsDir+'/fullchain.pem')});
  const {server}=buildGateway(config,{stateFile:config.stateFile,tls:loadTls()});
  server.on('error',e=>{console.error('GATEWAY_START_ERROR '+e.code);process.exit(1);});
  process.on('SIGHUP',()=>{try{server.setSecureContext(loadTls());console.log('TLS_CERTIFICATE_RELOADED');}catch{console.error('TLS_RELOAD_FAILED: old context kept');}});
  for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();});
  server.listen(443,'0.0.0.0',()=>console.log('HTTPS_GATEWAY_READY; TCP443; OAuth required; no UDP listener'));
}
