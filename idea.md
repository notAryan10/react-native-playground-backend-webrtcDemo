# React Native Playground with Live Streaming

A complete React Native playground that allows you to stream your mobile app's view in real-time to a web browser using WebSocket and ffmpeg.

## 🎯 Overview

This project consists of three main components:

1. **Backend Server** - Node.js WebSocket server with ffmpeg streaming
2. **Expo Mobile App** - React Native app that captures and streams views
3. **Next.js Frontend** - Web interface to view the live stream

## 🏗️ Architecture

```
┌─────────────────┐         WebSocket          ┌──────────────────┐
│   Expo Mobile   │ ─────── (Base64 PNG) ────> │  Backend Server  │
│      App        │                             │  (Node.js + WS)  │
└─────────────────┘                             └──────────────────┘
                                                         │
                                                    ffmpeg pipe
                                                         │
                                                         ▼
                                                  MJPEG Stream
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │  Next.js Web UI  │
                                                │  (Stream Viewer) │
                                                └──────────────────┘
```

## 📋 Prerequisites

- **Node.js** 18+ and npm
- **ffmpeg** installed and available in PATH
  ```bash
  # macOS
  brew install ffmpeg
  
  # Ubuntu/Debian
  sudo apt-get install ffmpeg
  
  # Windows
  # Download from https://ffmpeg.org/download.html
  ```
- **Expo CLI** (optional, for easier development)
  ```bash
  npm install -g expo-cli
  ```
- **iOS Simulator** or **Android Emulator** or **Physical Device**

## 🚀 Quick Start

### 1. Backend Server Setup

```bash
cd react_native_playground_backend

# Install dependencies
npm install

# Start the server
npm run dev
```

The server will start on:
- HTTP: `http://localhost:3000`
- WebSocket: `ws://localhost:3001`
- MJPEG Stream: `http://localhost:3000/stream.mjpeg`

### 2. Expo Mobile App Setup

```bash
cd expo-stream-app

# Install dependencies
npm install

# Start Expo
npx expo start
```

**Important:** Update the server IP in `app/index.tsx`:
```typescript
const [serverIP, setServerIP] = useState("YOUR_COMPUTER_IP"); // e.g., "192.168.1.100"
```

To find your IP:
```bash
# macOS/Linux
ifconfig | grep "inet "

# Windows
ipconfig
```

Then:
1. Scan QR code with Expo Go app (iOS/Android)
2. Or press `i` for iOS simulator / `a` for Android emulator
3. Enter your server IP in the app
4. Press "Start Streaming"

### 3. Frontend Web UI Setup

```bash
cd react-native-playground-frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Open `http://localhost:3000` in your browser to see the live stream!

## 🎮 Usage

### Starting a Stream

1. **Start Backend Server**
   ```bash
   cd react_native_playground_backend
   npm run dev
   ```

2. **Start Mobile App**
   ```bash
   cd expo-stream-app
   npx expo start
   ```
   - Open in Expo Go or simulator
   - Enter your computer's IP address
   - Tap "Start Streaming"

3. **View Stream in Browser**
   ```bash
   cd react-native-playground-frontend
   npm run dev
   ```
   - Open http://localhost:3000
   - Stream will appear in the Preview panel

### Alternative: View Stream Directly

You can also view the MJPEG stream directly:

**In VLC:**
- Media → Open Network Stream
- Enter: `http://YOUR_IP:3000/stream.mjpeg`

**In Browser:**
- Navigate to: `http://YOUR_IP:3000/stream.mjpeg`
- (Some browsers support MJPEG natively)

## 📁 Project Structure

```
native_playground/
├── react_native_playground_backend/
│   ├── server.ts                 # WebSocket + ffmpeg server
│   ├── package.json
│   └── tsconfig.json
│
├── expo-stream-app/
│   ├── app/
│   │   ├── _layout.tsx          # App layout
│   │   └── index.tsx            # Main streaming screen
│   ├── app.json
│   ├── package.json
│   └── tsconfig.json
│
└── react-native-playground-frontend/
    ├── src/
    │   ├── app/
    │   │   └── page.tsx
    │   └── components/
    │       ├── PlaygroundLayout.tsx
    │       ├── StreamViewer.tsx  # Stream display component
    │       └── ...
    ├── package.json
    └── next.config.ts
```

## 🔧 Configuration

### Backend Server

Edit `react_native_playground_backend/server.ts`:

