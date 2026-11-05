/**
 * Authoritative subscription and expiry calculation & formatting utilities.
 * Pure JavaScript helpers without JSX dependencies for complete testability and cross-platform consistency.
 */

const LIFETIME_TYPES = new Set(['forever', 'lifetime', 'permanent']);

/**
 * True when backend marks this device as lifetime / forever (not a 1-year term).
 */
export function isLifetimeSubscription(sub) {
  if (!sub || typeof sub !== 'object') return false;
  if (sub.is_lifetime === true || sub.never_expires === true) return true;
  const type = String(sub.subscription_type || sub.type || '').toLowerCase();
  if (LIFETIME_TYPES.has(type)) return true;
  const durationDays = Number(sub.duration_days);
  if (Number.isFinite(durationDays) && durationDays >= 3650) return true;
  const notes = String(sub.notes || '').toLowerCase();
  if (notes.includes('lifetime') || notes.includes('forever')) return true;
  const remaining = Number(sub.remaining_days ?? sub.days_left);
  if (Number.isFinite(remaining) && remaining >= 7300) return true;
  return false;
}

/**
 * Human-readable plan label from authoritative subscription fields.
 */
export function getSubscriptionPlanLabel(sub, { isTrialEligible = false } = {}) {
  if (!sub) {
    return isTrialEligible ? 'Free trial available' : 'No plan';
  }
  if (isLifetimeSubscription(sub)) return 'Lifetime';
  const type = String(sub.subscription_type || sub.type || '').toLowerCase();
  if (type === 'trial') return 'Free trial';
  if (type === 'year_1') return '1 year';
  if (type === 'paid') return 'Full access';
  if (type === 'custom') {
    const days = Number(sub.duration_days);
    if (Number.isFinite(days) && days > 0) return `${days}-day plan`;
    return 'Custom plan';
  }
  return 'Active plan';
}

/**
 * Merge API envelope + nested subscription into one normalized record for UI/state.
 */
export function normalizeSubscriptionRecord(raw, envelope = null) {
  const base = raw && typeof raw === 'object' ? { ...raw } : null;
  if (!base) return null;

  const top = envelope && typeof envelope === 'object' ? envelope : null;
  const merged = { ...base };

  if (top) {
    const keys = [
      'device_id',
      'installation_id',
      'subscription_type',
      'type',
      'status',
      'is_active',
      'is_valid',
      'expires_at',
      'starts_at',
      'server_time',
      'remaining_days',
      'days_left',
      'duration_days',
      'is_lifetime',
      'never_expires',
      'notes',
      'source',
    ];
    for (const key of keys) {
      if (top[key] !== undefined && top[key] !== null && merged[key] === undefined) {
        merged[key] = top[key];
      }
    }
  }

  if (merged.duration_days == null && merged.durationDays != null) {
    merged.duration_days = merged.durationDays;
  }

  merged.is_lifetime = isLifetimeSubscription(merged);
  merged.never_expires = merged.is_lifetime;

  return merged;
}

/**
 * Parse GET /api/subscription/status (or register) body into one subscription record.
 */
export function extractSubscriptionFromStatusResponse(res) {
  if (!res || typeof res !== 'object') return null;

  if (res.subscription && typeof res.subscription === 'object') {
    return normalizeSubscriptionRecord(res.subscription, res);
  }

  const hasPayload =
    res.has_subscription === true ||
    res.is_valid === true ||
    res.is_active === true ||
    Boolean(res.expires_at) ||
    Boolean(res.subscription_type) ||
    Boolean(res.type);

  if (hasPayload) {
    return normalizeSubscriptionRecord(res, res);
  }

  return null;
}

/**
 * Format an authoritative ISO UTC date string in the user's local timezone.
 */
export function formatAppExpiryDate(isoString, includeTime = false) {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'N/A';
    
    const options = {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    };
    return includeTime ? d.toLocaleString(undefined, options) : d.toLocaleDateString(undefined, options);
  } catch (_e) {
    return 'N/A';
  }
}

/** Compact pill/dialog date: D/M/YY in local timezone (e.g. 5/5/27). */
export function formatAppExpiryDateCompact(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '—';
    const day = d.getDate();
    const month = d.getMonth() + 1;
    const year = d.getFullYear() % 100;
    return `${day}/${month}/${year}`;
  } catch (_e) {
    return '—';
  }
}

