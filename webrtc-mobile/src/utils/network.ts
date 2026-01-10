import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function getWsUrl(port: number) {
  const backendUrl = (process.env as any).EXPO_PUBLIC_BACKEND_URL || "https://react-native-playground-backend.onrender.com";
  if (backendUrl) {
    return backendUrl.replace(/^http/, 'ws');
  }

  const debuggerHost = Constants.expoConfig?.hostUri;

  if (debuggerHost) {
    const host = debuggerHost.split(':')[0];
    return `ws://${host}:${port}`;
  }

  return `ws://localhost:${port}`;
}
