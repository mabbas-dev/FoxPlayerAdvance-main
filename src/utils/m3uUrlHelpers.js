/**
 * FOX PLAYER — M3U URL Utilities & Xtream Credential Detection
 *
 * Provides:
 *  - URL sanitization for safe, non-sensitive logging (passwords/tokens redacted)
 *  - Safe URL normalization preserving query params, encoding, and ports verbatim
 *  - Detection and extraction of Xtream credentials from M3U download URLs
 */

/**
 * Redacts passwords, tokens, and secrets from any URL for safe diagnostic logging
 */
export function sanitizeUrlForLogging(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url.trim());
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (lower.includes('pass') || lower.includes('token') || lower.includes('secret') || lower.includes('auth')) {
        parsed.searchParams.set(key, 'REDACTED');
      }
    }
    // Also check if path has credentials like /playlist/username/password/m3u_plus
    const pathParts = parsed.pathname.split('/');
    if (pathParts.length >= 4 && pathParts[1] === 'playlist') {
      pathParts[3] = 'REDACTED';
      parsed.pathname = pathParts.join('/');
    }
    return parsed.toString();
  } catch (_e) {
    return url.replace(/([?&](?:password|pass|token|secret)=)[^&]+/gi, '$1REDACTED');
  }
}

/**
 * Validates and safely normalizes an M3U URL without destroying query parameters,
 * port numbers, authentication parameters, or encoding.
 */
export function validateAndNormalizeM3UUrl(rawUrl) {
  if (rawUrl === null || rawUrl === undefined || typeof rawUrl !== 'string') {
    throw new Error('Please enter a valid playlist URL.');
  }

  // Strip leading and trailing whitespace, newlines, and carriage returns
  let trimmed = rawUrl.trim().replace(/^[\r\n\t ]+|[\r\n\t ]+$/g, '');

  if (!trimmed) {
    throw new Error('Playlist URL cannot be empty.');
  }

  // Support both HTTP and HTTPS; auto-prefix http:// if user omitted protocol
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }

  // Verify URL structure safely
  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname) {
      throw new Error('Playlist URL missing host address.');
    }
  } catch (err) {
    if (err.message?.includes('missing host')) throw err;
    // If native URL parsing failed on special characters in query string, ensure basic URL shape
    if (!/^https?:\/\/[a-zA-Z0-9-._~%]+(?::\d+)?(?:\/.*)?$/i.test(trimmed)) {
      throw new Error('Invalid playlist URL format. Please enter a valid HTTP or HTTPS URL.');
    }
  }

  return trimmed;
}

/**
 * Inspects whether the entered M3U URL is an Xtream-style credential-bearing endpoint.
 *
 * Supported IPTV provider patterns:
 *  1. Standard Xtream get.php:
 *     http://host:port/get.php?username=USER&password=PASS&type=m3u_plus&output=ts
 *  2. XMLTV or other Xtream php endpoints:
 *     http://host:port/xmltv.php?username=USER&password=PASS
 *  3. Path-based Xtream endpoint:
 *     http://host:port/playlist/USER/PASS/m3u_plus
 *     http://host:port/get/USER/PASS/m3u
 *
 * Returns: { serverUrl, username, password, type, output } or null if standalone M3U.
 */
export function parseXtreamCredentialsFromUrl(url) {
  if (!url || typeof url !== 'string') return null;

  try {
    const trimmed = url.trim();
    const parsed = new URL(trimmed);

    // Extract base server URL (protocol + host + port)
    const serverUrl = `${parsed.protocol}//${parsed.host}`;

    // Pattern 1: Query parameters (get.php, xmltv.php, player_api.php, etc.)
    const userParam = parsed.searchParams.get('username') || parsed.searchParams.get('user');
    const passParam = parsed.searchParams.get('password') || parsed.searchParams.get('pass');

    if (userParam && passParam) {
      return {
        isXtream: true,
        serverUrl,
        username: userParam.trim(),
        password: passParam.trim(),
        type: parsed.searchParams.get('type') || 'm3u_plus',
        output: parsed.searchParams.get('output') || 'ts',
      };
    }

    // Pattern 2: Path segments e.g. /playlist/USER/PASS/... or /get/USER/PASS/...
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 3) {
      const first = segments[0].toLowerCase();
      if (first === 'playlist' || first === 'get') {
        const username = segments[1];
        const password = segments[2];
        if (username && password && !username.includes('.') && !password.includes('.')) {
          return {
            isXtream: true,
            serverUrl,
            username: decodeURIComponent(username).trim(),
            password: decodeURIComponent(password).trim(),
            type: segments[3] || 'm3u_plus',
            output: 'ts',
          };
        }
      }
    }
  } catch (_e) {
    // Non-fatal
  }

  return null;
}
