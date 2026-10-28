// Secure storage + CSPRNG for the app lock. Values live in the Android
// Keystore-backed secure store, never in SQLite or in a backup.
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const PIN_KEY = 'kj.pin.v1';
const STATE_KEY = 'kj.lockstate.v1';

async function getJson(key) {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const secure = {
  randomBytes: (n) => Crypto.getRandomBytes(n),
  getPinRecord: () => getJson(PIN_KEY),
  setPinRecord: (rec) => SecureStore.setItemAsync(PIN_KEY, JSON.stringify(rec)),
  clearPinRecord: () => SecureStore.deleteItemAsync(PIN_KEY),
  getLockState: () => getJson(STATE_KEY),
  setLockState: (state) => SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state)),
  clearLockState: () => SecureStore.deleteItemAsync(STATE_KEY),
};
