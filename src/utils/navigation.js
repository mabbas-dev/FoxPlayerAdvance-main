/** Expo Router may pass a param as string or string[] — pick one stable string. */
export function getRouteParam(value) {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) {
    const first = value.find((v) => v != null && v !== '');
    return first != null ? String(first) : '';
  }
  return String(value);
}

/**
 * Safely navigates back if there is a previous route in history;
 * otherwise navigates to the fallback route (defaulting to '/(tabs)')
 * to prevent 'The action GO_BACK was not handled by any navigator' crashes/warnings.
 */
export function safeBack(router, fallback = '/(tabs)') {
  if (!router) return;
  try {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
    } else if (fallback && typeof router.replace === 'function') {
      router.replace(fallback);
    }
  } catch (_e) {
    if (fallback && typeof router.replace === 'function') {
      try {
        router.replace(fallback);
      } catch (_e2) {}
    }
  }
}
