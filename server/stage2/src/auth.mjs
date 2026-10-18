// Single-owner OAuth authorization-code server. No public registration/password grant.
// Tokens are opaque CSPRNG values; only SHA-256 digests enter the persistent token store.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
export const digest = x => createHash('sha256').update(String(x)).digest('hex');
export const random = () => randomBytes(32).toString('base64url');
export const challenge = v => createHash('sha256').update(v).digest('base64url');
export const same = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));
export class OAuthError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const need = (ok, code = 'invalid_request', status = 400) => { if (!ok) throw new OAuthError(code, status); };
export function fields(p) {
  const out = Object.create(null);
  for (const [k,v] of p) {
    need(!(k in out) && k.length <= 80 && v.length <= 4096);
    out[k] = v;
  }
  return out;
}
export class Auth {
  constructor(config, stateFile, clock = () => Math.floor(Date.now()/1000)) {
    this.c = config; this.clock = clock; this.file = stateFile;
    this.transactions = new Map(); this.codes = new Map();
    this.state = { version: 1, issuer: config.issuer, grants: {}, tokens: {} };
    if (stateFile && existsSync(stateFile)) {
      need(statSync(stateFile).size < 8*1024*1024, 'state_too_large', 500);
      this.state = JSON.parse(readFileSync(stateFile, 'utf8'));
      need(this.state.version === 1 && this.state.issuer === config.issuer &&
        this.state.tokens && this.state.grants, 'state_invalid', 500);
    }
    this.clean();
  }
  save() {
    if (!this.file) return;
    const tmp = this.file + '.tmp-' + randomBytes(8).toString('hex');
    const fd = openSync(tmp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(this.state)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.file);
    const d = openSync(dirname(this.file), 'r');
    try { fsyncSync(d); } finally { closeSync(d); }
  }
  clean() {
    const now = this.clock();
    for (const m of [this.transactions, this.codes]) for (const [k,v] of m) if (v.exp <= now) m.delete(k);
    for (const [k,v] of Object.entries(this.state.grants)) if (v.exp <= now) delete this.state.grants[k];
    for (const [k,v] of Object.entries(this.state.tokens)) {
      if (!this.state.grants[v.grant] || (v.kind === 'access' && v.exp <= now)) delete this.state.tokens[k];
    }
  }
  metadata() {
    const i = this.c.issuer;
    return { issuer: i, authorization_endpoint: i+'/oauth/authorize', token_endpoint: i+'/oauth/token',
      revocation_endpoint: i+'/oauth/revoke', scopes_supported: ['desktop'], response_types_supported: ['code'],
      response_modes_supported: ['query'], grant_types_supported: ['authorization_code','refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic','client_secret_post'],
      authorization_response_iss_parameter_supported: true };
  }
  resource() { return { resource: this.c.resource, authorization_servers: [this.c.issuer], scopes_supported: ['desktop'], bearer_methods_supported: ['header'] }; }
  begin(p) {
    this.clean();
    need(this.transactions.size < 128, 'temporarily_unavailable', 503);
    need(p.client_id === this.c.clientId, 'invalid_client');
    // Exact comparison: no wildcard, suffix matching or remote metadata fetch.
    need(this.c.redirectUris.includes(p.redirect_uri), 'invalid_redirect_uri');
    need(p.response_type === 'code', 'unsupported_response_type');
    need(!p.response_mode || p.response_mode === 'query', 'unsupported_response_mode');
    need(p.code_challenge_method === 'S256' && /^[A-Za-z0-9_-]{43}$/.test(p.code_challenge || ''), 'invalid_pkce');
    need(p.resource === this.c.resource, 'invalid_target');
    need((p.scope || 'desktop') === 'desktop', 'invalid_scope');
    need(typeof p.state === 'string' && p.state.length >= 8 && p.state.length <= 2048, 'invalid_state');
    const id = random(), csrf = random(), cookie = random();
    this.transactions.set(id, { p, csrfHash: digest(csrf), cookieHash: digest(cookie), exp: this.clock()+300 });
    return { id, csrf, cookie, redirect: p.redirect_uri };
  }
  consent(id, csrf, cookie, password, allow) {
    const tx = this.transactions.get(id);
    need(tx && tx.exp > this.clock(), 'expired_transaction');
    need(same(tx.csrfHash, digest(csrf || '')) && same(tx.cookieHash, digest(cookie || '')), 'invalid_csrf', 403);
    // A submitted login cannot be replayed. Failed login needs a fresh OAuth flow.
    this.transactions.delete(id);
    need(same(digest(password || ''), this.c.ownerPasswordHash), 'authentication_failed', 403);
    const redirect = new URL(tx.p.redirect_uri);
    redirect.searchParams.set('state', tx.p.state); redirect.searchParams.set('iss', this.c.issuer);
    if (!allow) { redirect.searchParams.set('error','access_denied'); return redirect.href; }
    need(this.codes.size < 128, 'temporarily_unavailable', 503);
    const code = random();
    this.codes.set(digest(code), { p: tx.p, exp: this.clock()+120 });
    redirect.searchParams.set('code', code);
    return redirect.href;
  }
  client(p, authHeader) {
    let id = p.client_id, secret = p.client_secret;
    if (authHeader) {
      need(/^Basic [A-Za-z0-9+/=]+$/.test(authHeader), 'invalid_client', 401);
      // Client must not use multiple authentication methods in one request.
      need(!p.client_secret, 'invalid_client', 401);
      const raw = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const cut = raw.indexOf(':'); need(cut > 0, 'invalid_client', 401);
      try { id = decodeURIComponent(raw.slice(0,cut)); secret = decodeURIComponent(raw.slice(cut+1)); }
      catch { throw new OAuthError('invalid_client',401); }
      need(!p.client_id || p.client_id === id, 'invalid_client',401);
    }
    need(id === this.c.clientId && typeof secret === 'string' && same(digest(secret), this.c.clientSecretHash), 'invalid_client',401);
  }
  issue(grantId) {
    this.clean();
    need(Object.keys(this.state.tokens).length < 8192, 'temporarily_unavailable',503);
    const grant = this.state.grants[grantId];
    need(grant && !grant.revoked && grant.exp > this.clock(), 'invalid_grant');
    const access = random(), refresh = random(), now = this.clock();
    this.state.tokens[digest(access)] = { kind:'access', grant:grantId, exp:Math.min(now+3600,grant.exp), aud:this.c.resource, scope:'desktop', client:this.c.clientId };
    this.state.tokens[digest(refresh)] = { kind:'refresh', grant:grantId, exp:grant.exp, used:false, aud:this.c.resource, scope:'desktop', client:this.c.clientId };
    this.save();
    return { access_token:access, refresh_token:refresh, token_type:'Bearer', expires_in:Math.min(3600,grant.exp-now), scope:'desktop' };
  }
  token(p, authHeader) {
    this.client(p, authHeader);
    need(p.resource === this.c.resource, 'invalid_target');
    need(!p.scope || p.scope === 'desktop','invalid_scope');
    if (p.grant_type === 'authorization_code') {
      const key = digest(p.code || ''), code = this.codes.get(key);
      need(code && code.exp > this.clock(), 'invalid_grant');
      this.codes.delete(key); // Never give a second attempt at guessing the verifier.
      need(p.redirect_uri === code.p.redirect_uri, 'invalid_grant');
      need(/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier || '') && same(challenge(p.code_verifier), code.p.code_challenge), 'invalid_grant');
      this.clean();
      need(Object.keys(this.state.grants).length < 32, 'too_many_grants', 429);
      const id = random(); this.state.grants[id] = { exp:this.clock()+30*86400, revoked:false };
      return this.issue(id);
    }
    if (p.grant_type === 'refresh_token') {
      const t = this.state.tokens[digest(p.refresh_token || '')];
      need(t && t.kind === 'refresh' && t.exp > this.clock() && t.aud === this.c.resource && t.client === this.c.clientId,'invalid_grant');
      if (t.used) {
        if (this.state.grants[t.grant]) this.state.grants[t.grant].revoked = true;
        this.save(); throw new OAuthError('invalid_grant');
      }
      t.used = true; this.save(); // Crash-safe: consumed before a replacement can leave the process.
      return this.issue(t.grant);
    }
    throw new OAuthError('unsupported_grant_type');
  }
  access(raw) {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return false;
    const t = this.state.tokens[digest(raw)];
    const g = t && this.state.grants[t.grant];
    return !!(t && t.kind === 'access' && t.exp > this.clock() && t.aud === this.c.resource &&
      t.client === this.c.clientId && t.scope === 'desktop' && g && !g.revoked && g.exp > this.clock());
  }
  revoke(p, header) {
    this.client(p,header);
    const t = this.state.tokens[digest(p.token || '')];
    if (t && this.state.grants[t.grant]) { this.state.grants[t.grant].revoked = true; this.save(); }
  }
}
