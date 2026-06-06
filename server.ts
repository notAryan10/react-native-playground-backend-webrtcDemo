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

let reanimatedPlugin: any = null;
try {
  const _require = createRequire(import.meta.url);
  reanimatedPlugin = _require('react-native-reanimated/plugin');
  console.log('[Bundler] react-native-reanimated/plugin loaded');
} catch (e: any) {
  console.warn('[Bundler] react-native-reanimated/plugin unavailable — worklet transforms disabled:', e.message);
}

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
  const exts = ['', '.tsx', '.ts', '.jsx', '.js'];

  // 1. Direct file: base, base.tsx, base.ts, ...
  for (const ext of exts) {
    if (files[base + ext] !== undefined) return base + ext;
  }

  // 2. Directory import: base/index.tsx, base/index.ts, ...
  //    (e.g. `import './components'` -> 'src/components/index.tsx')
  for (const ext of exts.slice(1)) {
    if (files[base + '/index' + ext] !== undefined) return base + '/index' + ext;
  }

  // 3. Forgiving unique-suffix fallback. A file created in the explorer without
  //    a folder selected lands at the workspace root (e.g. 'components/Card.tsx')
  //    while `src/App.tsx` imports it as './components/Card', resolving to
  //    'src/components/Card'. Match on the full import-relative tail so a file
  //    saved under a different root still resolves instead of rendering a
  //    "Missing module" stub. Only resolves when exactly one file matches, so
  //    a genuinely missing import still falls through to the stub and ambiguous
  //    names are never guessed.
  const importTail = importPath.replace(/^(\.\.?\/)+/, '').replace(/\.(tsx|ts|jsx|js)$/, '');
  if (importTail) {
    const matches = Object.keys(files).filter((k) => {
      const kNoExt = k.replace(/\.(tsx|ts|jsx|js)$/, '');
      return kNoExt === importTail || kNoExt.endsWith('/' + importTail);
    });
    if (matches.length === 1) {
      console.warn(`[Bundler] Resolved "${importPath}" -> "${matches[0]}" via suffix fallback (file is not under the expected directory).`);
      return matches[0];
    }
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
      if (resolved) {
        visit(resolved);
      } else {
        // File not yet synced — register a stub so the app renders an error
        // instead of crashing with "got: undefined"
        const stubPath = imp;
        if (!moduleCode[stubPath]) {
          console.warn(`[Bundler] Missing local module: "${imp}" imported from "${filePath}" — registering stub`);
          moduleCode[stubPath] = `
Object.defineProperty(exports, "__esModule", { value: true });
var MissingModule = function() {
  var React = require('react');
  var RN = require('react-native');
  return React.createElement(RN.View, { style: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#2d1b1b', padding:20 } },
    React.createElement(RN.Text, { style: { color:'#ff6b6b', fontSize:16, fontFamily:'monospace' } },
      "Missing file: ${imp.replace(/'/g, "\\'")}\\nCreate it in the file explorer."));
};
exports.default = MissingModule;
if (typeof Proxy !== 'undefined') {
  module.exports = new Proxy(exports, {
    get: function(target, prop) { return prop in target ? target[prop] : MissingModule; }
  });
}
`;
        }
      }
    }

    const babelOpts = (withReanimated: boolean) => ({
      filename: workspaceDir ? path.join(workspaceDir, filePath) : filePath,
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
        ['@babel/preset-react', { runtime: 'classic' }],
        '@babel/preset-typescript',
      ] as any[],
      plugins: [
        makePathRewritePlugin(filePath, files),
        ...(withReanimated && reanimatedPlugin ? [reanimatedPlugin] : []),
      ] as any[],
      retainLines: false,
      compact: false,
      configFile: false,
      babelrc: false,
    });

    try {
      const result = babel.transformSync(content, babelOpts(true));
      moduleCode[filePath] = result?.code ?? '';
    } catch (err: any) {
      console.error(`[Bundler] Error in ${filePath} (with reanimated):`, err.message);
      // Retry without reanimated plugin
      try {
        const result = babel.transformSync(content, babelOpts(false));
        moduleCode[filePath] = result?.code ?? '';
        console.log(`[Bundler] ${filePath} compiled OK without reanimated plugin`);
      } catch (err2: any) {
        console.error(`[Bundler] Error in ${filePath} (without reanimated):`, err2.message);
        moduleCode[filePath] = `/* Bundler error in ${filePath}: ${String(err2.message).replace(/\*\//g, '')} */`;
      }
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
function __makeEmptyExportStub(id) {
  var Stub = function() {
    var React = require('react');
    var RN = require('react-native');
    return React.createElement(RN.View, { style: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#2d1b1b', padding:20 } },
      React.createElement(RN.Text, { style: { color:'#ff6b6b', fontSize:14, fontFamily:'monospace' } },
        'No exports in ' + id + '\\nAdd: export default function MyComponent() { ... }'));
  };
  var stub = { __esModule: true, default: Stub };
  if (typeof Proxy !== 'undefined') {
    return new Proxy(stub, { get: function(t, p) { return p in t ? t[p] : Stub; } });
  }
  return stub;
}
function __require(id) {
  if (__cache[id]) return __cache[id].exports;
  if (__modules[id]) {
    var __mod = { exports: {} };
    __cache[id] = __mod;
    __modules[id](__mod, __mod.exports, __require);
    var result = __mod.exports;
    // Local module compiled but exported nothing — named imports would be undefined
    if (id.indexOf('/') !== -1 && !id.startsWith('@') && !result.__esModule && Object.keys(result).length === 0) {
      console.warn('[Bundle] ' + id + ' has no exports. Add a default or named export.');
      return __makeEmptyExportStub(id);
    }
    return result;
  }
  // Local paths that weren't bundled at all — missing file
  if (id.indexOf('/') !== -1 && !id.startsWith('@')) {
    console.warn('[Bundle] Unresolved local module:', id);
    return {};
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

function broadcastBuilderLog(level: 'info' | 'error', message: string) {
  clients.forEach((client) => {
    if (client.type === 'web' && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: 'builder-log', level, message }));
    }
  });
}

function broadcastAll(message: any) {
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

function rebundle() {
  if (fileRegistry.size === 0) {
    console.log('[Bundler] rebundle called but fileRegistry is empty');
    return;
  }
  console.log(`[Bundler] Starting rebundle — ${fileRegistry.size} file(s) in registry`);
  try {
    const files = Object.fromEntries(fileRegistry);
    currentBundle = bundleFiles(files, 'src/App.tsx', WORKSPACE_DIR);
    const bytes = currentBundle.length;
    console.log(`[Bundler] Bundle ready (${bytes} bytes)`);
    // Notify all clients (web gets BUILDER LOGS, mobile gets it in Metro)
    broadcastAll({ type: 'builder-log', level: 'info', message: `Bundle ready (${(bytes / 1024).toFixed(1)} KB)` });

    let mobileCount = 0;
    clients.forEach((client) => {
      if (client.type === 'mobile' && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'code-update', code: currentBundle }));
        mobileCount++;
      }
    });
    console.log(`[Bundler] Sent to ${mobileCount} mobile client(s)`);
    broadcastAll({ type: 'builder-log', level: 'info', message: `Sent to ${mobileCount} mobile client(s)` });
  } catch (err: any) {
    console.error('[Bundler] rebundle failed:', err.message, err.stack);
    broadcastAll({ type: 'builder-log', level: 'error', message: `Bundler error: ${err.message}` });
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
            } else {
              // No bundle yet — ask all connected web clients to resync their files immediately
              console.log(`[Sync] Mobile joined but no bundle — requesting file resync from ${clients.size} web client(s)`);
              clients.forEach((client) => {
                if (client.type === 'web' && client.ws.readyState === WebSocket.OPEN) {
                  client.ws.send(JSON.stringify({ type: 'resync-request' }));
                }
              });
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

        case 'request-bundle':
          console.log(`[RequestBundle] files=${fileRegistry.size}, bundle=${currentBundle?.length ?? 'null'}, clients=${clients.size}`);
          if (currentBundle) {
            console.log(`[Sync] Mobile ${clientId} requested bundle — sending (${currentBundle.length} bytes)`);
            ws.send(JSON.stringify({ type: 'code-update', code: currentBundle }));
            moduleBundles.forEach((code, name) => {
              ws.send(JSON.stringify({ type: 'module-bundle', name, code }));
            });
          } else if (fileRegistry.size > 0) {
            console.log(`[Sync] Mobile ${clientId} requested bundle — triggering rebundle`);
            rebundle();
            // If rebundle succeeded, currentBundle is now set — send it directly to this client
            if (currentBundle) {
              ws.send(JSON.stringify({ type: 'code-update', code: currentBundle }));
            }
          } else {
            console.log(`[Sync] Mobile ${clientId} requested bundle — no files yet`);
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
