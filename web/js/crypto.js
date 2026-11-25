// Decrypts files produced by garmin_sync/crypto_box.py (PBKDF2-SHA256 → AES-256-GCM).
// Shared by the Garmin and Apple (Reminders/Calendar) cards.
import { store } from "./util.js";

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const getPassphrase = () => store.get("garmin.passphrase", "");
export const setPassphrase = (p) => (p ? store.set("garmin.passphrase", p) : store.del("garmin.passphrase"));

export async function decrypt(payload, passphrase) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64(payload.salt), iterations: payload.iter || 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(payload.iv) }, key, b64(payload.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * Fetch an encrypted data file and decrypt it with the saved passphrase.
 * Returns { data, stale? } or { needsPassphrase, error? } or { error, missing }.
 */
export async function loadEncrypted(url, cacheKey) {
  let payload;
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("not found");
    payload = await res.json();
  } catch {
    const cached = store.get(cacheKey, null);
    return cached ? { data: cached, stale: true } : { error: "Nothing published yet.", missing: true };
  }
  if (!payload.ct) {
    store.set(cacheKey, payload);
    return { data: payload };
  }
  const pass = getPassphrase();
  if (!pass) return { needsPassphrase: true };
  try {
    const data = await decrypt(payload, pass);
    store.set(cacheKey, data);
    return { data };
  } catch {
    return { needsPassphrase: true, error: "That passphrase didn't unlock your data." };
  }
}