/**
 * Format local time from ISO timestamp.
 */
export function formatAppExpiryTime(isoString) {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch (_e) {
    return 'N/A';
  }
}

/**
 * Accurately calculate human-readable remaining or elapsed subscription duration
 * against authoritative server time (or client clock if server time unavailable).
 */
export function getSubscriptionTimeRemaining(expiresAt, serverTime = null, options = {}) {
  if (options.isLifetime || options.is_lifetime) {
    return {
      text: 'Lifetime access',
      isExpired: false,
      isLifetime: true,
      remainingMs: null,
      days: null,
      hours: 0,
      minutes: 0,
    };
  }

  if (!expiresAt) {
    return {
      text: 'Expiry date unavailable',
      isExpired: false,
      remainingMs: 0,
      days: 0,
      hours: 0,
      minutes: 0,
    };
  }

  const expDate = new Date(expiresAt);
  if (isNaN(expDate.getTime())) {
    return {
      text: 'Expiry date unavailable',
      isExpired: false,
      remainingMs: 0,
      days: 0,
      hours: 0,
      minutes: 0,
    };
  }

  const nowMs = serverTime ? new Date(serverTime).getTime() : Date.now();
  const diffMs = expDate.getTime() - nowMs;

  if (diffMs <= 0) {
    const elapsedMs = Math.abs(diffMs);
    const elapsedDays = Math.floor(elapsedMs / (24 * 3600 * 1000));
    const elapsedHours = Math.floor((elapsedMs % (24 * 3600 * 1000)) / (3600 * 1000));
    const elapsedMinutes = Math.floor((elapsedMs % (3600 * 1000)) / (60 * 1000));

    let text;
    if (elapsedDays === 0) {
      if (elapsedHours === 0) {
        text = elapsedMinutes <= 1 ? 'Expired just now' : `Expired ${elapsedMinutes} mins ago`;
      } else {
        text = `Expired ${elapsedHours} hour${elapsedHours !== 1 ? 's' : ''} ago`;
      }
    } else if (elapsedDays === 1) {
      text = 'Expired 1 day ago';
    } else {
      text = `Expired ${elapsedDays} days ago`;
    }

    return {
      text,
      isExpired: true,
      remainingMs: diffMs,
      days: 0,
      hours: 0,
      minutes: 0,
      elapsedDays,
      elapsedHours,
    };
  }

  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  const hours = Math.floor((diffMs % (24 * 3600 * 1000)) / (3600 * 1000));
  const minutes = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));

  let text;
  if (days > 2) {
    text = `${days} days remaining`;
  } else if (days >= 1) {
    text = `${days} day${days > 1 ? 's' : ''}${hours > 0 ? `, ${hours} hour${hours !== 1 ? 's' : ''}` : ''} remaining`;
  } else if (hours > 0) {
    text = `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} min remaining`;
  } else if (minutes > 0) {
    text = `Expires in ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    text = 'Expires today';
  }

  return {
    text,
    isExpired: false,
    remainingMs: diffMs,
    days,
    hours,
    minutes,
  };
}

/**
 * Calculate clamped 0–100% subscription progress between start and expiry timestamps.
 */
export function calculateSubscriptionProgress(startsAt, expiresAt, serverTime = null, options = {}) {
  if (options.isLifetime || options.is_lifetime) return null;
  if (!startsAt || !expiresAt) return null;
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(expiresAt).getTime();
  const nowMs = serverTime ? new Date(serverTime).getTime() : Date.now();

  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return null;

  const total = endMs - startMs;
  const elapsed = nowMs - startMs;
  const progressRatio = Math.max(0, Math.min(1, elapsed / total));
  const isExpired = nowMs >= endMs;

  const elapsedDays = Math.max(0, Math.floor(elapsed / (24 * 3600 * 1000)));
  const totalDays = Math.max(1, Math.round(total / (24 * 3600 * 1000)));

  return {
    percentage: Math.round(progressRatio * 100),
    ratio: progressRatio,
    isExpired,
    elapsedDays,
    totalDays,
  };
}
