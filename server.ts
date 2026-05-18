import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import { transform } from "sucrase";
import * as pty from 'node-pty';
import * as os from 'os';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || (os.platform() === 'win32' ? process.cwd() : '/workspace');

// Ensure workspace exists
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
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
          clients.set(clientId, { ws, id: clientId, type: data.clientType || 'web' });
          console.log(`Client ${clientId} registered as ${data.clientType || 'web'}`);
          broadcastToOthers(clientId, { type: 'client-connected', clientId, clientType: data.clientType || 'web' });
          break;

        case 'offer':
          if (data.targetId) sendToClient(data.targetId, { type: 'offer', offer: data.offer, fromId: clientId });
          else broadcastToOthers(clientId, { type: 'offer', offer: data.offer, fromId: clientId });
          break;

        case 'answer':
          if (data.targetId) sendToClient(data.targetId, { type: 'answer', answer: data.answer, fromId: clientId });
          else broadcastToOthers(clientId, { type: 'answer', answer: data.answer, fromId: clientId });
          break;

        case 'ice-candidate':
          if (data.targetId) sendToClient(data.targetId, { type: 'ice-candidate', candidate: data.candidate, fromId: clientId });
          else broadcastToOthers(clientId, { type: 'ice-candidate', candidate: data.candidate, fromId: clientId });
          break;

        case 'code-update':
          console.log(`[CodeUpdate] Received update from ${clientId} (${clients.get(clientId)?.type})`);
          const codeToSend = data.code;
          
          let mobileCount = 0;
          clients.forEach((client, id) => {
            if (id !== clientId && client.type === 'mobile' && client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify({ 
                type: 'code-update', 
                code: codeToSend, 
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
          console.log(`[FileUpdate] Syncing ${Object.keys(files).length} files to disk...`);
          
          try {
            for (const [filePath, fileData] of Object.entries(files as Record<string, any>)) {
              const fullPath = path.join(WORKSPACE_DIR, filePath);
              const dir = path.dirname(fullPath);
              
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              
              fs.writeFileSync(fullPath, fileData.content);
            }
            console.log('✅ File system synced');
          } catch (err: any) {
            console.error('❌ File sync error:', err.message);
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

httpServer.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`✅ Server is ready!`);
  console.log(`Listening on port ${PORT} at 0.0.0.0`);
  console.log(`WebRTC signaling and Terminal available on same port`);
});

process.on("SIGINT", () => {
  signalingWss.close();
  terminalWss.close();
  process.exit(0);
});
