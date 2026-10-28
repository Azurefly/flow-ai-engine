import { beforeEach, expect, it, vi } from "vitest";
import { authorizationAuditFilter, authorizationAuditPageInput } from "./authorization-audit-pagination";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { listAuthorizationAuditPage, listAuthorizationAudit } from "./iam-service";

const boundary = 1793181600000;
beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("CURRENT_TIMESTAMP")) return [[{ snapshotBefore: boundary }]];
    if (sql.startsWith("SELECT COUNT")) return [[{ total: 37 }]];
    return [[{ id: "older-than-twenty", action: "user_updated", resourceType: "iam_role", detailsJson: { operation: "custom_role_created" } }]];
  });
});
it("reads a full-history count and bounded page, with a stable snapshot and tie order", async () => {
  const result = await listAuthorizationAuditPage({ offset: 20, limit: 10 });
  expect(result).toMatchObject({ total: 37, offset: 20, limit: 10, snapshotBefore: boundary });
  expect(result.items[0]).toMatchObject({ action: "role_created", legacyAction: "user_updated" });
  const calls = mocks.query.mock.calls;
  expect(calls).toHaveLength(3);
  expect(calls[1][0]).toContain("a.createdAt < FROM_UNIXTIME(? / 1000)");
  expect(calls[1][1]).toEqual([boundary]);
  expect(calls[2][0]).toContain("ORDER BY a.createdAt DESC,a.id DESC LIMIT ? OFFSET ?");
  expect(calls[2][1]).toEqual([boundary, 10, 20]);
});
it("reuses the supplied snapshot and clamps out-of-range offsets", async () => {
  const result = await listAuthorizationAuditPage({ snapshotBefore: boundary, offset: 500, limit: 10 });
  expect(result.offset).toBe(30);
  expect(mocks.query).toHaveBeenCalledTimes(3);
  expect(mocks.query.mock.calls[2][1]).toEqual([boundary, 10, 30]);
});
it("uses one filter for both count and rows and keeps user search out of SQL", async () => {
  const search = "%' OR 1=1 --_";
  await listAuthorizationAuditPage({ snapshotBefore: boundary, search, category: "roles", from: 1000, until: 3000 });
  const [, count, page] = mocks.query.mock.calls;
  expect(count[0]).not.toContain(search);
  expect(count[1]).toContain(search.toLowerCase());
  expect(count[0]).toContain("INSTR(LOWER(CONCAT_WS");
  expect(count[0]).toContain("actor.name,target.username,target.name");
  expect(page[1].slice(0, -2)).toEqual(count[1]);
  expect(count[1].slice(-2)).toEqual([1000, 3000]);
});
it("matches displayed Chinese labels and legacy project/role semantics", () => {
  const filter = authorizationAuditFilter(authorizationAuditPageInput.parse({ category: "projects", search: "归档" }), boundary);
  expect(filter.where).toContain("JSON_VALID(a.detailsJson)");
  expect(filter.where).toContain("custom_role_created");
  expect(filter.where).toContain("project_archived");
  expect(filter.args).toContain("project_archived");
  expect(filter.args).toContain("project_restored");
  const other = authorizationAuditFilter(authorizationAuditPageInput.parse({ category: "other" }), boundary);
  expect(other.where).toContain("NOT IN");
});
it.each([{ limit: 0 }, { limit: 201 }, { offset: -1 }, { category: "secret" }, { from: 3000, until: 2000 }, { search: "a".repeat(161) }])("rejects invalid input before reading the database: %j", async input => {
  await expect(listAuthorizationAuditPage(input as any)).rejects.toThrow();
  expect(mocks.query).not.toHaveBeenCalled();
});
it("retains the recent-array API for existing acceptance clients", async () => {
  expect(Array.isArray(await listAuthorizationAudit(200))).toBe(true);
  expect(mocks.query).toHaveBeenCalledTimes(1);
});

it("caps future snapshots at database time and treats future calendar bounds consistently", async () => {
  const result = await listAuthorizationAuditPage({ snapshotBefore: boundary + 86400000 });
  expect(result.snapshotBefore).toBe(boundary);
  const farFuture = 253402214400000;
  expect(authorizationAuditFilter(authorizationAuditPageInput.parse({ until: farFuture }), boundary).args).toEqual([boundary]);
  const noHistory = authorizationAuditFilter(authorizationAuditPageInput.parse({ from: farFuture }), boundary);
  expect(noHistory.where).toContain("FALSE");
  expect(noHistory.args).toEqual([boundary]);
});
