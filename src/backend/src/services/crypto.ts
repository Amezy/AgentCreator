import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Get the master key from environment variable or use a default dev key.
 * The key must be exactly 32 bytes (256 bits) for AES-256.
 */
function getMasterKey(): Buffer {
  const keyHex = process.env.SWT_MASTER_KEY;
  if (keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== 32) {
      throw new Error(
        `SWT_MASTER_KEY must be exactly 32 bytes (64 hex chars), got ${key.length} bytes`
      );
    }
    return key;
  }

  // Development fallback: generate a deterministic key from a passphrase
  console.warn(
    '[Crypto] WARNING: SWT_MASTER_KEY not set, using development default key. DO NOT use in production!'
  );
  return crypto.scryptSync('dev-default-key-do-not-use', 'salt', 32);
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns base64-encoded string in format: iv:encrypted:authTag
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Combine iv:encrypted:authTag and base64 encode
  const combined = `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
  return combined;
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 * Expects base64-encoded string in format: iv:encrypted:authTag
 */
export function decrypt(ciphertext: string): string {
  const key = getMasterKey();

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format. Expected iv:encrypted:authTag');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const encrypted = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
