import { expect, it } from "vitest";
import { waitSubscriptionResumeAction } from "./workflow-message-resume";
const base = {
  runStatus: "waiting",
  waitType: "message",
  parallel: true,
  hasAcceptedMessage: false,
  resumeAcceptedMessage: false,
};
it("等待状态立即恢复", () =>
  expect(waitSubscriptionResumeAction(base)).toBe("resume"));
it.each(["running", "queued"])("并行消息在 %s 时持久化等待续跑", runStatus =>
  expect(waitSubscriptionResumeAction({ ...base, runStatus })).toBe("defer")
);
it.each(["waiting", "running", "queued"])(
  "%s 时拒绝重复已接收消息",
  runStatus =>
    expect(
      waitSubscriptionResumeAction({
        ...base,
        runStatus,
        hasAcceptedMessage: true,
      })
    ).toBe("duplicate")
);
it("重放已接收消息时使用等待状态", () =>
  expect(
    waitSubscriptionResumeAction({
      ...base,
      hasAcceptedMessage: true,
      resumeAcceptedMessage: true,
    })
  ).toBe("resume"));
it.each(["running", "queued"])("重放期间状态改为 %s 时稍后重试", runStatus =>
  expect(
    waitSubscriptionResumeAction({
      ...base,
      runStatus,
      hasAcceptedMessage: true,
      resumeAcceptedMessage: true,
    })
  ).toBe("skip")
);
it.each(["running", "queued"])("普通消息不能在 %s 时恢复", runStatus =>
  expect(
    waitSubscriptionResumeAction({ ...base, runStatus, parallel: false })
  ).toBe("reject")
);
it.each(["blocked", "cancelled", "terminated", "failed", "success"])(
  "%s 状态不能接收新消息",
  runStatus =>
    expect(waitSubscriptionResumeAction({ ...base, runStatus })).toBe("reject")
);
it.each(["running", "queued"])("定时扫描遇到 %s 状态时稍后重试", runStatus =>
  expect(
    waitSubscriptionResumeAction({ ...base, runStatus, waitType: "timer" })
  ).toBe("skip")
);
