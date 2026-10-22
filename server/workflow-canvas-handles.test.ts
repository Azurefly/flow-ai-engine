import { describe, expect, it } from "vitest";
import { readCanvasSourceHandles } from "../client/src/components/workflow-canvas-handles";

describe("历史操作节点出口显示", () => {
  it("保留已有 approved 出口，使已保存的操作到路由连线有真实锚点", () => {
    const config = { outcomeMode: "legacy_cancel", outcomes: [] };
    expect(readCanvasSourceHandles("operate", config, ["approved"])).toEqual([
      "approved",
    ]);
    expect(config).toEqual({ outcomeMode: "legacy_cancel", outcomes: [] });
  });
  it("无连线的旧版节点提供默认出口，历史空出口按 default 显示", () => {
    expect(readCanvasSourceHandles("operate", {})).toEqual(["default"]);
    expect(
      readCanvasSourceHandles("operate", {}, [null, " ", "default"])
    ).toEqual(["default"]);
    expect(
      readCanvasSourceHandles("operate", {}, ["complete", "complete"])
    ).toEqual(["complete"]);
  });
  it("显式结果模式仅显示已配置分支，不把旧连线升级为可执行结果", () => {
    expect(
      readCanvasSourceHandles(
        "operate",
        {
          outcomeMode: "explicit",
          outcomes: [
            { code: "yes", sourceHandle: "approved" },
            { code: "no", sourceHandle: "rejected" },
          ],
        },
        ["obsolete"]
      )
    ).toEqual(["approved", "rejected"]);
  });
  it("路由、条件、失败与补偿出口保留现有约定", () => {
    expect(
      readCanvasSourceHandles("router", {
        defaultRoute: "b",
        routes: [{ handle: "a" }, { handle: "b" }],
      })
    ).toEqual(["b", "a"]);
    expect(
      readCanvasSourceHandles("condition", {
        trueHandle: "yes",
        falseHandle: "no",
      })
    ).toEqual(["yes", "no"]);
    expect(readCanvasSourceHandles("llm", { failureHandle: "failed" })).toEqual(
      ["default", "failed"]
    );
    expect(
      readCanvasSourceHandles("rest", { writeSafety: "compensated" })
    ).toEqual(["default", "compensation"]);
    expect(readCanvasSourceHandles("end", {}, ["old"])).toEqual([]);
  });
});
