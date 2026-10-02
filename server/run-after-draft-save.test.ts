import { describe, expect, it } from "vitest";
import {
  DraftSaveBeforeRunError,
  runAfterDraftSave,
} from "../shared/run-after-draft-save";

describe("run after saving workflow draft", () => {
  it("waits for a draft save to finish before dispatching the run", async () => {
    const calls: string[] = [];

    await runAfterDraftSave({
      workflowStatus: "draft",
      saveDraft: async () => {
        await Promise.resolve();
        calls.push("save");
      },
      run: async () => {
        calls.push("run");
      },
    });

    expect(calls).toEqual(["save", "run"]);
  });

  it("does not dispatch a run when saving the draft fails", async () => {
    const calls: string[] = [];

    await expect(
      runAfterDraftSave({
        workflowStatus: "draft",
        saveDraft: async () => {
          calls.push("save");
          throw new Error("保存被拒绝");
        },
        run: async () => {
          calls.push("run");
        },
      })
    ).rejects.toBeInstanceOf(DraftSaveBeforeRunError);

    expect(calls).toEqual(["save"]);
  });

  it("runs a published workflow without trying to save it as a draft", async () => {
    const calls: string[] = [];

    await runAfterDraftSave({
      workflowStatus: "published",
      saveDraft: async () => {
        calls.push("save");
      },
      run: async () => {
        calls.push("run");
      },
    });

    expect(calls).toEqual(["run"]);
  });
});
