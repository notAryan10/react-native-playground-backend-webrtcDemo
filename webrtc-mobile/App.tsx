import React, { useRef, useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import {
  RTCPeerConnection,
  mediaDevices,
} from 'react-native-webrtc';
import CodeRunner from './src/CodeRunner';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function App() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState('idle');
  const [currentCode, setCurrentCode] = useState<string>('');
  const [userId, setUserId] = useState('');
  const [orchestratorUrl, setOrchestratorUrl] = useState('');
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    const loadSettings = async () => {
      const savedUrl = await AsyncStorage.getItem('orchestrator-url');
      const savedUser = await AsyncStorage.getItem('user-id');
      if (savedUrl) setOrchestratorUrl(savedUrl);
      if (savedUser) setUserId(savedUser);
    };
    loadSettings();
  }, []);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    try {
      const config = JSON.parse(data);
      if (config.url && config.id) {
        setOrchestratorUrl(config.url);
        setUserId(config.id);
        setShowScanner(false);
        // Start connection automatically after scan
        setTimeout(() => startConnection(config.url, config.id), 500);
      }
    } catch (e) {
      console.error('Invalid QR code:', e);
    }
  };

  const startConnection = async (url: string, id: string) => {
    try {
      await AsyncStorage.setItem('orchestrator-url', url);
      await AsyncStorage.setItem('user-id', id);

      setStatus('connecting');
      setIsProvisioning(true);
      
      const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      
      const res = await fetch(`${cleanUrl}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id })
      });
      const data = await res.json();
      
      if (data.status !== 'ready') throw new Error('Workspace not ready');

      const SIGNALING_URL = data.url;
      setIsProvisioning(false);

      const ws = new WebSocket(SIGNALING_URL);
      wsRef.current = ws;

      ws.onopen = async () => {
        setStatus('connected');
        ws.send(JSON.stringify({ type: 'register', clientType: 'mobile' }));

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;

        (pc as any).onicecandidate = (e: any) => {
          if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
        };

        try {
          // @ts-ignore
          const stream = await mediaDevices.getDisplayMedia({ video: true });
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        } catch (mediaErr) {
          console.error('Media error:', mediaErr);
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'offer', offer }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'answer') await pcRef.current?.setRemoteDescription(msg.answer);
        if (msg.type === 'ice-candidate') await pcRef.current?.addIceCandidate(msg.candidate);
        if (msg.type === 'code-update') setCurrentCode(msg.code);
      };

      ws.onerror = () => setStatus('error');
      ws.onclose = () => setStatus('closed');
    } catch (e: any) {
      alert('Connection failed: ' + e.message);
      setStatus('error');
      setIsProvisioning(false);
    }
  };

  if (showScanner) {
    if (!permission) return <View />;
    if (!permission.granted) {
      return (
        <View style={styles.container}>
          <Text style={{ color: 'white', textAlign: 'center', marginTop: 100 }}>We need your permission to show the camera</Text>
          <Button onPress={requestPermission} title="Grant Permission" />
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          onBarcodeScanned={handleBarCodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ["qr"],
          }}
        />
        <View style={styles.scannerOverlay}>
          <Text style={styles.scannerText}>Scan the QR code in your browser</Text>
          <Button title="Cancel" onPress={() => setShowScanner(false)} color="#fff" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📡 Runtime Exec</Text>
        <Text style={styles.status}>Status: {status}</Text>
      </View>

      <View style={styles.previewContainer}>
        {(status === 'idle' || status === 'error') && !isProvisioning ? (
          <View style={styles.setupBox}>
            {userId ? (
              <View style={styles.pairedBox}>
                <Text style={styles.pairedLabel}>Last Paired Workspace:</Text>
                <Text style={styles.pairedId}>{userId}</Text>
                <Text style={styles.pairedUrl}>{orchestratorUrl}</Text>
                <View style={{ height: 20 }} />
                <Button title="Reconnect" onPress={() => startConnection(orchestratorUrl, userId)} />
                <Text style={styles.orText}>— OR —</Text>
              </View>
            ) : null}
            <Button title="Scan QR to Pair" onPress={() => setShowScanner(true)} color="#007aff" />
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
        {status !== 'idle' && status !== 'error' && (
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
    flex: 1,
    padding: 30,
    justifyContent: 'center',
  },
  pairedBox: {
    alignItems: 'center',
    marginBottom: 30,
    padding: 20,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  pairedLabel: {
    color: '#666',
    fontSize: 12,
    marginBottom: 5,
  },
  pairedId: {
    color: '#007aff',
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  pairedUrl: {
    color: '#444',
    fontSize: 10,
    marginTop: 5,
  },
  orText: {
    color: '#333',
    marginVertical: 15,
    fontWeight: 'bold',
  },
  scannerOverlay: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scannerText: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 10,
    borderRadius: 5,
    marginBottom: 20,
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
