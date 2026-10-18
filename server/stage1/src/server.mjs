import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { tokenEquals, validateStageConfig } from './safety.mjs';

const cfg=validateStageConfig(process.env);
const EXPECTED_DEVICE=process.env.DEVICE_ID || 'desktop';
const VERSION='0.2.0-preview.1';
const devices=new Map(), pending=new Map();
const online=d=>Boolean(d && d.ws.readyState===WebSocket.OPEN);
const defaultDevice=()=>[...devices.values()].find(online);
const publicDevice=d=>({id:d.id,name:d.name,online:online(d),toolCount:d.tools.length,lastSeen:d.lastSeen});
const bearer=req=>typeof req.headers.authorization==='string' && req.headers.authorization.startsWith('Bearer ')
  ? req.headers.authorization.slice(7) : '';

function failSocket(ws,reason) {
  for (const [id,p] of pending) {
    if(p.ws!==ws) continue;
    pending.delete(id);clearTimeout(p.timer);
    p.reject(new Error(`OUTCOME_UNKNOWN call=${id}: ${reason}; NOT retried. Check state before repeating.`));
  }
}
function callDevice(device,tool,args,metadata) {
  if (!online(device)) throw new Error('Device offline; command NOT submitted');
  if (!device.tools.some(t=>t.name===tool)) throw new Error('Unknown tool; command NOT submitted');
  if (pending.size>=4) throw new Error('Relay busy; command NOT submitted');
  const id=randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      pending.delete(id);
      reject(new Error(`OUTCOME_UNKNOWN call=${id}: timeout; NOT retried. Check state before repeating.`));
    },cfg.timeoutMs);
    pending.set(id,{resolve,reject,timer,ws:device.ws});
    device.ws.send(JSON.stringify({type:'call',id,tool,args:args||{},metadata:metadata||{}}),error=>{
      if (!error) return;
      const p=pending.get(id);if(!p)return;
      pending.delete(id);clearTimeout(timer);
      reject(new Error(`OUTCOME_UNKNOWN call=${id}: send failed; NOT retried.`));
    });
  });
}
const UI_META_KEYS = new Set([
  'ui/resourceUri',
  'openai/outputTemplate',
  'openai/widgetAccessible',
  'ui'
]);

function stripUiToolMeta(tool) {
  const meta = tool?._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return tool;
  const filtered = Object.fromEntries(
    Object.entries(meta).filter(([key]) => !UI_META_KEYS.has(key))
  );
  const clean = { ...tool };
  if (Object.keys(filtered).length) clean._meta = filtered;
  else delete clean._meta;
  return clean;
}

function advertisedTools() {
  const local=[{
    name:'dc_remote_status',description:'Show relay device status.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false}
  }];
  return [...local,...(defaultDevice()?.tools||[]).map(stripUiToolMeta)];
}
function buildMcpServer() {
  const mcp=new McpServer({name:'mcp-pc-bridge',version:VERSION},{
    instructions:'Private relay to an authorized Windows computer. OUTCOME_UNKNOWN means a command may already have executed. Never blindly repeat it: first inspect the resulting state.'
  });
  mcp.server.registerCapabilities({tools:{listChanged:false}});
  mcp.server.setRequestHandler('tools/list',async()=>({tools:advertisedTools()}));
  mcp.server.setRequestHandler('tools/call',async request=>{
    const {name,arguments:args={},_meta}=request.params;
    if(name==='dc_remote_status') {
      const status=[...devices.values()].map(publicDevice);
      return {content:[{type:'text',text:JSON.stringify(status)}],structuredContent:{devices:status}};
    }
    try{return await callDevice(defaultDevice(),name,args,_meta);}
    catch(error){return {content:[{type:'text',text:String(error.message)}],isError:true};}
  });
  return mcp;
}
const app=createMcpExpressApp({host:cfg.host,allowedHosts:['localhost','127.0.0.1','[::1]']});
const nodeHandler=toNodeHandler(createMcpHandler(()=>buildMcpServer()));
app.get('/healthz',(_req,res)=>res.json({ok:true,version:VERSION,mode:'loopback-stage1'}));
app.all('/mcp',(req,res)=>{
  if(!tokenEquals(bearer(req),cfg.mcpToken)) {
    res.set('Cache-Control','no-store');res.status(401).json({error:'unauthorized'});return;
  }
  Promise.resolve(nodeHandler(req,res,req.body)).catch(()=>{
    if(!res.headersSent)res.status(500).json({error:'MCP request failed'});
  });
});
const httpServer=createServer(app);
const wss=new WebSocketServer({server:httpServer,path:'/device/ws',maxPayload:32*1024*1024,perMessageDeflate:false});
wss.on('connection',ws=>{
  let deviceId=null, alive=true;
  const helloTimer=setTimeout(()=>ws.close(1008,'hello timeout'),8000);
  const heartbeat=setInterval(()=>{
    if(!alive){ws.terminate();return;}
    alive=false;ws.ping();
  },30000);
  ws.on('pong',()=>{alive=true;});
  ws.on('error',()=>{});
  ws.on('message',raw=>{
    let message;try{message=JSON.parse(raw.toString());}catch{ws.close(1003,'invalid json');return;}
    if(!message || typeof message!=='object'){ws.close(1003,'invalid message');return;}
    if(message.type==='hello') {
      if(deviceId || !tokenEquals(message.token,cfg.deviceToken) || message.deviceId!==EXPECTED_DEVICE) {
        ws.close(1008,'unauthorized');return;
      }
      const tools=message.tools;
      if(!Array.isArray(tools)||tools.length>256||tools.some(t=>!t||typeof t.name!=='string'||t.name.length>128||t.name==='dc_remote_status'||!t.inputSchema)) {
        ws.close(1008,'invalid tools');return;
      }
      if(new Set(tools.map(t=>t.name)).size!==tools.length){ws.close(1008,'duplicate tools');return;}
      clearTimeout(helloTimer);deviceId=EXPECTED_DEVICE;
      const previous=devices.get(deviceId);
      if(previous){failSocket(previous.ws,'device connection replaced');previous.ws.close(1012,'replaced');}
      devices.set(deviceId,{id:deviceId,name:String(message.deviceName||deviceId).slice(0,128),ws,tools,lastSeen:new Date().toISOString()});
      ws.send(JSON.stringify({type:'hello_ack',deviceId}));
      console.log(`device online: ${deviceId}, tools=${tools.length}`);return;
    }
    if(!deviceId||devices.get(deviceId)?.ws!==ws){ws.close(1008,'hello required');return;}
    devices.get(deviceId).lastSeen=new Date().toISOString();
    if(message.type==='result') {
      const p=pending.get(message.id);
      // A result from another/replaced socket cannot complete this invocation.
      if(!p||p.ws!==ws)return;
      pending.delete(message.id);clearTimeout(p.timer);
      if(message.ok)p.resolve(message.result);else p.reject(new Error(String(message.error||'Remote call failed')));
    }else if(message.type==='ping')ws.send(JSON.stringify({type:'pong',ts:Date.now()}));
  });
  ws.on('close',()=>{
    clearTimeout(helloTimer);clearInterval(heartbeat);failSocket(ws,'device disconnected');
    if(deviceId&&devices.get(deviceId)?.ws===ws){devices.delete(deviceId);console.log(`device offline: ${deviceId}`);}
  });
});
httpServer.listen(cfg.port,cfg.host,()=>console.log(`dc-remote ${VERSION} listening on http://${cfg.host}:${cfg.port}`));
function shutdown(){for(const ws of wss.clients)ws.terminate();httpServer.close(()=>process.exit(0));setTimeout(()=>process.exit(1),3000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
