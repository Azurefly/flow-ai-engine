import { beforeEach, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query }) }));
vi.mock("./iam-service", () => ({ ensureIamCatalog: vi.fn(), hasSystemPermission: vi.fn(), recordAuthorizationAudit: vi.fn() }));
import { listUsersPage } from "./internal-auth";

beforeEach(() => query.mockReset());

it("部门与状态筛选同时应用于总数和分页查询，多部门归属不复制用户行", async () => {
  query.mockResolvedValueOnce([[{total:2}]]).mockResolvedValueOnce([[{id:1,username:"alice"},{id:2,username:"bob"}]]).mockResolvedValueOnce([[
    {userId:1,unitId:"unit-a",unitName:"采购",isPrimary:1},
    {userId:1,unitId:"unit-b",unitName:"财务",isPrimary:0},
    {userId:2,unitId:"unit-a",unitName:"采购",isPrimary:1},
  ]]);
  const result = await listUsersPage({search:" ALICE ",status:"active",unitId:"unit-a",offset:10,limit:10});
  expect(result.total).toBe(2);
  expect(result.items.map(item => item.departments.length)).toEqual([2,1]);
  for (const [sql,args] of query.mock.calls.slice(0,2)) {
    expect(sql).toContain("om.userId=users.id AND om.unitId=?");
    expect(sql).toContain("status=?");
    expect(args.slice(0,5)).toEqual(["alice","alice","alice","active","unit-a"]);
  }
  expect(query.mock.calls[1][1].slice(-2)).toEqual([10,10]);
  expect(query.mock.calls[2][1]).toEqual([[1,2]]);
});

it("未分配部门筛选由服务端处理，空页不查询全量组织成员", async () => {
  query.mockResolvedValueOnce([[{total:0}]]).mockResolvedValueOnce([[]]);
  expect(await listUsersPage({search:"",unassigned:true,offset:0,limit:10})).toMatchObject({items:[],total:0});
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][0]).toContain("NOT EXISTS (SELECT 1 FROM organization_membership om WHERE om.userId=users.id)");
});

it("普通目录调用保持兼容，搜索输入只作为参数传递", async () => {
  query.mockResolvedValueOnce([[{total:0}]]).mockResolvedValueOnce([[]]);
  await listUsersPage({search:"%' OR 1=1 --",offset:0,limit:20});
  expect(query.mock.calls[0][0]).not.toContain("OR 1=1");
  expect(query.mock.calls[0][1]).toEqual(Array(3).fill("%' or 1=1 --"));
  expect(query.mock.calls[0][0]).not.toContain("organization_membership");
});
