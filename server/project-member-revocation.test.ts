import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  getConnection: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.poolQuery,
    getConnection: mocks.getConnection,
  }),
}));
vi.mock("./iam-service", () => ({
  hasSystemPermission: vi.fn(),
  recordAuthorizationAudit: mocks.audit,
}));
import {
  revokeProjectMember,
  grantProjectMember,
  grantProjectUnit,
  revokeProjectUnit,
} from "./project-service";

const actor = { id: 7, role: "admin" as const };
const projectId = "project-revoke";
let grants: {
  id: string;
  projectId: string;
  userId: number;
  role: string;
  revoked: boolean;
}[];
let connection: {
  query: ReturnType<typeof vi.fn>;
  beginTransaction: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};
let archived: boolean;
let units: { id: string; projectId: string; unitId: string; role: string }[];
let targetActive: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  archived = false;
  targetActive = true;
  units = [
    { id: "unit-grant", projectId, unitId: "unit-target", role: "viewer" },
  ];
  grants = [
    {
      id: "creator-owner",
      projectId,
      userId: 7,
      role: "owner",
      revoked: false,
    },
    ...["owner", "designer", "operator"].map(role => ({
      id: `member-${role}`,
      projectId,
      userId: 9,
      role,
      revoked: false,
    })),
    {
      id: "other-project",
      projectId: "project-other",
      userId: 9,
      role: "viewer",
      revoked: false,
    },
  ];
  let snapshot: typeof grants;
  let unitSnapshot: typeof units;
  connection = {
    beginTransaction: vi.fn(async () => {
      snapshot = structuredClone(grants);
      unitSnapshot = structuredClone(units);
    }),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {
      grants = snapshot;
      units = unitSnapshot;
    }),
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith("SELECT id,role,status"))
        return [
          [
            { id: 7, role: "admin", status: "active", tokenVersion: 1 },
            {
              id: 9,
              role: "user",
              status: targetActive ? "active" : "disabled",
            },
          ],
        ];
      if (sql.startsWith("SELECT id, name FROM organization_unit"))
        return [[{ id: "unit-target", name: "验收部门" }]];
      if (sql.startsWith("INSERT INTO flow_project_member")) {
        grants.push({
          id: String(params[0]),
          projectId: String(params[1]),
          userId: Number(params[2]),
          role: String(params[3]),
          revoked: false,
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("INSERT INTO flow_project_unit")) {
        const existing = units.find(
          row => row.projectId === params[1] && row.unitId === params[2]
        );
        if (existing) existing.role = String(params[3]);
        else
          units.push({
            id: String(params[0]),
            projectId: String(params[1]),
            unitId: String(params[2]),
            role: String(params[3]),
          });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("DELETE FROM flow_project_unit")) {
        const original = units.length;
        units = units.filter(
          row => row.projectId !== params[0] || row.unitId !== params[1]
        );
        return [{ affectedRows: original - units.length }];
      }
      if (sql.startsWith("SELECT ownerUserId"))
        return [
          [{ ownerUserId: 7, status: archived ? "archived" : "active" }],
          [],
        ];
      const selected = grants.filter(
        row =>
          row.projectId === params[0] &&
          row.userId === params[1] &&
          !row.revoked &&
          (params.length === 2 || row.id === params[2])
      );
      if (sql.startsWith("SELECT id,role"))
        return [selected.map(({ id, role }) => ({ id, role })), []];
      if (sql.startsWith("UPDATE flow_project_member")) {
        selected.forEach(row => {
          row.revoked = true;
        });
        return [{ affectedRows: selected.length }, []];
      }
      throw new Error(`Unexpected transactional SQL: ${sql}`);
    }),
  };
  mocks.getConnection.mockResolvedValue(connection);
  mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.poolQuery.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT ownerUserId"))
      return [[{ ownerUserId: 7, status: "active" }], []];
    return [[], []];
  });
});

const activeRoles = () =>
  grants
    .filter(
      row => row.projectId === projectId && row.userId === 9 && !row.revoked
    )
    .map(row => row.role);

