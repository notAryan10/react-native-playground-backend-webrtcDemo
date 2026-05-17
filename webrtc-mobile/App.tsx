import React, { useRef, useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import {
  RTCPeerConnection,
  mediaDevices,
} from 'react-native-webrtc';
import CodeRunner from './src/CodeRunner';

const ORCHESTRATOR_URL = 'http://103.173.195.247:4000';

export default function App() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState('idle');
  const [currentCode, setCurrentCode] = useState<string>('');
  const [userId, setUserId] = useState('');
  const [isProvisioning, setIsProvisioning] = useState(false);

  const start = async () => {
    if (!userId) {
      alert('Please enter your Workspace ID (found in web dashboard)');
      return;
    }

    try {
      setStatus('connecting');
      setIsProvisioning(true);
      console.log('▶️ Requesting workspace for:', userId);

      // 1. Get dynamic workspace URL from Orchestrator
      const res = await fetch(`${ORCHESTRATOR_URL}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      
      if (data.status !== 'ready') {
        throw new Error('Workspace not ready');
      }

      const SIGNALING_URL = data.url;
      console.log('✅ Workspace assigned:', SIGNALING_URL);
      setIsProvisioning(false);

      // 2. Connect to the dynamic WebSocket
      const ws = new WebSocket(SIGNALING_URL);
      wsRef.current = ws;

      ws.onopen = async () => {
        console.log('✅ WS connected');
        setStatus('ws-connected');

        ws.send(JSON.stringify({
          type: 'register',
          clientType: 'mobile',
        }));

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;

        (pc as any).onicecandidate = (e: any) => {
          if (e.candidate) {
            ws.send(JSON.stringify({
              type: 'ice-candidate',
              candidate: e.candidate,
            }));
          }
        };

        try {
          // @ts-ignore
          const stream = await mediaDevices.getDisplayMedia({ video: true });
          stream.getTracks().forEach((track) => {
            pc.addTrack(track, stream);
          });
          console.log('📹 Screen stream added to PeerConnection');
        } catch (mediaErr) {
          console.error('Failed to get display media:', mediaErr);
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        ws.send(JSON.stringify({
          type: 'offer',
          offer,
        }));

        setStatus('connected');
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'answer') {
          console.log('Answer received');
          await pcRef.current?.setRemoteDescription(msg.answer);
          setStatus('connected');
        }

        if (msg.type === 'ice-candidate') {
          await pcRef.current?.addIceCandidate(msg.candidate);
        }

        if (msg.type === 'code-update') {
          console.log('📝 Code update received');
          setCurrentCode(msg.code);
        }
      };

      ws.onerror = () => setStatus('error');
      ws.onclose = () => setStatus('closed');
    } catch (e: any) {
      console.error(e);
      alert('Failed to connect: ' + e.message);
      setStatus('error');
      setIsProvisioning(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📡 Runtime Exec</Text>
        <Text style={styles.status}>Status: {status}</Text>
      </View>

      <View style={styles.previewContainer}>
        {status === 'idle' || status === 'error' ? (
          <View style={styles.setupBox}>
            <Text style={styles.label}>Enter Workspace ID:</Text>
            <TextInput
              style={styles.input}
              placeholder="e.user-xxxx"
              placeholderTextColor="#666"
              value={userId}
              onChangeText={setUserId}
              autoCapitalize="none"
            />
            <Text style={styles.hint}>You can find this ID in your browser's console or URL.</Text>
          </View>
        ) : null}

        {isProvisioning && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#007aff" />
            <Text style={styles.loadingText}>Locating your workspace...</Text>
          </View>
        )}

        {currentCode ? (
          <CodeRunner code={currentCode} />
        ) : (
          !isProvisioning && status !== 'idle' && (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>Waiting for code from editor...</Text>
            </View>
          )
        )}
      </View>

      <View style={styles.controls}>
        {status === 'idle' || status === 'error' ? (
           <Button title="Connect to Workspace" onPress={start} />
        ) : (
           <Button title="Disconnect" onPress={() => {
             wsRef.current?.close();
             setStatus('idle');
             setCurrentCode('');
           }} color="#ff3b30" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  header: {
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#1a1a2e',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  status: {
    color: '#aaa',
    marginTop: 5,
    fontSize: 14,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  setupBox: {
    padding: 30,
    justifyContent: 'center',
  },
  label: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 8,
    padding: 15,
    color: '#fff',
    fontSize: 18,
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  hint: {
    color: '#666',
    fontSize: 12,
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    marginTop: 15,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#555',
    fontSize: 16,
  },
  controls: {
    padding: 20,
    backgroundColor: '#1a1a2e',
  },
});
