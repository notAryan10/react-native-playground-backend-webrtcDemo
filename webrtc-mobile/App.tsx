import React, { useRef, useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import {
  RTCPeerConnection,
  mediaDevices,
} from 'react-native-webrtc';
import CodeRunner from './src/CodeRunner';
import { Runtime } from './src/runtime';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';

const getAutoUrl = () => {
  const debuggerHost = Constants.expoConfig?.hostUri;
  if (debuggerHost) {
    const host = debuggerHost.split(':')[0];
    return host; // Just return host, let caller handle protocol/port if needed, or rely on QR
  }
  return '';
};

const DEFAULT_STUN_SERVER = 'stun:stun.l.google.com:19302';

export default function App() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState('idle');
  // HMR: the root component is built by the module Runtime; renderVersion is
  // bumped on every sync/patch to remount the ErrorBoundary cleanly.
  const [rootComponent, setRootComponent] = useState<React.ComponentType | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [userId, setUserId] = useState('');
  const [orchestratorUrl, setOrchestratorUrl] = useState(getAutoUrl());
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

        // If no code arrives within 4 seconds, request the current bundle explicitly.
        // This handles the case where rebundle ran before this client registered.
        const retryTimer = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            console.log('[Sync] No code received — requesting bundle from server');
            ws.send(JSON.stringify({ type: 'request-bundle' }));
          }
        }, 4000);
        ws.addEventListener('message', function onFirstCode(event: MessageEvent) {
          try {
            const msg = JSON.parse(event.data);
            if ((msg.type === 'code-update' && msg.code) || msg.type === 'module-sync') {
              clearTimeout(retryTimer);
              ws.removeEventListener('message', onFirstCode);
            }
          } catch {}
        });

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: DEFAULT_STUN_SERVER }],
        });
        pcRef.current = pc;

        (pc as any).onicecandidate = (e: any) => {
          if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
        };

        try {
          // @ts-ignore
          const stream = await mediaDevices.getDisplayMedia({ video: true });
          stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));
        } catch (mediaErr) {
          console.error('Media error:', mediaErr);
        }

        const sendOffer = async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'offer', offer }));
          } catch (err) {
            console.error('Failed to send offer:', err);
          }
        };

        await sendOffer();
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log(`[WS] Received message: ${msg.type}`);

          if (msg.type === 'answer') {
            if (pcRef.current) {
              await pcRef.current.setRemoteDescription(msg.answer).catch(err => {
                console.error('Failed to set remote description:', err);
              });
            }
          }
          
          if (msg.type === 'ice-candidate') {
            if (pcRef.current) {
              await pcRef.current.addIceCandidate(msg.candidate).catch(err => {
                console.error('Failed to add ICE candidate:', err);
              });
            }
          }
          
          // HMR: full module set on connect.
          if (msg.type === 'module-sync') {
            console.log(`[HMR] module-sync: ${Object.keys(msg.modules || {}).length} module(s)`);
            try {
              Runtime.sync(msg.modules || {}, msg.entry);
              setRootComponent(() => Runtime.getRoot());
              setRenderVersion(v => v + 1);
              setStatus('running');
            } catch (e) { console.error('[HMR] sync failed:', e); }
          }

          // HMR: incremental patch on edit — only changed modules re-evaluate.
          if (msg.type === 'module-patch') {
            const changedCount = Object.keys(msg.changed || {}).length;
            console.log(`[HMR] module-patch: ${changedCount} changed, ${(msg.removed || []).length} removed`);
            try {
              Runtime.patch(msg.changed || {}, msg.removed || [], msg.entry);
              setRootComponent(() => Runtime.getRoot());
              setRenderVersion(v => v + 1);
              setStatus('running');
            } catch (e) { console.error('[HMR] patch failed:', e); }
          }

          // Legacy monolithic bundle. Ignored when the HMR runtime is active so
          // the device doesn't render twice; old app builds use this instead.
          if (msg.type === 'code-update' && !Runtime.hasModules()) {
            console.log('[Sync] (legacy) code-update received but HMR runtime is in use — ignoring');
          }

          if (msg.type === 'builder-log') {
            console.log(`[Builder][${msg.level}] ${msg.message}`);
          }

          if (msg.type === 'module-bundle') {
            console.log(`[Modules] Received bundle for: ${msg.name}`);
            if (!(global as any).DynamicModules) (global as any).DynamicModules = {};
            (global as any).DynamicModules[msg.name] = msg.code;
          }

          if (msg.type === 'client-id') {
            console.log('[WS] Assigned Client ID:', msg.clientId);
          }

          // A new web client joined — re-send our offer so they get the WebRTC stream.
          if (msg.type === 'client-connected' && msg.clientType === 'web') {
            console.log('[WebRTC] New web viewer joined — re-sending offer');
            if (pcRef.current) {
              try {
                const offer = await pcRef.current.createOffer();
                await pcRef.current.setLocalDescription(offer);
                ws.send(JSON.stringify({ type: 'offer', offer }));
              } catch (err) {
                console.error('Failed to re-send offer:', err);
              }
            }
          }
        } catch (e) {
          console.error('[WS] Error processing message:', e);
        }
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

        {status === 'running' ? (
          <CodeRunner rootComponent={rootComponent} renderKey={renderVersion} />
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
             setRootComponent(null);
             setRenderVersion(0);
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
