import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const dateLabel = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleString("zh-CN", { hour12: false })
    : "长期有效";

export default function RoleAuthorizationPanel({
  roleId,
  onAssign,
  onManage,
  onRevoke,
}: {
  roleId: number;
  onAssign: () => void;
  onManage: (mode: "edit" | "delete", role: any) => void;
  onRevoke: (record: any) => void;
}) {
  const [tab, setTab] = useState("permissions");
  const [source, setSource] = useState<{ id: string; name: string } | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(20);
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(search.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const overview = trpc.iam.roleAuthorizationOverview.useQuery(
    { roleId },
    authorizationQueryPolicy(true)
  );
  const kind = tab === "direct" ? "direct" : source ? "inherited" : "sources";
  const page = trpc.iam.roleMembersPage.useQuery(
    {
      roleId,
      kind,
      unitId: source?.id,
      search: keyword,
      status: status === "all" ? undefined : (status as "active" | "disabled"),
      offset,
      limit,
    },
    authorizationQueryPolicy(tab !== "permissions")
  );
  const data = overview.isError ? undefined : overview.data;
  const result = page.isError ? undefined : page.data;
  const actualOffset = result?.offset ?? offset;
  useEffect(() => {
    if (result && result.offset !== offset) setOffset(result.offset);
  }, [result, offset]);
  const changeContext = (next: string, unit: typeof source = null) => {
    setTab(next);
    setSource(unit);
    setSearch("");
    setKeyword("");
    setStatus("all");
    setOffset(0);
  };
  const refresh = () => {
    void overview.refetch();
    if (tab !== "permissions") void page.refetch();
  };
  const isSources = kind === "sources";
  return (
    <div className="role-members-workspace" data-role-members-workspace="">
      <div className="role-members-toolbar">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={
              !data || overview.isFetching || data.role.scope !== "system"
            }
            onClick={onAssign}
          >
            绑定用户
          </Button>
          {data && !Number(data.role.isSystem) && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={overview.isFetching}
                onClick={() =>
                  onManage("edit", {
                    ...data.role,
                    permissions: data.permissions.map(p => p.code),
                  })
                }
              >
                编辑角色
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={overview.isFetching}
                onClick={() =>
                  onManage("delete", {
                    ...data.role,
                    permissions: data.permissions.map(p => p.code),
                  })
                }
              >
                删除角色
              </Button>
            </>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={overview.isFetching || page.isFetching}
          onClick={refresh}
        >
          刷新
        </Button>
      </div>
      {overview.error && (
        <p role="alert" className="px-6 text-aiflow-danger">
          {overview.error.message}
        </p>
      )}
      {overview.isPending && (
        <p role="status" className="px-6">
          正在读取角色概览…
        </p>
      )}
      <Tabs
        value={tab}
        onValueChange={value => changeContext(value)}
        className="role-members-tabs"
      >
        <TabsList aria-label="角色详情分类" className="role-members-tablist">
          <TabsTrigger value="permissions">权限配置</TabsTrigger>
          <TabsTrigger value="direct">
            直接成员{data ? ` · ${data.direct.users}` : ""}
          </TabsTrigger>
          <TabsTrigger value="inherited">
            继承来源{data ? ` · ${data.sources}` : ""}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="permissions" className="role-members-body">
          {data && (
            <>
              <p className="text-sm text-muted-foreground">
                {data.role.description || "未填写角色说明"}
              </p>
              <div className="role-members-summary">
                <button onClick={() => changeContext("direct")}>
                  <strong>{data.direct.users} 人</strong>
                  <span>直接绑定 · {data.direct.records} 条授权</span>
                </button>
                <button onClick={() => changeContext("inherited")}>
                  <strong>{data.inherited.users} 人</strong>
                  <span>部门继承 · {data.inherited.records} 条来源记录</span>
                </button>
              </div>
              <h3 className="font-medium text-sm">
                权限清单（{data.permissions.length}）
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 mt-3">
                {data.permissions.map(p => (
                  <div
                    key={p.code}
                    className="rounded-md border border-border p-3 min-w-0"
                  >
                    <p className="text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground font-mono break-all mt-1">
                      {p.code}
                    </p>
                  </div>
                ))}
              </div>
              {!data.permissions.length && (
                <p className="text-sm text-muted-foreground mt-3">
                  尚未配置权限。
                </p>
              )}
              <p className="role-members-help">
                人数按用户去重；同一用户可以有多条授权或继承来源。停用账号保留绑定，但权限不生效。
              </p>
              {data.role.scope === "workflow" && (
                <p className="role-members-help">
                  流程角色在对应流程内分配，下方成员记录按授权范围区分。
                </p>
              )}
            </>
          )}
        </TabsContent>
        {(["direct", "inherited"] as const).map(value => (
          <TabsContent
            key={value}
            value={value}
            className="role-members-body role-members-directory"
          >
            <div className="role-members-heading">
              <div>
                <h3>
                  {value === "direct"
                    ? "直接绑定用户"
                    : source
                      ? `${source.name} · 继承用户`
                      : "组织继承来源"}
                </h3>
                <p>
                  {isSources
                    ? "先选择部门，再查看通过该部门继承此角色的用户。"
                    : "仅列出当前有效期内的绑定；停用账号单独标识。"}
                </p>
              </div>
              {source && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => changeContext("inherited")}
                >
                  返回部门来源
                </Button>
              )}
            </div>
            <div className="role-members-filters">
              <Input
                aria-label={isSources ? "搜索绑定部门" : "搜索绑定用户"}
                placeholder={
                  isSources ? "搜索部门名称、编码" : "搜索姓名、账号或邮箱"
                }
                value={search}
                onChange={event => setSearch(event.target.value)}
                maxLength={160}
              />
              <select
                aria-label={isSources ? "部门状态" : "成员状态"}
                value={status}
                onChange={event => {
                  setStatus(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="all">全部状态</option>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </div>
            <div className="role-members-result" aria-live="polite">
              {page.isFetching
                ? "正在读取…"
                : result
                  ? `共 ${result.total} ${isSources ? "个部门来源" : "条记录"}，当前 ${result.total ? actualOffset + 1 : 0}–${Math.min(actualOffset + limit, result.total)}`
                  : ""}
            </div>
            {page.error && (
              <p role="alert" className="text-aiflow-danger text-sm">
                {page.error.message}{" "}
                <button onClick={refresh} className="underline">
                  重试
                </button>
              </p>
            )}
            <div className="identity-table-scroll" aria-busy={page.isFetching}>
              <table
                className="identity-table role-members-table"
                aria-label={isSources ? "角色绑定部门" : "角色绑定用户"}
              >
                <thead>
                  <tr>
                    {(isSources
                      ? [
                          "部门 / 编码",
                          "继承规则",
                          "绑定状态",
                          "有效期",
                          "操作",
                        ]
                      : [
                          "用户 / 账号",
                          "状态",
                          value === "direct" ? "授权范围" : "来源部门",
                          ...(value === "direct" ? ["有效期", "操作"] : []),
                        ]
                    ).map(label => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result?.items.map((row: any) =>
                    isSources ? (
                      <tr key={row.unitId}>
                        <td>
                          <strong>{row.unitName}</strong>
                          <span className="identity-account-code">
                            {row.unitCode}
                          </span>
                        </td>
                        <td>
                          {Number(row.includeDescendants)
                            ? "本部门及下级部门"
                            : "仅本部门"}
                        </td>
                        <td>
                          {row.status !== "active"
                            ? "部门已停用"
                            : Number(row.effective)
                              ? "生效中"
                              : "未生效 / 已到期"}
                        </td>
                        <td>
                          <span className="text-xs">
                            自 {dateLabel(row.effectiveFrom)}
                            <br />
                            {row.expiresAt
                              ? `至 ${dateLabel(row.expiresAt)}`
                              : "长期有效"}
                          </span>
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              changeContext("inherited", {
                                id: row.unitId,
                                name: row.unitName,
                              })
                            }
                          >
                            查看用户
                          </Button>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={row.assignmentId || `${row.userId}-${row.unitId}`}
                      >
                        <td>
                          <strong>{row.name || row.username}</strong>
                          <span className="identity-account-code">
                            {row.username}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              row.status === "active"
                                ? "text-aiflow-success"
                                : "text-muted-foreground"
                            }
                          >
                            {row.status === "active" ? "启用" : "停用 · 不生效"}
                          </span>
                        </td>
                        <td>
                          {value === "direct" ? (
                            row.scopeType === "system" ? (
                              "系统全局"
                            ) : (
                              <span className="break-all">
                                流程 {row.scopeId}
                              </span>
                            )
                          ) : (
                            row.unitName
                          )}
                        </td>
                        {value === "direct" && (
                          <>
                            <td>
                              {dateLabel(row.expiresAt)}
                              {row.note && (
                                <p className="text-xs text-muted-foreground mt-1 break-words">
                                  备注：{row.note}
                                </p>
                              )}
                            </td>
                            <td>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={
                                  page.isFetching ||
                                  !data ||
                                  overview.isFetching
                                }
                                onClick={() =>
                                  onRevoke({
                                    ...row,
                                    roleName: data?.role.name,
                                  })
                                }
                              >
                                撤销
                              </Button>
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  )}
                  {!page.isPending && !page.error && result?.total === 0 && (
                    <tr>
                      <td colSpan={5} className="identity-empty">
                        没有匹配的{isSources ? "部门来源" : "绑定用户"}。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="role-members-pagination">
              <label>
                每页{" "}
                <select
                  aria-label="每页记录数"
                  value={limit}
                  onChange={event => {
                    setLimit(Number(event.target.value));
                    setOffset(0);
                  }}
                >
                  {[20, 50, 100].map(n => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>{" "}
                条
              </label>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page.isFetching || !result || actualOffset === 0}
                  onClick={() => setOffset(Math.max(0, actualOffset - limit))}
                >
                  上一页
                </Button>
                <span>
                  第 {Math.floor(actualOffset / limit) + 1} /{" "}
                  {Math.max(1, Math.ceil((result?.total || 0) / limit))} 页
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    page.isFetching ||
                    !result ||
                    actualOffset + limit >= result.total
                  }
                  onClick={() => setOffset(actualOffset + limit)}
                >
                  下一页
                </Button>
              </div>
            </div>
            <p className="role-members-help">
              {value === "direct"
                ? "撤销仅移除此条直接授权。用户仍可能通过其他授权、部门继承或管理员身份保有权限。"
                : "继承权限请在组织架构中调整部门角色或成员归属，不能在此单独撤销。"}
            </p>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
