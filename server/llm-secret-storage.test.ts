import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), stat: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: mocks.read, lstatSync: mocks.stat }));
import {
  decryptLlmApiKey,
  encryptLlmApiKey,
  llmEncryptionReady,
} from "./llm-secret-storage";
beforeEach(() => {
  mocks.read.mockReset().mockImplementation(() => Buffer.alloc(32, 7));
  mocks.stat
    .mockReset()
    .mockReturnValue({ isFile: () => true, isSymbolicLink: () => false });
});
it("AES-GCM 可恢复调用 Key，随机 IV 避免重复密文，存储不含明文", () => {
  const a = encryptLlmApiKey(" synthetic-test-key "),
    b = encryptLlmApiKey("synthetic-test-key");
  expect(a).not.toEqual(b);
  expect(JSON.stringify(a)).not.toContain("synthetic-test-key");
  expect(decryptLlmApiKey(a)).toBe("synthetic-test-key");
});
it("错密钥、篡改和格式异常均拒绝，错误不包含 Key 或密文", () => {
  const value = encryptLlmApiKey("synthetic-test-key");
  mocks.read.mockImplementation(() => Buffer.alloc(32, 8));
  expect(() => decryptLlmApiKey(value)).toThrow("无法解密");
  mocks.read.mockImplementation(() => Buffer.alloc(32, 7));
  for (const patch of [
    { tag: Buffer.alloc(16).toString("base64") },
    { iv: "bad" },
    { version: 2 },
    { ciphertext: "" },
  ])
    expect(() => decryptLlmApiKey({ ...value, ...patch })).toThrow("无法解密");
});
it("缺少、非普通文件或长度错误的主密钥不可保存 Key", () => {
  mocks.read.mockImplementation(() => {
    throw new Error("private path");
  });
  expect(llmEncryptionReady()).toBe(false);
  expect(() => encryptLlmApiKey("test-key")).toThrow("加密存储尚未就绪");
  mocks.read.mockReturnValue(Buffer.alloc(31));
  expect(llmEncryptionReady()).toBe(false);
  mocks.stat.mockReturnValue({
    isFile: () => true,
    isSymbolicLink: () => true,
  });
  expect(llmEncryptionReady()).toBe(false);
});
it.each(["", "Bearer test-key", "test\r\nkey", "非ASCII密钥"])(
  "拒绝无效 Key",
  value => expect(() => encryptLlmApiKey(value)).toThrow("有效的 API Key")
);
