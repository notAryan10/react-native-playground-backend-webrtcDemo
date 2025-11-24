/**
 * WebRTC Mobile App Component
 * 
 * IMPORTANT: This requires react-native-webrtc which needs native modules.
 * 
 * Setup Instructions:
 * 1. Install expo-dev-client:
 *    npx expo install expo-dev-client
 * 
 * 2. Install react-native-webrtc:
 *    npm install react-native-webrtc
 * 
 * 3. Create a development build:
 *    npx expo prebuild
 *    npx expo run:ios  # or run:android
 * 
 * Note: This will NOT work in Expo Go. You need a development build.
 */

import React, { useRef, useEffect, useState } from "react";
import { View, Text, Button, StyleSheet, SafeAreaView, TextInput, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";

// Uncomment these imports after installing react-native-webrtc
// import {
//   RTCPeerConnection,
//   mediaDevices,
//   RTCView,
//   RTCSessionDescription,
//   RTCIceCandidate,
// } from 'react-native-webrtc';

export default function App() {
  const [streaming, setStreaming] = useState(false);
  const [serverIP, setServerIP] = useState("localhost");
  const [signalingUrl, setSignalingUrl] = useState("ws://localhost:3002");
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [connectionState, setConnectionState] = useState<string>("disconnected");
  const [clientId, setClientId] = useState<string | null>(null);

  // Refs for WebRTC
  const pcRef = useRef<any>(null); // RTCPeerConnection
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<any>(null); // MediaStream

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);

    return () => {
      clearInterval(timer);
      stopStreaming();
    };
  }, []);

  const startStreaming = async () => {
    try {
      // Check if WebRTC is available
      // In a real implementation, you would check:
      // if (!RTCPeerConnection || !mediaDevices) {
      //   Alert.alert("Error", "WebRTC is not available. Please install react-native-webrtc and create a development build.");
      //   return;
      // }

      Alert.alert(
        "WebRTC Setup Required",
        "This component requires react-native-webrtc. Please:\n\n1. Install expo-dev-client\n2. Install react-native-webrtc\n3. Create a development build\n\nSee the file comments for instructions.",
        [{ text: "OK" }]
      );

      // Uncomment below after installing react-native-webrtc
      /*
      setStreaming(true);
      setConnectionState("connecting");

      // Connect to signaling server
      const ws = new WebSocket(signalingUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("Signaling WebSocket connected");
        setConnectionState("signaling-connected");
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'client-id':
              setClientId(message.clientId);
              // Register as mobile client
              ws.send(JSON.stringify({
                type: 'register',
                clientType: 'mobile'
              }));
              // Start capturing and create offer
              await startWebRTCStream(ws, message.clientId);
              break;

            case 'answer':
              // Received answer from web client
              console.log('Received answer from:', message.fromId);
              if (pcRef.current && pcRef.current.remoteDescription === null) {
                await pcRef.current.setRemoteDescription(
                  new RTCSessionDescription(message.answer)
                );
                setConnectionState("connected");
              }
              break;

            case 'ice-candidate':
              // Received ICE candidate
              if (message.candidate && pcRef.current) {
                try {
                  await pcRef.current.addIceCandidate(
                    new RTCIceCandidate(message.candidate)
                  );
                  console.log('Added ICE candidate from:', message.fromId);
                } catch (err) {
                  console.error('Error adding ICE candidate:', err);
                }
              }
              break;

            default:
              console.log('Unknown message type:', message.type);
          }
        } catch (err) {
          console.error('Error processing signaling message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error("Signaling WebSocket error:", err);
        setConnectionState("error");
        setStreaming(false);
      };

      ws.onclose = () => {
        console.log("Signaling WebSocket closed");
        setConnectionState("disconnected");
        setStreaming(false);
      };
      */
    
      // In WebRTCViewer.tsx, update the ws.onerror handler (around line 200)
ws.onerror = (err) => {
  console.error('Signaling WebSocket error:', err);
  setError(`Failed to connect to signaling server at ${streamingUrl}. Make sure the signaling server is running.`);
  setConnecting(false);
  setConnectionState('error');
  
  // Add more detailed error handling
      if (err && 'message' in err) {
        console.error('WebSocket error details:', err.message);
      } else {
        console.error('WebSocket connection failed. Possible reasons:',
          '\n- Signaling server not running',
          '\n- Incorrect WebSocket URL',
          '\n- CORS issues',
          '\n- Network connectivity problems'
        );
      }
    };
    } catch (error) {
      console.error("Failed to start streaming:", error);
      Alert.alert("Error", `Failed to start streaming: ${error}`);
      setStreaming(false);
      setConnectionState("error");
    }
  };

  // Uncomment this function after installing react-native-webrtc
  /*
  const startWebRTCStream = async (ws: WebSocket, clientId: string) => {
    try {
      // Get screen capture stream
      // Note: getDisplayMedia might not be available in React Native
      // You may need to use camera stream or screen recording API
      const stream = await mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });

      localStreamRef.current = stream;

      // Create RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          // Add TURN server here if needed
        ],
        iceCandidatePoolSize: 10
      });

      pcRef.current = pc;

      // Add local stream tracks
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'ice-candidate',
            candidate: event.candidate,
            targetId: null // Broadcast to all
          }));
        }
      };

      // Handle connection state
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        setConnectionState(state);
        console.log('ICE connection state:', state);
      };

      // Create offer
      const offer = await pc.createOffer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: false
      });

      await pc.setLocalDescription(offer);

      // Send offer via signaling
      ws.send(JSON.stringify({
        type: 'offer',
        offer: offer,
        targetId: null // Broadcast to all
      }));

      console.log('Sent offer to signaling server');
    } catch (err) {
      console.error('Error starting WebRTC stream:', err);
      Alert.alert("Error", `Failed to start WebRTC stream: ${err}`);
      setStreaming(false);
      setConnectionState("error");
    }
  };
  */

  const stopStreaming = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Uncomment after installing react-native-webrtc
    /*
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    */

    setStreaming(false);
    setConnectionState("disconnected");
    setClientId(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      
      <View style={styles.controls}>
        <Text style={styles.label}>Server IP:</Text>
        <TextInput
          style={styles.input}
          value={serverIP}
          onChangeText={setServerIP}
          placeholder="192.168.1.100"
          editable={!streaming}
        />

        <Text style={styles.label}>Signaling URL:</Text>
        <TextInput
          style={styles.input}
          value={signalingUrl}
          onChangeText={setSignalingUrl}
          placeholder="ws://192.168.1.100:3002"
          editable={!streaming}
        />
        
        <Button
          title={streaming ? "Stop Streaming" : "Start WebRTC Streaming"}
          onPress={streaming ? stopStreaming : startStreaming}
          color={streaming ? "#ff4444" : "#7b5cff"}
        />
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.title}>🎥 WebRTC Stream</Text>
        
        <View style={styles.statusCard}>
          <Text style={styles.big}>Status: {connectionState}</Text>
          <Text style={styles.subtitle}>Time: {currentTime}</Text>
          {clientId && (
            <Text style={styles.subtitle}>Client ID: {clientId.substring(0, 8)}...</Text>
          )}
        </View>

        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>⚠️ Setup Required</Text>
          <Text style={styles.warningText}>
            This component requires react-native-webrtc which needs native modules.
            {"\n\n"}
            Steps:
            {"\n"}1. Install expo-dev-client
            {"\n"}2. Install react-native-webrtc
            {"\n"}3. Create a development build
            {"\n\n"}
            See file comments for detailed instructions.
          </Text>
        </View>

        {/* Uncomment after installing react-native-webrtc */}
        {/* 
        {localStreamRef.current && (
          <RTCView
            streamURL={localStreamRef.current.toURL()}
            style={styles.preview}
            objectFit="cover"
          />
        )}
        */}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Signaling: {signalingUrl}
        </Text>
        <Text style={styles.footerText}>
          WebRTC provides lower latency (~50-150ms) vs WebSocket (~100-300ms)
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
    marginTop: 8,
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
  infoCard: {
    width: "100%",
    maxWidth: 360,
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
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
  statusCard: {
    marginTop: 12,
    padding: 16,
    backgroundColor: "#f6f0ff",
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#7b5cff",
  },
  big: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
  },
  warningCard: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#ffc107",
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#856404",
    marginBottom: 8,
  },
  warningText: {
    fontSize: 12,
    color: "#856404",
    lineHeight: 18,
  },
  preview: {
    width: "100%",
    height: 200,
    marginTop: 16,
    borderRadius: 8,
    backgroundColor: "#000",
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
    fontSize: 11,
    color: "#666",
    textAlign: "center",
    marginBottom: 4,
  },
});

