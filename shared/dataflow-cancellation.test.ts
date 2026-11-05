import { expect, it } from "vitest";
import {
  cancellationNeedsReadback,
  cancellationReadback,
} from "./dataflow-cancellation";
it.each([undefined, "TIMEOUT", "INTERNAL_SERVER_ERROR", "UNKNOWN"])(
  "%s不能当作取消失败自动重提",
  code => expect(cancellationNeedsReadback(code)).toBe(true)
);
it.each(["BAD_REQUEST", "FORBIDDEN", "UNAUTHORIZED", "CONFLICT", "NOT_FOUND"])(
  "%s保留原因并显示明确反馈",
  code => expect(cancellationNeedsReadback(code)).toBe(false)
);
it("只读取原实例并按真实状态恢复，不把其他实例或成功误当取消", () => {
  expect(cancellationReadback(null, "r")).toBe("unavailable");
  expect(cancellationReadback({ id: "other", status: "cancelled" }, "r")).toBe(
    "unavailable"
  );
  expect(cancellationReadback({ id: "r", status: "cancelled" }, "r")).toBe(
    "cancelled"
  );
  for (const status of ["success", "failed"])
    expect(cancellationReadback({ id: "r", status }, "r")).toBe("finished");
  expect(
    cancellationReadback({ id: "r", status: "running", canCancel: true }, "r")
  ).toBe("retry");
  expect(
    cancellationReadback({ id: "r", status: "running", canCancel: false }, "r")
  ).toBe("forbidden");
});
