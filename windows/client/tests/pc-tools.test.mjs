import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalPcTools, PC_TOOLS } from '../pc-tools.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pc-tools-test-')),tools=new LocalPcTools();
  t.after(async()=>{await tools.close();await fs.rm(root,{recursive:true,force:true});});
  return {root,tools};
}
function data(result) {assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent;}
async function wait(tools,id) {
  for(let i=0;i<200;i++) {
    const value=data(await tools.call('pc_read_process',{jobId:id}));
    if(value.state!=='running')return value;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.fail('synthetic job did not finish');
}
test('UTF-8/base64 reads and explicit writes on synthetic files',async t=>{
  const {root,tools}=await fixture(t),target=path.join(root,'sample.txt');
  const written=data(await tools.call('pc_write_file',{path:target,content:'hello мир'}));assert.equal(written.bytesWritten,12);
  assert.equal(data(await tools.call('pc_read_file',{path:target})).content,'hello мир');
  assert.equal(data(await tools.call('pc_read_file',{path:target,offset:6,length:6,encoding:'base64'})).content,Buffer.from('мир').toString('base64'));
  assert.ok((await tools.call('pc_write_file',{path:target,content:'should not overwrite'})).isError);
  assert.equal(await fs.readFile(target,'utf8'),'hello мир');
  data(await tools.call('pc_write_file',{path:target,content:'x',overwrite:true}));assert.equal(await fs.readFile(target,'utf8'),'x');
});
test('directory tools, bounded listing and file information',async t=>{
  const {root,tools}=await fixture(t);
  data(await tools.call('pc_make_directory',{path:path.join(root,'folder')}));
  data(await tools.call('pc_write_file',{path:path.join(root,'file'),content:''}));
  const listing=data(await tools.call('pc_list_directory',{path:root,limit:1}));assert.equal(listing.entries.length,1);assert.equal(listing.truncated,true);
  assert.equal(data(await tools.call('pc_file_info',{path:path.join(root,'folder')})).type,'directory');
  assert.ok((await tools.call('pc_read_file',{path:root})).isError);
});
test('argument limits reject invalid operations without writes',async t=>{
  const {root,tools}=await fixture(t),target=path.join(root,'untouched');
  for (const [name,args] of [
    ['pc_write_file',{path:target,content:'x',overwrite:'yes'}],
    ['pc_write_file',{path:target,content:'x'.repeat(1024*1024+1)}],
    ['pc_write_file',{path:target,content:'x',extra:true}],
    ['pc_read_file',{path:'relative',length:1}],
    ['pc_read_file',{path:target,offset:-1}],
    ['pc_start_process',{command:'echo should-not-run',cwd:root,timeoutMs:0}],
    ['not_a_tool',{}],
  ]) assert.ok((await tools.call(name,args)).isError,name);
  await assert.rejects(fs.stat(target),{code:'ENOENT'});
});
test('commands return jobs, capture output, and exclude bridge credentials',async t=>{
  const {root,tools}=await fixture(t),old=process.env.DEVICE_TOKEN;process.env.DEVICE_TOKEN='synthetic-not-a-real-token';
  t.after(()=>{if(old===undefined)delete process.env.DEVICE_TOKEN;else process.env.DEVICE_TOKEN=old;});
  const command=process.platform==='win32'?"Write-Output 'synthetic output'; if ($env:DEVICE_TOKEN) { exit 99 }":"printf 'synthetic output'; test -z \"$DEVICE_TOKEN\"";
  const {jobId}=data(await tools.call('pc_start_process',{command,cwd:root}));
  const job=await wait(tools,jobId);assert.equal(job.exitCode,0);assert.match(job.output,/synthetic output/);assert.ok(!job.output.includes('synthetic-not-a-real-token'));
  assert.equal(data(await tools.call('pc_read_process',{jobId,cursor:job.nextCursor})).output,'');
  assert.ok((await tools.call('pc_read_process',{jobId,cursor:job.totalBytes+1})).isError);
});
test('process output is bounded and dropped bytes are reported',async t=>{
  const {root,tools}=await fixture(t);
  const command=process.platform==='win32'?"[Console]::Write(('x' * 400000))":"head -c 400000 /dev/zero | tr '\\000' x";
  const {jobId}=data(await tools.call('pc_start_process',{command,cwd:root}));
  const job=await wait(tools,jobId);assert.equal(job.exitCode,0);assert.equal(job.totalBytes,400000);assert.equal(job.firstAvailable,400000-256*1024);
  assert.equal(job.outputDropped,true);assert.ok(job.output.length<=65536);assert.ok(tools.jobs.get(jobId).output.length<=256*1024);
});
test('timeout and explicit stop affect only agent-owned direct children',async t=>{
  const {root,tools}=await fixture(t),command=process.platform==='win32'?'Start-Sleep -Seconds 20':'exec sleep 20';
  const first=data(await tools.call('pc_start_process',{command,cwd:root,timeoutMs:300}));
  assert.equal((await wait(tools,first.jobId)).timedOut,true);
  const second=data(await tools.call('pc_start_process',{command,cwd:root}));
  assert.equal(data(await tools.call('pc_stop_process',{jobId:second.jobId})).stopRequested,true);
  assert.equal((await wait(tools,second.jobId)).state,'exited');
  assert.ok((await tools.call('pc_stop_process',{jobId:String(process.pid)})).isError);
});
test('closed agent and unknown job fail without restarting work',async t=>{
  const {root,tools}=await fixture(t);
  assert.match((await tools.call('pc_read_process',{jobId:'previous-agent-job'})).content[0].text,/OUTCOME_UNKNOWN/);
  await tools.close();await assert.rejects(tools.call('pc_start_process',{command:'echo no',cwd:root}),/NOT submitted/);
  assert.equal(new Set(PC_TOOLS.map(t=>t.name)).size,PC_TOOLS.length);
});
