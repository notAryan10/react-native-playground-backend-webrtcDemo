import { findNodeHandle, Dimensions } from 'react-native';

// Tap-to-source inspector. A web client taps the streamed device video and
// sends a normalized [0,1] coordinate; we hit-test the on-device view tree at
// that point and resolve it back to the user's `file:line:col` plus the tapped
// element's component name and props.
//
// How source is recovered: the backend bundler stamps every JSX element with a
// `__rnpSrc="path:line:col"` prop (React 18.3 fibers no longer carry
// `_debugSource`, and user code is eval'd so error-stack resolution is useless).
// We locate the precise touched host fiber via RN's own inspector primitive,
// then read `__rnpSrc` off its memoizedProps, climbing to the nearest ancestor
// that has one if the leaf was untagged.

// RN core inspector primitive. Present in dev/dev-client builds (requires the
// React DevTools global hook, which the dev client injects).
let getInspectorDataForViewAtPoint: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  getInspectorDataForViewAtPoint = require('react-native/Libraries/Inspector/getInspectorDataForViewAtPoint');
} catch (e) {
  console.warn('[Inspector] getInspectorDataForViewAtPoint unavailable:', e);
}

export interface InspectResult {
  source: string | null; // "src/App.tsx:12:4"
  componentName: string | null;
  props: Record<string, any> | null;
  frame?: { left: number; top: number; width: number; height: number } | null;
}

// The on-device root the WebRTC stream shows. getDisplayMedia captures the full
// screen, so this should be App's top-level container; normalized coordinates
// then map directly onto its measured rect.
let rootRef: any = null;
export function setInspectRoot(ref: any) {
  rootRef = ref;
}

// Listener so App can paint a transient highlight box at the hit frame.
type FrameListener = (frame: InspectResult['frame']) => void;
let frameListener: FrameListener | null = null;
export function onInspectFrame(fn: FrameListener | null) {
  frameListener = fn;
}

function rootFiber(): any {
  return rootRef && rootRef._internalFiberInstanceHandleDEV ? rootRef._internalFiberInstanceHandleDEV : null;
}

// DFS the fiber subtree for the host fiber backing a given native tag.
function findFiberByTag(root: any, tag: number): any {
  if (!root) return null;
  const stack = [root];
  while (stack.length) {
    const f = stack.pop();
    if (f.stateNode && f.stateNode._nativeTag === tag) return f;
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  return null;
}

// Walk a fiber and its ancestors for the nearest `__rnpSrc` user-source stamp.
function climbForSource(fiber: any): string | null {
  let f = fiber;
  while (f) {
    const s = f.memoizedProps && f.memoizedProps.__rnpSrc;
    if (typeof s === 'string') return s;
    f = f.return;
  }
  return null;
}

function nearestComponentName(fiber: any): string | null {
  let f = fiber;
  while (f) {
    const t = f.type;
    if (typeof t === 'function') return t.displayName || t.name || 'Component';
    if (t && typeof t === 'object') {
      const name = t.displayName || (t.render && (t.render.displayName || t.render.name));
      if (name) return name;
    }
    f = f.return;
  }
  return null;
}

function sanitizeProps(props: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!props) return out;
  for (const k of Object.keys(props)) {
    if (k === '__rnpSrc' || k === 'children') continue;
    const v = props[k];
    const tv = typeof v;
    if (tv === 'function') out[k] = 'fn ' + (v.name || 'anonymous');
    else if (tv === 'object' && v !== null) {
      try {
        out[k] = JSON.parse(JSON.stringify(v));
      } catch {
        out[k] = '[object]';
      }
    } else out[k] = v;
  }
  return out;
}

const EMPTY: InspectResult = { source: null, componentName: null, props: null, frame: null };

export function inspectAt(xRatio: number, yRatio: number): Promise<InspectResult> {
  return new Promise((resolve) => {
    if (!getInspectorDataForViewAtPoint || !rootRef) return resolve(EMPTY);

    const run = (width: number, height: number) => {
      const locationX = Math.max(0, Math.min(1, xRatio)) * width;
      const locationY = Math.max(0, Math.min(1, yRatio)) * height;
      try {
        getInspectorDataForViewAtPoint(rootRef, locationX, locationY, (viewData: any) => {
          try {
            let source: string | null = null;
            let componentName: string | null = null;

            // Precise path: resolve the exact touched host fiber by its tag.
            if (viewData && viewData.touchedViewTag != null) {
              const hit = findFiberByTag(rootFiber(), viewData.touchedViewTag);
              if (hit) {
                source = climbForSource(hit);
                componentName = nearestComponentName(hit);
              }
            }
            // Fallback: props of the nearest host RN handed us.
            if (!source && viewData && viewData.props && typeof viewData.props.__rnpSrc === 'string') {
              source = viewData.props.__rnpSrc;
            }
            if (!componentName && viewData && Array.isArray(viewData.hierarchy) && viewData.hierarchy.length) {
              const idx = viewData.selectedIndex != null ? viewData.selectedIndex : viewData.hierarchy.length - 1;
              componentName = (viewData.hierarchy[idx] && viewData.hierarchy[idx].name) || null;
            }

            const frame = viewData && viewData.frame ? viewData.frame : null;
            if (frameListener) frameListener(frame);
            resolve({ source, componentName, props: sanitizeProps(viewData && viewData.props), frame });
          } catch (err) {
            console.warn('[Inspector] resolve failed:', err);
            resolve(EMPTY);
          }
          return true; // stop after the first renderer that has the view
        });
      } catch (err) {
        console.warn('[Inspector] getInspectorDataForViewAtPoint threw:', err);
        resolve(EMPTY);
      }
    };

    // Measure the root so ratios map onto its real on-screen size; fall back to
    // window dimensions if measure is unavailable.
    if (typeof rootRef.measure === 'function') {
      rootRef.measure((_x: number, _y: number, width: number, height: number) => {
        if (width && height) run(width, height);
        else {
          const d = Dimensions.get('window');
          run(d.width, d.height);
        }
      });
    } else {
      const d = Dimensions.get('window');
      run(d.width, d.height);
    }
  });
}
