import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenEquals, validateStageConfig, callOnce, CallLedger } from '../src/safety.mjs';
const env={DEVICE_TOKEN:'a'.repeat(64),MCP_TOKEN:'b'.repeat(64)};
test('constant-time equality wrapper rejects missing tokens',()=>{
  assert.equal(tokenEquals('',''),false);assert.equal(tokenEquals(undefined,'x'),false);
  assert.equal(tokenEquals('x','x'),true);assert.equal(tokenEquals('x','xx'),false);assert.equal(tokenEquals('x','y'),false);
});
test('loopback is default',()=>assert.equal(validateStageConfig(env).host,'127.0.0.1'));
test('public bind is rejected even with long secrets',()=>assert.throws(()=>validateStageConfig({...env,HOST:'0.0.0.0'}),/loopback/));
test('development secrets are rejected on loopback',()=>assert.throws(()=>validateStageConfig({...env,DEVICE_TOKEN:'dev-device-token'}),/random/));
test('same token cannot authorize both roles',()=>assert.throws(()=>validateStageConfig({...env,MCP_TOKEN:env.DEVICE_TOKEN}),/different/));
test('invalid ports and timeouts are rejected',()=>{
  for(const PORT of ['-1','0','443','65536','abc','8787.1'])assert.throws(()=>validateStageConfig({...env,PORT}));
  for(const CALL_TIMEOUT_MS of ['1','abc','300001'])assert.throws(()=>validateStageConfig({...env,CALL_TIMEOUT_MS}));
});
test('successful tool call is invoked once',async()=>{
  let calls=0;const client={callTool:async req=>{calls++;return req;}};
  assert.deepEqual(await callOnce(client,'echo',{x:1}),{name:'echo',arguments:{x:1}});assert.equal(calls,1);
});
test('lost result after side effect never retries',async()=>{
  let sideEffects=0;let closes=0;
  const client={callTool:async()=>{sideEffects++;throw new Error('connection lost after write');},close:()=>closes++};
  await assert.rejects(callOnce(client,'write_file',{}),/OUTCOME_UNKNOWN/);
  assert.equal(sideEffects,1);assert.equal(closes,0);
});
test('concurrent duplicate id shares a single invocation',async()=>{
  const ledger=new CallLedger();let calls=0;let release;const gate=new Promise(r=>release=r);
  const work=async()=>{calls++;await gate;return 'ok';};
  const a=ledger.run('one','same',work),b=ledger.run('one','same',work);release();
  assert.deepEqual(await Promise.all([a,b]),['ok','ok']);assert.equal(calls,1);
});
test('failed call result is also deduplicated',async()=>{
  const ledger=new CallLedger();let calls=0;const work=()=>{calls++;throw new Error('unknown');};
  await assert.rejects(ledger.run('one','same',work));await assert.rejects(ledger.run('one','same',work));assert.equal(calls,1);
});
test('duplicate id with changed arguments is rejected',async()=>{
  const ledger=new CallLedger();await ledger.run('one','A',()=>1);
  await assert.rejects(ledger.run('one','B',()=>2),/different payload/);
});
test('ledger capacity rejects new work rather than dropping in-flight history',async()=>{
  const ledger=new CallLedger({max:1});await ledger.run('one','A',()=>1);
  await assert.rejects(ledger.run('two','B',()=>2),/NOT submitted/);
});
test('completed ledger records expire, unresolved records do not',async()=>{
  let now=0;const ledger=new CallLedger({max:2,ttlMs:10,now:()=>now});
  await ledger.run('done','A',()=>1);let release;const pending=ledger.run('pending','B',()=>new Promise(r=>release=r));
  await Promise.resolve();now=20;await ledger.run('new','C',()=>2);
  assert.equal(ledger.entries.has('done'),false);assert.equal(ledger.entries.has('pending'),true);release(1);await pending;
});
