import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  EMPTY_LOCK_STATE,
  createPinRecord,
  isValidPin,
  onFailedAttempt,
  onSuccessfulAttempt,
  remainingLockMs,
  shouldRelock,
  verifyPin,
} from '../services/lock';
import { secure } from '../platform/secure';
import { authenticateBiometric, biometricsAvailable } from '../platform/biometrics';
import { loadSettings, saveSetting } from '../db/repository';

/**
 * App lock controller.
 *
 * `locked`  — the app content must be hidden behind the lock screen.
 * `ready`   — settings were read; until then the app shows its loading state
 *             (and, if a lock is configured, never flashes content).
 *
 * The PIN is never stored: only a salted PBKDF2 record in the secure store.
 * This is an access lock; it does not encrypt the database or photos.
 */
export function useAppLock(db) {
  const [config, setConfig] = useState({ enabled: false, biometric: false, relock: 'immediately' });
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(true); // fail closed until we know
  const [lockState, setLockState] = useState(EMPTY_LOCK_STATE);
  const [now, setNow] = useState(Date.now());
  const [bioAvailable, setBioAvailable] = useState(false);
  const backgroundedAt = useRef(null);
  // True while the app itself has opened a system screen (photo picker, share
  // sheet, permission dialog). Leaving for those must not trigger a re-lock.
  const externalRef = useRef(false);
  const configRef = useRef(config);
  const recordRef = useRef(null);
  configRef.current = config;

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await loadSettings(db);
        const record = await secure.getPinRecord();
        const state = (await secure.getLockState()) || EMPTY_LOCK_STATE;
        let enabled = settings.lockEnabled === true;
        if (enabled && !record) {
          // The secure store lost the PIN (e.g. keystore reset). Nothing can
          // verify the user, so the lock is switched off instead of trapping them.
          enabled = false;
          await saveSetting(db, 'lockEnabled', false).catch(() => {});
        }
        recordRef.current = record;
        const cfg = {
          enabled,
          biometric: enabled && settings.lockBiometric === true,
          relock: ['immediately', '1m', '5m'].includes(settings.lockRelock) ? settings.lockRelock : 'immediately',
        };
        if (cancelled) return;
        setConfig(cfg);
        setLockState(state);
        setLocked(enabled);
        setBioAvailable(await biometricsAvailable());
      } catch {
        if (!cancelled) setLocked(false);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  // Re-lock when returning from the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        if (externalRef.current) return;
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
        // Hide content immediately in the app switcher when a lock is on and
        // the delay is zero.
        if (configRef.current.enabled && configRef.current.relock === 'immediately') setLocked(true);
      } else if (state === 'active') {
        if (externalRef.current) {
          backgroundedAt.current = null;
          return;
        }
        const relock = shouldRelock({
          enabled: configRef.current.enabled,
          backgroundedAt: backgroundedAt.current,
          now: Date.now(),
          delay: configRef.current.relock,
        });
        backgroundedAt.current = null;
        // A short trip to the background within the grace period leaves the
        // current lock state untouched.
        if (relock) setLocked(true);
      }
    });
    return () => sub.remove();
  }, []);

  // Tick while a lockout countdown is visible.
  const remaining = remainingLockMs(lockState, now);
  useEffect(() => {
    if (remaining <= 0) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [remaining]);

  const persistState = useCallback(async (next) => {
    setLockState(next);
    try {
      await secure.setLockState(next);
    } catch {
      /* best effort: the in-memory state still applies for this run */
    }
  }, []);

  /** @returns {Promise<'ok'|'wrong'|'locked'|'error'>} */
  const tryPin = useCallback(
    async (pin) => {
      const t = Date.now();
      setNow(t);
      if (remainingLockMs(lockState, t) > 0) return 'locked';
      const record = recordRef.current || (await secure.getPinRecord());
      if (!record) return 'error';
      recordRef.current = record;
      if (verifyPin(pin, record)) {
        await persistState(onSuccessfulAttempt());
        setLocked(false);
        return 'ok';
      }
      const next = onFailedAttempt(lockState, t);
      await persistState(next);
      setNow(t);
      return remainingLockMs(next, t) > 0 ? 'locked' : 'wrong';
    },
    [lockState, persistState],
  );

  const tryBiometric = useCallback(
    async (prompt, cancelLabel) => {
      if (!configRef.current.biometric) return false;
      if (remainingLockMs(lockState, Date.now()) > 0) return false;
      const ok = await authenticateBiometric(prompt, cancelLabel);
      if (ok) {
        await persistState(onSuccessfulAttempt());
        setLocked(false);
      }
      return ok;
    },
    [lockState, persistState],
  );

  const updateConfig = useCallback(
    async (patch) => {
      const next = { ...configRef.current, ...patch };
      setConfig(next);
      await saveSetting(db, 'lockEnabled', next.enabled);
      await saveSetting(db, 'lockBiometric', next.biometric);
      await saveSetting(db, 'lockRelock', next.relock);
    },
    [db],
  );

  /** Turn the lock on with a new PIN. Throws on invalid PIN. */
  const enable = useCallback(
    async (pin) => {
      if (!isValidPin(pin)) throw new Error('invalid pin');
      const record = createPinRecord(pin, secure.randomBytes);
      await secure.setPinRecord(record);
      recordRef.current = record;
      await persistState(EMPTY_LOCK_STATE);
      await updateConfig({ enabled: true });
      setLocked(false);
    },
    [persistState, updateConfig],
  );

  /** Verify the current PIN without changing lock state (used before sensitive changes). */
  const confirmPin = useCallback(
    async (pin) => {
      const t = Date.now();
      if (remainingLockMs(lockState, t) > 0) return 'locked';
      const record = recordRef.current || (await secure.getPinRecord());
      if (record && verifyPin(pin, record)) {
        await persistState(onSuccessfulAttempt());
        return 'ok';
      }
      const next = onFailedAttempt(lockState, t);
      await persistState(next);
      setNow(t);
      return remainingLockMs(next, t) > 0 ? 'locked' : 'wrong';
    },
    [lockState, persistState],
  );

  const changePin = useCallback(async (newPin) => {
    if (!isValidPin(newPin)) throw new Error('invalid pin');
    const record = createPinRecord(newPin, secure.randomBytes);
    await secure.setPinRecord(record);
    recordRef.current = record;
  }, []);

  const disable = useCallback(async () => {
    await updateConfig({ enabled: false, biometric: false });
    await secure.clearPinRecord().catch(() => {});
    await secure.clearLockState().catch(() => {});
    recordRef.current = null;
    setLockState(EMPTY_LOCK_STATE);
    setLocked(false);
  }, [updateConfig]);

  /**
   * Wrap any call that opens a system screen (picker, share sheet, permission
   * prompt). The lock ignores the app leaving the foreground meanwhile.
   */
  const runExternal = useCallback(async (fn) => {
    externalRef.current = true;
    try {
      return await fn();
    } finally {
      // Clear after the foreground event for this return has been delivered.
      setTimeout(() => {
        externalRef.current = false;
        backgroundedAt.current = null;
      }, 700);
    }
  }, []);

  return {
    ready,
    runExternal,
    locked: ready ? locked && config.enabled : true,
    config,
    bioAvailable,
    lockedForMs: remaining,
    attempts: lockState.fails || 0,
    tryPin,
    tryBiometric,
    confirmPin,
    enable,
    changePin,
    disable,
    setBiometric: (value) => updateConfig({ biometric: Boolean(value) }),
    setRelock: (value) => updateConfig({ relock: value }),
  };
}
