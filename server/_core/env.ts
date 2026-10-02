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

export function getJwtSecretConfigurationError(
  jwtSecret: string | undefined,
  bootstrapAdminPassword: string | undefined
) {
  if (!jwtSecret) return "JWT_SECRET is required";
  if (Buffer.byteLength(jwtSecret, "utf8") < 32) {
    return "JWT_SECRET must contain at least 32 bytes";
  }
  if (jwtSecret === bootstrapAdminPassword) {
    return "JWT_SECRET must differ from FLOW_BOOTSTRAP_ADMIN_PASSWORD";
  }
  return null;
}

export function validateEnv() {
  const missing: string[] = [];
  const invalid: string[] = [];
  if (ENV.isProduction) {
    const jwtSecretError = getJwtSecretConfigurationError(
      process.env.JWT_SECRET,
      process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD
    );
    if (jwtSecretError === "JWT_SECRET is required") {
      missing.push("JWT_SECRET");
    } else if (jwtSecretError) {
      invalid.push(jwtSecretError);
    }
    if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  }
  if (missing.length > 0) {
    throw new Error(`[ENV] 生产环境缺少必要环境变量: ${missing.join(", ")}`);
  }
  if (invalid.length > 0) {
    throw new Error(`[ENV] 生产环境密钥配置无效: ${invalid.join(", ")}`);
  }
}
