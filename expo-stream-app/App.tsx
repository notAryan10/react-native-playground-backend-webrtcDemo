import React, { useRef, useEffect, useState } from "react";
import { View, Text, Button, StyleSheet, SafeAreaView, TextInput, AppRegistry } from "react-native";
import { captureRef } from "react-native-view-shot";
import { StatusBar } from "expo-status-bar";
import { registerRootComponent } from "expo";

export default function App() {
  const streamRef = useRef<View>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [serverIP, setServerIP] = useState("10.254.203.23"); // Your wifi IP
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);

    return () => {
      clearInterval(timer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const startStreaming = async () => {
    try {
      // Remove any existing port from serverIP
      const cleanIP = serverIP.split(':')[0];
      const wsUrl = `ws://${cleanIP}:3001`;
      console.log("Connecting to:", wsUrl);
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log("WebSocket connected");
        setStreaming(true);
        captureLoop();
      };

      wsRef.current.onclose = () => {
        console.log("WebSocket closed");
        setStreaming(false);
      };

      wsRef.current.onerror = (e) => {
        console.error("WebSocket error:", e);
        setStreaming(false);
      };
    } catch (error) {
      console.error("Failed to start streaming:", error);
    }
  };

  const stopStreaming = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
      wsRef.current.close();
      wsRef.current = null;
    }
    setStreaming(false);
  };

  const captureLoop = async () => {
    const intervalMs = 100;
    
    const sendOne = async () => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        const uri = await captureRef(streamRef, {
          format: "png",
          quality: 0.7,
          result: "base64",
        });
        wsRef.current.send(JSON.stringify({ 
          type: "frame", 
          data: uri 
        }));
      } catch (err) {
        console.warn("Capture error:", err);
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        setTimeout(sendOne, intervalMs);
      }
    };

    sendOne();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar />
      
      <View style={styles.controls}>
        <Text style={styles.label}>Server IP:</Text>
        <TextInput
          style={styles.input}
          value={serverIP}
          onChangeText={setServerIP}
          placeholder="192.168.1.100"
          editable={!streaming}
        />
        
        <Button
          title={streaming ? "Stop Streaming" : "Start Streaming"}
          onPress={streaming ? stopStreaming : startStreaming}
          color={streaming ? "#ff4444" : "#7b5cff"}
        />
      </View>
      <View 
        style={styles.streamArea} 
        ref={streamRef} 
        collapsable={false}
      >
        <Text style={styles.title}>🎥 Live App Output</Text>
        
        <View style={styles.card}>
          <Text style={styles.big}>FPS: ~10</Text>
          <Text style={styles.subtitle}>Time: {currentTime}</Text>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            {streaming ? "🟢 Streaming Active" : "⚪ Not Streaming"}
          </Text>
          <Text style={styles.smallText}>
            This view is being captured and sent to your server
          </Text>
        </View>

        <View style={styles.demoContent}>
          <Text style={styles.demoTitle}>React Native Playground</Text>
          <Text style={styles.demoText}>
            This is a demo of live view streaming from React Native to a web browser.
          </Text>
          <View style={styles.colorBoxes}>
            <View style={[styles.colorBox, { backgroundColor: "#ff6b6b" }]} />
            <View style={[styles.colorBox, { backgroundColor: "#4ecdc4" }]} />
            <View style={[styles.colorBox, { backgroundColor: "#ffe66d" }]} />
            <View style={[styles.colorBox, { backgroundColor: "#95e1d3" }]} />
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Stream URL: http://{serverIP}:3000/stream.mjpeg
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    padding: 16,
    backgroundColor: "#f5f5f5",
  },
  controls: {
    width: "100%",
    maxWidth: 360,
    marginVertical: 12,
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
    color: "#333",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  streamArea: {
    width: 360,
    height: 640,
    borderWidth: 2,
    borderColor: "#7b5cff",
    borderRadius: 12,
    padding: 16,
    backgroundColor: "#fff",
    shadowColor: "#7b5cff",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#7b5cff",
    marginBottom: 16,
  },
  card: {
    marginTop: 12,
    padding: 16,
    backgroundColor: "#f6f0ff",
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#7b5cff",
  },
  big: {
    fontSize: 32,
    fontWeight: "700",
    color: "#333",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
  },
  infoCard: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#e8f5e9",
    borderRadius: 8,
  },
  infoText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2e7d32",
  },
  smallText: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  demoContent: {
    marginTop: 20,
    padding: 16,
    backgroundColor: "#fff9e6",
    borderRadius: 8,
  },
  demoTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f57c00",
    marginBottom: 8,
  },
  demoText: {
    fontSize: 14,
    color: "#555",
    lineHeight: 20,
  },
  colorBoxes: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 12,
  },
  colorBox: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  footer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    width: "100%",
    maxWidth: 360,
  },
  footerText: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
  },
});

registerRootComponent(App);
