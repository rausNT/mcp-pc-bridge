// MCP PC Bridge's own local tools. MIT; no third-party execution engine.
// Full Windows-user access, NOT a filesystem sandbox or an approval broker.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

const MAX_FILE = 1024 * 1024, MAX_OUTPUT = 256 * 1024;
const str = (description) => ({type:'string', description});
const integer = (minimum, maximum, description) => ({type:'integer',minimum,maximum,description});
function tool(name, description, properties, required, readOnlyHint=false) {
  return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
    annotations:{readOnlyHint,destructiveHint:!readOnlyHint,idempotentHint:readOnlyHint,openWorldHint:true}};
}
export const PC_TOOLS = [
  tool('pc_read_file','Read up to 1 MiB from a file as UTF-8 or base64. Offsets are bytes; UTF-8 chunks may split a character.',{
    path:str('Absolute file path'),offset:integer(0,Number.MAX_SAFE_INTEGER,'Byte offset; default 0'),
    length:integer(1,MAX_FILE,'Maximum bytes; default 65536'),encoding:{enum:['utf8','base64'],type:'string'}},['path'],true),
  tool('pc_write_file','Write UTF-8 text. Creates a new file by default. Set overwrite=true to replace an existing file. Does not create parent directories.',{
    path:str('Absolute file path'),content:str('UTF-8 text, at most 1 MiB'),overwrite:{type:'boolean',description:'Explicit replacement of existing contents; default false'}},['path','content']),
  tool('pc_list_directory','List immediate directory entries, up to the requested limit. Does not recurse.',{
    path:str('Absolute directory path'),limit:integer(1,1000,'Maximum entries; default 200')},['path'],true),
  tool('pc_file_info','Inspect a file, directory or symbolic link without following the final link.',{path:str('Absolute path')},['path'],true),
  tool('pc_make_directory','Create a directory. Parent creation requires recursive=true.',{
    path:str('Absolute directory path'),recursive:{type:'boolean'}},['path']),
  tool('pc_start_process','Run a PowerShell command as the Windows user, with unrestricted file/network access. Returns a job id immediately. Read the job before considering a retry. Timeout only attempts to stop the direct child; detached descendants may survive.',{
    command:str('Exact PowerShell command'),cwd:str('Absolute working directory'),timeoutMs:integer(100,120000,'Execution deadline; default 30000 ms')},['command','cwd']),
  tool('pc_read_process','Read a known job status/output. Retains the last 256 KiB; a cursor below firstAvailable means earlier output was discarded. Jobs are in memory and disappear when the agent exits.',{
    jobId:str('Job id returned by pc_start_process'),cursor:integer(0,Number.MAX_SAFE_INTEGER,'Output byte cursor; default 0')},['jobId'],true),
  tool('pc_stop_process','Attempt to stop this agent-owned direct child. Does not guarantee descendant termination or rollback.',{jobId:str('Job id returned by pc_start_process')},['jobId']),
];
const schemaByName = new Map(PC_TOOLS.map(t=>[t.name,t.inputSchema]));

