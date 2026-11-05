import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { AppState } from 'react-native';
import { getSubscriptionStatus, activateTrial as activateTrialApi } from '../services/apiService';
import { readCache, writeCache } from '../storage/cacheStorage';

export const SUBSCRIPTION_STATUS = {
  CHECKING: 'CHECKING',
  ACTIVE_TRIAL: 'ACTIVE_TRIAL',
  ACTIVE_PAID: 'ACTIVE_PAID',
  TRIAL_AVAILABLE: 'TRIAL_AVAILABLE',
  EXPIRED: 'EXPIRED',
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
  NO_SUBSCRIPTION: 'NO_SUBSCRIPTION',
};

const SubscriptionContext = createContext(null);

import {
  formatAppExpiryDate,
  formatAppExpiryDateCompact,
  formatAppExpiryTime,
  getSubscriptionTimeRemaining,
  calculateSubscriptionProgress,
  isLifetimeSubscription,
  getSubscriptionPlanLabel,
  normalizeSubscriptionRecord,
  extractSubscriptionFromStatusResponse,
} from '../utils/subscriptionUtils';

export {
  formatAppExpiryDate,
  formatAppExpiryTime,
  formatAppExpiryDateCompact,
  getSubscriptionTimeRemaining,
  calculateSubscriptionProgress,
  isLifetimeSubscription,
  getSubscriptionPlanLabel,
  normalizeSubscriptionRecord,
};

