import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditMock, queryMock } = vi.hoisted(() => ({
  auditMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("./db", () => ({
  getSharedPool: () => ({ query: queryMock }),
}));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: vi.fn(),
  recordAuthorizationAudit: auditMock,
}));
vi.mock("./workflow-engine", () => ({ resumeWorkflowTask: vi.fn() }));
vi.mock("./workflow-worker", () => ({ wakeWorkflowWorker: vi.fn() }));

import { updateP1SystemSetting } from "./p1-service";

const admin = { id: 1, role: "admin" as const };

describe("system setting persistence", () => {
  beforeEach(() => {
    queryMock.mockReset();
    auditMock.mockReset();
    auditMock.mockResolvedValue(undefined);
  });

  it("rejects an empty platform name before writing", async () => {
    queryMock.mockResolvedValueOnce([[], []]);

    await expect(
      updateP1SystemSetting(admin, "general", {
        platformName: "   ",
        watermarkEnabled: false,
        watermarkText: "",
      })
    ).rejects.toThrow("平台名称不可为空");

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("requires watermark text when watermarking is enabled", async () => {
    queryMock.mockResolvedValueOnce([[], []]);

    await expect(
      updateP1SystemSetting(admin, "general", {
        platformName: "Flow AI Engine",
        watermarkEnabled: true,
        watermarkText: "   ",
      })
    ).rejects.toThrow("开启水印时必须配置水印文本");

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("preserves existing fields during a partial settings update", async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          {
            key: "general",
            valueJson: JSON.stringify({
              platformName: "Original",
              watermarkEnabled: true,
              watermarkText: "Internal",
            }),
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await updateP1SystemSetting(admin, "general", {
      platformName: "Renamed",
    });

    expect(result).toMatchObject({
      platformName: "Renamed",
      watermarkEnabled: true,
      watermarkText: "Internal",
    });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1][1]).toContain(
      JSON.stringify({
        platformName: "Renamed",
        watermarkEnabled: true,
        watermarkText: "Internal",
      })
    );
    expect(auditMock).toHaveBeenCalledOnce();
  });

  it("does not persist or audit an unchanged setting", async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          key: "approval",
          valueJson: JSON.stringify({
            reviewerMode: "project_owner_or_admin",
            requireProjectApproval: true,
          }),
        },
      ],
      [],
    ]);

    const result = await updateP1SystemSetting(admin, "approval", {
      requireProjectApproval: true,
      reviewerMode: "project_owner_or_admin",
    });

    expect(result).toMatchObject({
      requireProjectApproval: true,
      reviewerMode: "project_owner_or_admin",
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(auditMock).not.toHaveBeenCalled();
  });
});
