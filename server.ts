import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import * as pty from 'node-pty';
import * as os from 'os';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import * as babel from '@babel/core';

const _require = createRequire(import.meta.url);
const reanimatedPlugin = _require('react-native-reanimated/plugin');

// ─── Bundler ────────────────────────────────────────────────────────────────

function resolvePath(fromFile: string, importPath: string, files: Record<string, string>): string | null {
  if (!importPath.startsWith('.')) return null;
  const fromDir = fromFile.split('/').slice(0, -1).join('/');
  const parts = (fromDir ? fromDir + '/' + importPath : importPath).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  const base = resolved.join('/');
  for (const ext of ['', '.tsx', '.ts', '.jsx', '.js']) {
    if (files[base + ext] !== undefined) return base + ext;
  }
  return null;
}

function makePathRewritePlugin(fromFile: string, files: Record<string, string>) {
  return () => ({
    visitor: {
      ImportDeclaration(nodePath: any) {
        const src = nodePath.node.source.value as string;
        if (src.startsWith('.')) {
          const resolved = resolvePath(fromFile, src, files);
          if (resolved) nodePath.node.source.value = resolved;
        }
      },
      CallExpression(nodePath: any) {
        const { node } = nodePath;
        if (
          node.callee.name === 'require' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'StringLiteral' &&
          (node.arguments[0].value as string).startsWith('.')
        ) {
          const resolved = resolvePath(fromFile, node.arguments[0].value, files);
          if (resolved) node.arguments[0].value = resolved;
        }
      }
    }
  });
}

function bundleFiles(files: Record<string, string>, entryPoint = 'src/App.tsx', workspaceDir?: string): string {
  const visited = new Set<string>();
  const moduleCode: Record<string, string> = {};

  function visit(filePath: string) {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const content = files[filePath];
    if (content === undefined) {
      console.warn(`[Bundler] File not found: ${filePath}`);
      return;
    }

    // Scan for local imports BEFORE transform so we visit them
    const importRe = /(?:import\s+[\s\S]*?from\s+['"](\.[^'"]+)['"]|require\s*\(\s*['"](\.[^'"]+)['"]\s*\))/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content)) !== null) {
      const imp = m[1] || m[2];
      const resolved = resolvePath(filePath, imp, files);
      if (resolved) visit(resolved);
    }

    try {
      // Use real disk path as filename so reanimated plugin can read it for worklet extraction
      const diskFilename = workspaceDir ? path.join(workspaceDir, filePath) : filePath;
      const result = babel.transformSync(content, {
        filename: diskFilename,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
          ['@babel/preset-react', { runtime: 'classic' }],
          '@babel/preset-typescript',
        ],
        plugins: [
          makePathRewritePlugin(filePath, files),
          reanimatedPlugin,
        ],
        retainLines: false,
        compact: false,
        configFile: false,
        babelrc: false,
      });
      moduleCode[filePath] = result?.code ?? '';
    } catch (err: any) {
      console.error(`[Bundler] Error in ${filePath}:`, err.message);
      moduleCode[filePath] = `/* Bundler error in ${filePath}: ${String(err.message).replace(/\*\//g, '')} */`;
    }
  }

  visit(entryPoint);

  const registrations = Object.entries(moduleCode)
    .map(([fp, code]) =>
      `__modules[${JSON.stringify(fp)}] = function(module, exports, require) {\n${code}\n};`
    )
    .join('\n\n');

  return `
var __modules = {};
var __cache  = {};
function __require(id) {
  if (__cache[id]) return __cache[id].exports;
  if (__modules[id]) {
    var __mod = { exports: {} };
    __cache[id] = __mod;
    __modules[id](__mod, __mod.exports, __require);
    return __mod.exports;
  }
  return require(id);
}

${registrations}

module.exports = __require(${JSON.stringify(entryPoint)});
`.trim();
}

const app = express();
const PORT = process.env.PORT || 3000;


// Default to a relative 'workspace' folder if not specified, 
// ensuring we don't try to write to /workspace (root) on platforms like Render
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace');

// Ensure workspace exists
try {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    console.log(`Creating workspace at: ${WORKSPACE_DIR}`);
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
} catch (err: any) {
  console.error(`⚠️ Could not create workspace directory: ${err.message}. Terminal might have limited functionality.`);
}

