// Unified Toast Service for Fox Player
// Decoupled event bus for responsive, dismissible dark toast notifications

class ToastService {
  constructor() {
    this.listeners = new Set();
    this.recentMessages = new Map(); // message -> timestamp
  }

  /**
   * Subscribe to toast events
   * @param {Function} listener ({ action, toast, id }) => void
   * @returns {Function} unsubscribe
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Show a toast message with automatic deduplication
   * @param {string} message - Toast message
   * @param {'info' | 'error' | 'success'} [type='info'] - Toast category
   * @param {number} [duration=3500] - Display duration in ms (3-5s)
   * @returns {string | null} toastId
   */
  show(message, type = 'info', duration = 3500) {
    if (!message || typeof message !== 'string') return null;
    const cleanMsg = message.trim();
    if (!cleanMsg) return null;

    const now = Date.now();
    const lastTime = this.recentMessages.get(cleanMsg);

    // Deduplicate repeated identical messages within 3000ms window
    if (lastTime && (now - lastTime) < 3000) {
      return null;
    }
    this.recentMessages.set(cleanMsg, now);

    // Cleanup old deduplication entries after 6 seconds
    setTimeout(() => {
      if (this.recentMessages.get(cleanMsg) === now) {
        this.recentMessages.delete(cleanMsg);
      }
    }, 6000);

    const safeDuration = Math.max(2500, Math.min(5000, duration || 3500));
    const toast = {
      id: `toast_${now}_${Math.random().toString(36).substr(2, 6)}`,
      message: cleanMsg,
      type,
      duration: safeDuration,
      createdAt: now,
    };

    this.listeners.forEach((listener) => {
      try {
        listener({ action: 'show', toast });
      } catch (err) {
        console.warn('[ToastService] listener error:', err);
      }
    });

    return toast.id;
  }

  /**
   * Dismiss a specific toast by its unique ID
   * @param {string} id - toastId
   */
  dismiss(id) {
    if (!id) return;
    this.listeners.forEach((listener) => {
      try {
        listener({ action: 'dismiss', id });
      } catch (err) {
        console.warn('[ToastService] dismiss listener error:', err);
      }
    });
  }

  /**
   * Dismiss all active toasts
   */
  dismissAll() {
    this.listeners.forEach((listener) => {
      try {
        listener({ action: 'dismiss_all' });
      } catch (err) {
        console.warn('[ToastService] dismissAll listener error:', err);
      }
    });
  }
}

export const toastService = new ToastService();
export const showToast = (message, type, duration) => toastService.show(message, type, duration);
export const dismissToast = (id) => toastService.dismiss(id);

