import { describe, expect, it, beforeEach } from "vitest";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  loginRateLimitKey,
  recordLoginFailure,
  resetLoginRateLimitForTests,
} from "./_core/login-rate-limit";

describe("login rate limit", () => {
  beforeEach(() => resetLoginRateLimitForTests());

  it("locks an account and source pair after repeated failures", () => {
    const key = loginRateLimitKey("Admin", "203.0.113.10");
    for (let i = 0; i < 4; i += 1)
      expect(recordLoginFailure(key, 1000 + i).allowed).toBe(true);
    const locked = recordLoginFailure(key, 2000);
    expect(locked.allowed).toBe(false);
    expect(locked.retryAfterSeconds).toBe(30);
    expect(checkLoginRateLimit(key, 2000).allowed).toBe(false);

    for (let i = 0; i < 5; i += 1) recordLoginFailure(key, 32001 + i);
    expect(checkLoginRateLimit(key, 32005)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("expires the window and clears failures after successful login", () => {
    const key = loginRateLimitKey("user", "198.51.100.2");
    recordLoginFailure(key, 1000);
    expect(checkLoginRateLimit(key, 1000).allowed).toBe(true);
    expect(checkLoginRateLimit(key, 901001).allowed).toBe(true);
    recordLoginFailure(key, 2000);
    clearLoginFailures(key);
    expect(checkLoginRateLimit(key, 2000).allowed).toBe(true);
  });
});
