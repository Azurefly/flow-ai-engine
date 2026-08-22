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

const clean = (value: unknown, fallback = "") => typeof value === "string" ? value.trim() : fallback;
const allowedRole = (value: unknown): "user" | "admin" => value === "admin" ? "admin" : "user";

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