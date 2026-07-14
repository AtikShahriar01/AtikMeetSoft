/**
 * ============================================================
 *  AtikMeet - E2EE Security Module (Renderer Process)
 *  Provides basic AES-GCM encryption helper functions for E2EE meetings.
 * ============================================================
 */

class AtikMeetEncryption {
  constructor() {
    this.keyMaterial = null;
    this.aesKey = null;
    this.salt = "ATIKMEET-SALT-SECURE-KEY";
  }

  /**
   * Derives a cryptographic AES key from a human readable room password
   * @param {string} roomSecret - Secret key unique to meeting ID
   */
  async deriveKey(roomSecret) {
    try {
      const enc = new TextEncoder();
      const rawKey = enc.encode(roomSecret);
      
      // Import raw bytes
      const baseKey = await window.crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
      );

      // Derive key
      this.aesKey = await window.crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: enc.encode(this.salt),
          iterations: 100000,
          hash: "SHA-256"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      
      console.log("[E2EE] Cryptographic key successfully derived");
    } catch (err) {
      console.error("[E2EE] Key derivation failed:", err);
    }
  }

  /**
   * Encrypts a text payload using derived AES key
   * @param {string} text - Message text
   * @returns {ArrayBuffer} Encrypted raw buffer bytes
   */
  async encryptText(text) {
    if (!this.aesKey) return null;
    try {
      const enc = new TextEncoder();
      const encoded = enc.encode(text);
      const iv = window.crypto.getRandomValues(new Uint8Array(12)); // AES-GCM IV requirement

      const ciphertext = await window.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        this.aesKey,
        encoded
      );

      // Combine IV and Ciphertext
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(ciphertext), iv.length);
      return combined.buffer;
    } catch (err) {
      console.error("[E2EE] Encryption error:", err);
      return null;
    }
  }

  /**
   * Decrypts an encrypted buffer to original string
   * @param {ArrayBuffer} buffer - Combined IV + Ciphertext
   * @returns {string} Plain text message
   */
  async decryptText(buffer) {
    if (!this.aesKey) return null;
    try {
      const data = new Uint8Array(buffer);
      const iv = data.slice(0, 12);
      const ciphertext = data.slice(12);

      const decrypted = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        this.aesKey,
        ciphertext
      );

      const dec = new TextDecoder();
      return dec.decode(decrypted);
    } catch (err) {
      console.error("[E2EE] Decryption failed (invalid key or tampered content):", err);
      return null;
    }
  }
}

// Export global instance
window.atikEncryption = new AtikMeetEncryption();
