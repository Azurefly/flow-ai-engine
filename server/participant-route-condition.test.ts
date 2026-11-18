import { describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import type { ParticipantRouteCondition } from "../shared/participant-route-condition";
import { participantRouteConditionSchema } from "./participant-route-condition-schema";
import {
  matchesParticipantCondition,
  resolveParticipantDepartments,
} from "./participant-route-condition";
import { createParticipantStateExample } from "../shared/participant-state-example";
import { analyzeWorkflowDefinition } from "./workflow-compiler";
import { planParticipantStateChange } from "./participant-state-plan";

const input = {
  userId: 12,
  roleKeys: ["reviewer", "employee"],
  stateCode: "PENDING",
  departments: [
    {
      unitId: "team",
      ancestorIds: ["team", "branch", "root"],
      isPrimary: true,
    },
    { unitId: "audit", ancestorIds: ["audit", "root"], isPrimary: false },
  ],
  context: { result: { amount: 120 }, participant: { isInitiator: false } },
  identities: { isParticipant: true, isInitiator: false, isActor: true },
};
const department: ParticipantRouteCondition = {
  kind: "department",
  unitIds: ["root"],
  minDepth: 0,
  maxDepth: 2,
  membership: "any",
};

describe("可组合参与人路径条件", () => {
  it("组合身份、部门层级、角色排除、个人状态和业务数据", () => {
    const condition: ParticipantRouteCondition = {
      kind: "group",
      match: "all",
      conditions: [
        { kind: "identity", identity: "isInitiator", negate: true },
        department,
        {
          kind: "role",
          roleKeys: ["director", "auditor"],
          match: "any",
          negate: true,
        },
        {
          kind: "group",
          match: "any",
          conditions: [
            { kind: "user", userIds: [99] },
            { kind: "state", stateCodes: ["PENDING"] },
          ],
        },
        {
          kind: "data",
          left: "{{result.amount}}",
          operator: "greaterThan",
          right: 100,
        },
      ],
    };
    expect(matchesParticipantCondition(condition, input)).toBe(true);
    expect(
      matchesParticipantCondition(condition, {
        ...input,
        roleKeys: ["employee", "auditor"],
      })
    ).toBe(false);
    expect(
      matchesParticipantCondition({ ...condition, negate: true }, input)
    ).toBe(false);
  });
  it.each([
    ["root", 0, 0, "any", false],
    ["root", 1, 1, "any", true],
    ["root", 1, 1, "primary", false],
    ["root", 2, 2, "primary", true],
    ["root", 3, null, "any", false],
    ["root", 0, null, "primary", true],
    ["team", 0, 0, "primary", true],
    ["unknown", 0, null, "any", false],
  ] as const)(
    "部门 %s 层级 %s–%s 成员范围 %s",
    (unitId, minDepth, maxDepth, membership, expected) => {
      expect(
        matchesParticipantCondition(
          {
            kind: "department",
            unitIds: [unitId],
            minDepth,
            maxDepth,
            membership,
          },
          input
        )
      ).toBe(expected);
    }
  );
  it("多角色全部匹配、角色排除及指定人员取反", () => {
    expect(
      matchesParticipantCondition(
        { kind: "role", roleKeys: ["reviewer", "employee"], match: "all" },
        input
      )
    ).toBe(true);
    expect(
      matchesParticipantCondition(
        { kind: "role", roleKeys: ["reviewer", "auditor"], match: "all" },
        input
      )
    ).toBe(false);
    expect(
      matchesParticipantCondition(
        {
          kind: "role",
          roleKeys: ["reviewer", "auditor"],
          match: "any",
          negate: true,
        },
        input
      )
    ).toBe(false);
    expect(
      matchesParticipantCondition(
        { kind: "user", userIds: [12], negate: true },
        input
      )
    ).toBe(false);
  });
  it.each([
    { kind: "group", match: "all", conditions: [] },
    { kind: "role", match: "any", roleKeys: [] },
    { ...department, minDepth: 3, maxDepth: 2 },
    { ...department, minDepth: -1 },
    { ...department, maxDepth: 1.5 },
    { kind: "data", operator: "arbitraryCode", left: "code" },
  ])("发布拒绝无效条件 %j", value => {
    expect(participantRouteConditionSchema.safeParse(value).success).toBe(
      false
    );
    const definition = createParticipantStateExample();
    const routes = definition.nodes.find(node => node.id === "after-submit")!
      .config.routes as any[];
    routes[0].participantCondition = value;
    const result = analyzeWorkflowDefinition(definition, { flowType: "state" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map(item => item.code)).toContain(
        "WF_PARTICIPANT_ROUTE_CONDITION"
      );
  });
  it("通过正常状态规划入口为发起人与部门内非指定角色分配不同状态", () => {
    const definition = createParticipantStateExample();
    definition.nodes.find(node => node.id === "after-submit")!.config.routes = [
      {
        handle: "sender",
        priority: 100,
        participantCondition: { kind: "identity", identity: "isInitiator" },
      },
      {
        handle: "receiver",
        priority: 50,
        participantCondition: {
          kind: "group",
          match: "all",
          conditions: [
            department,
            { kind: "role", roleKeys: ["auditor"], match: "any", negate: true },
          ],
        },
      },
    ];
    const changes = planParticipantStateChange({
      definition,
      entryNodeId: "after-submit",
      actorUserId: 12,
      initiatorUserId: 1,
      userIds: [1, 12],
      receiverUserIds: [],
      cards: {},
      roles: new Map([[12, input.roleKeys]]),
      departments: new Map([[12, input.departments]]),
      context: {},
    });
    expect(changes.map(change => [change.userId, change.stateNodeId])).toEqual([
      [1, "sent"],
      [12, "pending"],
    ]);
  });
  it("部门读取保留完整祖先路径、多部门及主部门信息", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        [
          { id: "root", parentUnitId: null },
          { id: "branch", parentUnitId: "root" },
          { id: "team", parentUnitId: "branch" },
        ],
      ])
      .mockResolvedValueOnce([
        [
          { unitId: "team", userId: 12, isPrimary: 1 },
          { unitId: "root", userId: 12, isPrimary: 0 },
          { unitId: "disabled", userId: 12, isPrimary: 0 },
        ],
      ]);
    const departments = await resolveParticipantDepartments(
      { query } as unknown as PoolConnection,
      [12],
      ["root"]
    );
    expect(departments.get(12)).toEqual([
      {
        unitId: "team",
        ancestorIds: ["team", "branch", "root"],
        isPrimary: true,
      },
      { unitId: "root", ancestorIds: ["root"], isPrimary: false },
    ]);
    expect(query.mock.calls[1][1]).toEqual([[12]]);
  });
  it("停用条件部门与组织循环会阻止操作", async () => {
    const query = vi.fn().mockResolvedValueOnce([[]]);
    await expect(
      resolveParticipantDepartments(
        { query } as unknown as PoolConnection,
        [12],
        ["missing"]
      )
    ).rejects.toThrow("已停用");
    query
      .mockResolvedValueOnce([
        [
          { id: "a", parentUnitId: "b" },
          { id: "b", parentUnitId: "a" },
        ],
      ])
      .mockResolvedValueOnce([[{ unitId: "a", userId: 12, isPrimary: 1 }]]);
    await expect(
      resolveParticipantDepartments(
        { query } as unknown as PoolConnection,
        [12],
        ["a"]
      )
    ).rejects.toThrow("循环");
  });
});
