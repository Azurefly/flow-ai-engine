import { expect, it, vi } from "vitest";
import { readWorkflowNodeHistory } from "./workflow-node-history";

it("preserves database visit ordering and full JSON while excluding a concurrent new visit", async () => {
  const longInput = { evidence: "采购依据".repeat(70000) };
  const earlier = { id: "z", sequenceNo: 1, inputJson: longInput };
  const later = { id: "a", sequenceNo: 2, inputJson: { resumed: true } };
  const query = vi.fn()
    .mockResolvedValueOnce([[{ id: "z" }, { id: "a" }]])
    .mockResolvedValueOnce([[later, { id: "new", sequenceNo: 3 }, earlier]]);
  const rows = await readWorkflowNodeHistory({ query } as never, "run-1");
  expect(rows).toEqual([earlier, later]);
  expect(rows[0].inputJson).toBe(longInput);
});

it("returns empty history without fetching payloads when no visits exist", async () => {
  const query = vi.fn().mockResolvedValueOnce([[]]);
  expect(await readWorkflowNodeHistory({ query } as never, "empty-run")).toEqual([]);
  expect(query).toHaveBeenCalledTimes(1);
});

it("does not turn a payload read failure into an empty history", async () => {
  const query = vi.fn().mockResolvedValueOnce([[{ id: "one" }]])
    .mockRejectedValueOnce(new Error("connection lost"));
  await expect(readWorkflowNodeHistory({ query } as never, "run-1"))
    .rejects.toThrow("connection lost");
});
