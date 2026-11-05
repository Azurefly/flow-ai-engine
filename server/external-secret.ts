import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function resolveExternalSecret(secretRef: string) {
  if (!/^env:FLOW_SECRET_[A-Z0-9_]{2,128}$/.test(secretRef))
    throw new Error("SecretRef 不在允许的外部密钥命名空间内。");
  const envName = secretRef.slice("env:".length);
  const value = process.env[envName];
  if (value) return value;
  const secretDirectory = process.env.FLOW_SECRET_FILE_DIR;
  if (!secretDirectory) throw new Error(`SecretRef ${secretRef} 未配置。`);
  const secretPath = join(secretDirectory, envName);
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(secretPath);
  } catch {
    throw new Error(`SecretRef ${secretRef} 未配置或无法读取。`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile())
    throw new Error(`SecretRef ${secretRef} 必须指向普通密钥文件。`);
  let fileValue: string;
  try {
    fileValue = readFileSync(secretPath, "utf8");
  } catch {
    throw new Error(`SecretRef ${secretRef} 未配置或无法读取。`);
  }
  if (fileValue.endsWith("\r\n")) fileValue = fileValue.slice(0, -2);
  else if (fileValue.endsWith("\n")) fileValue = fileValue.slice(0, -1);
  if (!fileValue.trim()) throw new Error(`SecretRef ${secretRef} 未配置。`);
  return fileValue;
}
