// App-lock logic (spec section 15). Pure functions only; secure storage,
// randomness and biometrics are injected / live in src/platform.
//
// What this is — and is not:
//   * The PIN is never stored. Only {salt, PBKDF2-HMAC-SHA256 hash} is kept,
//     and only in the platform secure store (Android Keystore backed).
//   * Failed attempts escalate to timed lockouts that survive app restarts.
//   * This is an ACCESS lock for the app interface. It does NOT encrypt the
//     SQLite database or the photo files at rest, and the UI must not claim so.

/* --------------------- SHA-256 / HMAC / PBKDF2 (pure JS) --------------------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const INIT = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Uint32Array(64);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** Process one 64-byte block (given as bytes) into state H (Uint32Array(8)). */
function compress(H, block) {
  for (let i = 0; i < 16; i++) {
    const j = i * 4;
    W[i] = ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
    const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
  }
  let [a, b, c, d, e, f, g, h] = H;
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
  H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
}

function stateToBytes(H) {
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 255;
    out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255;
  }
  return out;
}

/** Final block(s) for a message tail: `tail` bytes + 0x80 + zeros + bit length. */
function finish(H, tail, totalBytes) {
  const padded = tail.length + 1 + 8 <= 64 ? 64 : 128;
  const buf = new Uint8Array(padded);
  buf.set(tail);
  buf[tail.length] = 0x80;
  const bits = totalBytes * 8;
  const hi = Math.floor(bits / 0x100000000);
  const lo = bits >>> 0;
  buf[padded - 8] = hi >>> 24; buf[padded - 7] = (hi >>> 16) & 255; buf[padded - 6] = (hi >>> 8) & 255; buf[padded - 5] = hi & 255;
  buf[padded - 4] = lo >>> 24; buf[padded - 3] = (lo >>> 16) & 255; buf[padded - 2] = (lo >>> 8) & 255; buf[padded - 1] = lo & 255;
  for (let o = 0; o < padded; o += 64) compress(H, buf.subarray(o, o + 64));
  return stateToBytes(H);
}

export function sha256(bytes) {
  const H = Uint32Array.from(INIT);
  const full = bytes.length - (bytes.length % 64);
  for (let o = 0; o < full; o += 64) compress(H, bytes.subarray(o, o + 64));
  return finish(H, bytes.subarray(full), bytes.length);
}

/**
 * PBKDF2-HMAC-SHA256, one 32-byte block. Uses precomputed HMAC key states so
 * each iteration costs two compressions. `password` must be <= 64 bytes
 * (a numeric PIN always is).
 */
export function pbkdf2Sha256(password, salt, iterations) {
  if (password.length > 64) throw new Error('password too long');
  const ipad = new Uint8Array(64).fill(0x36);
  const opad = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < password.length; i++) { ipad[i] ^= password[i]; opad[i] ^= password[i]; }
  const Hi = Uint32Array.from(INIT); compress(Hi, ipad);
  const Ho = Uint32Array.from(INIT); compress(Ho, opad);

  const hmac = (msg) => {
    const inner = finish(Uint32Array.from(Hi), msg, 64 + msg.length);
    return finish(Uint32Array.from(Ho), inner, 64 + 32);
  };

  const first = new Uint8Array(salt.length + 4);
  first.set(salt);
  first[salt.length + 3] = 1;
  let u = hmac(first);
  const t = Uint8Array.from(u);
  for (let i = 1; i < iterations; i++) {
    u = hmac(u);
    for (let j = 0; j < 32; j++) t[j] ^= u[j];
  }
  return t;
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
const asciiBytes = (s) => Uint8Array.from(String(s), (ch) => ch.charCodeAt(0) & 0xff);

/* --------------------------------- PIN --------------------------------- */

export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const PBKDF2_ITERATIONS = 10000;

export const isValidPin = (pin) => /^\d+$/.test(String(pin)) && String(pin).length >= PIN_MIN && String(pin).length <= PIN_MAX;

/** @param randomBytes (n) => Uint8Array from a CSPRNG (expo-crypto) */
export function createPinRecord(pin, randomBytes, iterations = PBKDF2_ITERATIONS) {
  if (!isValidPin(pin)) throw new Error('invalid pin');
  const salt = randomBytes(16);
  if (!salt || salt.length !== 16) throw new Error('bad salt');
  const hash = pbkdf2Sha256(asciiBytes(pin), salt, iterations);
  return { v: 1, kdf: 'pbkdf2-sha256', iterations, salt: toHex(salt), hash: toHex(hash) };
}

/** Constant-time comparison of hex strings of equal length. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyPin(pin, record) {
  if (!record || record.v !== 1 || record.kdf !== 'pbkdf2-sha256' || !isValidPin(pin)) return false;
  if (!/^[0-9a-f]{32}$/.test(record.salt) || !/^[0-9a-f]{64}$/.test(record.hash)) return false;
  const hash = pbkdf2Sha256(asciiBytes(pin), fromHex(record.salt), record.iterations);
  return safeEqual(toHex(hash), record.hash);
}

/* ------------------------------- lockout ------------------------------- */

export const FREE_ATTEMPTS = 4;
export const EMPTY_LOCK_STATE = { fails: 0, lockedUntil: 0, lastAttempt: 0 };

/** 0 for the first FREE_ATTEMPTS failures, then 30s doubling, capped at 15 min. */
export function lockoutMs(fails) {
  if (fails <= FREE_ATTEMPTS) return 0;
  return Math.min(30000 * 2 ** (fails - FREE_ATTEMPTS - 1), 15 * 60000);
}

export function onFailedAttempt(state, now) {
  const fails = (state.fails || 0) + 1;
  return { fails, lockedUntil: now + lockoutMs(fails), lastAttempt: now };
}

export const onSuccessfulAttempt = () => ({ ...EMPTY_LOCK_STATE });

/**
 * Milliseconds still to wait. If the device clock was moved backwards since the
 * last attempt, the full penalty is applied instead of trusting the clock.
 */
export function remainingLockMs(state, now) {
  if (!state || !state.lockedUntil) return 0;
  if (now < (state.lastAttempt || 0)) return lockoutMs(state.fails || 0);
  return Math.max(0, state.lockedUntil - now);
}

/* ---------------------------- relock policy ---------------------------- */

export const RELOCK_DELAYS = { immediately: 0, '1m': 60000, '5m': 300000 };

/** Should the app lock when it returns to the foreground? */
export function shouldRelock({ enabled, backgroundedAt, now, delay }) {
  if (!enabled) return false;
  if (backgroundedAt == null) return false;
  const ms = RELOCK_DELAYS[delay] ?? 0;
  if (now < backgroundedAt) return true; // clock went backwards: fail closed
  return now - backgroundedAt >= ms;
}
