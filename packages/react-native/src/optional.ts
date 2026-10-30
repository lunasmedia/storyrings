/**
 * Optional peer dependencies, used when the app has them installed. Each
 * require sits directly in a try block so Metro treats it as optional.
 */
import type { KeyValueStorage } from '@stories/core';
import type { ComponentType, Context } from 'react';

// biome-ignore lint/suspicious/noExplicitAny: untyped module loader
declare const require: (id: string) => any;

/** react-native-video's <Video>, for video stories and animated covers. */
// biome-ignore lint/suspicious/noExplicitAny: third-party component without a hard type dependency
export let Video: ComponentType<any> | null = null;
try {
  Video = require('react-native-video').default ?? null;
} catch {}

let asyncStorage: KeyValueStorage | null = null;
try {
  asyncStorage = require('@react-native-async-storage/async-storage').default ?? null;
} catch {}

// biome-ignore lint/suspicious/noExplicitAny: optional module
let safeArea: any = null;
try {
  safeArea = require('react-native-safe-area-context');
} catch {}

/** Kept for this app session only, when AsyncStorage isn't installed. */
function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

export const defaultStorage: KeyValueStorage = asyncStorage ?? memoryStorage();
export const hasPersistentStorage = asyncStorage !== null;

export interface Insets {
  top: number;
  bottom: number;
}

/** Context holding the insets when the app uses <SafeAreaProvider>; null otherwise. */
export const SafeAreaInsetsContext: Context<Insets | null> | null =
  safeArea?.SafeAreaInsetsContext ?? null;

/** Insets measured at launch, available even without a provider. */
export const initialInsets: Insets | null = safeArea?.initialWindowMetrics?.insets ?? null;
