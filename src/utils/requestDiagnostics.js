/**
 * FOX PLAYER — Request Diagnostics & Telemetry
 *
 * Tracks backend & IPTV network requests to diagnose failures, stale responses,
 * and lifecycle transactions without exposing passwords, credentials, or tokens.
 */

import { ERROR_CATEGORY } from '../services/networkErrors.js';

const MAX_HISTORY = 60;
let requestCounter = 0;
const inFlightRequests = new Map();
const diagnosticsHistory = [];

/**
 * Strips passwords, tokens, and query credentials from URLs and endpoints
 */
export function sanitizeEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') return '';
  try {
    const url = new URL(endpoint, 'http://localhost');
    // Remove sensitive query params
    url.searchParams.delete('password');
    url.searchParams.delete('token');
    url.searchParams.delete('secret');
    url.searchParams.delete('code');
    return `${url.pathname}${url.search ? url.search : ''}`;
  } catch (_e) {
    return endpoint.replace(/([?&](?:password|token|secret)=)[^&]+/gi, '$1[REDACTED]');
  }
}

/**
 * Start tracking a request
 */
export function trackRequestStart({
  endpoint,
  playlistId = null,
  operationId = null,
  category = 'API',
}) {
  requestCounter += 1;
  const requestId = requestCounter;
  const startTime = Date.now();

  const record = {
    requestId,
    operationId: operationId || null,
    playlistId: playlistId ? String(playlistId) : null,
    endpoint: sanitizeEndpoint(endpoint),
    category,
    startTime,
    completionState: 'IN_FLIGHT',
    durationMs: 0,
    httpStatus: 0,
    errorCategory: null,
  };

  inFlightRequests.set(requestId, record);
  return requestId;
}

/**
 * Finish tracking a request
 */
export function trackRequestEnd(requestId, {
  completionState = 'SUCCESS',
  httpStatus = 200,
  errorCategory = null,
  errorMessage = null,
} = {}) {
  const record = inFlightRequests.get(requestId);
  if (!record) return null;

  inFlightRequests.delete(requestId);
  const endTime = Date.now();
  record.completionState = completionState;
  record.durationMs = endTime - record.startTime;
  record.httpStatus = httpStatus || 0;
  record.errorCategory = errorCategory || (completionState === 'SUCCESS' ? null : ERROR_CATEGORY.UNKNOWN_ERROR);
  if (errorMessage && completionState !== 'SUCCESS') {
    record.errorMessage = String(errorMessage).substring(0, 150);
  }

  diagnosticsHistory.unshift(record);
  if (diagnosticsHistory.length > MAX_HISTORY) {
    diagnosticsHistory.pop();
  }

  return record;
}

/**
 * Retrieve recent request diagnostics
 */
export function getRequestDiagnostics() {
  return {
    inFlightCount: inFlightRequests.size,
    inFlight: Array.from(inFlightRequests.values()),
    history: [...diagnosticsHistory],
  };
}

/**
 * Clear diagnostics (for tests)
 */
export function clearRequestDiagnostics() {
  inFlightRequests.clear();
  diagnosticsHistory.length = 0;
  requestCounter = 0;
}
