export type JsonRecord = Record<string, unknown>;

export type ReferenceSignMode = "single" | "orSignFor" | "andSignFor";

export type TemporaryRoleChange = {
  action: "add" | "remove";
  roleKeys: string[];
};

export type NormalizedReferenceOperateConfig = {
  bindOperateCodes: string[];
  bindRoles: string[];
  signMode: ReferenceSignMode;
  signSelectorUserIds: number[];
  passPercent: number;
  autoRelatedParty: string[];
  relatedUnitOperate: boolean;
  requiredSubflowIds: string[];
  bindObjectReceiverEffective: boolean;
  bindOperateReceiverEffective: boolean;
  senderIdentity: "UserWord" | "UnitWord" | "AuthUnitWord" | "";
  senderAlias: string;
  receiverAlias: string;
  senderInnateOperation: string;
  receiverInnateOperation: string;
  senderTemporaryRoles: TemporaryRoleChange[];
  receiverTemporaryRoles: TemporaryRoleChange[];
  autoExecute: boolean;
  autoExecuteConditions: unknown[];
  hasUnsafeAutoExecuteCode: boolean;
};

const asRecord = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function firstValue(...values: unknown[]) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const record = asRecord(value);
  return String(firstValue(record.code, record.key, record.id, record.value, record.roleCode, record.roleKey, record.text) ?? "").trim();
}

function strings(value: unknown) {
  const values = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  return Array.from(new Set(values.map(stringValue).filter(Boolean)));
}

function ids(value: unknown): number[] {
  const values: unknown[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item === "number" || typeof item === "string") values.push(item);
    else {
      const record = asRecord(item);
      const candidate = firstValue(record.userId, record.id, record.key, record.value, record.userCode, record.userWord);
      if (candidate !== undefined) values.push(candidate);
      for (const key of ["userIds", "userWords", "userCodes"]) if (record[key] !== undefined) visit(record[key]);
    }
  };
  visit(value);
  return Array.from(new Set(values.map(Number).filter(id => Number.isInteger(id) && id > 0)));
}

function bool(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "是";
}

function normalizePercent(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  return Math.min(number > 1 ? number / 100 : number, 1);
}

function temporaryRoles(value: unknown): TemporaryRoleChange[] {
  const config = asRecord(value);
  const items = asArray(firstValue(config.configTypeList, config.lsjspz, value));
  return items.map(item => {
    const record = asRecord(item);
    const roleKeys = strings(firstValue(record.roleId, record.roleCode, record.roleKey, record.xzjs));
    const add = firstValue(record.addOrRemoveFlag, record.pzlx);
    return { action: add === false || add === "移除" ? "remove" as const : "add" as const, roleKeys };
  }).filter(item => item.roleKeys.length > 0);
}

function senderIdentity(value: unknown): NormalizedReferenceOperateConfig["senderIdentity"] {
  const normalized = String(value ?? "").trim();
  if (["UserWord", "以本人身份"].includes(normalized)) return "UserWord";
  if (["UnitWord", "以部门身份"].includes(normalized)) return "UnitWord";
  if (["AuthUnitWord", "以权限部门身份"].includes(normalized)) return "AuthUnitWord";
  return "";
}

/**
 * Converts both the original canvas shape and the original server persistence shape
 * into one safe runtime contract. Unknown source keys remain on the workflow node;
 * this function only reads them and never rewrites an imported definition.
 */
export function normalizeReferenceOperateConfig(config: JsonRecord): NormalizedReferenceOperateConfig {
  const canvasBind = asRecord(config.bdcz);
  const attribute = asRecord(config.operateAttributeMap);
  const canvasAttribute = asRecord(config.sxsz);
  const senderCanvas = asRecord(config.fsfsz);
  const receiverCanvas = asRecord(config.jsfsz);
  const senderSettings = asRecord(config.senderSettings);
  const receiverSettings = asRecord(config.receiverSettings);
  const autoCanvas = asRecord(config.zdzx);
  const orSign = asRecord(attribute.orSignForAttribute);
  const andSign = asRecord(attribute.andSignForAttribute);

  const signText = String(firstValue(attribute.signForFlag, canvasBind.hqhqsz) ?? "");
  const signMode: ReferenceSignMode = signText === "orSignFor" || signText === "或签"
    ? "orSignFor"
    : signText === "andSignFor" || signText === "会签"
      ? "andSignFor"
      : "single";
  const selector = firstValue(
    signMode === "orSignFor" ? orSign.orSignForStaff : andSign.andSignForStaff,
    canvasBind.xzdfhq,
  );
  const bindOperate = firstValue(attribute.bindOperate, canvasBind.bdcz);

  return {
    bindOperateCodes: asArray(bindOperate).map(item => stringValue(firstValue(asRecord(item).flowOprateCode, asRecord(item).id, item))).filter(Boolean),
    bindRoles: strings(firstValue(attribute.bindRole, canvasBind.bdczjs)),
    signMode,
    signSelectorUserIds: ids(selector),
    passPercent: normalizePercent(firstValue(andSign.passPercent, canvasBind.hqtgbfb)),
    autoRelatedParty: strings(firstValue(attribute.autoRelatedParty, canvasAttribute.zdglxgfsz)),
    relatedUnitOperate: bool(firstValue(attribute.relatedUnitOperate, canvasAttribute.yrdbmsfkcz)),
    requiredSubflowIds: strings(firstValue(attribute.bindChildWorkModuleIdList, canvasAttribute.xzdzlcjywc)),
    bindObjectReceiverEffective: bool(firstValue(attribute.bindObjectReceiverEffective, config.bddxcrjsrsx)),
    bindOperateReceiverEffective: bool(firstValue(attribute.bindOperateReceiverEffective, config.bdczcrjsrsx)),
    senderIdentity: senderIdentity(firstValue(senderSettings.senderIdentity, senderCanvas.fsflzsf)),
    senderAlias: String(firstValue(senderSettings.senderAliasName, senderCanvas.fsfbm) ?? ""),
    receiverAlias: String(firstValue(receiverSettings.receiverAliasName, receiverCanvas.jsfbm) ?? ""),
    senderInnateOperation: String(firstValue(asRecord(senderSettings.senderInnateOperate).flowOprateName, senderCanvas.fsfgycz) ?? ""),
    receiverInnateOperation: String(firstValue(asRecord(receiverSettings.receiverInnateOperate).flowOprateName, receiverCanvas.jsfgycz) ?? ""),
    senderTemporaryRoles: temporaryRoles(firstValue(senderSettings.temPoraryRoleConfig, senderCanvas.lsjspz)),
    receiverTemporaryRoles: temporaryRoles(firstValue(receiverSettings.temPoraryRoleConfig, receiverCanvas.lsjspz)),
    autoExecute: bool(firstValue(config.autoExecute, autoCanvas.sfzdzx)),
    autoExecuteConditions: asArray(firstValue(config.autoExecuteAuthGroups, autoCanvas.tjsz)),
    hasUnsafeAutoExecuteCode: strings(firstValue(config.autoExecuteJavaCode, autoCanvas.zdzxCode, autoCanvas.code)).length > 0,
  };
}

export function approvalRequirement(signMode: ReferenceSignMode, totalApprovers: number, passPercent: number) {
  if (totalApprovers <= 0) return 0;
  if (signMode === "orSignFor") return 1;
  if (signMode === "andSignFor") return Math.max(1, Math.min(totalApprovers, Math.ceil(totalApprovers * passPercent)));
  return 1;
}
