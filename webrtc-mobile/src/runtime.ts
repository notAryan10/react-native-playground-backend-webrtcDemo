import type React from 'react';
import { requireModule } from './CodeRunner';

// A persistent on-device module registry, Metro-like. Module factory functions
// are compiled once from their code strings and kept across edits; an edit
// re-creates only the changed factory and re-evaluates, instead of re-parsing
// and re-running the whole bundle. Bare specifiers (react, react-native,
// expo-*, third-party) fall through to the existing requireModule resolver.

type Factory = (
    module: any,
    exports: any,
    require: (id: string) => any,
    global: any,
    process: any,
) => void;

class ModuleRuntime {
    private modules: Record<string, Factory> = {};
    private cache: Record<string, { exports: any }> = {};
    entry = 'src/App.tsx';

    private readonly processShim = { env: { NODE_ENV: 'development' } };

    require = (id: string): any => {
        const cached = this.cache[id];
        if (cached) return cached.exports;

        const factory = this.modules[id];
        if (factory) {
            const module = { exports: {} as any };
            this.cache[id] = module;
            try {
                factory(module, module.exports, this.require, global, this.processShim);
            } catch (e) {
                // Don't cache a module that threw while initializing.
                delete this.cache[id];
                throw e;
            }
            return module.exports;
        }

        // Not a local module — resolve as a bare specifier (native/dynamic).
        return requireModule(id);
    };

    private define(path: string, code: string) {
        // eslint-disable-next-line no-new-func
        this.modules[path] = new Function(
            'module', 'exports', 'require', 'global', 'process', code,
        ) as Factory;
    }

    // Full replace — used on connect (module-sync).
    sync(modules: Record<string, string>, entry?: string) {
        this.modules = {};
        this.cache = {};
        for (const [p, code] of Object.entries(modules)) this.define(p, code);
        if (entry) this.entry = entry;
    }

    // Incremental update — used on edit (module-patch). v1 clears the instance
    // cache so a re-require rebuilds with the new code; cheap because factories
    // are already-parsed functions (no Babel, no re-parse of unchanged files).
    patch(changed: Record<string, string>, removed: string[] = [], entry?: string) {
        for (const p of removed) {
            delete this.modules[p];
            delete this.cache[p];
        }
        for (const [p, code] of Object.entries(changed)) this.define(p, code);
        this.cache = {};
        if (entry) this.entry = entry;
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