it("撤销单条设计者授权，保留该人的其他角色以及其他业务授权", async () => {
  await revokeProjectMember(actor, {
    projectId,
    userId: 9,
    assignmentId: "member-designer",
  });
  expect(activeRoles()).toEqual(["owner", "operator"]);
  expect(grants.find(row => row.id === "other-project")!.revoked).toBe(false);
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      details: { assignmentId: "member-designer", roles: ["designer"] },
    }),
    connection
  );
  expect(connection.commit).toHaveBeenCalledOnce();
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledOnce();
});

it("允许撤销转授的业务管理员角色", async () => {
  await revokeProjectMember(actor, {
    projectId,
    userId: 9,
    assignmentId: "member-owner",
  });
  expect(activeRoles()).toEqual(["designer", "operator"]);
});

it("保护创建人的所有权授权", async () => {
  await expect(
    revokeProjectMember(actor, {
      projectId,
      userId: 7,
      assignmentId: "creator-owner",
    })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(grants.every(row => !row.revoked)).toBe(true);
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledOnce();
});

it.each(["missing-assignment", "other-project", "creator-owner"])(
  "不存在或不属于目标人员与业务的记录不能撤销：%s",
  async assignmentId => {
    await expect(
      revokeProjectMember(actor, { projectId, userId: 9, assignmentId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(grants.every(row => !row.revoked)).toBe(true);
    expect(mocks.audit).not.toHaveBeenCalled();
  }
);

it("兼容整人撤销接口，同时限定在当前业务", async () => {
  await revokeProjectMember(actor, { projectId, userId: 9 });
  expect(activeRoles()).toEqual([]);
  expect(grants.find(row => row.id === "other-project")!.revoked).toBe(false);
});

it("审计写入失败时回滚撤销，使用同一事务连接", async () => {
  mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
  await expect(
    revokeProjectMember(actor, {
      projectId,
      userId: 9,
      assignmentId: "member-designer",
    })
  ).rejects.toThrow("audit unavailable");
  expect(activeRoles()).toEqual(["owner", "designer", "operator"]);
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledOnce();
  expect(connection.release).toHaveBeenCalledOnce();
});

it("事务开始后重新检查业务状态，已归档业务不再撤销授权", async () => {
  archived = true;
  await expect(
    revokeProjectMember(actor, {
      projectId,
      userId: 9,
      assignmentId: "member-owner",
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(grants.every(row => !row.revoked)).toBe(true);
});

it("没有管理权限时不进入修改事务", async () => {
  const request = revokeProjectMember(
    { id: 10, role: "user" },
    { projectId, userId: 9, assignmentId: "member-owner" }
  );
  await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(request).rejects.toThrow("当前账号无权");
  expect(mocks.getConnection).not.toHaveBeenCalled();
});
for (const operation of ["grantMember", "grantUnit", "revokeUnit"] as const) {
  const write = () =>
    operation === "grantMember"
      ? grantProjectMember(actor, { projectId, userId: 9, role: "viewer" })
      : operation === "grantUnit"
        ? grantProjectUnit(actor, {
            projectId,
            unitId: "unit-target",
            role: "designer",
          })
        : revokeProjectUnit(actor, { projectId, unitId: "unit-target" });
  it(`${operation} 在同一事务写入授权和审计`, async () => {
    await write();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "flow_project",
        resourceId: projectId,
      }),
      connection
    );
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(
      connection.commit.mock.invocationCallOrder[0]
    );
    expect(
      mocks.poolQuery.mock.calls.some(([sql]) =>
        /^(INSERT|UPDATE|DELETE)/.test(sql)
      )
    ).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it(`${operation} 审计失败时授权完整回滚`, async () => {
    const original = structuredClone({ grants, units });
    mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(write()).rejects.toThrow("audit unavailable");
    expect({ grants, units }).toEqual(original);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
}
it("成员授权前复核目标账号，不向已停用用户写入授权", async () => {
  targetActive = false;
  await expect(
    grantProjectMember(actor, { projectId, userId: 9, role: "viewer" })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
});
it("已不存在的部门授权不再写入虚假的撤销审计", async () => {
  units = [];
  await expect(
    revokeProjectUnit(actor, { projectId, unitId: "unit-target" })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(mocks.audit).not.toHaveBeenCalled();
});
