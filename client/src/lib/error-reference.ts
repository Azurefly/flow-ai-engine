export type ErrorDetails = Pick<Error, "name" | "message" | "stack">;

/**
 * Creates a short, deterministic identifier that can be copied to support
 * tickets without exposing the error message or stack in the UI.
 */
export function createErrorReference(
  error: ErrorDetails | null | undefined
): string {
  const source = `${error?.name ?? "Error"}:${error?.message ?? ""}:${error?.stack ?? ""}`;
  let hash = 2_166_136_261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return `ERR-${(hash >>> 0).toString(36).toUpperCase().padStart(7, "0")}`;
}

export interface ErrorBoundaryPresentation {
  title: string;
  description: string;
  reference: string;
  debugDetails: string | null;
}

export function getErrorBoundaryPresentation(
  error: ErrorDetails | null | undefined,
  isDevelopment: boolean
): ErrorBoundaryPresentation {
  return {
    title: "页面暂时无法显示",
    description:
      "发生了未预期的错误，请重新加载页面。如果问题仍然存在，请将错误标识提供给管理员。",
    reference: createErrorReference(error),
    debugDetails: isDevelopment
      ? (error?.stack ?? error?.message ?? null)
      : null,
  };
}