function validate(name,args) {
  const schema=schemaByName.get(name);
  if (!schema) throw new Error('Unknown tool; command NOT submitted');
  if (!args || typeof args!=='object' || Array.isArray(args)) throw new Error('Expected an argument object');
  for (const key of schema.required) if (!(key in args)) throw new Error(`Missing argument: ${key}`);
  for (const [key,value] of Object.entries(args)) {
    const rule=schema.properties[key];
    if (!rule) throw new Error(`Unknown argument: ${key}`);
    if (rule.type==='integer' ? !Number.isSafeInteger(value) || value<rule.minimum || value>rule.maximum : typeof value!==rule.type)
      throw new Error(`Invalid argument: ${key}`);
    if (rule.enum && !rule.enum.includes(value)) throw new Error(`Invalid argument: ${key}`);
    if (typeof value==='string' && value.includes('\0')) throw new Error(`NUL is not allowed: ${key}`);
  }
  for (const key of ['path','cwd']) if (key in args && !path.isAbsolute(args[key])) throw new Error(`${key} must be absolute`);
}
function result(value) {return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
function childEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key])=>
    !['DEVICE_TOKEN','MCP_TOKEN','DC_REMOTE_CONFIG','RELAY_URL','DC_COMMAND','DC_ARGS'].includes(key.toUpperCase())));
}
export class LocalPcTools {
  tools=PC_TOOLS;
  jobs=new Map();
  closed=false;
  async connect() {if(this.closed)throw new Error('Agent is stopping; command NOT submitted');}
  async call(name,args={}) {
    await this.connect();
    try {
      validate(name,args);
      switch(name) {
        case 'pc_read_file': {
          const file=await fs.open(args.path,'r');
          try {
            const info=await file.stat();if(!info.isFile())throw new Error('Expected a regular file');
            const offset=args.offset??0,buffer=Buffer.alloc(args.length??65536);
            const {bytesRead}=await file.read(buffer,0,buffer.length,offset);
            return result({content:buffer.subarray(0,bytesRead).toString(args.encoding??'utf8'),encoding:args.encoding??'utf8',
              offset,bytesRead,nextOffset:offset+bytesRead,size:info.size,hasMore:offset+bytesRead<info.size});
          } finally {await file.close();}
        }
        case 'pc_write_file': {
          const data=Buffer.from(args.content,'utf8');if(data.length>MAX_FILE)throw new Error('File content exceeds 1 MiB');
          // r+ avoids following a path and immediately truncating a special file.
          let file;
          try {file=await fs.open(args.path,args.overwrite?'r+':'wx');}
          catch(error){if(error.code!=='ENOENT'||!args.overwrite)throw error;file=await fs.open(args.path,'wx');}
          try {
            if(!(await file.stat()).isFile())throw new Error('Expected a regular file');
            try {await file.truncate(0);await file.writeFile(data);await file.sync();}
            catch {throw new Error('OUTCOME_UNKNOWN: file may be partially written. Inspect it before retrying.');}
          } finally {await file.close();}
          return result({path:args.path,bytesWritten:data.length,sha256:createHash('sha256').update(data).digest('hex')});
        }
        case 'pc_list_directory': {
          const entries=[],limit=args.limit??200;let truncated=false;
          const dir=await fs.opendir(args.path);
          for await (const e of dir) {
            if(entries.length===limit){truncated=true;break;}
            entries.push({name:e.name,type:e.isSymbolicLink()?'link':e.isDirectory()?'directory':e.isFile()?'file':'other'});
          }
          return result({entries,truncated});
        }
        case 'pc_file_info': {
          const info=await fs.lstat(args.path);
          return result({path:args.path,type:info.isSymbolicLink()?'link':info.isDirectory()?'directory':info.isFile()?'file':'other',size:info.size,modified:info.mtime.toISOString()});
        }
        case 'pc_make_directory': await fs.mkdir(args.path,{recursive:args.recursive??false});return result({path:args.path,created:true});
        case 'pc_start_process': return await this.start(args);
        case 'pc_read_process': return this.read(args);
        case 'pc_stop_process': {
          const job=this.job(args.jobId);
          const requested=job.state==='running' ? job.child.kill() : false;
          return result({jobId:job.id,state:job.state,stopRequested:requested,descendantsMaySurvive:true});
        }
      }
    } catch(error) {return {content:[{type:'text',text:String(error.message)}],isError:true};}
  }
  job(id) {
    const job=this.jobs.get(id);
    if(!job)throw new Error('OUTCOME_UNKNOWN: job is not retained by this agent. Inspect resulting state; do not blindly rerun it.');
    return job;
  }
  async start(args) {
    if(Buffer.byteLength(args.command)>65536 || !args.command.trim())throw new Error('Command must contain 1 to 65536 bytes');
    if(!(await fs.stat(args.cwd)).isDirectory())throw new Error('cwd is not a directory');
    if(this.closed)throw new Error('Agent is stopping; command NOT submitted');
    if([...this.jobs.values()].filter(j=>j.state==='running').length>=4)throw new Error('Four jobs are already running; command NOT submitted');
    while(this.jobs.size>=16) {
      const done=[...this.jobs.values()].find(j=>j.state!=='running');if(!done)break;this.jobs.delete(done.id);
    }
    const windows=process.platform==='win32';
    const executable=windows?path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'):'/bin/sh';
    const argv=windows?['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(args.command,'utf16le').toString('base64')]:['-c',args.command];
    const child=spawn(executable,argv,{cwd:args.cwd,env:childEnvironment(),windowsHide:true,stdio:['ignore','pipe','pipe']});
    const job={id:randomUUID(),child,state:'running',output:Buffer.alloc(0),total:0,exitCode:null,timedOut:false,error:null};
    this.jobs.set(job.id,job);
    const collect=chunk=>{job.total+=chunk.length;job.output=Buffer.concat([job.output,chunk]).subarray(-MAX_OUTPUT);};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    const timer=setTimeout(()=>{job.timedOut=true;child.kill();},args.timeoutMs??30000);
    job.done=new Promise(resolve=>{
      child.once('error',()=>{job.error='Process could not be started';job.state='failed';});
      child.once('close',(code,signal)=>{clearTimeout(timer);job.exitCode=code;job.signal=signal;job.state=job.error?'failed':'exited';resolve();});
    });
    return result({jobId:job.id,state:'started',outputLimitBytes:MAX_OUTPUT});
  }
  read(args) {
    const job=this.job(args.jobId),first=job.total-job.output.length,cursor=args.cursor??0;
    if(cursor>job.total)throw new Error('Cursor exceeds current output length');
    const begin=Math.max(first,cursor),bytes=job.output.subarray(begin-first,begin-first+65536);
    return result({jobId:job.id,state:job.state,exitCode:job.exitCode,timedOut:job.timedOut,error:job.error,
      output:bytes.toString('utf8'),firstAvailable:first,outputDropped:cursor<first,nextCursor:begin+bytes.length,totalBytes:job.total,
      descendantsMaySurvive:true});
  }
  async close() {
    this.closed=true;
    const running=[...this.jobs.values()].filter(j=>j.state==='running');
    for(const job of running)job.child.kill();
    let timer;await Promise.race([Promise.all(running.map(j=>j.done)),new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);
    clearTimeout(timer);
  }
}
