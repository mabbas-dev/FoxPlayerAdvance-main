import * as FileSystem from 'expo-file-system/legacy';
import { CACHE_DURATION_MS } from '../constants';

const CACHE_DIR = `${FileSystem.documentDirectory}fox_player_cache/`;

let cacheDirEnsured = false;

async function ensureCacheDir() {
  if (cacheDirEnsured) return;
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
  cacheDirEnsured = true;
}

function cacheFilePath(key) {
  return `${CACHE_DIR}${key.replace(/[^a-zA-Z0-9_]/g, '_')}.json`;
}

// Global queue to serialize disk writes across the entire app
// Prevents concurrent JNI string conversions from exhausting Android Dalvik/JVM heap (OOM)
let globalWriteQueue = Promise.resolve();
const writeLocks = new Map();

/**
 * Internal write implementation with unique temporary file and atomic replace.
 */
async function doWriteCache(key, data) {
  const finalPath = cacheFilePath(key);
  const tmpPath = `${finalPath}.${Date.now()}_${Math.random().toString(36).substring(2, 8)}.tmp`;
  try {
    await ensureCacheDir();
    const payload = {
      timestamp: Date.now(),
      data,
    };
    const jsonStr = JSON.stringify(payload);

    // 1. Write to unique temporary file first
    await FileSystem.writeAsStringAsync(
      tmpPath,
      jsonStr,
      { encoding: FileSystem.EncodingType.UTF8 }
    );

    // 2. On Android/Expo FileSystem, moveAsync will reject if the destination file already exists.
    // Ensure destination is deleted prior to moving so moveAsync succeeds.
    await FileSystem.deleteAsync(finalPath, { idempotent: true });

    try {
      await FileSystem.moveAsync({
        from: tmpPath,
        to: finalPath,
      });
    } catch (_moveErr) {
      // 3. Fallback: If moveAsync fails for any filesystem-specific reason,
      // directly write to final destination.
      await FileSystem.writeAsStringAsync(
        finalPath,
        jsonStr,
        { encoding: FileSystem.EncodingType.UTF8 }
      );
      await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    }

    return true;
  } catch (e) {
    console.warn('[Cache] Write failed:', key, e?.message);
    try {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    } catch (_ignore) {}
    return false;
  }
}

/**
 * Write data to local file cache with timestamp (globally serialized atomic write)
 */
export async function writeCache(key, data) {
  let releaseKey;
  const keyPromise = new Promise((resolve) => {
    releaseKey = resolve;
  });
  writeLocks.set(key, keyPromise);

  const writeOperation = async () => {
    try {
      return await doWriteCache(key, data);
    } finally {
      releaseKey();
      if (writeLocks.get(key) === keyPromise) {
        writeLocks.delete(key);
      }
    }
  };

  const queued = globalWriteQueue.then(writeOperation, writeOperation);
  globalWriteQueue = queued.catch(() => {});
  return queued;
}

/**
 * Read data from local file cache
 * Returns null if not found, expired, or corrupted
 */
export async function readCache(key, maxAgeMs = CACHE_DURATION_MS) {
  const pending = writeLocks.get(key);
  if (pending) {
    try {
      await pending;
    } catch (_e) {}
  }

  const path = cacheFilePath(key);
  try {
    // Directly read without a pre-check getInfoAsync() round-trip for performance.
    // expo-file-system throws if the file doesn't exist — we catch that below.
    const raw = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (!raw || raw.trim().length === 0) {
      FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      return null;
    }

    const payload = JSON.parse(raw);

    if (!payload || !payload.timestamp || payload.data === undefined) {
      FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      return null;
    }

    const age = Date.now() - payload.timestamp;
    if (maxAgeMs > 0 && age > maxAgeMs) {
      // Expired — delete asynchronously (non-blocking)
      FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      return null;
    }

    return payload.data;
  } catch (e) {
    // File not found is expected on cold start — not an error worth logging
    const isNotFound = e?.message?.includes('No such file') ||
      e?.message?.includes('does not exist') ||
      e?.code === 'ERR_FILESYSTEM_CANNOT_READ_DIRECTORY';
    if (!isNotFound) {
      console.warn('[Cache] Read failed / corrupted cache deleted:', key, e?.message);
      FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    }
    return null;
  }
}

/**
 * Read cache ignoring expiry (for offline fallback)
 */
export async function readCacheStale(key) {
  return readCache(key, -1);
}

/**
 * Delete a specific cache entry
 */
export async function deleteCache(key) {
  const pending = writeLocks.get(key);
  if (pending) {
    try {
      await pending;
    } catch (_e) {}
  }
  try {
    const path = cacheFilePath(key);
    await FileSystem.deleteAsync(path, { idempotent: true });
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Clear all cache
 */
export async function clearAllCache() {
  cacheDirEnsured = false;
  try {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Clear all caches scoped to a specific playlist (channels, movies, series, categories, config)
 */
export async function clearPlaylistCache(playlistId) {
  if (!playlistId) return false;
  try {
    await ensureCacheDir();
    const cleanId = String(playlistId).replace(/[^a-zA-Z0-9_]/g, '_');
    const prefix = `fox_player_${cleanId}_`;
    const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
    const toDelete = files.filter((f) => f.startsWith(prefix));
    await Promise.all(
      toDelete.map((f) => FileSystem.deleteAsync(`${CACHE_DIR}${f}`, { idempotent: true }))
    );
    return true;
  } catch (e) {
    console.warn('[Cache] clearPlaylistCache warning:', playlistId, e?.message);
    return false;
  }
}

/**
 * Clear all playlist-scoped caches on the device
 */
export async function clearAllPlaylistCaches() {
  try {
    await ensureCacheDir();
    const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
    const toDelete = files.filter((f) => f.startsWith('fox_player_'));
    await Promise.all(
      toDelete.map((f) => FileSystem.deleteAsync(`${CACHE_DIR}${f}`, { idempotent: true }))
    );
    return true;
  } catch (e) {
    console.warn('[Cache] clearAllPlaylistCaches warning:', e?.message);
    return false;
  }
}

/**
 * Get cache metadata without reading full data
 */
export async function getCacheInfo(key) {
  try {
    const path = cacheFilePath(key);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;

    const raw = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const payload = JSON.parse(raw);
    return {
      timestamp: payload?.timestamp || null,
      age: payload?.timestamp ? Date.now() - payload.timestamp : null,
      size: info.size,
    };
  } catch (_e) {
    return null;
  }
}
