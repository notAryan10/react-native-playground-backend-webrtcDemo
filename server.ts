import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import { transform } from "sucrase";
import * as pty from 'node-pty';
import * as os from 'os';
import * as http from 'http';

const app = express();
const PORT = process.env.PORT || 3000;

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
          break;

        case 'ice-candidate':
          if (data.targetId) sendToClient(data.targetId, { type: 'ice-candidate', candidate: data.candidate, fromId: clientId });
          else broadcastToOthers(clientId, { type: 'ice-candidate', candidate: data.candidate, fromId: clientId });
          break;

        case 'code-update':
          console.log(`Code update from ${clientId}`);
          let transpiledCode = data.code;
          try {
            const result = transform(data.code, { transforms: ["jsx", "typescript", "imports"], production: true });
            transpiledCode = result.code;
            console.log('✅ Code transpiled');
          } catch (err: any) {
            console.error("❌ Transpilation error:", err.message);
          }
          clients.forEach((client, id) => {
            if (id !== clientId && client.type === 'mobile' && client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify({ type: 'code-update', code: transpiledCode, originalCode: data.code, fromId: clientId }));
            }
          });
          break;

        case 'get-clients':
          const clientList = Array.from(clients.values()).filter(c => c.id !== clientId).map(c => ({ id: c.id, type: c.type }));
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
      cwd: process.cwd(),
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
    // Default to signaling for other paths (likely root or specified signaling path)
    signalingWss.handleUpgrade(req, socket, head, (ws) => {
      signalingWss.emit("connection", ws, req);
    });
  }
});

httpServer.listen(PORT, () => {
  console.log(`✅ Server is ready!`);
  console.log(`Listening on port ${PORT}`);
  console.log(`WebRTC signaling and Terminal available on same port`);
});

process.on("SIGINT", () => {
  signalingWss.close();
  terminalWss.close();
  process.exit(0);
});
