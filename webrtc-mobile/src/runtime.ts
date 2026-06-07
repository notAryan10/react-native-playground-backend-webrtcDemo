import type React from 'react';
import * as RefreshRuntime from 'react-refresh/runtime';
import { requireModule } from './CodeRunner';

// A persistent on-device module registry, Metro-like. Module factory functions
// are compiled once from their code strings and kept across edits; an edit
// re-runs only the changed modules (plus their importers, computed by the
// backend) instead of re-parsing and re-running the whole bundle. Bare
// specifiers (react, react-native, expo-*, third-party) fall through to the
// existing requireModule resolver.
//
// Tier 2 — Fast Refresh: modules are compiled by the backend with
// react-refresh/babel, so each registers its component types via $RefreshReg$.
// On a patch we re-run the changed modules then call performReactRefresh(),
// which swaps component implementations in the mounted tree while preserving
// hook state. If the Fast Refresh runtime is unavailable or fails, we fall back
// to a full remount (Tier 1), so the playground never regresses to broken.

type Factory = (
    module: any,
    exports: any,
    require: (id: string) => any,
    global: any,
    process: any,
) => void;

// react-refresh/runtime is a singleton in the Metro bundle: in dev, Metro has
// already injected it into the global hook, so register/performReactRefresh
// here drive the live renderer. In a production build with no host Fast Refresh
// we inject our own. Either way $RefreshReg$/$RefreshSig$ must always exist so
// babel-instrumented modules don't throw a ReferenceError.
let fastRefreshReady = false;
try {
    const g: any = global;
    if (typeof g.$RefreshReg$ !== 'function') {
        RefreshRuntime.injectIntoGlobalHook(g);
        g.$RefreshReg$ = () => {};
        g.$RefreshSig$ = () => (type: any) => type;
    }
    fastRefreshReady = true;
} catch (e) {
    console.warn('[HMR] Fast Refresh runtime unavailable — falling back to remount:', e);
    fastRefreshReady = false;
}

class ModuleRuntime {
    private modules: Record<string, Factory> = {};
    private cache: Record<string, { exports: any }> = {};
    entry = 'src/App.tsx';

    private readonly processShim = { env: { NODE_ENV: 'development' } };

    get fastRefresh(): boolean {
        return fastRefreshReady;
    }

    require = (id: string): any => {
        const cached = this.cache[id];
        if (cached) return cached.exports;

        const factory = this.modules[id];
        if (factory) return this.runFactory(id, factory);

        // Not a local module — resolve as a bare specifier (native/dynamic).
        return requireModule(id);
    };

    // Run a module factory with per-module Fast Refresh globals in scope, so the
    // react-refresh/babel-inserted $RefreshReg$(type, "Local") calls register
    // each component under a stable id (modulePath + localId) for its family.
    private runFactory(id: string, factory: Factory): any {
        const g: any = global;
        const prevReg = g.$RefreshReg$;
        const prevSig = g.$RefreshSig$;
        if (fastRefreshReady) {
            g.$RefreshReg$ = (type: any, localId: string) => {
                RefreshRuntime.register(type, id + ' ' + localId);
            };
            g.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;
        }

        const module = { exports: {} as any };
        this.cache[id] = module;
        try {
            factory(module, module.exports, this.require, g, this.processShim);
        } catch (e) {
            delete this.cache[id]; // don't cache a module that threw while initializing
            throw e;
        } finally {
            if (fastRefreshReady) {
                g.$RefreshReg$ = prevReg;
                g.$RefreshSig$ = prevSig;
            }
        }
        return module.exports;
    }

    private define(path: string, code: string) {
        // eslint-disable-next-line no-new-func
        this.modules[path] = new Function(
            'module', 'exports', 'require', 'global', 'process', code,
        ) as Factory;
    }

    // Full replace — used on connect (module-sync). Caller mounts via getRoot().
    sync(modules: Record<string, string>, entry?: string) {
        this.modules = {};
        this.cache = {};
        for (const [p, code] of Object.entries(modules)) this.define(p, code);
        if (entry) this.entry = entry;
    }

    // Incremental update — used on edit (module-patch). `changed` already
    // includes the importer closure (computed by the backend). Returns true if
    // it was applied via Fast Refresh (tree stays mounted, state preserved);
    // false if the caller should remount.
    patch(changed: Record<string, string>, removed: string[] = [], entry?: string): boolean {
        for (const p of removed) {
            delete this.modules[p];
            delete this.cache[p];
        }
        for (const [p, code] of Object.entries(changed)) this.define(p, code);
        if (entry) this.entry = entry;

        if (!fastRefreshReady) {
            // Tier 1 fallback: clear all instances so a re-require rebuilds.
            this.cache = {};
            return false;
        }

        // Fast Refresh: re-run the changed modules (re-registering their
        // component families), then refresh the mounted tree in place.
        for (const p of Object.keys(changed)) delete this.cache[p];
        for (const p of Object.keys(changed)) {
            try {
                this.require(p);
            } catch (e) {
                console.error('[HMR] re-run failed for', p, e);
            }
        }
        try {
            RefreshRuntime.performReactRefresh();
            return true;
        } catch (e) {
            console.error('[HMR] performReactRefresh failed — remounting:', e);
            this.cache = {};
            return false;
        }
    }

    hasModules(): boolean {
        return Object.keys(this.modules).length > 0;
    }

    // Require the entry and return its default export as the root component.
    getRoot(): React.ComponentType | null {
        const exp = this.require(this.entry);
        const Comp = exp && (exp.default || exp);
        return typeof Comp === 'function' ? Comp : null;
    }
}

export const Runtime = new ModuleRuntime();
