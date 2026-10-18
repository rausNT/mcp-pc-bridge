// Real MCP -> relay -> original agent/tools, using only disposable files/jobs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('real MCP discovers built-in tools, writes/reads synthetic file and executes a harmless job',{timeout:30000},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pc-mcp-test-'));
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  const deviceToken=randomBytes(32).toString('hex'),mcpToken=randomBytes(32).toString('hex');
  const env={...process.env,HOST:'127.0.0.1',PORT:String(port),DEVICE_ID:'synthetic-pc',DEVICE_TOKEN:deviceToken,MCP_TOKEN:mcpToken};
  const children=[];let client;
  try {
    const server=spawn(process.execPath,['src/server.mjs'],{cwd:new URL('..',import.meta.url),env,stdio:'ignore',windowsHide:true});children.push(server);
    let ready=false;
    for(let i=0;i<100;i++){try{ready=(await fetch(`http://127.0.0.1:${port}/healthz`)).ok;if(ready)break;}catch{}await sleep(50);}
    assert.ok(ready,'relay not ready');
    const agent=spawn(process.execPath,['src/agent.mjs'],{cwd:new URL('..',import.meta.url),env:{...env,DC_REMOTE_CONFIG:path.join(root,'agent.json'),RELAY_URL:`ws://127.0.0.1:${port}/device/ws`},stdio:'ignore',windowsHide:true});children.push(agent);
    client=new Client({name:'synthetic-pc-test',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${mcpToken}`}}}));
    let tools=[];for(let i=0;i<100;i++){tools=(await client.listTools()).tools;if(tools.length===9)break;await sleep(50);}
    assert.equal(tools.length,9);assert.ok(tools.some(t=>t.name==='pc_write_file'));
    async function call(name,args){const value=await client.callTool({name,arguments:args});assert.ok(!value.isError,JSON.stringify(value));return value.structuredContent;}
    const file=path.join(root,'synthetic.txt');
    await call('pc_write_file',{path:file,content:'MCP bridge verified'});
    assert.equal((await call('pc_read_file',{path:file})).content,'MCP bridge verified');
    assert.equal(await fs.readFile(file,'utf8'),'MCP bridge verified');
    const job=await call('pc_start_process',{command:process.platform==='win32'?"Write-Output 'PC_JOB_OK'":"printf PC_JOB_OK",cwd:root});
    let output;for(let i=0;i<100;i++){output=await call('pc_read_process',{jobId:job.jobId});if(output.state!=='running')break;await sleep(50);}
    assert.equal(output.exitCode,0);assert.match(output.output,/PC_JOB_OK/);
  } finally {
    try{await client?.close();}catch{}
    for(const child of children.reverse())if(child.exitCode===null && child.signalCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),sleep(3000)]);if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}}
    await fs.rm(root,{recursive:true,force:true});
  }
});
