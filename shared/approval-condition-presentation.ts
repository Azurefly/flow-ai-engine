import {
  PARTICIPANT_DATA_OPERATORS,
  PARTICIPANT_IDENTITIES,
  type ParticipantRouteCondition as Condition,
} from "./participant-route-condition";

type Group = Extract<Condition, { kind: "group" }>;
type Leaf = Extract<Condition, { kind: "data" }>;
export type ApprovalCount = { node: string; ids: string[]; votes: Leaf[]; required: number };
const decisionPath = /^\{\{participants\.([1-9]\d*)\.results\.([\w-]+)\.decision\}\}$/;

// Only offer a rewrite for exact, unmodified voting expressions.
function plain(value: unknown, keys: string[]): boolean {
  return !!value && typeof value === "object" && Object.keys(value).every(key => keys.includes(key));
}

export function isGroup(value: unknown): value is Group {
  const group = value as Group | undefined;
  return group?.kind === "group" && Array.isArray(group.conditions);
}

function plainGroup(value: unknown): value is Group {
  return isGroup(value) && plain(value, ["kind", "match", "conditions"]) &&
    (value.match === "all" || value.match === "any");
}

function combinationCount(n: number, k: number) {
  let count = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) count = count * (n - i + 1) / i;
  return Math.round(count);
}

export function readApprovalCount(value: unknown): ApprovalCount | undefined {
  const terms = plainGroup(value)
    ? value.match === "all" ? [value.conditions] : value.conditions.map(item =>
      plainGroup(item) && item.match === "all" ? item.conditions : [item])
    : [[value]];
  const required = terms[0]?.length;
  if (!required) return;
  const votes = new Map<string, Leaf>();
  const seen = new Set<string>();
  let node = "";
  for (const term of terms) {
    if (term.length !== required) return;
    const ids = new Set<string>();
    for (const item of term) {
      const vote = item as Leaf | undefined;
      if (vote?.kind !== "data" || !plain(vote, ["kind", "left", "operator", "right"]) ||
          vote.operator !== "equals" || vote.right !== "approved" || typeof vote.left !== "string") return;
      const path = decisionPath.exec(vote.left);
      if (!path || (node && node !== path[2]) || ids.has(path[1])) return;
      node = path[2];
      ids.add(path[1]);
      votes.set(path[1], vote);
    }
    const signature = Array.from(ids).sort().join(",");
    if (seen.has(signature)) return;
    seen.add(signature);
  }
  if (seen.size === combinationCount(votes.size, required)) return { node, required, ids: Array.from(votes.keys()), votes: Array.from(votes.values()) };
}

export function availableCounts({ votes, required }: ApprovalCount) {
  const n = votes.length;
  // Bound generated comparisons, including for imported, very large groups.
  return Array.from({ length: n }, (_, i) => i + 1).filter(k =>
    k === required || k === 1 || k === n || combinationCount(n, k) * k <= 256);
}

export function withApprovalCount(rule: ApprovalCount, required: number): Condition {
  const { votes } = rule;
  if (!availableCounts(rule).includes(required)) throw new Error("通过人数超出可配置范围");
  if (votes.length === 1) return votes[0];
  if (required === 1 || required === votes.length)
    return { kind: "group", match: required === 1 ? "any" : "all", conditions: votes };
  const terms: Group[] = [];
  function choose(start: number, picked: Leaf[]) {
    if (picked.length === required) {
      terms.push({ kind: "group", match: "all", conditions: picked });
      return;
    }
    for (let i = start; i <= votes.length - (required - picked.length); i++)
      choose(i + 1, [...picked, votes[i]]);
  }
  choose(0, []);
  return { kind: "group", match: "any", conditions: terms };
}

export function conditionText(value: unknown, names: Record<string, string>): string {
  const rule = readApprovalCount(value);
  if (rule) return `${names[rule.node] || rule.node} · ${rule.votes.length} 人中至少 ${rule.required} 人通过`;
  const c = value as Condition | undefined;
  if (!c) return "未设置条件";
  const list = (items: unknown) => Array.isArray(items) && items.length ? items.join("、") : "未选择";
  const format = (v: unknown) => typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
  let text: string;
  switch (c.kind) {
    case "group": text = `${c.match === "all" ? "全部" : "任一"}满足 · ${Array.isArray(c.conditions) ? c.conditions.length : 0} 项条件`; break;
    case "identity": text = PARTICIPANT_IDENTITIES.find(i => i.value === c.identity)?.label || "流程身份"; break;
    case "user": text = "指定人员 " + list(c.userIds); break;
    case "role": text = (c.match === "all" ? "同时具有角色 " : "具有任一角色 ") + list(c.roleKeys); break;
    case "state": text = "个人状态 " + list(c.stateCodes); break;
    case "department": text = `${c.membership === "primary" ? "主部门" : "所属部门"} ${list(c.unitIds)} · 层级 ${c.minDepth}–${c.maxDepth ?? "不限"}`; break;
    case "data": {
      const path = typeof c.left === "string" && decisionPath.exec(c.left);
      const source = path ? `${names[path[2]] || path[2]} · 人员 ${path[1]} 的意见` : format(c.left);
      const op = PARTICIPANT_DATA_OPERATORS.find(o => o.value === c.operator)?.label ?? c.operator;
      const decisions: Record<string, string> = { approved: "通过", rejected: "拒绝", abstained: "弃权" };
      const right = path && typeof c.right === "string" && Object.hasOwn(decisions, c.right) ? decisions[c.right] : format(c.right);
      text = [source, op, c.operator !== "exists" && right].filter(Boolean).join(" ");
      break;
    }
    default: text = "未识别的条件";
  }
  return c.negate ? `取反（${text}）` : text;
}

// Group titles identify the operation even when the expression cannot be simplified.
export function conditionOperations(value: unknown, names: Record<string, string>) {
  const operations = new Set<string>();
  function visit(item: unknown) {
    if (isGroup(item)) return item.conditions.forEach(visit);
    const leaf = item as Leaf | null;
    const path = leaf?.kind === "data" && typeof leaf.left === "string" && decisionPath.exec(leaf.left);
    if (path) operations.add(names[path[2]] || path[2]);
  }
  visit(value);
  return Array.from(operations).join("、");
}
