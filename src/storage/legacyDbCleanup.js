import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

const SQLITE_CLEANUP_FLAG = 'fox_legacy_sqlite_cleaned_v2';
const SQLITE_DIR_NAME = 'SQLite';

let hasCompletedInMemory = false;

/**
 * Idempotently cleans up legacy SQLite database files and directories
 * from the mobile application storage.
 * Runs once per installation and records completion in SecureStore.
 * Never touches the backend server's SQLite database.
 */
export async function cleanupLegacySqlite() {
  // Fast in-memory short-circuit — zero async overhead on subsequent calls
  if (hasCompletedInMemory) {
    return { cleaned: false, reason: 'ALREADY_COMPLETED' };
  }

  try {
    // 1. Check if cleanup was already executed
    try {
      const alreadyCleaned = await SecureStore.getItemAsync(SQLITE_CLEANUP_FLAG);
      if (alreadyCleaned === 'true') {
        hasCompletedInMemory = true;
        return { cleaned: false, reason: 'ALREADY_COMPLETED' };
      }
    } catch (_e) {
      // If SecureStore read fails, proceed safely
    }

    const docDir = FileSystem.documentDirectory;
    if (!docDir) {
      return { cleaned: false, reason: 'NO_DOC_DIR' };
    }

    let filesRemoved = 0;

    // 2. Check for standard Expo SQLite directory: ${documentDirectory}SQLite/
    const sqliteDir = `${docDir}${SQLITE_DIR_NAME}/`;
    try {
      const dirInfo = await FileSystem.getInfoAsync(sqliteDir);
      if (dirInfo.exists) {
        if (__DEV__) {
          console.log('[LegacyCleanup] Found legacy SQLite directory:', sqliteDir);
        }
        await FileSystem.deleteAsync(sqliteDir, { idempotent: true });
        filesRemoved++;
        if (__DEV__) {
          console.log('[LegacyCleanup] Deleted legacy SQLite directory successfully.');
        }
      }
    } catch (e) {
      console.warn('[LegacyCleanup] Error removing SQLite directory:', e?.message);
    }

    // 3. Scan documentDirectory for any orphan .db or .sqlite files and sidecars (.db-wal, .db-shm)
    try {
      const dirContents = await FileSystem.readDirectoryAsync(docDir);
      const legacyExtensions = ['.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite-wal', '.sqlite-shm'];
      
      for (const item of dirContents) {
        const lower = item.toLowerCase();
        const isLegacyDbFile = legacyExtensions.some((ext) => lower.endsWith(ext));
        if (isLegacyDbFile) {
          const filePath = `${docDir}${item}`;
          try {
            await FileSystem.deleteAsync(filePath, { idempotent: true });
            filesRemoved++;
            if (__DEV__) {
              console.log('[LegacyCleanup] Removed legacy database file:', item);
            }
          } catch (_e) {}
        }
      }
    } catch (_e) {
      // Non-fatal if directory reading is restricted
    }

    // 4. Mark cleanup as completed in SecureStore
    try {
      await SecureStore.setItemAsync(SQLITE_CLEANUP_FLAG, 'true');
    } catch (_e) {}

    return { cleaned: true, filesRemoved };
  } catch (err) {
    console.warn('[LegacyCleanup] Legacy cleanup caught error:', err?.message);
    return { cleaned: false, error: err?.message };
  }
}
