import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

test('real agent performs synthetic writes and deduplicates across a relay reconnect', {timeout:20000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pc-agent-test-'));
  const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
  let child; t.after(async()=>{
    if(child && child.exitCode===null){child.kill();await once(child,'exit');}
    for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));
    await fs.rm(root,{recursive:true,force:true});
  });
  let connections=0;
  const target=path.join(root,'synthetic.txt'),request={type:'call',id:'test-write-once',tool:'pc_write_file',args:{path:target,content:'written once'}};
  const finished=new Promise((resolve,reject)=>{
    wss.on('connection',ws=>{
      const session=++connections;
      ws.on('message',raw=>{
        try {
          const msg=JSON.parse(raw);
          if(msg.type==='hello') {
            assert.equal(msg.deviceId,'synthetic');assert.equal(msg.token,'a'.repeat(64));
            assert.ok(msg.tools.some(tool=>tool.name==='pc_start_process'));assert.equal(msg.tools.length,8);
            ws.send(JSON.stringify({type:'hello_ack',deviceId:'synthetic'}));ws.send(JSON.stringify(request));
          } else if(msg.type==='result') {
            assert.equal(msg.ok,true);assert.ok(!msg.result.isError,JSON.stringify(msg));
            if(session===1)ws.close(1012,'synthetic relay restart');else resolve(msg.result);
          }
        } catch(error){reject(error);}
      });
    });
  });
  child=spawn(process.execPath,[fileURLToPath(new URL('../agent.mjs',import.meta.url))],{
    env:{...process.env,DC_REMOTE_CONFIG:path.join(root,'agent.json'),DEVICE_ID:'synthetic',DEVICE_TOKEN:'a'.repeat(64),RELAY_URL:`ws://127.0.0.1:${wss.address().port}/device/ws`},stdio:['ignore','ignore','pipe'],windowsHide:true});
  let diagnostics='';child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-4000);});
  const exited=new Promise((_,reject)=>child.once('exit',code=>reject(new Error(`Agent exited ${code}: ${diagnostics}`))));
  const result=await Promise.race([finished,exited]);assert.equal(result.structuredContent.bytesWritten,12);
  assert.equal(await fs.readFile(target,'utf8'),'written once');assert.equal(connections,2);
});
