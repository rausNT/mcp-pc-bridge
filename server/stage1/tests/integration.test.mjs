// Runs with the LOCKED npm dependencies installed. Only a fake device is used.
// Only synthetic relay tools are invoked; no real file or shell operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('real HTTP MCP relay: auth, discovery, fake call, disconnect without repeat',{timeout:30000},async()=>{
  const port=await freePort();const deviceToken=randomBytes(32).toString('hex'),mcpToken=randomBytes(32).toString('hex');
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DEVICE_ID:'stage1-test',DEVICE_TOKEN:deviceToken,MCP_TOKEN:mcpToken,CALL_TIMEOUT_MS:'3000'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const base=`http://127.0.0.1:${port}`;let ws,client,bad;
  try{
    let ready=false;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw new Error(`Server failed: ${output}`);
      try{const r=await fetch(base+'/healthz');if(r.ok){ready=true;const health=await r.json();assert.equal(health.mode,'loopback-stage1');assert.equal('devices' in health,false);break;}}catch{}
      await sleep(100);
    }
    assert.ok(ready,`not ready: ${output}`);
    assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer wrong'},body:'{}'})).status,401);
    bad=new WebSocket(`ws://127.0.0.1:${port}/device/ws`);await once(bad,'open');const closed=once(bad,'close');bad.send(JSON.stringify({type:'hello',deviceId:'stage1-test',token:'wrong',tools:[]}));assert.equal((await closed)[0],1008);
    ws=new WebSocket(`ws://127.0.0.1:${port}/device/ws`);await once(ws,'open');const hello=once(ws,'message');
    ws.send(JSON.stringify({type:'hello',deviceId:'stage1-test',deviceName:'TEST ONLY',token:deviceToken,tools:[{name:'echo',description:'test echo',inputSchema:{type:'object',properties:{value:{type:'string'}}},_meta:{'ui/resourceUri':'ui://synthetic-test/file-preview','openai/outputTemplate':'ui://synthetic-test/file-preview',ui:{resourceUri:'ui://synthetic-test/file-preview'},keepMe:'ok'}},{name:'disconnect_test',description:'test lost result',inputSchema:{type:'object',properties:{}}}]}));
    assert.equal(JSON.parse((await hello)[0].toString()).type,'hello_ack');let echoCount=0,dropCount=0;
    ws.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.type!=='call')return;if(m.tool==='echo'){echoCount++;ws.send(JSON.stringify({type:'result',id:m.id,ok:true,result:{content:[{type:'text',text:m.args.value}]}}));}else{dropCount++;ws.close(1000,'simulated lost response');}});
    client=new Client({name:'stage1-integration',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${mcpToken}`}}}));
    const listed=(await client.listTools()).tools;const names=listed.map(t=>t.name);assert.deepEqual(new Set(names),new Set(['dc_remote_status','echo','disconnect_test']));
    const echoTool=listed.find(t=>t.name==='echo');assert.equal(echoTool._meta?.['ui/resourceUri'],undefined);assert.equal(echoTool._meta?.['openai/outputTemplate'],undefined);assert.equal(echoTool._meta?.ui,undefined);assert.equal(echoTool._meta?.keepMe,'ok');
    const result=await client.callTool({name:'echo',arguments:{value:'RELAY_TEST_OK'}});assert.equal(result.content[0].text,'RELAY_TEST_OK');assert.equal(echoCount,1);
    const lost=await client.callTool({name:'disconnect_test',arguments:{}});assert.equal(lost.isError,true);assert.match(lost.content[0].text,/OUTCOME_UNKNOWN/);assert.equal(dropCount,1);
    const after=(await client.listTools()).tools;assert.equal(after.length,1);assert.equal(after[0].name,'dc_remote_status');
  }finally{
    bad?.terminate();ws?.terminate();try{await client?.close();}catch{}
    if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),sleep(4000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  }
});