const INACTIVITY_TIMEOUT = 60 * 60 * 1000; // 1 hour

let inactivityTimer: NodeJS.Timeout;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    console.log("Shutting down due to inactivity...");
    process.exit(0);
  }, INACTIVITY_TIMEOUT);
}

// Initial timer start
resetInactivityTimer();

app.use(cors());
app.use(express.json());

const signalingWss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });

interface Client {
  ws: WebSocket;
  id: string;
  type: 'mobile' | 'web';
}

const clients: Map<string, Client> = new Map();
let currentCode: string | null = null;
let currentBundle: string | null = null;
const fileRegistry: Map<string, string> = new Map();
const moduleBundles: Map<string, string> = new Map();

function rebundle() {
  if (fileRegistry.size === 0) return;
  try {
    const files = Object.fromEntries(fileRegistry);
    currentBundle = bundleFiles(files, 'src/App.tsx', WORKSPACE_DIR);
    console.log(`[Bundler] Bundle ready (${currentBundle.length} bytes)`);

    clients.forEach((client) => {
      if (client.type === 'mobile' && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'code-update', code: currentBundle }));
      }
    });
  } catch (err: any) {
    console.error('[Bundler] rebundle failed:', err.message);
  }
}

function sendToClient(clientId: string, message: any) {
  const client = clients.get(clientId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

function broadcastToOthers(senderId: string, message: any) {
  clients.forEach((client, id) => {
    if (id !== senderId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

signalingWss.on("connection", (ws: WebSocket) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`WebRTC signaling client connected: ${clientId}`);

  ws.send(JSON.stringify({ type: 'client-id', clientId: clientId }));

  ws.on("message", (message: Buffer) => {
    resetInactivityTimer();
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'register':
          const clientType = data.clientType || 'web';
          clients.set(clientId, { ws, id: clientId, type: clientType });
          console.log(`Client ${clientId} registered as ${clientType}`);
          
          // On mobile join: send latest bundle (or fallback to legacy code), then dynamic JS bundles
          if (clientType === 'mobile') {
            const codeToSend = currentBundle ?? currentCode;
            if (codeToSend) {
              console.log(`[Sync] Sending ${currentBundle ? 'bundle' : 'legacy code'} to: ${clientId}`);
              ws.send(JSON.stringify({ type: 'code-update', code: codeToSend }));
            }
            if (moduleBundles.size > 0) {
              console.log(`[Sync] Sending ${moduleBundles.size} module bundle(s) to: ${clientId}`);
              moduleBundles.forEach((code, name) => {
                ws.send(JSON.stringify({ type: 'module-bundle', name, code }));
              });
            }
          }

          broadcastToOthers(clientId, { type: 'client-connected', clientId, clientType });
          break;

        case 'offer':
          if (data.targetId) {
            sendToClient(data.targetId, { type: 'offer', offer: data.offer, fromId: clientId });
          } else {
            // If no target specified, broadcast to all OTHER clients
            // Usually, mobile sends offer, web receives it.
            broadcastToOthers(clientId, { type: 'offer', offer: data.offer, fromId: clientId });
          }
          break;

        case 'answer':
          if (data.targetId) {
            sendToClient(data.targetId, { type: 'answer', answer: data.answer, fromId: clientId });
          } else {
            broadcastToOthers(clientId, { type: 'answer', answer: data.answer, fromId: clientId });
          }
          break;

        case 'ice-candidate':
          if (data.targetId) {
            sendToClient(data.targetId, { type: 'ice-candidate', candidate: data.candidate, fromId: clientId });
          } else {
            broadcastToOthers(clientId, { type: 'ice-candidate', candidate: data.candidate, fromId: clientId });
          }
          break;

        case 'code-update':
          console.log(`[CodeUpdate] Received update from ${clientId} (${clients.get(clientId)?.type})`);
          currentCode = data.code;
          
          let mobileCount = 0;
          clients.forEach((client, id) => {
            if (id !== clientId && client.type === 'mobile' && client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify({ 
                type: 'code-update', 
                code: currentCode, 
                originalCode: data.code, 
                fromId: clientId 
              }));
              mobileCount++;
            }
          });
          console.log(`[CodeUpdate] Broadcasted to ${mobileCount} mobile clients`);
          break;

        case 'file-update':
          const { files } = data; // Record<string, { content: string }>
          console.log(`[FileUpdate] Syncing ${Object.keys(files).length} files...`);

          try {
            for (const [filePath, fileData] of Object.entries(files as Record<string, any>)) {
              // Update in-memory registry for bundler
              fileRegistry.set(filePath, fileData.content);

              // Persist to disk
              const fullPath = path.join(WORKSPACE_DIR, filePath);
              const dir = path.dirname(fullPath);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(fullPath, fileData.content);
            }
            console.log('✅ Files synced — triggering rebundle');
            rebundle();
          } catch (err: any) {
            console.error('❌ File sync error:', err.message);
          }
          break;

        case 'module-bundle':
          const { name: moduleName, code: moduleCode } = data;
          if (moduleName && moduleCode) {
            moduleBundles.set(moduleName, moduleCode);
            console.log(`[ModuleBundle] Stored and broadcasting bundle for: ${moduleName} (${moduleCode.length} bytes)`);
            let mobileModuleCount = 0;
            clients.forEach((client, id) => {
              if (id !== clientId && client.type === 'mobile' && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({ type: 'module-bundle', name: moduleName, code: moduleCode }));
                mobileModuleCount++;
              }
            });
            console.log(`[ModuleBundle] Sent to ${mobileModuleCount} mobile client(s)`);
          }
          break;

        case 'get-clients':
          const clientList = Array.from(clients.values()).filter(c => c.id !== clientId).map(c => ({ id: c.id, type: c.type }));
          console.log(`[Status] Client ${clientId} requested client list. Found ${clientList.length} others.`);
          ws.send(JSON.stringify({ type: 'clients-list', clients: clientList }));
          break;
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${clientId}`);
    clients.delete(clientId);
    broadcastToOthers(clientId, { type: 'client-disconnected', clientId });
  });
});

terminalWss.on("connection", (ws: WebSocket) => {
  console.log("🖥️  Terminal connected");

  const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/bash");

  let ptyProcess: any;
  try {
    ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: WORKSPACE_DIR,
      env: process.env as any,
    });
  } catch (err: any) {
    console.error("❌ Failed to spawn pty:", err);
    ws.send(`\r\n\x1b[31mError spawning terminal: ${err.message}\x1b[0m\r\n`);
    ws.close();
    return;
  }

  ptyProcess.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on("message", (msg: Buffer) => {
    resetInactivityTimer();
    try {
      const parsed = JSON.parse(msg.toString());
      const { type, data, cols, rows } = parsed;

      if (type === "input") {
        ptyProcess.write(data);
      }

      if (type === "resize") {
        ptyProcess.resize(cols, rows);
      }
    } catch (e) {
      console.error("Terminal msg error:", e);
    }
  });

  ws.on("close", () => {
    console.log("🖥️  Terminal disconnected");
    try {
      ptyProcess.kill();
    } catch (e) { }
  });
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "React Native Playground Backend - WebRTC Mode",
    port: PORT,
    connectedClients: clients.size
  });
});

app.get("/status", (req, res) => {
  res.json({
    signalingActive: true,
    connectedClients: clients.size,
    clients: Array.from(clients.values()).map(c => ({ id: c.id, type: c.type }))
  });
});

const httpServer = http.createServer(app);

// Use a number for the port and ensure it defaults correctly
const finalPort = Number(PORT);

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  if (url.pathname === "/terminal") {
    terminalWss.handleUpgrade(req, socket, head, (ws) => {
      terminalWss.emit("connection", ws, req);
    });
  } else {
    signalingWss.handleUpgrade(req, socket, head, (ws) => {
      signalingWss.emit("connection", ws, req);
    });
  }
});

httpServer.listen(finalPort, "0.0.0.0", () => {
  console.log(`✅ Server is ready and listening on port ${finalPort}`);
  console.log(`Environment PORT: ${process.env.PORT}`);
});

process.on("SIGINT", () => {
  signalingWss.close();
  terminalWss.close();
  process.exit(0);
});
