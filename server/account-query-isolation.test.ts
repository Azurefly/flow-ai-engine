import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { clearAccountQueries, isPublicSessionQuery } from "../client/src/lib/account-query-isolation";
it("仅保留身份和公开平台配置，不保留其他权限查询", () => {
  expect(isPublicSessionQuery([["auth", "me"], { type: "query" }])).toBe(true);
  expect(isPublicSessionQuery([["config", "publicGeneral"]])).toBe(true);
  expect(isPublicSessionQuery([["iam", "roles"]])).toBe(false);
  expect(isPublicSessionQuery([["auth", "sessions"]])).toBe(false);
  expect(isPublicSessionQuery(["unknown"])).toBe(false);
});
it("账号切换清除流程、人员、权限及运行缓存，保留公开配置", async () => {
  const client = new QueryClient();
  const paths = ["workflow", "iam", "task", "project", "config.organization"];
  for (const path of paths) client.setQueryData([[path, "get"], { input: 7 }], { oldAccount: true });
  client.setQueryData([["auth", "me"]], { id: 8 });
  client.setQueryData([["config", "publicGeneral"]], { platformName: "Flow" });
  await clearAccountQueries(client);
  for (const path of paths) expect(client.getQueryData([[path, "get"], { input: 7 }])).toBeUndefined();
  expect(client.getQueryData([["auth", "me"]])).toEqual({ id: 8 });
  expect(client.getQueryData([["config", "publicGeneral"]])).toEqual({ platformName: "Flow" });
  client.clear();
});
it("旧账号延迟响应不能重新填入新账号缓存", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = [["workflow", "get"], { input: "old-flow" }];
  let resolveOld!: (value: unknown) => void;
  const oldRequest = client.fetchQuery({ queryKey: key, queryFn: () => new Promise(resolve => { resolveOld = resolve; }) }).then(() => false, () => true);
  await clearAccountQueries(client);
  resolveOld({ secretFromOldAccount: true });
  expect(await oldRequest).toBe(true);
  expect(client.getQueryData(key)).toBeUndefined();
  await clearAccountQueries(client);
  expect(client.getQueryData(key)).toBeUndefined();
  client.clear();
});
