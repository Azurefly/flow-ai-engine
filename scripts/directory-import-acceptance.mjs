import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  routerAcceptanceConfig,
  RouterAcceptanceSession,
} from "./router-acceptance-safety.mjs";

const { base, username, password } = routerAcceptanceConfig(process.env);
const app = new RouterAcceptanceSession(base);
const rpc = (name, input, write = false) => app.request(name, input, write);
const tag = randomBytes(6).toString("hex");
const member = "dirqa_" + tag,
  code = "DQA_" + tag.toUpperCase();
const secret = "Qa9!" + randomBytes(26).toString("hex");
const file = {
  version: 1,
  users: [{ username: member, name: "目录验收成员" }],
  units: [{ code, name: "目录验收部门" }],
  memberships: [{ username: member, unitCode: code, title: "验收岗位" }],
};
const preview = (manifest, label) =>
  rpc(
    "directoryImport.preview",
    { filename: tag + label + ".json", manifest },
    true
  );
const read = async () =>
  (await rpc("iam.userDirectory", { search: member, limit: 5 })).items.filter(
    u => u.username === member
  );
const result = { target: base, fixture: tag };
let batch, rename, other, first;
try {
  await rpc("auth.login", { username, password }, true);
  assert.equal((await rpc("directoryImport.access")).apply, true);
  assert.deepEqual(await read(), []);
  batch = await preview(file, "-main");
  assert.equal(
    batch.rows.filter(r => r.action === "create" && r.state === "ready").length,
    3
  );
  assert.deepEqual(await read(), []);
  result.previewWrites = 0;
  const blocked = await preview(
    {
      version: 1,
      users: [file.users[0], file.users[0]],
      units: [{ code: code + "A", name: "循环", parentCode: code + "A" }],
    },
    "-duplicates"
  );
  assert(blocked.rows.every(r => r.state === "blocked"));
  await assert.rejects(
    preview(
      { ...file, users: [{ ...file.users[0], role: "admin" }] },
      "-invalid"
    )
  );
  for (let index = 0; index < batch.rows.length; index++) {
    const request = {
      id: batch.id,
      index,
      ...(index === 0 ? { password: secret } : {}),
    };
    const [a, b] = await Promise.all([
      rpc("directoryImport.applyRow", request, true),
      rpc("directoryImport.applyRow", request, true),
    ]);
    assert.equal(a.rows[index].state, "applied");
    assert.equal(a.rows[index].after.id, b.rows[index].after.id);
  }
  const [current] = await read();
  first = current.id;
  assert.equal(current.name, "目录验收成员");
  assert.equal(current.departments.length, 1);
  assert.equal(current.departments[0].unitName, "目录验收部门");
  result.replayUnique = true;
  rename = await preview(
    { version: 1, users: [{ username: member, name: "已由其他管理员修改" }] },
    "-rename"
  );
  other = await preview(
    { version: 1, users: [{ username: member, name: "过期预览" }] },
    "-stale"
  );
  await rpc("directoryImport.applyRow", { id: rename.id, index: 0 }, true);
  assert.equal(
    (await rpc("directoryImport.applyRow", { id: other.id, index: 0 }, true))
      .rows[0].state,
    "conflict"
  );
  const protectedRow = (
    await rpc("directoryImport.revert", { id: batch.id, index: 0 }, true)
  ).rows[0];
  assert(protectedRow.message && protectedRow.state === "applied");
  assert.equal((await read())[0].name, "已由其他管理员修改");
  result.staleWriteProtected = true;
  assert((await rpc("directoryImport.list")).some(b => b.id === batch.id));
  result.batchId = batch.id;
} finally {
  if (rename)
    await rpc("directoryImport.revert", { id: rename.id, index: 0 }, true);
  if (batch) {
    for (let index = batch.rows.length - 1; index >= 0; index--) {
      const receipt = await rpc(
        "directoryImport.revert",
        { id: batch.id, index },
        true
      );
      if (receipt.rows[index].state === "applied")
        throw new Error("请核对该测试批次的回退回执 " + batch.id);
    }
    const account = await read();
    if (first) {
      assert.equal(account.length, 1);
      assert.equal(account[0].id, first);
      assert.equal(account[0].status, "disabled");
      assert.equal(account[0].departments.length, 0);
      result.cleanup = "测试账号和部门已停用，成员关系已回退";
    }
  }
  await rpc("auth.logout", null, true);
  console.log(JSON.stringify(result));
}