```typescript
const HTTP_PORT = 3000;  // HTTP server port
const WS_PORT = 3001;    // WebSocket port

// ffmpeg settings
"-r", "10",              // Frame rate (FPS)
"-vf", "scale=640:-2",   // Video scale
"-q:v", "5",             // JPEG quality (2-31, lower = better)
```

### Mobile App

Edit `expo-stream-app/app/index.tsx`:

```typescript
const intervalMs = 100;  // Capture interval (100ms = 10 FPS)

// Capture settings
format: "png",
quality: 0.7,            // Image quality (0-1)
result: "base64",
```

### Frontend

Edit `react-native-playground-frontend/src/components/PlaygroundLayout.tsx`:

```typescript
<StreamViewer 
  serverUrl="http://localhost:3000"  // Backend URL
  theme={currentSettings.theme}
/>
```

## 🛠️ Tech Stack

### Backend
- **Node.js** + **TypeScript**
- **Express.js** - HTTP server
- **ws** - WebSocket server
- **ffmpeg** - Video encoding
- **CORS** - Cross-origin support

### Mobile App
- **Expo** ~52.0.0
- **React Native** 0.76.5
- **react-native-view-shot** - View capture
- **expo-router** - Navigation

### Frontend
- **Next.js** 15.5.3
- **React** 19.1.0
- **Monaco Editor** - Code editor
- **TailwindCSS** - Styling
- **Lucide React** - Icons

## 🎨 Features

### Backend
- ✅ WebSocket server for receiving frames
- ✅ ffmpeg integration for MJPEG encoding
- ✅ HTTP endpoint for stream delivery
- ✅ Status monitoring endpoints
- ✅ Graceful shutdown handling

### Mobile App
- ✅ Real-time view capture at 10 FPS
- ✅ WebSocket streaming
- ✅ Configurable server IP
- ✅ Beautiful UI with live preview
- ✅ Connection status indicators
- ✅ Works in Expo Go (no native build needed)

### Frontend
- ✅ Live MJPEG stream display
- ✅ Device frame UI
- ✅ Connection status monitoring
- ✅ Auto-refresh capability
- ✅ Dark/Light theme support
- ✅ Responsive layout

## 🐛 Troubleshooting

### Stream Not Appearing

1. **Check ffmpeg installation:**
   ```bash
   ffmpeg -version
   ```

2. **Verify server is running:**
   ```bash
   curl http://localhost:3000/status
   ```

3. **Check mobile app connection:**
   - Ensure mobile device and computer are on same network
   - Verify IP address is correct
   - Check firewall settings

4. **Test stream directly:**
   ```bash
   curl http://localhost:3000/stream.mjpeg
   ```

### WebSocket Connection Failed

- Ensure backend server is running on port 3001
- Check that mobile device can reach server IP
- Verify no firewall blocking WebSocket connections

### Low Frame Rate

- Reduce capture quality in mobile app
- Decrease image resolution in ffmpeg settings
- Check network bandwidth

## 🚀 Performance Optimization

### For Better Quality
```typescript
// Mobile app - increase quality
quality: 0.9,

// Backend - better JPEG quality
"-q:v", "2",
```

### For Better Performance
```typescript
// Mobile app - lower quality
quality: 0.5,

// Backend - smaller resolution
"-vf", "scale=480:-2",

// Reduce frame rate
"-r", "5",
```

## 📝 API Endpoints

### Backend Server

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/status` | GET | Server status (ffmpeg, clients) |
| `/stream.mjpeg` | GET | MJPEG video stream |
| `ws://localhost:3001` | WebSocket | Frame receiver |

### WebSocket Messages

**From Mobile App:**
```json
{
  "type": "frame",
  "data": "<base64-encoded-png>"
}
```

```json
{
  "type": "stop"
}
```

## 🎯 Use Cases

- **Live Coding Demos** - Show React Native development in real-time
- **Remote Debugging** - Share app state with team members
- **Presentations** - Display mobile app on larger screens
- **Testing** - Monitor app behavior during automated tests
- **Education** - Teaching React Native development

## 🔮 Future Enhancements

- [ ] Binary frame transmission (reduce overhead)
- [ ] HLS/RTMP output for CDN streaming
- [ ] Multiple device support
- [ ] Recording capability
- [ ] Audio streaming
- [ ] Touch event overlay
- [ ] Performance metrics display

## 📄 License

ISC

## 👥 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 🙏 Acknowledgments

- Built with inspiration from the React Native community
- Uses ffmpeg for efficient video encoding
- Powered by Expo for seamless mobile development

---

**Happy Streaming! 🎥**
