import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as ReactNative from 'react-native';

interface CodeRunnerProps {
    code: string;
}

const modules: Record<string, any> = {
    'react': React,
    'react-native': ReactNative,
    '@react-native-async-storage/async-storage': require('@react-native-async-storage/async-storage'),
};

const requireModule = (name: string) => {
    if (modules[name]) return modules[name];

    const dynamicModules = (global as any).DynamicModules || {};
    if (dynamicModules[name]) {
        if (typeof dynamicModules[name] === 'string') {
            try {
                const bundleCode = dynamicModules[name];
                const exports: any = {};
                const module: any = { exports };

                const func = new Function('require', 'exports', 'module', 'process', bundleCode);

                const process = { env: { NODE_ENV: 'development' } };

                func(requireModule, exports, module, process);

                dynamicModules[name] = module.exports.default || module.exports;
            } catch (e) {
                console.error(`Failed to eval dynamic module ${name}:`, e);
                return {};
            }
        }
        return dynamicModules[name];
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

export default function CodeRunner({ code }: CodeRunnerProps) {
    const [Component, setComponent] = useState<React.ComponentType | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!code) return;

        try {
            const exports: any = {};
            const module: any = { exports };

            const func = new Function('require', 'exports', 'module', code);
            func(requireModule, exports, module);
            const ExportedComponent = module.exports.default || module.exports;

            if (typeof ExportedComponent === 'function') {
                setComponent(() => ExportedComponent);
                setError(null);
            } else {
                setError("No default export found. Make sure to 'export default function App() { ... }'");
            }

        } catch (e: any) {
            console.error("Eval error:", e);
            setError(e.message);
        }
    }, [code]);

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
        <ErrorBoundary key={code.substring(0, 20)}>
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
