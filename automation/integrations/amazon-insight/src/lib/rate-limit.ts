type Bucket = {
  attempts: number[];
};

const globalStore = globalThis as unknown as {
  __measuremanRateLimits?: Map<string, Bucket>;
};

function store() {
  if (!globalStore.__measuremanRateLimits) {
    globalStore.__measuremanRateLimits = new Map();
  }
  return globalStore.__measuremanRateLimits;
}

export function checkRateLimit(
  key: string,
  options: { maxAttempts?: number; windowMs?: number; now?: number } = {},
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const maxAttempts = options.maxAttempts ?? 10;
  const windowMs = options.windowMs ?? 15 * 60_000;
  const now = options.now ?? Date.now();
  const cutoff = now - windowMs;
  const map = store();
  const existing = map.get(key);
  const attempts = existing ? existing.attempts.filter((ts) => ts > cutoff) : [];

  if (attempts.length >= maxAttempts) {
    map.set(key, { attempts });
    const oldest = attempts[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  attempts.push(now);
  map.set(key, { attempts });
  return { allowed: true, remaining: Math.max(0, maxAttempts - attempts.length), retryAfterSec: 0 };
}

export function resetRateLimit(key: string) {
  store().delete(key);
}

export function clearAllRateLimits() {
  store().clear();
}
