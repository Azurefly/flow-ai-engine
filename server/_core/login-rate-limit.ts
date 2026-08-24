type FailureWindow = {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
  lockLevel: number;
  lastFailureAt: number;
};

const WINDOW_MS = 15 * 60 * 1000;
const BASE_LOCK_MS = 30 * 1000;
const MAX_LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, FailureWindow>();

function normalizeKey(value: string) {
  return value.trim().toLowerCase().slice(0, 160);
}

function now() {
  return Date.now();
}

function get(key: string, at: number) {
  const current = failures.get(key);
  if (!current) return null;
  if (current.lockedUntil > at) return current;
  if (at - current.firstFailureAt > WINDOW_MS)
    return { ...current, failures: 0, firstFailureAt: at, lockedUntil: 0 };
  return current;
}

export function loginRateLimitKey(username: string, ip: string) {
  return `${normalizeKey(username)}|${normalizeKey(ip || "unknown")}`;
}

export function checkLoginRateLimit(key: string, at = now()) {
  const current = get(key, at);
  if (!current || current.lockedUntil <= at) return { allowed: true as const };
  return {
    allowed: false as const,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((current.lockedUntil - at) / 1000)
    ),
  };
}

export function recordLoginFailure(key: string, at = now()) {
  const current = get(key, at);
  const next =
    current && at - current.firstFailureAt <= WINDOW_MS
      ? { ...current, failures: current.failures + 1 }
      : {
          failures: 1,
          firstFailureAt: at,
          lockedUntil: 0,
          lockLevel: 0,
          lastFailureAt: at,
        };
  next.lastFailureAt = at;
  if (next.failures >= MAX_FAILURES) {
    next.lockLevel += 1;
    next.failures = 0;
    next.firstFailureAt = at;
    next.lockedUntil =
      at + Math.min(BASE_LOCK_MS * 2 ** (next.lockLevel - 1), MAX_LOCK_MS);
  }
  failures.set(key, next);
  return checkLoginRateLimit(key, at);
}

export function clearLoginFailures(key: string) {
  failures.delete(key);
}

export function resetLoginRateLimitForTests() {
  failures.clear();
}
