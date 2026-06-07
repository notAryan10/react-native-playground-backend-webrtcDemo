import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as ReactNative from 'react-native';
import * as ExpoHaptics from 'expo-haptics';
import * as ExpoAV from 'expo-av';
import * as ExpoCamera from 'expo-camera';
import * as ExpoImagePicker from 'expo-image-picker';
import * as ExpoLocation from 'expo-location';
import * as ExpoSensors from 'expo-sensors';
import * as ExpoLinearGradient from 'expo-linear-gradient';
import * as ExpoBlur from 'expo-blur';
import * as ExpoFileSystem from 'expo-file-system';
import * as ExpoNotifications from 'expo-notifications';
import * as Reanimated from 'react-native-reanimated';
import * as GestureHandler from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as VectorIcons from '@expo/vector-icons';
import AntDesign from '@expo/vector-icons/AntDesign';
import Entypo from '@expo/vector-icons/Entypo';
import EvilIcons from '@expo/vector-icons/EvilIcons';
import Feather from '@expo/vector-icons/Feather';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import Fontisto from '@expo/vector-icons/Fontisto';
import Foundation from '@expo/vector-icons/Foundation';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Octicons from '@expo/vector-icons/Octicons';
import SimpleLineIcons from '@expo/vector-icons/SimpleLineIcons';
import Zocial from '@expo/vector-icons/Zocial';

interface CodeRunnerProps {
    // Legacy path: a full self-contained bundle string, eval'd on each change.
    code?: string;
    // HMR path: a root component built externally by the module Runtime. When
    // this prop is present (even null), CodeRunner renders it instead of eval'ing
    // `code`. `renderKey` is bumped on each patch to remount the ErrorBoundary.
    rootComponent?: React.ComponentType | null;
    renderKey?: number;
}

const modules: Record<string, any> = {
    'react': React,
    'react-native': ReactNative,
    '@react-native-async-storage/async-storage': AsyncStorage,
    'expo-haptics': ExpoHaptics,
    'expo-av': ExpoAV,
    'expo-camera': ExpoCamera,
    'expo-image-picker': ExpoImagePicker,
    'expo-location': ExpoLocation,
    'expo-sensors': ExpoSensors,
    'expo-linear-gradient': ExpoLinearGradient,
    'expo-blur': ExpoBlur,
    'expo-file-system': ExpoFileSystem,
    'expo-notifications': ExpoNotifications,
    'react-native-reanimated': Reanimated,
    'react-native-gesture-handler': GestureHandler,
    '@expo/vector-icons': VectorIcons,
    '@expo/vector-icons/AntDesign': { default: AntDesign, AntDesign },
    '@expo/vector-icons/Entypo': { default: Entypo, Entypo },
    '@expo/vector-icons/EvilIcons': { default: EvilIcons, EvilIcons },
    '@expo/vector-icons/Feather': { default: Feather, Feather },
    '@expo/vector-icons/FontAwesome': { default: FontAwesome, FontAwesome },
    '@expo/vector-icons/FontAwesome5': { default: FontAwesome5, FontAwesome5 },
    '@expo/vector-icons/FontAwesome6': { default: FontAwesome6, FontAwesome6 },
    '@expo/vector-icons/Fontisto': { default: Fontisto, Fontisto },
    '@expo/vector-icons/Foundation': { default: Foundation, Foundation },
    '@expo/vector-icons/Ionicons': { default: Ionicons, Ionicons },
    '@expo/vector-icons/MaterialCommunityIcons': { default: MaterialCommunityIcons, MaterialCommunityIcons },
    '@expo/vector-icons/MaterialIcons': { default: MaterialIcons, MaterialIcons },
    '@expo/vector-icons/Octicons': { default: Octicons, Octicons },
    '@expo/vector-icons/SimpleLineIcons': { default: SimpleLineIcons, SimpleLineIcons },
    '@expo/vector-icons/Zocial': { default: Zocial, Zocial },
};

