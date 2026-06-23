/**
 * Metadata for tracking individual Gemini API keys. 
 */
export interface KeyMetadata {
  key: string;
  isCoolingDown: boolean;
  coolDownUntil: number; // millisecond timestamp
  errorCount: number;
}

export class KeyManager {
  private keys: KeyMetadata[] = [];
  private lastUsedIndex: number = -1;

  constructor(rawKeys: string[]) {
    if (!rawKeys || rawKeys.length === 0) {
      throw new Error("KeyManager must be initialized with at least one API key.");
    }
    
    // Clean and de-duplicate keys
    const uniqueKeys = Array.from(new Set(rawKeys.map(k => k.trim()).filter(Boolean)));
    if (uniqueKeys.length === 0) {
      throw new Error("KeyManager initialized with empty or invalid API key strings.");
    }

    this.keys = uniqueKeys.map(key => ({
      key,
      isCoolingDown: false,
      coolDownUntil: 0,
      errorCount: 0
    }));
  }

  /**
   * Retrieves the next available key that is not in a cooldown state.
   * Walks through the array sequentially starting from the last used index.
   * Resets the cooldown status inline if the quarantine window has expired.
   */
  public getNextAvailableKey(): string {
    const totalKeys = this.keys.length;
    const now = Date.now();

    // Start scanning from the next element after the last used index
    for (let i = 0; i < totalKeys; i++) {
      const targetIndex = (this.lastUsedIndex + 1 + i) % totalKeys;
      const keyMeta = this.keys[targetIndex];

      // Check if the key's cooldown has expired
      if (keyMeta.isCoolingDown && now >= keyMeta.coolDownUntil) {
        keyMeta.isCoolingDown = false;
        keyMeta.coolDownUntil = 0;
        keyMeta.errorCount = 0;
      }

      // If it is not cooling down, lease it
      if (!keyMeta.isCoolingDown) {
        this.lastUsedIndex = targetIndex;
        return keyMeta.key;
      }
    }

    // If we completed the loop and found no available keys, error out
    throw new Error("All Gemini API keys in the pool are currently cooling down due to rate limits.");
  }

  /**
   * Flags a key as rate-limited, forcing a 60,000ms cooldown window.
   */
  public flagRateLimited(keyString: string): void {
    const keyMeta = this.keys.find(k => k.key === keyString);
    if (!keyMeta) {
      return; // Key not tracked by this manager
    }

    keyMeta.isCoolingDown = true;
    keyMeta.coolDownUntil = Date.now() + 60000; // 60 seconds quarantine
    keyMeta.errorCount++;
  }

  /**
   * Returns current statistics/status for all tracked keys (useful for monitoring/debugging).
   */
  public getStatus(): KeyMetadata[] {
    // Return a copy to prevent external mutation
    return this.keys.map(k => ({ ...k }));
  }
}
