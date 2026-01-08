import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import { transform } from "sucrase";
import * as pty from 'node-pty';
import * as os from 'os';
import * as http from 'http';

const app = express();
const HTTP_PORT = 3000;
const WS_SIGNALING_PORT = 3002;

app.use(cors());
app.use(express.json());

let signalingWss: WebSocketServer;
try {
  signalingWss = new WebSocketServer({ port: WS_SIGNALING_PORT });
  console.log(`WebRTC Signaling server listening on ws://0.0.0.0:${WS_SIGNALING_PORT}`);
} catch (error: any) {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${WS_SIGNALING_PORT} is already in use.`);
    process.exit(1);
  }
  throw error;
}

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


const terminalWss = new WebSocketServer({ noServer: true });

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
    signalingPort: WS_SIGNALING_PORT,
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
    socket.destroy();
  }
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`✅ Server is ready!`);
  console.log(`HTTP server listening on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`WebRTC signaling available at ws://0.0.0.0:${WS_SIGNALING_PORT}`);
  console.log(`Terminal WebSocket available at ws://0.0.0.0:${HTTP_PORT}/terminal`);
});

httpServer.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${HTTP_PORT} is already in use.`);
    process.exit(1);
  }
  throw error;
});

process.on("SIGINT", () => {
  signalingWss.close();
  terminalWss.close();
  process.exit(0);
});
