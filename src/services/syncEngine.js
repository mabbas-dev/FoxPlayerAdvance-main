/**
 * FOX PLAYER — Synchronization Engine primitives
 *
 * Pure, framework-free building blocks used by the central synchronization
 * coordinator in AppContext. Nothing in this file touches React, storage or the
 * network directly, which keeps every rule unit-testable:
 *
 *  - classifyPlaylistsResponse(): validates a backend association response and
 *    distinguishes a CONFIRMED empty list from an invalid/failed response.
 *  - classifySyncError(): maps an exception to a recovery category. Failures are
 *    never interpreted as "zero playlists".
 *  - reconcilePlaylistState(): computes the next authoritative association state
 *    (dedupe by stable ID, additions/removals/changes, next active playlist).
 *  - createSingleFlight(): single-flight runner that coalesces concurrent
 *    requests into at most one follow-up run (no request storms, no loops).
 *  - createDatasetJobManager(): runs at most ONE heavy dataset job at a time,
 *    with AbortController cancellation and generation tokens so obsolete
 *    playlist responses can never commit.
 */

export const SYNC_ERROR_KIND = {
  CANCELLED: 'cancelled',
  OFFLINE: 'offline',
  TIMEOUT: 'timeout',
  SERVER: 'server',
  INVALID: 'invalid',
  DEVICE_MISSING: 'device_missing',
  UNAUTHORIZED: 'unauthorized',
  UNKNOWN: 'unknown',
};

/**
 * Create an error representing an intentionally cancelled operation.
 * Cancelled operations must never switch the app to an error or empty state.
 */
export function createCancelledError(message = 'CANCELLED') {
  const err = new Error(message);
  err.code = 'CANCELLED';
  err.isCancelled = true;
  return err;
}

export function isCancelledError(err) {
  return Boolean(
    err && (
      err.isCancelled ||
      err.code === 'CANCELLED' ||
      err.category === 'REQUEST_ABORTED' ||
      err.category === 'STALE_REQUEST' ||
      err.name === 'AbortError' ||
      err.message === 'CANCELLED'
    )
  );
}

/**
 * Throws a cancellation error if the given signal has been aborted.
 */
export function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw createCancelledError();
  }
}

/**
 * Validate a `/device/:id/playlists` response.
 * Returns { ok: true, playlists, activeId, idLock } ONLY for a structurally valid
 * success response. Anything else returns { ok: false } and must be treated as
 * a failure — never as a confirmed empty playlist list.
 */
export function classifyPlaylistsResponse(res) {
  if (!res || typeof res !== 'object') return { ok: false, reason: 'EMPTY_BODY' };
  if (res.success !== true) return { ok: false, reason: 'NOT_SUCCESS' };
  if (!Array.isArray(res.playlists)) return { ok: false, reason: 'MALFORMED_PLAYLISTS' };
  return {
    ok: true,
    playlists: res.playlists,
    activeId: res.active_playlist_id != null ? String(res.active_playlist_id) : null,
    idLock: typeof res.id_lock === 'boolean' ? res.id_lock : null,
  };
}

/**
 * Map an exception thrown by the API client / fetch to a recovery category.
 */
export function classifySyncError(err) {
  if (!err) return SYNC_ERROR_KIND.UNKNOWN;
  if (isCancelledError(err)) return SYNC_ERROR_KIND.CANCELLED;
  const code = err.code || err.category || '';
  const status = Number(err.statusCode || 0);
  if (code === 'DEVICE_NOT_FOUND' || status === 404) return SYNC_ERROR_KIND.DEVICE_MISSING;
  if (status === 401 || status === 403 || code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'AUTH_ERROR') {
    return SYNC_ERROR_KIND.UNAUTHORIZED;
  }
  if (code === 'TIMEOUT') return SYNC_ERROR_KIND.TIMEOUT;
  if (code === 'REQUEST_ABORTED' || code === 'STALE_REQUEST') return SYNC_ERROR_KIND.CANCELLED;
  if (code === 'OFFLINE') return SYNC_ERROR_KIND.OFFLINE;
  if (code === 'BACKEND_UNAVAILABLE' || code === 'CONNECTION_ERROR' || code === 'DNS_ERROR') return SYNC_ERROR_KIND.SERVER;
  if (code === 'NETWORK_ERROR') return SYNC_ERROR_KIND.SERVER;
  if (status >= 500 || code === 'SERVER_ERROR') {
    return err.message && /invalid response/i.test(err.message) ? SYNC_ERROR_KIND.INVALID : SYNC_ERROR_KIND.SERVER;
  }
  return SYNC_ERROR_KIND.UNKNOWN;
}

