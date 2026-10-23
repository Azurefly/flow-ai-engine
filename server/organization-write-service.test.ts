import {
  organizationUnitToken,
  organizationMembershipToken,
  organizationBindingToken,
} from "./organization-configuration";
import { customRoleConfigToken } from "./custom-role-configuration";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  access: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.connection }),
}));
vi.mock("./iam-service", () => ({
  ensureIamCatalog: vi.fn(),
  hasSystemPermission: mocks.access,
  recordAuthorizationAudit: mocks.audit,
}));
import * as organization from "./organization-write-service";
const actor = { id: 7, role: "user" as const, tokenVersion: 1 };
let conn: any,
  current: any,
  target: any,
  units: any[],
  role: any,
  blockers: any[],
  memberships: any[],
  binding: any;
beforeEach(() => {
  vi.resetAllMocks();
  current = { id: 7, role: "user", status: "active", tokenVersion: 1 };
  target = { id: 9, role: "user", status: "active", tokenVersion: 1 };
  units = [
    {
      id: "a",
      code: "AA",
      name: "部门",
      status: "active",
      parentUnitId: null,
      unitLevel: 1,
    },
    { id: "b", status: "active", parentUnitId: null },
  ];
  role = { id: 10, code: "custom_reader", scope: "system" };
  blockers = [];
  memberships = [
    { id: "member-a", unitId: "a", userId: 9, title: "岗位", isPrimary: true },
  ];
  binding = {
    id: "binding",
    unitId: "a",
    roleId: 10,
    includeDescendants: 1,
    effectiveFrom: new Date("2026-10-20T00:00:00Z"),
    expiresAt: null,
    createdByUserId: 7,
  };
  mocks.access.mockResolvedValue(true);
  conn = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    destroy: vi.fn(),
    query: vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.includes("FROM users WHERE"))
        return [[current, target].filter(Boolean)];
      if (sql.startsWith("SELECT * FROM organization_unit_role"))
        return [[binding]];
      if (sql.startsWith("SELECT id,unitId,userId,title,isPrimary"))
        return [memberships];
      if (sql.startsWith("SELECT permissionId")) return [[{ permissionId: 5 }]];
      if (sql.startsWith("SELECT code FROM permission"))
        return [[{ code: "workflow:create" }]];
      if (sql.startsWith("SELECT * FROM organization_unit"))
        return [units.filter(row => row.id === params[0])];
      if (sql.startsWith("SELECT parentUnitId"))
        return [[{ parentUnitId: null }]];
      if (sql.startsWith("SELECT id,title,isPrimary"))
        return [[{ id: "membership", title: "岗位", isPrimary: true }]];
      if (sql.includes("FROM iam_role")) return [[role].filter(Boolean)];
      if (
        sql.startsWith(
          "SELECT id FROM organization_unit_role WHERE unitId=? AND roleId=?"
        )
      )
        return [[{ id: "binding" }]];
      if (sql.startsWith("SELECT id FROM")) return [blockers];
      return [{ affectedRows: 1 }];
    }),
  };
  mocks.connection.mockResolvedValue(conn);
});
const operations = [
  [
    "create",
    () =>
      organization.createOrganizationUnit(actor, { code: "AA", name: "部门" }),
  ],
  [
    "update",
    () => organization.updateOrganizationUnit(actor, { id: "a", name: "更新" }),
  ],
  [
    "assign",
    () =>
      organization.assignOrganizationMember(actor, {
        unitId: "a",
        userId: 9,
        isPrimary: true,
      }),
  ],
  [
    "remove",
    () =>
      organization.removeOrganizationMember(actor, { unitId: "a", userId: 9 }),
  ],
  [
    "primary",
    () =>
      organization.setPrimaryOrganizationMembership(actor, {
        unitId: "a",
        userId: 9,
      }),
  ],
  [
    "move",
    () =>
      organization.moveOrganizationMember(actor, {
        fromUnitId: "a",
        toUnitId: "b",
        userId: 9,
      }),
  ],
  ["delete", () => organization.deleteOrganizationUnit(actor, { id: "a" })],
  [
    "bind",
    () => organization.bindOrganizationRole(actor, { unitId: "a", roleId: 10 }),
  ],
  [
    "unbind",
    () =>
      organization.unbindOrganizationRole(actor, { unitId: "a", roleId: 10 }),
  ],
] as const;
it.each(operations)(
  "%s waits, locks current actor, rechecks permission and audits before commit",
  async (_, run) => {
    await run();
    expect(conn.query.mock.calls[0][0]).toContain("GET_LOCK");
    expect(conn.beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.access.mock.invocationCallOrder[0]
    );
    expect(mocks.access).toHaveBeenCalledTimes(2);
    expect(mocks.access).toHaveBeenLastCalledWith(
      { id: 7, role: "user" },
      "iam:manage",
      conn
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 7 }),
      conn
    );
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(
      conn.commit.mock.invocationCallOrder[0]
    );
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  }
);
it.each(operations)(
  "%s audit failure rolls back and never acknowledges success",
  async (_, run) => {
    mocks.audit.mockRejectedValue(new Error("private sql failure"));
    await expect(run()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  }
);
it.each(operations)(
  "%s cannot mutate after current IAM permission disappears",
  async (_, run) => {
    mocks.access.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      conn.query.mock.calls.some(([sql]: string[]) =>
        /^(INSERT|UPDATE|DELETE)/.test(sql)
      )
    ).toBe(false);
    expect(mocks.audit).not.toHaveBeenCalled();
  }
);
it.each(["disabled", "invalidated", "missing", "invalid-role"])(
  "rejects %s actor after lock wait",
  async kind => {
    if (kind === "missing") current = null;
    else if (kind === "disabled") current.status = "disabled";
    else if (kind === "invalidated") current.tokenVersion++;
    else current.role = "obsolete";
    await expect(operations[0][1]()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  }
);
it("locks actor and target account ids in primary key order", async () => {
  await operations[2][1]();
  const read = conn.query.mock.calls.find(([sql]: string[]) =>
    sql.includes("FROM users WHERE")
  );
  expect(read[0]).toContain("ORDER BY id FOR UPDATE");
  expect(read[1]).toEqual([[7, 9]]);
});
it("rejects a target disabled while waiting", async () => {
  target.status = "disabled";
  await expect(operations[2][1]()).rejects.toThrow("组织成员不存在或已停用");
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("rejects a manager disabled while waiting", async () => {
  target.status = "disabled";
  await expect(
    organization.updateOrganizationUnit(actor, { id: "a", managerUserId: 9 })
  ).rejects.toThrow("负责人不存在或已停用");
});
it("permits cleanup of a disabled user's membership", async () => {
  target.status = "disabled";
  await expect(operations[3][1]()).resolves.toBe(true);
});
it("rejects a department disabled after precheck", async () => {
  units[0].status = "disabled";
  await expect(operations[2][1]()).rejects.toThrow("组织单元不存在或已停用");
});
it("checks expiry after lock wait", async () => {
  await expect(
    organization.bindOrganizationRole(actor, {
      unitId: "a",
      roleId: 10,
      expiresAt: new Date(Date.now() - 1000),
    })
  ).rejects.toThrow("晚于生效时间");
});
it("rejects inheriting system administrator", async () => {
  role.code = "system_admin";
  await expect(operations[7][1]()).rejects.toThrow("非系统管理员");
});
it("blocks deletion with child departments, members or roles", async () => {
  blockers = [{ id: "other" }];
  await expect(operations[6][1]()).rejects.toThrow(
    "子部门 1 个、成员 1 人、权限组 1 个"
  );
});
it("returns bounded conflict when organization lock is busy", async () => {
  conn.query.mockResolvedValueOnce([[{ acquired: 0 }]]);
  await expect(operations[0][1]()).rejects.toMatchObject({ code: "CONFLICT" });
  expect(conn.beginTransaction).not.toHaveBeenCalled();
  expect(conn.query).toHaveBeenCalledTimes(1);
  expect(conn.release).toHaveBeenCalledOnce();
});
it("destroys an ambiguous advisory-lock connection", async () => {
  conn.query.mockRejectedValueOnce(new Error("network interrupted"));
  await expect(operations[0][1]()).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  expect(conn.destroy).toHaveBeenCalledOnce();
  expect(conn.release).not.toHaveBeenCalled();
});
it("does not turn an acknowledged commit into a failure when unlock fails", async () => {
  const query = conn.query.getMockImplementation();
  conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("RELEASE_LOCK")) throw new Error("release failed");
    return query(sql, params);
  });
  await expect(operations[1][1]()).resolves.toBe(true);
  expect(conn.destroy).toHaveBeenCalledOnce();
});
it("destroys a connection if the lock was not actually released", async () => {
  const query = conn.query.getMockImplementation();
  conn.query.mockImplementation(async (sql: string, params: unknown[]) =>
    sql.includes("RELEASE_LOCK") ? [[{ released: null }]] : query(sql, params)
  );
  await operations[1][1]();
  expect(conn.destroy).toHaveBeenCalledOnce();
});
it("destroys a connection when rollback cannot confirm transaction cleanup", async () => {
  mocks.audit.mockRejectedValue(new Error("audit failed"));
  conn.rollback.mockRejectedValue(new Error("rollback connection lost"));
  await expect(operations[1][1]()).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  expect(conn.destroy).toHaveBeenCalledOnce();
  expect(conn.release).not.toHaveBeenCalled();
});
it("retries deadlocks at most three times, releasing each connection", async () => {
  mocks.audit.mockRejectedValue({ code: "ER_LOCK_DEADLOCK", errno: 1213 });
  await expect(operations[1][1]()).rejects.toMatchObject({ code: "CONFLICT" });
  expect(conn.rollback).toHaveBeenCalledTimes(3);
  expect(conn.release).toHaveBeenCalledTimes(3);
  expect(conn.commit).not.toHaveBeenCalled();
});

