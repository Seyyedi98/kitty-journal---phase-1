import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Debounced, serialised autosave.
 *
 * status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
 * "saved" is only ever set AFTER persist() resolved, i.e. after the local
 * database commit — never optimistically.
 *
 * - values:  current editor values (any JSON-serialisable object)
 * - persist: async (values) => void  — must throw/reject on failure
 * - baseline: signature considered already saved when the editor opens
 */
export function useAutosave({ active, values, persist, delay = 900 }) {
  const [status, setStatus] = useState('idle');
  const latest = useRef(values);
  const lastSaved = useRef(null);
  const timer = useRef(null);
  const chain = useRef(Promise.resolve());
  const persistRef = useRef(persist);
  const alive = useRef(true);

  latest.current = values;
  persistRef.current = persist;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const signature = JSON.stringify(values);

  // Reset the baseline whenever the editor (re)opens.
  const reset = useCallback((baseline) => {
    clearTimeout(timer.current);
    lastSaved.current = JSON.stringify(baseline);
    setStatus('idle');
  }, []);

  const writeNow = useCallback(() => {
    clearTimeout(timer.current);
    const snapshot = latest.current;
    const sig = JSON.stringify(snapshot);
    if (sig === lastSaved.current) return chain.current;
    // Serialise: a new write starts only after the previous one finished,
    // so out-of-order commits can never overwrite newer text with older text.
    chain.current = chain.current
      .catch(() => {})
      .then(async () => {
        if (alive.current) setStatus('saving');
        try {
          await persistRef.current(snapshot);
          lastSaved.current = sig;
          if (alive.current) {
            setStatus(JSON.stringify(latest.current) === sig ? 'saved' : 'dirty');
          }
        } catch (error) {
          if (alive.current) setStatus('error');
          throw error;
        }
      });
    return chain.current;
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    if (lastSaved.current === null || signature === lastSaved.current) return undefined;
    setStatus((s) => (s === 'saving' ? s : 'dirty'));
    timer.current = setTimeout(() => {
      writeNow().catch(() => {});
    }, delay);
    return () => clearTimeout(timer.current);
  }, [signature, active, delay, writeNow]);

  // Flush immediately when the app is sent to the background.
  useEffect(() => {
    if (!active) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') writeNow().catch(() => {});
    });
    return () => sub.remove();
  }, [active, writeNow]);

  /** Await all pending writes (used before closing the editor). */
  const flush = useCallback(async () => {
    await writeNow();
    await chain.current;
  }, [writeNow]);

  return { status, reset, flush, retry: writeNow };
}
