import { describe, expect, it } from "vitest";
import { getJwtSecretConfigurationError } from "./env";

describe("生产 JWT 签名密钥配置", () => {
  it("拒绝缺失或短密钥", () => {
    expect(getJwtSecretConfigurationError(undefined, undefined)).toBe(
      "JWT_SECRET is required"
    );
    expect(getJwtSecretConfigurationError("short-secret", undefined)).toBe(
      "JWT_SECRET must contain at least 32 bytes"
    );
  });

  it("要求签名密钥至少 32 字节且不同于初始管理员口令", () => {
    const jwtSecret = "x".repeat(32);

    expect(getJwtSecretConfigurationError(jwtSecret, "admin-password")).toBe(
      null
    );
    expect(getJwtSecretConfigurationError(jwtSecret, jwtSecret)).toBe(
      "JWT_SECRET must differ from FLOW_BOOTSTRAP_ADMIN_PASSWORD"
    );
  });
});
