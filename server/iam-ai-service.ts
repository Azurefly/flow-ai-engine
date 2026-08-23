import { invokeLLM, listLLMModels } from "./_core/llm";

export type UserCreationInput = {
  username?: string;
  name: string;
  email?: string;
  role: "user" | "admin";
  organizationHint?: string;
  managerHint?: string;
};

export type UserCreationPreview = {
  username: string;
  displayName: string;
  email?: string;
  role: "user" | "admin";
  organizationSuggestion?: string;
  managerSuggestion?: string;
  rationale: string;
  requiresConfirmation: true;
  generatedBy: "ai" | "fallback";
};

export type UserBatchPreviewInput = { goal: string; maxUsers: number; defaultRole: "user" | "admin" };
export type UserBatchPreview = { goal: string; users: UserCreationPreview[]; requiresConfirmation: true; generatedBy: "ai" | "fallback" };

const clean = (value: unknown, fallback = "") => typeof value === "string" ? value.trim() : fallback;
const allowedRole = (value: unknown): "user" | "admin" => value === "admin" ? "admin" : "user";
function normalizeUsername(value: unknown, fallback: string) {
  let username = clean(value).toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!/^[a-z]/.test(username)) username = `user_${username}`;
  username = username.slice(0, 64);
  return username.length >= 3 ? username : fallback;
}

function fallbackPreview(input: UserCreationInput): UserCreationPreview {
  const displayName = clean(input.name, "未命名用户");
  const username = clean(input.username).toLowerCase().replace(/[^a-z0-9._-]/g, "") || ("user_" + Date.now().toString(36));
  return {
    username,
    displayName,
    ...(clean(input.email) ? { email: clean(input.email) } : {}),
    role: allowedRole(input.role),
    ...(clean(input.organizationHint) ? { organizationSuggestion: clean(input.organizationHint) } : {}),
    ...(clean(input.managerHint) ? { managerSuggestion: clean(input.managerHint) } : {}),
    rationale: "根据管理员输入生成的安全预览；确认后才会创建账号。",
    requiresConfirmation: true,
    generatedBy: "fallback",
  };
}

function parsePreview(content: unknown, input: UserCreationInput): UserCreationPreview | null {
  let parsed: unknown = content;
  if (Array.isArray(content)) parsed = content.map(item => (item && typeof item === "object" && "text" in item ? (item as { text?: unknown }).text : "")).join("");
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  const username = clean(value.username).toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const displayName = clean(value.displayName ?? value.name, input.name);
  if (!username || !displayName) return null;
  return {
    username,
    displayName,
    ...(clean(value.email ?? input.email) ? { email: clean(value.email ?? input.email) } : {}),
    role: allowedRole(value.role ?? input.role),
    ...(clean(value.organizationSuggestion ?? input.organizationHint) ? { organizationSuggestion: clean(value.organizationSuggestion ?? input.organizationHint) } : {}),
    ...(clean(value.managerSuggestion ?? input.managerHint) ? { managerSuggestion: clean(value.managerSuggestion ?? input.managerHint) } : {}),
    rationale: clean(value.rationale, "AI 根据管理员输入生成账号预览。"),
    requiresConfirmation: true,
    generatedBy: "ai",
  };
}

export async function previewUserCreation(input: UserCreationInput): Promise<UserCreationPreview> {
  const fallback = fallbackPreview(input);
  try {
    const models = await listLLMModels();
    const model = models.data?.[0]?.id;
    const result = await invokeLLM({
      model,
      messages: [
        { role: "system", content: "你是企业 IAM 助手。只生成账号创建预览，不创建账号，不生成密码，不改变管理员指定的角色。输出 JSON。" },
        { role: "user", content: JSON.stringify({ username: input.username ?? "", name: input.name, email: input.email ?? "", role: input.role, organizationHint: input.organizationHint ?? "", managerHint: input.managerHint ?? "" }) },
      ],
      maxTokens: 400,
      outputSchema: {
        name: "user_creation_preview",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            username: { type: "string" },
            displayName: { type: "string" },
            email: { type: "string" },
            role: { type: "string", enum: ["user", "admin"] },
            organizationSuggestion: { type: "string" },
            managerSuggestion: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["username", "displayName", "role", "rationale"],
        },
      },
    });
    const content = result.choices?.[0]?.message?.content;
    return parsePreview(content, input) ?? fallback;
  } catch {
    return fallback;
  }
}

