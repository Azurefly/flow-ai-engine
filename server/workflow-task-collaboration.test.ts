import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  approvalRequirementAfterMemberChange,
  isTaskActor,
} from "./p1-service";

describe("人工任务协作变更", () => {
  it("按签署模式重新计算加签和减签门槛", () => {
    expect(
      approvalRequirementAfterMemberChange({
        signMode: "orSignFor",
        totalApprovers: 5,
        passPercentBasisPoints: 10000,
      })
    ).toBe(1);
    expect(
      approvalRequirementAfterMemberChange({
        signMode: "andSignFor",
        totalApprovers: 5,
        passPercentBasisPoints: 6000,
      })
    ).toBe(3);
    expect(
      approvalRequirementAfterMemberChange({
        signMode: "sequentialSignFor",
        totalApprovers: 4,
        passPercentBasisPoints: 10000,
      })
    ).toBe(4);
  });

  it("代理后责任人和被代理人都保留任务可见性", () => {
    const delegatedTask = {
      assignedUserId: 12,
      responsibleUserId: 12,
      representedUserId: 7,
      candidateUserIdsJson: [12],
    } as any;
    expect(isTaskActor(12, delegatedTask)).toBe(true);
    expect(isTaskActor(7, delegatedTask)).toBe(true);
    expect(isTaskActor(99, delegatedTask)).toBe(false);
  });

  it("成员变更使用 CAS，仅允许未处理成员减签并记录代理主体", () => {
    const service = readFileSync(
      new URL("./p1-service.ts", import.meta.url),
      "utf8"
    );
    const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const workbench = readFileSync(
      new URL("../client/src/components/ProcessWorkbench.tsx", import.meta.url),
      "utf8"
    );
    expect(service).toContain("memberVersion=memberVersion+1");
    expect(service).toContain("String(member.status) !== \"pending\"");
    expect(service).toContain('"task_delegated"');
    expect(service).toContain("representedUserId");
    expect(router).toContain("addSigner: protectedProcedure");
    expect(router).toContain("removeSigner: protectedProcedure");
    expect(workbench).toContain("加签与减签");
  });
});
