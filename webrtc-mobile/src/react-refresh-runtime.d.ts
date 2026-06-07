// Minimal types for the react-refresh runtime (ships without .d.ts).
declare module 'react-refresh/runtime' {
    export function injectIntoGlobalHook(globalObject: any): void;
    export function register(type: any, id: string): void;
    export function createSignatureFunctionForTransform(): (...args: any[]) => any;
    export function performReactRefresh(): any;
    export function isLikelyComponentType(type: any): boolean;
    export function getFamilyByType(type: any): any;
}
