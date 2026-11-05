export type LlmSettings = {
  baseUrl: string;
  defaultModel: string;
  credentialRef: string;
};
export const EMPTY_LLM_SETTINGS: LlmSettings = {
  baseUrl: "",
  defaultModel: "",
  credentialRef: "",
};

/** A configured API prefix is complete; only a host-only legacy URL gains /v1. */
export function normalizeLlmBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请输入有效的 HTTP(S) 接口基础地址。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "接口地址须为 HTTP(S) 地址，不可包含账号、密码、查询参数或片段。"
    );
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/(chat\/completions|models)$/.test(path))
    throw new Error(
      "请填写 API 基础地址，不要包含 /chat/completions 或 /models。"
    );
  return `${url.origin}${path || "/v1"}`;
}

export function normalizeLlmSettings(
  value: Record<string, unknown>
): LlmSettings {
  if (Object.keys(value).some(key => !Object.hasOwn(EMPTY_LLM_SETTINGS, key)))
    throw new Error(
      "模型服务仅保存接口地址、模型 ID 和凭据引用，请勿提交 API Key。"
    );
  for (const key of Object.keys(EMPTY_LLM_SETTINGS))
    if (typeof value[key] !== "string")
      throw new Error("模型服务配置格式无效。");
  const baseUrl = String(value.baseUrl).trim();
  const defaultModel = String(value.defaultModel).trim();
  const credentialRef = String(value.credentialRef).trim();
  if (baseUrl.length > 2048 || defaultModel.length > 200)
    throw new Error("接口地址最多 2048 个字符，模型 ID 最多 200 个字符。");
  if (defaultModel && /\s|[\u0000-\u001f]/.test(defaultModel))
    throw new Error("模型 ID 不可包含空白字符。");
  if (
    credentialRef &&
    !/^env:FLOW_SECRET_[A-Z0-9_]{2,128}$/.test(credentialRef)
  )
    throw new Error("凭据引用应为 env:FLOW_SECRET_ 开头的大写名称。");
  return {
    baseUrl: baseUrl ? normalizeLlmBaseUrl(baseUrl) : "",
    defaultModel,
    credentialRef,
  };
}
