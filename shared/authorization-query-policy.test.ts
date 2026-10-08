import { expect, it } from "vitest";
import { authorizationQueryPolicy } from "./authorization-query-policy";
it("正在查看的权限来源定时刷新，不在后台轮询", () =>
  expect(authorizationQueryPolicy(true)).toEqual({
    enabled: true,
    retry: false,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  }));
it("离开当前视图停止查询和定时器", () =>
  expect(authorizationQueryPolicy(false)).toEqual({
    enabled: false,
    retry: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  }));
