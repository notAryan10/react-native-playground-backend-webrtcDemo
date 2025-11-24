# Expo Stream App

React Native mobile app that captures views and streams them to a backend server via WebSocket.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Server IP

Edit `app/index.tsx` and update the default server IP:

```typescript
const [serverIP, setServerIP] = useState("192.168.1.100"); // Your computer's IP
```

To find your computer's IP address:

**macOS/Linux:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**Windows:**
```bash
ipconfig
```

### 3. Start the App

```bash
npx expo start
```

Then:
- **iOS Simulator:** Press `i`
- **Android Emulator:** Press `a`
- **Physical Device:** Scan QR code with Expo Go app

### 4. Start Streaming

1. Make sure the backend server is running
2. Enter your server IP in the app
3. Tap "Start Streaming"
4. The view will be captured at ~10 FPS and sent to the server

## 📱 Features

- **Real-time View Capture** - Uses `react-native-view-shot` to capture views
- **WebSocket Streaming** - Sends frames to backend via WebSocket
- **Configurable Server** - Change server IP without rebuilding
- **Live Preview** - See what's being streamed
- **Connection Status** - Visual indicators for connection state
- **Beautiful UI** - Modern, polished interface

## 🎨 Customization

### Change Frame Rate

Edit the capture interval in `app/index.tsx`:

```typescript
const intervalMs = 100; // 100ms = 10 FPS
// For 5 FPS: const intervalMs = 200;
// For 20 FPS: const intervalMs = 50;
```

### Adjust Image Quality

```typescript
const uri = await captureRef(streamRef, {
  format: "png",
  quality: 0.7,  // 0.0 to 1.0 (higher = better quality, larger size)
  result: "base64",
});
```

### Modify Streamed Content

The content inside the `streamArea` View is what gets captured and streamed. Customize it in `app/index.tsx`:

```typescript
<View 
  style={styles.streamArea} 
  ref={streamRef} 
  collapsable={false}  // Important for Android!
>
  {/* Your custom content here */}
</View>
```

## 🔧 Technical Details

### How It Works

1. **Capture Loop** - Every 100ms, `captureRef` takes a screenshot of the view
2. **Encode** - Image is encoded as base64 PNG
3. **Send** - Frame is sent via WebSocket as JSON:
   ```json
   {
     "type": "frame",
     "data": "<base64-png-data>"
   }
   ```
4. **Backend** - Server receives frames and pipes them to ffmpeg
5. **Output** - ffmpeg produces MJPEG stream viewable in browser

### Dependencies

- **expo** - Expo framework
- **react-native-view-shot** - View capture library
- **expo-router** - File-based routing
- **expo-status-bar** - Status bar component

### Network Requirements

- Mobile device and server must be on the same network
- Server must be accessible from mobile device
- Ports 3000 (HTTP) and 3001 (WebSocket) must be open

## 🐛 Troubleshooting

### "Cannot connect to server"

1. Verify server is running:
   ```bash
   curl http://YOUR_IP:3000/status
   ```

2. Check if mobile device can reach server:
   - Ping the server IP from mobile device
   - Ensure both are on same WiFi network
   - Check firewall settings

3. Verify WebSocket port is open:
   ```bash
   telnet YOUR_IP 3001
   ```

### "Capture error"

- Make sure `collapsable={false}` is set on the View
- Check that the view is mounted before starting stream
- Verify `react-native-view-shot` is properly installed

### Low Frame Rate

- Reduce image quality
- Decrease capture frequency
- Check network bandwidth
- Simplify view content

## 📦 Building for Production

### Create Development Build

```bash
# iOS
npx expo run:ios

# Android
npx expo run:android
```

### Create Production Build

```bash
# Configure app.json first, then:
eas build --platform ios
eas build --platform android
```

## 🎯 Use Cases

- **Live Demos** - Show your app to remote audiences
- **Debugging** - Share app state with team
- **Testing** - Monitor app during automated tests
- **Presentations** - Display on larger screens
- **Education** - Teaching React Native

## 📝 Notes

- Works in Expo Go (no native build required)
- Supports both iOS and Android
- `collapsable={false}` is crucial for Android capture
- Base64 encoding adds ~33% overhead (consider binary in production)

## 🔮 Future Improvements

- Binary frame transmission
- Adaptive quality based on network
- Touch event recording
- Audio streaming
- Multiple view capture

---

**Happy Streaming! 📱**