export function SubscriptionProvider({ deviceId, installationId, initialSubscription = null, initialEligibility = null, children }) {
  const [subscription, setSubscription] = useState(initialSubscription);
  const [isTrialEligible, setIsTrialEligible] = useState(Boolean(initialEligibility?.is_eligible));
  const [trialDurationDays, setTrialDurationDays] = useState(initialEligibility?.duration_days || 7);
  const [isLoading, setIsLoading] = useState(!initialSubscription && !initialEligibility);
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState(null);
  const [showTrialDisclaimer, setShowTrialDisclaimer] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [lastValidatedAt, setLastValidatedAt] = useState(null);

  const fetchSequenceRef = useRef(0);
  const hasInitializedRef = useRef(false);
  const disclaimerDismissedThisSessionRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (initialSubscription) {
      setSubscription(
        normalizeSubscriptionRecord(initialSubscription, initialSubscription)
      );
      setError(null);
      setIsLoading(false);
    }
  }, [initialSubscription]);

  useEffect(() => {
    if (initialEligibility?.is_eligible !== undefined) {
      setIsTrialEligible(Boolean(initialEligibility.is_eligible));
      if (initialEligibility.duration_days) {
        setTrialDurationDays(initialEligibility.duration_days);
      }
    }
  }, [initialEligibility?.is_eligible, initialEligibility?.duration_days]);

  const isSubActive = useCallback((sub) => {
    if (!sub) return false;
    if (isLifetimeSubscription(sub)) return true;
    if (sub.is_valid !== undefined) return Boolean(sub.is_valid);
    if (sub.is_active !== undefined) return Boolean(sub.is_active);
    return sub.status === 'active';
  }, []);

  // Compute fine-grained subscription status
  const subscriptionStatus = useMemo(() => {
    if (isLoading) return SUBSCRIPTION_STATUS.CHECKING;
    if (error && !subscription) return SUBSCRIPTION_STATUS.BACKEND_UNAVAILABLE;

    if (subscription) {
      if (isSubActive(subscription)) {
        if (subscription.subscription_type === 'trial' || subscription.type === 'trial') {
          return SUBSCRIPTION_STATUS.ACTIVE_TRIAL;
        }
        return SUBSCRIPTION_STATUS.ACTIVE_PAID;
      }
      return SUBSCRIPTION_STATUS.EXPIRED;
    }

    if (isTrialEligible) {
      return SUBSCRIPTION_STATUS.TRIAL_AVAILABLE;
    }

    return SUBSCRIPTION_STATUS.NO_SUBSCRIPTION;
  }, [isLoading, error, subscription, isTrialEligible, isSubActive]);

  const isSubscriptionValid = useMemo(() => {
    return isSubActive(subscription);
  }, [subscription, isSubActive]);

  const appExpiresAt = useMemo(() => {
    return subscription?.expires_at || null;
  }, [subscription]);

  const isLifetime = useMemo(() => isLifetimeSubscription(subscription), [subscription]);

  const appExpiresAtFormatted = useMemo(() => {
    if (isLifetime) return 'Lifetime';
    return formatAppExpiryDate(appExpiresAt, false);
  }, [appExpiresAt, isLifetime]);

  const appExpiresAtCompact = useMemo(() => {
    if (isLifetime) return 'Lifetime';
    return formatAppExpiryDateCompact(appExpiresAt);
  }, [appExpiresAt, isLifetime]);

  const remainingDays = useMemo(() => {
    if (isLifetime) return null;
    if (typeof subscription?.remaining_days === 'number') {
      return Math.max(0, subscription.remaining_days);
    }
    if (subscription?.expires_at) {
      const expMs = new Date(subscription.expires_at).getTime();
      const refMs = subscription.server_time ? new Date(subscription.server_time).getTime() : null;
      if (refMs && !isNaN(refMs) && !isNaN(expMs)) {
        return Math.max(0, Math.ceil((expMs - refMs) / (24 * 3600 * 1000)));
      }
    }
    return 0;
  }, [subscription, isLifetime]);

  const subscriptionType = useMemo(() => {
    return subscription?.subscription_type || subscription?.type || null;
  }, [subscription]);

  const subscriptionPlanLabel = useMemo(() => {
    return getSubscriptionPlanLabel(subscription, { isTrialEligible });
  }, [subscription, isTrialEligible]);

  /**
   * Authoritatively query subscription status from backend server clock
   */
  const refreshSubscription = useCallback(async (options = {}) => {
    if (!deviceId && !installationId) return null;

    fetchSequenceRef.current += 1;
    const currentSeq = fetchSequenceRef.current;

    if (!options.silent) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const res = await getSubscriptionStatus(deviceId, installationId);

      // Stale response guard
      if (fetchSequenceRef.current !== currentSeq) {
        return null;
      }

      retryCountRef.current = 0;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      const subData = extractSubscriptionFromStatusResponse(res);
      if (subData) {
        setSubscription(subData);
        setError(null);
        setIsTrialEligible(false);
        setIsCached(false);
        setLastValidatedAt(subData.server_time || new Date().toISOString());
        try {
          await writeCache('fox_player_cached_subscription', subData);
        } catch (_e) {}
        setIsLoading(false);
        return subData;
      }

      // No active subscription: check if backend confirms trial eligibility
      if (res?.is_trial_eligible) {
        setSubscription(null);
        setError(null);
        setIsTrialEligible(true);
        setIsCached(false);
        setLastValidatedAt(new Date().toISOString());
        if (res.trial_settings?.duration_days) {
          setTrialDurationDays(res.trial_settings.duration_days);
        }
        // First launch or return without dismissal -> show trial disclaimer
        if (!disclaimerDismissedThisSessionRef.current) {
          setShowTrialDisclaimer(true);
        }
      } else {
        setSubscription(res?.subscription || null);
        setError(null);
        setIsTrialEligible(false);
        setIsCached(false);
        setLastValidatedAt(new Date().toISOString());
      }

      setIsLoading(false);
      return res?.subscription || null;
    } catch (err) {
      if (fetchSequenceRef.current !== currentSeq) {
        return null;
      }

      console.warn('[SUB_CTX] refreshSubscription failed:', err?.message || err);

      // Offline fallback: load cached subscription if available
      try {
        const cached = await readCache('fox_player_cached_subscription');
        if (cached && (cached.is_active || cached.is_valid || cached.status === 'active')) {
          setSubscription(cached);
          setError(null);
          setIsTrialEligible(false);
          setIsCached(true);
          setIsLoading(false);
          return cached;
        }
      } catch (_cacheErr) {}

      setError(err?.message || 'Unable to connect to subscription server.');
      setIsLoading(false);

      // Auto-retry recovery: if backend was unavailable and device is connected, retry with backoff
      if (retryCountRef.current < 4) {
        retryCountRef.current += 1;
        const delayMs = retryCountRef.current * 3000;
        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = setTimeout(() => {
          refreshSubscription({ silent: true });
        }, delayMs);
      }

      return null;
    }
  }, [deviceId, installationId]);

  /**
   * Atomically activate free trial upon user clicking "Activate Free Trial"
   */
  const activateTrial = useCallback(async () => {
    if (!installationId) {
      throw new Error('Device installation UUID is required to activate trial.');
    }

    setIsActivating(true);
    setError(null);

    try {
      const res = await activateTrialApi(deviceId, installationId);

      if (res?.success && res.subscription) {
        setSubscription(normalizeSubscriptionRecord(res.subscription, res));
        setIsTrialEligible(false);
        setShowTrialDisclaimer(false);
        setIsCached(false);
        setLastValidatedAt(res.subscription.server_time || new Date().toISOString());
        try {
          await writeCache('fox_player_cached_subscription', res.subscription);
        } catch (_e) {}
        setIsActivating(false);
        return { success: true, subscription: res.subscription };
      }

      throw new Error(res?.error?.message || 'Failed to activate trial.');
    } catch (err) {
      setIsActivating(false);
      const errMsg = err?.message || 'Failed to activate trial. Please try again.';
      setError(errMsg);
      return { success: false, error: errMsg };
    }
  }, [deviceId, installationId]);

  /**
   * Dismiss the disclaimer for the current session without activating or consuming trial
   */
  const dismissTrialDisclaimer = useCallback(() => {
    disclaimerDismissedThisSessionRef.current = true;
    setShowTrialDisclaimer(false);
  }, []);

  /**
   * Open the disclaimer manually (e.g. from Settings or Home status pill)
   */
  const openTrialDisclaimer = useCallback(() => {
    setShowTrialDisclaimer(true);
  }, []);

  const lastFetchedKeyRef = useRef(null);

  // Initialize on mount or when deviceId/installationId become available
  useEffect(() => {
    if (!deviceId && !installationId) return;

    const currentKey = `${deviceId || ''}_${installationId || ''}`;
    if (lastFetchedKeyRef.current !== currentKey) {
      lastFetchedKeyRef.current = currentKey;
      hasInitializedRef.current = true;
      refreshSubscription();
    }
  }, [deviceId, installationId, refreshSubscription]);

  // Foreground listener: refresh status when returning to app to catch admin updates
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active' && hasInitializedRef.current) {
        refreshSubscription({ silent: true });
      }
    };

    let sub = null;
    if (typeof AppState !== 'undefined' && AppState?.addEventListener) {
      sub = AppState.addEventListener('change', handleAppStateChange);
    }

    return () => {
      if (sub?.remove) sub.remove();
    };
  }, [refreshSubscription]);

  const value = {
    deviceId,
    installationId,
    subscription,
    subscriptionStatus,
    subscriptionType,
    subscriptionPlanLabel,
    isLifetime,
    appExpiresAt,
    appExpiresAtFormatted,
    appExpiresAtCompact,
    remainingDays,
    isSubscriptionValid,
    isTrialEligible,
    trialDurationDays,
    isLoading,
    isActivating,
    error,
    isCached,
    lastValidatedAt,
    showTrialDisclaimer,
    refreshSubscription,
    activateTrial,
    dismissTrialDisclaimer,
    openTrialDisclaimer,
  };

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return ctx;
}
