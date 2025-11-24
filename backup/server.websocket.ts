import express from "express";
import { WebSocketServer } from "ws";
import { spawn, ChildProcess } from "child_process";
import cors from "cors";
import { IncomingMessage, ServerResponse } from "http";

const app = express();
const HTTP_PORT = 3000;
const WS_PORT = 3001;
app.use(cors());
app.use(express.json());
const wss = new WebSocketServer({ port: WS_PORT });
console.log(`WebSocket server listening on ws://0.0.0.0:${WS_PORT}`);

let ffmpeg: ChildProcess | null = null;
let httpClients: ServerResponse[] = [];

function startFFmpeg() {
  if (ffmpeg) return;
  
  console.log("Starting ffmpeg process...");
  
  ffmpeg = spawn("ffmpeg", [
    "-f", "image2pipe",       
    "-r", "10",               
    "-i", "pipe:0",           
    "-vf", "scale=640:-2",     
    "-q:v", "5",              
    "-f", "mjpeg",          
    "pipe:1"                
  ], { stdio: ["pipe", "pipe", "inherit"] });
  ffmpeg.stdout?.on("data", (chunk: Buffer) => {
    console.log(`ffmpeg output: ${chunk.length} bytes to ${httpClients.length} clients`);
    httpClients.forEach(res => {
      try {
        res.write(chunk);
      } catch (e) {
        console.error("Error writing to client:", e);
      }
    });
  });

  ffmpeg.on("exit", (code) => {
    console.log(`ffmpeg exited with code ${code}`);
    ffmpeg = null;
  });

  ffmpeg.on("error", (err) => {
    console.error("ffmpeg error:", err);
    ffmpeg = null;
  });

  console.log("ffmpeg started successfully");
}

function stopFFmpeg() {
  if (ffmpeg) {
    console.log("Stopping ffmpeg...");
    try {
      if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
        ffmpeg.stdin.end();
      }
      ffmpeg.kill('SIGTERM');
    } catch (err: any) {
      console.log("Error stopping ffmpeg (this is normal):", err?.message || err);
    }
    ffmpeg = null;
  }
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  console.log("Mobile client connected via WebSocket");

  ws.on("message", (msg: Buffer) => {
    try {
      const msgStr = msg.toString();
      const data = JSON.parse(msgStr);

      if (data.type === "frame" && data.data) {
        if (!ffmpeg) {
          startFFmpeg();
        }
        const buffer = Buffer.from(data.data, "base64");
        console.log(`Received frame: ${buffer.length} bytes`);
        
        if (ffmpeg && ffmpeg.stdin && ffmpeg.stdin.writable && !ffmpeg.stdin.destroyed) {
          try {
            ffmpeg.stdin.write(buffer, (err) => {
              if (err) {
                console.error("Error writing to ffmpeg:", err.message);
              }
            });
          } catch (err: any) {
            console.error("Error writing frame to ffmpeg:", err?.message || err);
          }
        } else {
          console.log("Cannot write to ffmpeg - stdin not available");
        }
      } else if (data.type === "stop") {
        console.log("Stop signal received from client");
        stopFFmpeg();
      }
    } catch (e) {
      console.error("Error processing WebSocket message:", e);
    }
  });

  ws.on("close", () => {
    console.log("Mobile client disconnected");
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});
app.get("/stream.mjpeg", (req: IncomingMessage, res: ServerResponse) => {
  console.log("HTTP client connected to stream");
  
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=ffserver",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Connection": "close",
    "Access-Control-Allow-Origin": "*"
  });

  httpClients.push(res);

  req.on("close", () => {
    console.log("HTTP client disconnected from stream");
    httpClients = httpClients.filter(r => r !== res);
  });
});
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "React Native Playground Backend",
    streaming: ffmpeg !== null,
    connectedClients: httpClients.length
  });
});

app.get("/status", (req, res) => {
  res.json({
    ffmpegRunning: ffmpeg !== null,
    httpClients: httpClients.length,
    wsConnections: wss.clients.size
  });
});
app.listen(HTTP_PORT, () => {
  console.log(`HTTP server listening on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`MJPEG stream available at http://0.0.0.0:${HTTP_PORT}/stream.mjpeg`);
});

process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  stopFFmpeg();
  wss.close();
  process.exit(0);
});

