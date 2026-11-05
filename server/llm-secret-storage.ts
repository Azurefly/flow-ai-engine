import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const aad = Buffer.from("flow-ai-engine:llm-api-key:v1");
type Envelope = { version: 1; iv: string; tag: string; ciphertext: string };
export type LlmCredentialChange =
  | { action: "replace"; apiKey: string }
  | { action: "clear" };

function masterKey() {
  const path =
    process.env.FLOW_LLM_ENCRYPTION_KEY_FILE ||
    join(
      process.env.FLOW_SECRET_FILE_DIR || "/run/flow-secrets",
      ".llm-master-key"
    );
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    const key = readFileSync(path);
    if (key.length !== 32) throw new Error();
    return key;
  } catch {
    throw new Error("服务器加密存储尚未就绪，请联系维护人员配置加密密钥。");
  }
}

export function llmEncryptionReady() {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptLlmApiKey(value: string): Envelope {
  const apiKey = value.trim();
  if (!apiKey || apiKey.length > 8192 || !/^[\x21-\x7e]+$/.test(apiKey))
    throw new Error("请填写有效的 API Key，不要包含空白字符或 Bearer 前缀。");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptLlmApiKey(value: unknown) {
  const key = masterKey();
  try {
    const envelope = value as Envelope;
    if (envelope?.version !== 1) throw new Error();
    const decode = (input: string) => {
      if (typeof input !== "string" || input.length > 12000) throw new Error();
      const bytes = Buffer.from(input, "base64");
      if (bytes.toString("base64") !== input) throw new Error();
      return bytes;
    };
    const iv = decode(envelope.iv),
      tag = decode(envelope.tag),
      encrypted = decode(envelope.ciphertext);
    if (iv.length !== 12 || tag.length !== 16 || !encrypted.length)
      throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "已保存的模型 Key 无法解密，请检查服务器加密密钥或重新填写 Key。"
    );
  }
}
