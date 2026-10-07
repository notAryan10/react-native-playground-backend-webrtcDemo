import { requireOptionalNativeModule } from 'expo-modules-core';

type TouchAction = 'down' | 'move' | 'up' | 'cancel';

const RnpTouch = requireOptionalNativeModule<{
  touch(action: TouchAction, xRatio: number, yRatio: number): boolean;
}>('RnpTouch');

// Coordinates are fractions (0..1) of the whole display. Returns false when
// the native module is missing (e.g. an APK built before it existed).
export function injectTouch(action: TouchAction, xRatio: number, yRatio: number): boolean {
  return RnpTouch ? RnpTouch.touch(action, xRatio, yRatio) : false;
}
