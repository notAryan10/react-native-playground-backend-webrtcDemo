import { Platform } from 'react-native';

const DEV_MACHINE_IP = '10.229.4.190';

export function getWsUrl(port: number) {
  if (Platform.OS === 'android') {
    return `ws://${DEV_MACHINE_IP}:${port}`;
  }
  return `ws://localhost:${port}`;
}