it.each(["update", "delete"])(
  "%s rejects a stale department token before writing",
  async name => {
    const input = {
      id: "a",
      expectedConfigToken: organizationUnitToken({
        ...units[0],
        name: "旧名称",
      }),
    };
    await expect(
      name === "update"
        ? organization.updateOrganizationUnit(actor, { ...input, name: "覆盖" })
        : organization.deleteOrganizationUnit(actor, input)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      conn.query.mock.calls.some(([sql]: string[]) =>
        /^(INSERT|UPDATE|DELETE)/.test(sql)
      )
    ).toBe(false);
  }
);
it.each(["assign", "remove", "primary", "move"])(
  "%s compares the whole current membership set",
  async name => {
    const token = organizationMembershipToken(9, memberships);
    memberships.push({
      id: "another",
      unitId: "b",
      userId: 9,
      title: "新岗位",
      isPrimary: false,
    });
    const input = { unitId: "a", userId: 9, expectedMembershipToken: token };
    const run =
      name === "assign"
        ? organization.assignOrganizationMember(actor, input)
        : name === "remove"
          ? organization.removeOrganizationMember(actor, input)
          : name === "primary"
            ? organization.setPrimaryOrganizationMembership(actor, input)
            : organization.moveOrganizationMember(actor, {
                ...input,
                fromUnitId: "a",
                toUnitId: "b",
              });
    await expect(run).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      conn.query.mock.calls.some(([sql]: string[]) =>
        /^(INSERT|UPDATE|DELETE)/.test(sql)
      )
    ).toBe(false);
  }
);
it("new UI assignment does not overwrite an existing membership", async () => {
  await expect(
    organization.assignOrganizationMember(actor, {
      unitId: "a",
      userId: 9,
      onlyIfAbsent: true,
      expectedMembershipToken: organizationMembershipToken(9, memberships),
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("new UI binding does not overwrite an existing scope or expiry", async () => {
  await expect(
    organization.bindOrganizationRole(actor, {
      unitId: "a",
      roleId: 10,
      onlyIfAbsent: true,
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("role configuration is checked after acquiring its row lock", async () => {
  const token = customRoleConfigToken({
    ...role,
    permissions: ["workflow:create"],
  });
  role.description = "new description";
  await expect(
    organization.bindOrganizationRole(actor, {
      unitId: "a",
      roleId: 10,
      expectedRoleConfigToken: token,
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("unbind checks the current binding scope and expiry", async () => {
  const token = organizationBindingToken(binding);
  binding.includeDescendants = 0;
  await expect(
    organization.unbindOrganizationRole(actor, {
      unitId: "a",
      roleId: 10,
      expectedConfigToken: token,
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.audit).not.toHaveBeenCalled();
});
