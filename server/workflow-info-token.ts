import { createHash } from "node:crypto";

/** Only the fields edited together here; running or saving a definition is unrelated. */
export function workflowInfoToken(row: Record<string, unknown>) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.id,
        row.projectId ?? null,
        row.name,
        row.description ?? null,
      ])
    )
    .digest("hex");
}