/**
 * Connection signature of a playlist (type + endpoint identity). Never logged.
 * Passwords are intentionally excluded: the backend's playlist LIST endpoint never
 * returns them, so password changes are detected through the backend revision instead.
 */
export function playlistConfigSignature(p) {
  if (!p) return '';
  return [
    p.type || '',
    String(p.serverUrl || '').trim().replace(/\/+$/, '').toLowerCase(),
    p.username || '',
    String(p.playlistUrl || '').trim(),
  ].join('|');
}

/**
 * True when the backend reports a different configuration for the same playlist.
 * The backend revision (playlist_configs.updated_at) is only compared when BOTH sides
 * know it, so records persisted before revisions existed don't trigger false reloads.
 */
export function hasConfigChanged(prev, next) {
  if (!prev || !next) return false;
  if (playlistConfigSignature(prev) !== playlistConfigSignature(next)) return true;
  if (prev.remoteRevision && next.remoteRevision && String(prev.remoteRevision) !== String(next.remoteRevision)) {
    return true;
  }
  return false;
}

/**
 * Compute the next authoritative playlist association state.
 *
 * @param {object} args
 * @param {Array}  args.prevPlaylists   Currently committed playlists.
 * @param {string} args.prevActiveId    Currently active playlist ID (or null).
 * @param {Array}  args.remotePlaylists Validated backend playlists (already normalized
 *                                      records with stable `id`).
 * @param {string} [args.serverActiveId] Backend's active playlist hint.
 * @param {string} [args.preferredActiveId] Explicit user target (e.g. manual switch).
 */
export function reconcilePlaylistState({
  prevPlaylists = [],
  prevActiveId = null,
  remotePlaylists = [],
  serverActiveId = null,
  preferredActiveId = null,
}) {
  const prevMap = new Map();
  for (const p of prevPlaylists || []) {
    if (p && p.id != null) prevMap.set(String(p.id), p);
  }

  // 1. Deduplicate by stable ID (last occurrence wins, original order preserved).
  //    The backend list never includes passwords — carry forward the locally known one.
  const seen = new Map();
  for (const p of remotePlaylists) {
    if (!p || p.id == null || p.id === '') continue;
    const id = String(p.id);
    const prev = prevMap.get(id);
    const merged = { ...p, id };
    const configChanged = prev ? hasConfigChanged(prev, merged) : false;
    if (!merged.password && prev?.password && !configChanged) merged.password = prev.password;
    if (!merged.remoteRevision && prev?.remoteRevision && !configChanged) {
      merged.remoteRevision = prev.remoteRevision;
    }
    seen.set(id, merged);
  }
  const playlists = Array.from(seen.values());

  // 2. Diff
  const added = [];
  const changed = [];
  for (const p of playlists) {
    const prev = prevMap.get(p.id);
    if (!prev) {
      added.push(p.id);
    } else if (hasConfigChanged(prev, p) || prev.name !== p.name) {
      changed.push(p.id);
    }
  }
  const removed = [];
  for (const id of prevMap.keys()) {
    if (!seen.has(id)) removed.push(id);
  }

  // 3. Next active playlist: keep current if valid → explicit preference → server hint → first
  const has = (id) => id != null && seen.has(String(id));
  let nextActiveId = null;
  if (has(preferredActiveId)) nextActiveId = String(preferredActiveId);
  else if (has(prevActiveId)) nextActiveId = String(prevActiveId);
  else if (has(serverActiveId)) nextActiveId = String(serverActiveId);
  else {
    const flagged = playlists.find((p) => p.isActive);
    nextActiveId = flagged ? flagged.id : (playlists[0]?.id ?? null);
  }

  const prevActiveStr = prevActiveId != null ? String(prevActiveId) : null;
  const activeChanged = nextActiveId !== prevActiveStr;
  const activeRemoved = Boolean(prevActiveStr && !seen.has(prevActiveStr));
  const prevActive = prevActiveStr ? prevMap.get(prevActiveStr) : null;
  const nextActive = nextActiveId ? seen.get(nextActiveId) : null;
  const activeConfigChanged = Boolean(
    !activeChanged && prevActive && nextActive && hasConfigChanged(prevActive, nextActive)
  );

  const orderChanged = !activeChanged && added.length === 0 && removed.length === 0 &&
    playlists.some((p, idx) => String(prevPlaylists[idx]?.id) !== p.id);

  return {
    playlists,
    activePlaylist: nextActive || null,
    nextActiveId,
    added,
    removed,
    changed,
    activeChanged,
    activeRemoved,
    activeConfigChanged,
    isEmpty: playlists.length === 0,
    hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0 || activeChanged || orderChanged,
  };
}

