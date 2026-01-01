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

const terminalWss = new WebSocketServer({ noServer: true });

let signalingWss: WebSocketServer;
try {
  signalingWss = new WebSocketServer({ port: WS_SIGNALING_PORT });
  console.log(`WebRTC Signaling server listening on ws://0.0.0.0:${WS_SIGNALING_PORT}`);
} catch (error: any) {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${WS_SIGNALING_PORT} is already in use.`);
    console.error(`   Run: ./kill-ports.sh or lsof -ti :${WS_SIGNALING_PORT} | xargs kill`);
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

signalingWss.on("connection", (ws: WebSocket, req) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`WebRTC signaling client connected: ${clientId}`);

  ws.send(JSON.stringify({
    type: 'client-id',
    clientId: clientId
  }));

  ws.on("message", (message: Buffer) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'register':
          clients.set(clientId, {
            ws,
            id: clientId,
            type: data.clientType || 'web'
          });
          console.log(`Client ${clientId} registered as ${data.clientType || 'web'}`);

          broadcastToOthers(clientId, {
            type: 'client-connected',
            clientId: clientId,
            clientType: data.clientType || 'web'
          });
          break;

        case 'offer':
          console.log(`Offer from ${clientId} to ${data.targetId || 'all'}`);
          if (data.targetId) {
            sendToClient(data.targetId, {
              type: 'offer',
              offer: data.offer,
              fromId: clientId
            });
          } else {
            broadcastToOthers(clientId, {
              type: 'offer',
              offer: data.offer,
              fromId: clientId
            });
          }
          break;

        case 'answer':
          console.log(`Answer from ${clientId} to ${data.targetId}`);
          if (data.targetId) {
            sendToClient(data.targetId, {
              type: 'answer',
              answer: data.answer,
              fromId: clientId
            });
          }
          break;

        case 'ice-candidate':
          if (data.targetId) {
            sendToClient(data.targetId, {
              type: 'ice-candidate',
              candidate: data.candidate,
              fromId: clientId
            });
          } else {
            broadcastToOthers(clientId, {
              type: 'ice-candidate',
              candidate: data.candidate,
              fromId: clientId
            });
          }
          break;

        case 'code-update':
          console.log(`Code update from ${clientId}`);
          let transpiledCode = data.code;
          try {
            const result = transform(data.code, {
              transforms: ["jsx", "typescript", "imports"],
              production: true,
            });
            transpiledCode = result.code;
            console.log('✅ Code transpiled successfully');
          } catch (err: any) {
            console.error("❌ Transpilation error:", err.message);
          }

          clients.forEach((client, id) => {
            if (id !== clientId && client.type === 'mobile' && client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify({
                type: 'code-update',
                code: transpiledCode,
                originalCode: data.code,
                fromId: clientId
              }));
            }
          });
          break;

        case 'get-clients':
          const clientList = Array.from(clients.values())
            .filter(c => c.id !== clientId)
            .map(c => ({ id: c.id, type: c.type }));
          ws.send(JSON.stringify({
            type: 'clients-list',
            clients: clientList
          }));
          break;

        default:
          console.log(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error("Error processing WebRTC signaling message:", error);
    }
  });

  ws.on("close", () => {
    console.log(`WebRTC signaling client disconnected: ${clientId}`);
    clients.delete(clientId);
    broadcastToOthers(clientId, {
      type: 'client-disconnected',
      clientId: clientId
    });
  });

  ws.on("error", (err) => {
    console.error(`WebSocket error for client ${clientId}:`, err);
  });
});

function sendToClient(clientId: string, message: any) {
  const client = clients.get(clientId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
  } else {
    console.warn(`Client ${clientId} not found or not connected`);
  }
}

function broadcastToOthers(senderId: string, message: any) {
  clients.forEach((client, id) => {
    if (id !== senderId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "React Native Playground Backend - WebRTC Mode",
    signalingPort: WS_SIGNALING_PORT,
    connectedClients: clients.size
  });
});

app.get("/status", (req, res) => {
  const clientList = Array.from(clients.values()).map(c => ({
    id: c.id,
    type: c.type
  }));

  res.json({
    signalingActive: true,
    connectedClients: clients.size,
    clients: clientList
  });
});

app.get("/clients", (req, res) => {
  const clientList = Array.from(clients.values()).map(c => ({
    id: c.id,
    type: c.type
  }));

  res.json({
    clients: clientList,
    count: clients.size
  });
});

terminalWss.on('connection', (ws: WebSocket) => {
  console.log('🖥️  Terminal client connected');

  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.cwd(),
    env: process.env as any,
  });

  ptyProcess.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on('message', (message: Buffer) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'input':
          ptyProcess.write(data.data);
          break;

        case 'resize':
          ptyProcess.resize(data.cols || 80, data.rows || 30);
          break;
      }
    } catch (error) {
      console.error('Terminal message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('🖥️  Terminal client disconnected');
    ptyProcess.kill();
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`Terminal process exited with code ${exitCode}`);
    ws.close();
  });
});

const httpServer = http.createServer();

httpServer.on('request', app);

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (url.pathname === '/terminal') {
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`HTTP server listening on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`WebRTC signaling available at ws://0.0.0.0:${WS_SIGNALING_PORT}`);
  console.log(`Terminal WebSocket available at ws://0.0.0.0:${HTTP_PORT}/terminal`);
  console.log(`\n✅ Server is ready!`);
  console.log(`\nTo use WebRTC:`);
  console.log(`1. Connect mobile app to ws://YOUR_IP:${WS_SIGNALING_PORT}`);
  console.log(`2. Connect web frontend to ws://localhost:${WS_SIGNALING_PORT}`);
}).on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${HTTP_PORT} is already in use.`);
    console.error(`   Run: ./kill-ports.sh or lsof -ti :${HTTP_PORT} | xargs kill`);
    process.exit(1);
  }
  throw error;
});

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (url.pathname === '/terminal') {
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit('connection', ws, request);
    });
  }
});

process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  signalingWss.close();
  process.exit(0);
});

