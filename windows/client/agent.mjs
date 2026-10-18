import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { LocalPcTools } from "./pc-tools.mjs";
import WebSocket from "ws";
import { CallLedger } from "./safety.mjs";

const configPath = process.env.DC_REMOTE_CONFIG || path.join(os.homedir(), ".mcp-pc-bridge-agent", "agent.json");
let fileConfig = {};
try {
  const rawConfig = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
  fileConfig = JSON.parse(rawConfig);
} catch (error) {
  if (error?.code !== "ENOENT") throw new Error(`Invalid config: ${error.message}`);
}

const RELAY_URL = process.env.RELAY_URL || fileConfig.relayUrl || "ws://127.0.0.1:8787/device/ws";
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || fileConfig.deviceToken || "";
const DEVICE_ID = process.env.DEVICE_ID || fileConfig.deviceId || os.hostname().toLowerCase();
const DEVICE_NAME = process.env.DEVICE_NAME || fileConfig.deviceName || os.hostname();
if (!/^[a-f0-9]{64}$/.test(DEVICE_TOKEN)) throw new Error("A random device token is required");
const relayAddress = new URL(RELAY_URL);
if (!['ws:', 'wss:'].includes(relayAddress.protocol) ||
    (relayAddress.protocol === 'ws:' && !['127.0.0.1', '[::1]', 'localhost'].includes(relayAddress.hostname))) {
  throw new Error("Unencrypted ws is allowed only on loopback; use wss for remote access");
}

const lockDir = path.dirname(configPath);
const lockPath = path.join(lockDir, "agent.lock");

function acquireSingleInstance() {
  fs.mkdirSync(lockDir, { recursive: true });
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const oldPid = Number(fs.readFileSync(lockPath, "utf8").trim());
    try {
      process.kill(oldPid, 0);
      throw new Error(`MCP PC Bridge agent is already running as PID ${oldPid}`);
    } catch (probeError) {
      if (probeError?.code !== "ESRCH") throw probeError;
      fs.rmSync(lockPath, { force: true });
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    }
  }
}

function releaseSingleInstance() {
  try { fs.rmSync(lockPath, { force: true }); } catch { /* best effort */ }
}

acquireSingleInstance();
process.on("exit", releaseSingleInstance);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const local = new LocalPcTools();
const ledger = new CallLedger();
let activeSocket = null;
let stopping = false;

async function executeRemoteCall(ws, message) {
  if (typeof message.id !== 'string' || message.id.length > 128 || typeof message.tool !== 'string') {
    ws.close(1008, 'invalid call'); return;
  }
  let reply;
  try {
    const signature = JSON.stringify([message.tool, message.args || {}]);
    const result = await ledger.run(message.id, signature, () => local.call(message.tool, message.args));
    reply = { type: "result", id: message.id, ok: true, result };
  } catch (error) {
    reply = { type: "result", id: message.id, ok: false, error: String(error.message) };
  }
  // Lost result != unexecuted command. Never reconnect or rerun the command here.
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply), () => {});
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

async function relaySession() {
  await local.connect();

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL, {handshakeTimeout:10000, maxPayload:32*1024*1024, perMessageDeflate:false});
    activeSocket = ws;
    let heartbeat = null;
    let opened = false;
    let accepted = false;
    let lastPong = Date.now();
    const acceptTimer = setTimeout(() => { if (!accepted) ws.terminate(); }, 12000);

    ws.on("open", () => {
      opened = true;
      ws.send(JSON.stringify({
        type: "hello",
        deviceId: DEVICE_ID,
        deviceName: DEVICE_NAME,
        token: DEVICE_TOKEN,
        tools: local.tools.map(stripUiToolMeta)
      }));
      heartbeat = setInterval(() => {
        if (Date.now()-lastPong > 65000) { ws.terminate(); return; }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
        }
      }, 20000);
      console.log(`relay connected: ${RELAY_URL} as ${DEVICE_ID}`);
    });

    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === "hello_ack") {
        accepted = true; clearTimeout(acceptTimer); lastPong = Date.now();
        console.log(`relay accepted device: ${message.deviceId}`);
      } else if (message.type === "pong") {
        lastPong = Date.now();
      } else if (message.type === "call" && accepted) {
        void executeRemoteCall(ws, message);
      }
    });

    ws.on("error", (error) => {
      if (!opened) reject(error);
      else console.error("relay socket error:", error.message);
    });

    ws.on("close", (code, reason) => {
      clearTimeout(acceptTimer);
      if (heartbeat) clearInterval(heartbeat);
      if (activeSocket === ws) activeSocket = null;
      console.warn(`relay disconnected: ${code} ${reason.toString()}`);
      resolve();
    });
  });
}

async function main() {
  let delay = 1000;
  while (!stopping) {
    try {
      await relaySession();
      delay = 1000;
    } catch (error) {
      console.error("relay connection failed:", error.message);
    }
    if (stopping) break;
    await sleep(delay);
    delay = Math.min(delay * 2, 15000);
  }
}
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  try {
    activeSocket?.close(1000, "shutdown");
  } catch {
    // Ignore.
  }
  await local.close();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