/**
 * Single-flight runner.
 *
 * - If idle: starts `runFn(options)` immediately.
 * - If running: records ONE pending follow-up (options are merged) and returns a
 *   promise that resolves with the follow-up's result. Any number of concurrent
 *   requests collapse into that single follow-up, so N triggers ≤ 2 runs.
 * - The follow-up only exists if somebody asked for it while running, so the
 *   runner can never loop on its own.
 */
export function createSingleFlight(runFn, mergeOptions = defaultMergeOptions) {
  let running = null;
  let pending = null; // { options, promise, resolve, reject }

  const start = (options) => {
    const p = Promise.resolve()
      .then(() => runFn(options))
      .finally(() => {
        running = null;
        if (pending) {
          const next = pending;
          pending = null;
          const followUp = start(next.options);
          followUp.then(next.resolve, next.reject);
        }
      });
    running = p;
    return p;
  };

  return {
    request(options = {}) {
      if (!running) return start(options);
      if (pending) {
        pending.options = mergeOptions(pending.options, options);
        return pending.promise;
      }
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pending = { options: mergeOptions({}, options), promise, resolve, reject };
      return promise;
    },
    isRunning() {
      return Boolean(running);
    },
    hasPending() {
      return Boolean(pending);
    },
  };
}

function defaultMergeOptions(a = {}, b = {}) {
  return {
    ...a,
    ...b,
    manual: Boolean(a.manual || b.manual),
    forceDatasets: Boolean(a.forceDatasets || b.forceDatasets),
    reason: b.reason || a.reason,
  };
}

/**
 * Heavy dataset job manager (Live/Movies/Series downloads and cache reads).
 *
 * Guarantees:
 *  - At most ONE job runs at a time (bounded memory/network usage).
 *  - Starting a job for a different playlist aborts the running one.
 *  - A non-forced request for the playlist that is already loading reuses the
 *    in-flight job (deduplication). A forced request after a non-forced job is
 *    chained so a fresh result is still produced.
 *  - Every job receives a token; `isCurrent(token)` must be checked before any
 *    commit so a stale/aborted response can never modify state.
 */
export function createDatasetJobManager() {
  let generation = 0;
  let current = null; // { token, controller, promise, force }

  const isCurrent = (token) => Boolean(
    token && current && current.token === token && !token.signal.aborted
  );

  const cancel = (playlistId = null) => {
    if (!current) return false;
    if (playlistId != null && current.token.playlistId !== String(playlistId)) return false;
    try {
      current.controller.abort();
    } catch (_e) {}
    current = null;
    return true;
  };

  const run = (playlistId, { force = false } = {}, worker) => {
    const strId = String(playlistId);

    if (current && current.token.playlistId === strId && !current.token.signal.aborted) {
      if (!force || current.force) {
        return current.promise; // dedupe
      }
      // Forced fresh result requested while a non-forced job runs: chain after it.
      const prior = current.promise;
      return prior.catch(() => {}).then(() => run(strId, { force: true }, worker));
    }

    // Different playlist (or none) → abort obsolete job first
    if (current) cancel();

    generation += 1;
    const controller = new AbortController();
    const token = { playlistId: strId, generation, signal: controller.signal, force: Boolean(force) };
    const entry = { token, controller, force: Boolean(force), promise: null };
    current = entry;

    entry.promise = Promise.resolve()
      .then(() => worker(token))
      .finally(() => {
        if (current === entry) current = null;
      });
    return entry.promise;
  };

  return {
    run,
    cancel,
    cancelAll: () => cancel(null),
    isCurrent,
    activePlaylistId: () => (current ? current.token.playlistId : null),
    isBusy: () => Boolean(current),
  };
}

/**
 * Combine an optional external AbortSignal with a timeout.
 * Hermes does not guarantee AbortSignal.any / AbortSignal.timeout, so this is
 * implemented manually. Returns { signal, cleanup, didTimeout }.
 */
export function linkAbortSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => {
    try { controller.abort(); } catch (_e) {}
  };
  if (externalSignal) {
    if (externalSignal.aborted) onAbort();
    else if (typeof externalSignal.addEventListener === 'function') {
      externalSignal.addEventListener('abort', onAbort);
    }
  }
  const timer = timeoutMs > 0
    ? setTimeout(() => {
      timedOut = true;
      onAbort();
    }, timeoutMs)
    : null;
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', onAbort);
      }
    },
  };
}
