import { requireOptionalNativeModule } from 'expo-modules-core';

type TouchAction = 'down' | 'move' | 'up' | 'cancel';

export interface NativeHit {
  nativeID: string; // "file:line:col" (the bundler's rnp: prefix stripped)
  viewClass: string; // e.g. ReactTextView, ReactViewGroup
  frame: { left: number; top: number; width: number; height: number }; // dp, window-relative
}

const RnpTouch = requireOptionalNativeModule<{
  touch(action: TouchAction, xRatio: number, yRatio: number): boolean;
  hitTest(xRatio: number, yRatio: number): Promise<NativeHit | null>;
}>('RnpTouch');

// Native tap-to-source for release builds. null if the module is missing or
// nothing tagged is under the point.
export async function nativeHitTest(xRatio: number, yRatio: number): Promise<NativeHit | null> {
  if (!RnpTouch || typeof RnpTouch.hitTest !== 'function') return null;
  try {
    return await RnpTouch.hitTest(xRatio, yRatio);
  } catch {
    return null;
  }
}

// Coordinates are fractions (0..1) of the whole display. Returns false when
// the native module is missing (e.g. an APK built before it existed).
export function injectTouch(action: TouchAction, xRatio: number, yRatio: number): boolean {
  return RnpTouch ? RnpTouch.touch(action, xRatio, yRatio) : false;
}
