import type { RowDataPacket } from "mysql2/promise";
import { ENV } from "./_core/env";
import { getSharedPool } from "./db";
import { resolveExternalSecret } from "./external-secret";
import {
  EMPTY_LLM_SETTINGS,
  normalizeLlmBaseUrl,
  normalizeLlmSettings,
} from "../shared/llm-settings";
import { systemSettingConfigToken } from "./system-setting-config";

export type LlmConnection = {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
};

async function readConfiguration() {
  if (!process.env.DATABASE_URL) return { ...EMPTY_LLM_SETTINGS };
  let rows: RowDataPacket[];
  try {
    [rows] = await getSharedPool().query<RowDataPacket[]>(
      "SELECT valueJson FROM system_setting WHERE `key`='llm'"
    );
  } catch {
    throw new Error("无法读取模型服务配置，请稍后重试。");
  }
  const raw = rows[0]?.valueJson;
  return normalizeLlmSettings({
    ...EMPTY_LLM_SETTINGS,
    ...(typeof raw === "string" ? JSON.parse(raw) : raw),
  });
}

/** Snapshot a connection per operation; never mutate ENV or expose the resolved key. */
export async function getLlmConfiguration() {
  const settings = await readConfiguration();
  const baseUrl = normalizeLlmBaseUrl(
    settings.baseUrl || ENV.llmApiUrl.trim() || "https://api.openai.com"
  );
  let apiKey = "",
    message = "";
  try {
    apiKey = settings.credentialRef
      ? resolveExternalSecret(settings.credentialRef)
      : ENV.llmApiKey;
  } catch (error) {
    message = error instanceof Error ? error.message : "无法读取服务器凭据。";
  }
  const configured = Boolean(apiKey?.trim());
  return {
    connection: { baseUrl, apiKey, defaultModel: settings.defaultModel },
    configToken: systemSettingConfigToken("llm", settings),
    status: {
      baseUrl,
      defaultModel: settings.defaultModel,
      credentialRef: settings.credentialRef,
      configured,
      message:
        message ||
        (configured
          ? "凭据已就绪，尚需测试模型调用。"
          : "未配置可用凭据，请在服务器配置 API Key。"),
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
  return (apiKey ? message.split(apiKey).join("[凭据已隐藏]") : message).slice(
    0,
    2000
  );
}
