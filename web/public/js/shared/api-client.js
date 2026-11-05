import { decryptPayload } from './payload-crypto.js';

export const API_BASE = 'https://api.foxplayer.app';

export async function apiRequest(path, { method = 'GET', body = null, token = null, deviceId = null, headers: extraHeaders = {} } = {}) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-app-client': 'foxplayer-web-v2',
    ...extraHeaders,
  };
  if (token) headers.Authorization = headers.Authorization || `Bearer ${token}`;
  if (deviceId) headers['x-device-id'] = deviceId;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) {}
  if (!res.ok || (json && json.success === false)) {
    const msg = json?.error?.message || json?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

/** Decrypt `encrypted` + `data` responses from the FOX API. */
export async function apiEncrypted(path, options = {}) {
  const json = await apiRequest(path, options);
  if (json?.encrypted && json?.data) {
    const payload = decryptPayload(json.data);
    if (payload == null) {
      throw new Error('Could not decrypt server response.');
    }
    return { ...json, payload };
  }
  return { ...json, payload: json };
}

export function readQueryParams() {
  const p = new URLSearchParams(window.location.search);
  const deviceId = p.get('device_id') || p.get('deviceId') || p.get('d') || '';
  const token = p.get('token') || p.get('pairing_token') || p.get('t') || '';
  return { deviceId: deviceId.trim(), token: token.trim() };
}
