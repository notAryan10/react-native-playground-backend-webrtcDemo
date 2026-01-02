import React, { useRef, useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import {
  RTCPeerConnection,
} from 'react-native-webrtc';
import CodeRunner from './src/CodeRunner';

import { getWsUrl } from './src/utils/network';

const SIGNALING_URL = getWsUrl(3002);

export default function App() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState('idle');
  const [currentCode, setCurrentCode] = useState<string>('');

  const start = async () => {
    try {
      setStatus('connecting');
      console.log('▶️ Start pressed');

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
          console.log('📩 Answer received');
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

        if (msg.type === 'bundle') {
          console.log(`📦 Bundle received: ${msg.name}`);
          (global as any).DynamicModules = (global as any).DynamicModules || {};
          (global as any).DynamicModules[msg.name] = msg.code;
        }
      };

      ws.onerror = () => setStatus('error');
      ws.onclose = () => setStatus('closed');
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📡 Runtime Exec</Text>
        <Text style={styles.status}>Status: {status}</Text>
      </View>

      <View style={styles.previewContainer}>
        {currentCode ? (
          <CodeRunner code={currentCode} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Waiting for code...</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <Button title="Connect" onPress={start} />
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
