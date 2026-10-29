import crypto from "node:crypto";

// Authenticated encryption for user-provided API keys (BYOK), AES-256-GCM.
// The master key lives ONLY in the server env var BYOK_ENCRYPTION_KEY (never in
// the database, never in a NEXT_PUBLIC_* var, never returned to the browser).
// If it is absent or malformed, encryption is treated as UNCONFIGURED and
// callers must fail safe (never store plaintext).

const ALG = "aes-256-gcm";

/** Returns the 32-byte key, or null if BYOK_ENCRYPTION_KEY is missing/invalid.
 *  Accepts a 64-char hex string or a base64 string that decodes to 32 bytes. */
function keyBytes(): Buffer | null {
  const raw = (process.env.BYOK_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
  else {
    try { buf = Buffer.from(raw, "base64"); } catch { return null; }
  }
  return buf.length === 32 ? buf : null;
}

export function encryptionConfigured(): boolean {
  return keyBytes() !== null;
}

export interface SealedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

export function encryptSecret(plaintext: string): SealedSecret {
  const key = keyBytes();
  if (!key) throw new Error("BYOK_ENCRYPTION_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: enc.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") };
}

export function decryptSecret(sealed: SealedSecret): string {
  const key = keyBytes();
  if (!key) throw new Error("BYOK_ENCRYPTION_KEY is not configured");
  const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

/** Last 4 chars, for a masked "Configured ••••abcd" status. Never the full key. */
export function last4(secret: string): string {
  return secret.length <= 4 ? "••••" : secret.slice(-4);
}
