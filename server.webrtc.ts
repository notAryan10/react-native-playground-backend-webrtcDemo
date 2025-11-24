import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";

const app = express();
const HTTP_PORT = 3000;
const WS_SIGNALING_PORT = 3002;

app.use(cors());
app.use(express.json());

// WebRTC Signaling Server
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

// Store connected clients
interface Client {
  ws: WebSocket;
  id: string;
  type: 'mobile' | 'web';
}

const clients: Map<string, Client> = new Map();

signalingWss.on("connection", (ws: WebSocket, req) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`WebRTC signaling client connected: ${clientId}`);

  // Send client ID to the newly connected client
  ws.send(JSON.stringify({
    type: 'client-id',
    clientId: clientId
  }));

  ws.on("message", (message: Buffer) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'register':
          // Register client type (mobile or web)
          clients.set(clientId, {
            ws,
            id: clientId,
            type: data.clientType || 'web'
          });
          console.log(`Client ${clientId} registered as ${data.clientType || 'web'}`);
          
          // Notify all clients about new connection
          broadcastToOthers(clientId, {
            type: 'client-connected',
            clientId: clientId,
            clientType: data.clientType || 'web'
          });
          break;

        case 'offer':
          // Forward offer to the other peer
          console.log(`Offer from ${clientId} to ${data.targetId || 'all'}`);
          if (data.targetId) {
            sendToClient(data.targetId, {
              type: 'offer',
              offer: data.offer,
              fromId: clientId
            });
          } else {
            // Broadcast to all other clients
            broadcastToOthers(clientId, {
              type: 'offer',
              offer: data.offer,
              fromId: clientId
            });
          }
          break;

        case 'answer':
          // Forward answer to the peer that sent the offer
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
          // Forward ICE candidate to the other peer
          if (data.targetId) {
            sendToClient(data.targetId, {
              type: 'ice-candidate',
              candidate: data.candidate,
              fromId: clientId
            });
          } else {
            // Broadcast to all other clients
            broadcastToOthers(clientId, {
              type: 'ice-candidate',
              candidate: data.candidate,
              fromId: clientId
            });
          }
          break;

        case 'get-clients':
          // Send list of connected clients
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
    
    // Notify other clients about disconnection
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

// HTTP endpoints
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

app.listen(HTTP_PORT, () => {
  console.log(`HTTP server listening on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`WebRTC signaling available at ws://0.0.0.0:${WS_SIGNALING_PORT}`);
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

process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  signalingWss.close();
  process.exit(0);
});

