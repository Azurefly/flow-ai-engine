// The latest immutable transition must match the run's recorded state exactly.
export const recordedBusinessStateNameSql = `CASE
  WHEN JSON_TYPE(JSON_EXTRACT(bs.payloadJson,'$.stateName'))='STRING'
  THEN NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(bs.payloadJson,'$.stateName'))),'')
  ELSE NULL END`;

export const businessStateLabelSql = `CASE WHEN r.flowType='state'
  THEN COALESCE(${recordedBusinessStateNameSql},NULLIF(r.currentStateCode,''))
  ELSE NULL END`;

export const businessStateJoinSql = `LEFT JOIN workflow_state_transition bs
  ON r.flowType='state' AND bs.runId=r.id
  AND bs.sequenceNo=(SELECT MAX(latest.sequenceNo) FROM workflow_state_transition latest WHERE latest.runId=r.id)
  AND BINARY bs.toStateCode=BINARY r.currentStateCode`;

export function presentProcessInstance<T extends Record<string, unknown>>(
  row: T
) {
  let operations = row.availableOperationsJson;
  if (typeof operations === "string") {
    try {
      operations = JSON.parse(operations);
    } catch {}
  }
  return {
    ...row,
    stateName: row.flowType === "state" ? (row.stateName ?? null) : null,
    stateCode: row.flowType === "state" ? (row.currentStateCode ?? null) : null,
    displayStatus: row.status,
    availableOperations: operations,
  };
}
