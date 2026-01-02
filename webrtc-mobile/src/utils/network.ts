import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function getWsUrl(port: number) {
  const debuggerHost = Constants.expoConfig?.hostUri;

  if (debuggerHost) {
    const host = debuggerHost.split(':')[0];
    return `ws://${host}:${port}`;
  }

  return `ws://localhost:${port}`;
}
