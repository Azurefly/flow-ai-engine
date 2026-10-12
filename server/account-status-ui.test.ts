import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const source = readFileSync(
  new URL("../client/src/pages/Home.tsx", import.meta.url),
  "utf8"
);
it("人员状态变更只在明确确认后提交，携带原始状态版本", () => {
  expect(source).toContain("setStatusTarget(account)");
  expect(source).toContain("expectedStatus: status, expectedVersion: version");
  expect(source).toContain(
    "onToggleStatus(statusTarget.id, statusTarget.status, statusTarget.statusVersion)"
  );
  expect(source).toContain(
    'Number(account.id) === currentUserId ? "当前登录账号"'
  );
});
it("失败后先读取最新账号，再由用户重新确认，不自动重放变更", () => {
  const submit = source.slice(
    source.indexOf('submitLabel={statusError ? "刷新并重新确认"'),
    source.indexOf("open={normalDialogOpen}")
  );
  expect(submit).toContain("utils.iam.userDirectory.fetch");
  expect(submit).toContain("staleTime: 0");
  expect(submit).toContain(
    'setStatusTarget(fresh); setStatusError(""); return;'
  );
  expect(submit).toContain("changingStatus || statusBusy");
  expect(submit).toContain("finally { setStatusBusy(false); }");
});
