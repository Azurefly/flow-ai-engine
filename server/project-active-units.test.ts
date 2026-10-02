import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("./db", () => ({
  getSharedPool: () => ({ query: queryMock }),
}));
vi.mock("./iam-service", () => ({
  hasSystemPermission: vi.fn().mockResolvedValue(true),
  recordAuthorizationAudit: vi.fn(),
}));

import { listActiveUnits } from "./project-service";

describe("project active organization units", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("queries only schema-backed columns and computes display paths in application code", async () => {
    queryMock.mockResolvedValueOnce([
      [
        { id: "root", code: "HQ", name: "总部", parentUnitId: null },
        { id: "ops", code: "OPS", name: "运营部", parentUnitId: "root" },
      ],
      [],
    ]);

    const units = await listActiveUnits({ id: 1, role: "admin" });

    expect(queryMock).toHaveBeenCalledWith(
      "SELECT id, code, name, parentUnitId FROM organization_unit WHERE status='active' ORDER BY sortOrder, code"
    );
    expect(queryMock.mock.calls[0][0]).not.toMatch(/\bpath\b/i);
    expect(units[1]).toMatchObject({
      pathName: "总部 / 运营部",
      pathCode: "HQ/OPS",
      displayPath: "总部 / 运营部（HQ/OPS）",
    });
  });
});
