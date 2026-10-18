import { timingSafeEqual } from 'node:crypto';

export function tokenEquals(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validateStageConfig(env) {
  const host = env.HOST || '127.0.0.1';
  if (!['127.0.0.1','::1'].includes(host)) {
    throw new Error('Stage 1 must bind to loopback. Public deployment is NOT enabled.');
  }
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  for (const name of ['DEVICE_TOKEN','MCP_TOKEN']) {
    if (!/^[a-f0-9]{64}$/.test(env[name] || '')) {
      throw new Error(`${name} must be an independent random 32-byte hex secret`);
    }
  }
  if (env.DEVICE_TOKEN === env.MCP_TOKEN) throw new Error('Device and MCP tokens must be different');
  const timeoutMs = Number(env.CALL_TIMEOUT_MS || 120000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('Invalid call timeout');
  return {host, port, timeoutMs, deviceToken:env.DEVICE_TOKEN, mcpToken:env.MCP_TOKEN};
}

// A timeout/transport error does not prove that a command did not execute.
// Deliberately no reconnect+retry and no forced shutdown of the local process.
export async function callOnce(client, name, args = {}) {
  try { return await client.callTool({ name, arguments: args }); }
  catch (cause) {
    throw new Error('OUTCOME_UNKNOWN: command may have executed; it was NOT retried. Check state before issuing it again.', {cause});
  }
}

// In-process deduplication only. This is NOT an exactly-once guarantee across restarts.
export class CallLedger {
  constructor({max=128, ttlMs=600000, now=Date.now}={}) {
    this.entries=new Map(); this.max=max; this.ttlMs=ttlMs; this.now=now;
  }
  run(id, signature, execute) {
    const now=this.now();
    for (const [k,e] of this.entries) if (e.finished && now-e.at >= this.ttlMs) this.entries.delete(k);
    const prev=this.entries.get(id);
    if (prev) {
      if (prev.signature !== signature) return Promise.reject(new Error('Duplicate call id with different payload'));
      return prev.promise;
    }
    if (this.entries.size >= this.max) return Promise.reject(new Error('Call ledger full; command NOT submitted'));
    const entry={signature,at:now,finished:false,promise:null};
    entry.promise=Promise.resolve().then(execute).finally(()=>{entry.finished=true;entry.at=this.now();});
    this.entries.set(id,entry);
    return entry.promise;
  }
}