const makeMissingModuleStub = (name: string) => {
    const MissingComponent = () =>
        React.createElement(
            View,
            { style: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2d1b1b', padding: 20 } },
            React.createElement(Text, { style: { color: '#ff6b6b', fontSize: 14, fontFamily: 'monospace' } },
                `Missing module: ${name}\nCreate the file in the file explorer.`)
        );
    const stub: any = { __esModule: true, default: MissingComponent };
    if (typeof Proxy !== 'undefined') {
        return new Proxy(stub, {
            get: (target: any, prop: string) => prop in target ? target[prop] : MissingComponent,
        });
    }
    return stub;
};

export const requireModule = (name: string) => {
    if (modules[name]) return modules[name];

    const dynamicModules = (global as any).DynamicModules || {};
    if (dynamicModules[name]) {
        if (typeof dynamicModules[name] === 'string') {
            try {
                const bundleCode = dynamicModules[name];
                const exports: any = {};
                const module: any = { exports };

                const func = new Function('require', 'exports', 'module', 'global', 'process', bundleCode);

                const process = { env: { NODE_ENV: 'development' } };

                func(requireModule, exports, module, global, process);

                dynamicModules[name] = module.exports.default || module.exports;
            } catch (e) {
                console.error(`Failed to eval dynamic module ${name}:`, e);
                return {};
            }
        }
        return dynamicModules[name];
    }

    // Relative path that escaped the bundle's __require — return a visible error stub
    // so named imports (e.g. `import { Foo } from './missing'`) render an error component
    // instead of crashing with "Element type is invalid: got undefined".
    if (name.startsWith('.') || name.startsWith('/')) {
        console.warn(`[Playground] Missing local module: '${name}'`);
        return makeMissingModuleStub(name);
    }

    console.warn(`Module '${name}' not found in playground scope.`);
    return {};
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    render() {
        if (this.state.hasError) {
            return (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorTitle}>Runtime Error</Text>
                    <Text style={styles.errorMessage}>{this.state.error?.message}</Text>
                </View>
            );
        }
        return this.props.children;
    }
}

export default function CodeRunner({ code, rootComponent, renderKey }: CodeRunnerProps) {
    const [Component, setComponent] = useState<React.ComponentType | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [bundleKey, setBundleKey] = useState(0);

    const hmrMode = rootComponent !== undefined;

    useEffect(() => {
        if (hmrMode) return; // HMR Runtime owns rendering; skip the legacy eval
        if (!code) return;

        const timeoutId = setTimeout(() => {
            try {
                const exports: any = {};
                const module: any = { exports };

                // Expose `global` and a minimal `process` to the bundle. The
                // reanimated Babel plugin compiles worklets into code that
                // references `global` (e.g. `new global.Error()`), and many
                // third-party CJS bundles read `process.env.NODE_ENV`; without
                // these in scope the bundle throws "global does not exist".
                const processShim = { env: { NODE_ENV: 'development' } };
                const func = new Function('require', 'exports', 'module', 'global', 'process', code);
                func(requireModule, exports, module, global, processShim);
                const ExportedComponent = module.exports.default || module.exports;

                if (typeof ExportedComponent === 'function') {
                    setBundleKey(k => k + 1);
                    setComponent(() => ExportedComponent);
                    setError(null);
                } else {
                    setError("No default export found. Make sure to 'export default function App() { ... }'");
                }

            } catch (e: any) {
                console.error("Eval error:", e);
                setError(e.message);
            }
        }, 800);

        return () => clearTimeout(timeoutId);
    }, [code, hmrMode]);

    // HMR mode: the module Runtime supplies the root component directly.
    if (hmrMode) {
        console.log('[HMR] CodeRunner render — rootComponent:', typeof rootComponent, (rootComponent as any)?.name || '(none)');
        if (!rootComponent) {
            return (
                <View style={styles.placeholder}>
                    <Text style={styles.placeholderText}>Waiting for code from editor...</Text>
                </View>
            );
        }
        const Root = rootComponent;
        return (
            <ErrorBoundary key={renderKey ?? 0}>
                <View style={styles.runnerContainer}>
                    <Root />
                </View>
            </ErrorBoundary>
        );
    }

    if (error) {
        return (
            <View style={styles.errorContainer}>
                <Text style={styles.errorTitle}>Compilation/Eval Error</Text>
                <Text style={styles.errorMessage}>{error}</Text>
            </View>
        );
    }

    if (!Component) {
        return (
            <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>Waiting for code...</Text>
            </View>
        );
    }

    return (
        <ErrorBoundary key={bundleKey}>
            <View style={styles.runnerContainer}>
                <Component />
            </View>
        </ErrorBoundary>
    );
}

const styles = StyleSheet.create({
    runnerContainer: {
        flex: 1,
    },
    placeholder: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1a1a2e',
    },
    placeholderText: {
        color: '#fff',
        fontSize: 16,
    },
    errorContainer: {
        flex: 1,
        backgroundColor: '#2d1b1b',
        padding: 20,
        justifyContent: 'center',
    },
    errorTitle: {
        color: '#ff6b6b',
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    errorMessage: {
        color: '#ff9999',
        fontSize: 14,
        fontFamily: 'monospace',
    },
});
