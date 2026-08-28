function decodeStorageEncryptionKey(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return Uint8Array.from(normalized.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
  }
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9+/_=-]+$/.test(normalized)) return null;
  try {
    const base64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = atob(padded);
    if (decoded.length !== 32) return null;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function storageEncryptionSelfTest(value: unknown): Promise<boolean> {
  const keyBytes = decodeStorageEncryptionKey(value);
  if (!keyBytes || keyBytes.byteLength !== 32) return false;
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode("portal-storage-contract-v1");
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted));
    return decrypted.length === plaintext.length
      && decrypted.every((valueAtIndex, index) => valueAtIndex === plaintext[index]);
  } catch {
    return false;
  }
}
