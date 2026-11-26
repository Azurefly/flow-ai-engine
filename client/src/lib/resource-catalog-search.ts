import { dataFunctionTypeLabel } from "@shared/builtin-data-functions";
import { dataSourceCapability } from "@shared/data-source-capabilities";

/** Only the public fields shown in the directory are searchable. */
export function catalogSearchText(row: Record<string, unknown>) {
  return [
    row.name, row.sourceType && dataSourceCapability(row.sourceType).label, row.sourceType,
    row.sourceName, row.assetType, typeof row.udfType === "string" && dataFunctionTypeLabel(row.udfType, row.artifactRef),
    row.udfType, row.pluginType, row.version,
  ].filter(Boolean).join(" ");
}
