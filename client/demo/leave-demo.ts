import { z } from "zod";
import { createLeaveApprovalDefinition } from "../../shared/leave-approval-workflow";

export const definition = createLeaveApprovalDefinition();
export type LeaveNode = (typeof definition.nodes)[number];
export const nodesById = new Map(definition.nodes.map(node => [node.id, node]));

export function participantStatus(node?: LeaveNode) {
  const config = node?.config;
  return config && "flowStatus" in config ? config.flowStatus : undefined;
}

export const roles = [
  {
    id: "employee",
    title: "员工",
    name: "林晓",
    action: "提交申请",
    record: "提交请假申请",
  },
  {
    id: "supervisor",
    title: "直属上级",
    name: "周明",
    action: "上级审核",
    record: "审核通过并转交经理",
  },
  {
    id: "manager",
    title: "部门经理",
    name: "陈佳",
    action: "经理审核",
    record: "批准请假申请",
  },
] as const;

export type RoleId = (typeof roles)[number]["id"];

interface Phase {
  title: string;
  currentNode: string;
  focusNodes: string[];
  participantNodes: [string | null, string | null, string | null];
  completedNodes: string[];
}

export const phases: readonly Phase[] = [
  {
    title: "待提交",
    currentNode: "application-state",
    focusNodes: [
      "start",
      "application-state",
      "apply-auto",
      "route-after-apply",
    ],
    participantNodes: ["application-state", null, null],
    completedNodes: [],
  },
  {
    title: "直属上级待审批",
    currentNode: "supervisor-pending",
    focusNodes: [
      "route-after-apply",
      "employee-waiting-supervisor",
      "supervisor-pending",
      "supervisor-approve",
    ],
    participantNodes: [
      "employee-waiting-supervisor",
      "supervisor-pending",
      null,
    ],
    completedNodes: [
      "start",
      "application-state",
      "apply-auto",
      "route-after-apply",
      "employee-waiting-supervisor",
    ],
  },
  {
    title: "部门经理待审批",
    currentNode: "manager-pending",
    focusNodes: [
      "route-after-supervisor",
      "employee-waiting-manager",
      "supervisor-approved",
      "manager-pending",
      "manager-approve",
    ],
    participantNodes: [
      "employee-waiting-manager",
      "supervisor-approved",
      "manager-pending",
    ],
    completedNodes: [
      "supervisor-pending",
      "supervisor-approve",
      "route-to-manager-binding",
      "bind-manager-auto",
      "route-after-supervisor",
      "employee-waiting-manager",
      "supervisor-approved",
    ],
  },
  {
    title: "申请通过",
    currentNode: "end",
    focusNodes: [
      "route-after-manager",
      "employee-approved",
      "supervisor-finished",
      "manager-approved",
      "end",
    ],
    participantNodes: [
      "employee-approved",
      "supervisor-finished",
      "manager-approved",
    ],
    completedNodes: [
      "manager-pending",
      "manager-approve",
      "route-after-manager",
      "employee-approved",
      "supervisor-finished",
      "manager-approved",
      "end",
    ],
  },
];

const storageKey = "flow-ai-engine.leave-demo.v1";
export const reasonLimit = 120;
const reasonSchema = z.string().trim().min(1).max(reasonLimit);
const runSchema = z.object({
  id: z.string().regex(/^DEMO-[0-9A-F]{8}$/),
  reason: reasonSchema,
  events: z.array(z.iso.datetime()).min(1).max(roles.length),
});

export type DemoRun = z.infer<typeof runSchema>;

export function advanceRun(
  run: DemoRun | null,
  action: { role: RoleId; reason: string; at: string; id: string }
) {
  if (roles[run?.events.length ?? 0]?.id !== action.role) return run;

  if (run) return { ...run, events: [...run.events, action.at] };

  const validated = reasonSchema.safeParse(action.reason);
  if (!validated.success) return null;
  return { id: action.id, reason: validated.data, events: [action.at] };
}

export function readRun(): DemoRun | null {
  try {
    const data = sessionStorage.getItem(storageKey);
    return data ? (runSchema.safeParse(JSON.parse(data)).data ?? null) : null;
  } catch {
    return null;
  }
}

export function saveRun(run: DemoRun | null) {
  try {
    if (run) sessionStorage.setItem(storageKey, JSON.stringify(run));
    else sessionStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}
