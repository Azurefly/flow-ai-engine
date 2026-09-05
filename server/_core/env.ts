export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  llmApiUrl:
    process.env.OPENAI_BASE_URL ?? process.env.BUILT_IN_FORGE_API_URL ?? "",
  llmApiKey:
    process.env.OPENAI_API_KEY ?? process.env.BUILT_IN_FORGE_API_KEY ?? "",
  llmModelPricingJson: process.env.LLM_MODEL_PRICING_JSON ?? "",
};

export function validateEnv() {
  const missing: string[] = [];
  if (ENV.isProduction) {
    if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
    if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  }
  if (missing.length > 0) {
    throw new Error(`[ENV] 生产环境缺少必要环境变量: ${missing.join(", ")}`);
  }
}
