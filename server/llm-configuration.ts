import { decryptLlmApiKey, llmEncryptionReady } from "./llm-secret-storage";
import type { RowDataPacket } from "mysql2/promise";
import { ENV } from "./_core/env";
import { getSharedPool } from "./db";
import { resolveExternalSecret } from "./external-secret";
import {
  EMPTY_LLM_SETTINGS,
  normalizeLlmBaseUrl,
  normalizeLlmSettings,
} from "../shared/llm-settings";
import {
  publicSystemSettingValue,
  readSystemSettingValue,
  systemSettingConfigToken,
} from "./system-setting-config";

export type LlmConnection = {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
};

async function readConfiguration() {
  if (!process.env.DATABASE_URL)
    return { ...EMPTY_LLM_SETTINGS } as Record<string, unknown>;
  let rows: RowDataPacket[];
  try {
    [rows] = await getSharedPool().query<RowDataPacket[]>(
      "SELECT valueJson FROM system_setting WHERE `key`='llm'"
    );
  } catch {
    throw new Error("无法读取模型服务配置，请稍后重试。");
  }
  const raw = rows[0]?.valueJson;
  return readSystemSettingValue(
    "llm",
    typeof raw === "string" ? JSON.parse(raw) : raw
  );
}

/** Snapshot a connection per operation; never mutate ENV or expose the resolved key. */
export async function getLlmConfiguration() {
  const stored = await readConfiguration();
  const settings = normalizeLlmSettings(
    publicSystemSettingValue("llm", stored)
  );
  const hasStoredKey = Boolean(stored.encryptedApiKey);
  const baseUrl = normalizeLlmBaseUrl(
    settings.baseUrl || ENV.llmApiUrl.trim() || "https://api.openai.com"
  );
  let apiKey = "",
    message = "";
  try {
    apiKey = settings.credentialRef
      ? resolveExternalSecret(settings.credentialRef)
      : hasStoredKey
        ? decryptLlmApiKey(stored.encryptedApiKey)
        : ENV.llmApiKey;
  } catch (error) {
    message = error instanceof Error ? error.message : "无法读取服务器凭据。";
  }
  const configured = Boolean(apiKey?.trim());
  return {
    connection: { baseUrl, apiKey, defaultModel: settings.defaultModel },
    configToken: systemSettingConfigToken("llm", stored),
    status: {
      baseUrl,
      hasStoredKey,
      encryptionReady: llmEncryptionReady(),
      defaultModel: settings.defaultModel,
      credentialRef: settings.credentialRef,
      configured,
      message:
        message ||
        (configured
          ? settings.credentialRef
            ? "服务器凭据引用已就绪，尚需测试调用。"
            : hasStoredKey
              ? "网页 API Key 已配置，尚需测试调用。"
              : "服务器环境凭据已就绪，尚需测试调用。"
          : "尚未配置 API Key，请填写并保存。"),
      source: settings.baseUrl ? "系统配置" : "服务器环境变量 / 默认地址",
    },
  };
}

export async function resolveLlmConnection(): Promise<LlmConnection> {
  const { connection, status } = await getLlmConfiguration();
  if (!status.configured) throw new Error(status.message);
  return connection;
}

export async function getLlmServiceStatus() {
  return (await getLlmConfiguration()).status;
}

export function redactLlmError(error: unknown, apiKey: string) {
  const message = error instanceof Error ? error.message : "模型服务请求失败。";
  let safe = message;
  if (apiKey)
    for (const value of Array.from(
      new Set([
        apiKey,
        JSON.stringify(apiKey).slice(1, -1),
        encodeURIComponent(apiKey),
      ])
    ))
      safe = safe.split(value).join("[凭据已隐藏]");
  return safe.slice(0, 2000);
}
