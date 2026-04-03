// Stub for @react-native-async-storage — used by packages/domain/src/services/SyncService.ts
// (a legacy Sheets-sync service not used in the web app). This suppresses the missing-types
// error when tsc traverses domain sources via package alias paths.
declare module '@react-native-async-storage/async-storage' {
  const AsyncStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  export default AsyncStorage;
}