function fallbackBatchPreview(input: UserBatchPreviewInput): UserBatchPreview {
  const requested = input.goal.match(/(\d{1,2})\s*(?:个|名|位|条|人)/)?.[1];
  const count = Math.min(input.maxUsers, Math.max(1, Number(requested || 1)));
  const seed = Date.now().toString(36);
  const label = clean(input.goal).slice(0, 36) || "批量用户";
  return { goal: input.goal, users: Array.from({ length: count }, (_, index) => ({ username: `user_${seed}_${index + 1}`, displayName: `${label} ${index + 1}`, role: input.defaultRole, rationale: "运行时模型不可用，已生成可编辑的安全回退预览。", requiresConfirmation: true, generatedBy: "fallback" })), requiresConfirmation: true, generatedBy: "fallback" };
}

function parseBatchPreview(content: unknown, input: UserBatchPreviewInput): UserBatchPreview | null {
  let parsed: unknown = content;
  if (Array.isArray(content)) parsed = content.map(item => (item && typeof item === "object" && "text" in item ? (item as { text?: unknown }).text : "")).join("");
  if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { return null; } }
  if (!parsed || typeof parsed !== "object") return null;
  const candidates = (parsed as { users?: unknown }).users;
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const seen = new Set<string>();
  const seed = Date.now().toString(36);
  const users = candidates.slice(0, input.maxUsers).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const value = candidate as Record<string, unknown>;
    let username = normalizeUsername(value.username, `user_${seed}_${index + 1}`);
    if (seen.has(username)) username = `${username.slice(0, 59)}_${index + 1}`;
    seen.add(username);
    const displayName = clean(value.displayName ?? value.name, `用户 ${index + 1}`);
    const email = clean(value.email);
    return [{ username, displayName: displayName.slice(0, 160), ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email: email.slice(0, 320) } : {}), role: input.defaultRole, ...(clean(value.organizationSuggestion) ? { organizationSuggestion: clean(value.organizationSuggestion).slice(0, 160) } : {}), ...(clean(value.managerSuggestion) ? { managerSuggestion: clean(value.managerSuggestion).slice(0, 160) } : {}), rationale: clean(value.rationale, "AI 根据批量创建目标生成账号预览。").slice(0, 500), requiresConfirmation: true as const, generatedBy: "ai" as const }];
  });
  return users.length ? { goal: input.goal, users, requiresConfirmation: true, generatedBy: "ai" } : null;
}

export async function previewUserBatch(input: UserBatchPreviewInput): Promise<UserBatchPreview> {
  const fallback = fallbackBatchPreview(input);
  try {
    const models = await listLLMModels();
    const model = models.data?.[0]?.id;
    const result = await invokeLLM({
      model,
      messages: [
        { role: "system", content: "你是企业 IAM 批量建账助手。根据目标生成用户账号预览列表；只输出非敏感元数据，不生成或接收密码，不创建账号，不提升管理员指定的默认角色。输出 JSON。" },
        { role: "user", content: JSON.stringify(input) },
      ],
      maxTokens: 1800,
      outputSchema: { name: "user_batch_creation_preview", strict: true, schema: { type: "object", additionalProperties: false, properties: { users: { type: "array", minItems: 1, maxItems: input.maxUsers, items: { type: "object", additionalProperties: false, properties: { username: { type: "string" }, displayName: { type: "string" }, email: { type: "string" }, organizationSuggestion: { type: "string" }, managerSuggestion: { type: "string" }, rationale: { type: "string" } }, required: ["username", "displayName", "rationale"] } } }, required: ["users"] } },
    });
    return parseBatchPreview(result.choices?.[0]?.message?.content, input) ?? fallback;
  } catch { return fallback; }
}
