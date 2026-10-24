import { expect, it, vi } from "vitest";
import type mysql from "mysql2/promise";
import type { WorkflowDefinition } from "./workflow-compiler";
import {
  assertDataflowResourcesReady,
  dataflowResourceDiagnostics,
} from "./dataflow-resource-readiness";

const definition = (
  specs: Array<[string, string, Record<string, unknown>]>
): WorkflowDefinition => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  edges: [],
  nodes: specs.map(([id, type, config]) => ({
    id,
    type: type as any,
    name: id,
    position: { x: 0, y: 0 },
    config,
  })),
});
const database = (
  assets: object[] = [],
  sources: object[] = [],
  functions: object[] = []
) => {
  const query = vi.fn(async (sql: string) => [
    sql.includes("FROM data_asset")
      ? assets
      : sql.includes("FROM data_source")
        ? sources
        : functions,
    [],
  ]);
  return { query, reader: { query } as unknown as Pick<mysql.Pool, "query"> };
};
const asset = {
  id: "asset",
  name: "orders",
  sourceId: "source",
  status: "active",
  matchedSourceId: "source",
  sourceType: "inline",
  sourceStatus: "draft",
  connectionJson: "{}",
};
it("批量按业务读取并去重引用；同一资源供多个节点使用仍只读一次", async () => {
  const { reader, query } = database([asset]);
  const result = await dataflowResourceDiagnostics(
    reader,
    "owned",
    definition([
      ["a", "source", { assetId: "asset" }],
      ["b", "table", { assetId: "asset" }],
    ])
  );
  expect(result).toEqual([]);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain("a.projectId=?");
  expect((query.mock.calls[0] as unknown[])[1]).toEqual(["owned", ["asset"]]);
});
it.each(["api", "file"])(
  "%s已验证仍给出具体节点/字段诊断，不接受其样本替代读取",
  async sourceType => {
    const { reader } = database([
      {
        ...asset,
        sourceType,
        sourceStatus: "verified",
        connectionJson: '{"endpoint":"https://private.example/credential"}',
      },
    ]);
    const result = await dataflowResourceDiagnostics(
      reader,
      "owned",
      definition([["read", "source", { assetId: "asset" }]])
    );
    expect(result).toHaveLength(1);
    expect(result[0].location).toEqual({
      kind: "node",
      nodeId: "read",
      field: "assetId",
    });
    expect(result[0].message).not.toContain("private.example");
    expect(result[0].code).toBe("DATAFLOW_RESOURCE_UNAVAILABLE");
  }
);
it.each([
  {},
  { ...asset, status: "disabled" },
  { ...asset, sourceStatus: "disabled" },
  { ...asset, matchedSourceId: null },
])("缺失/停用/跨业务关联资源被拒绝 %j", async row => {
  const { reader } = database(Object.keys(row).length ? [row] : []);
  expect(
    await dataflowResourceDiagnostics(
      reader,
      "owned",
      definition([["read", "source", { assetId: "asset" }]])
    )
  ).toHaveLength(1);
});
it("MySQL表名与列名在发布前检查；资源元数据不含外部连通性承诺", async () => {
  const source = {
    id: "source",
    sourceType: "jdbc",
    status: "verified",
    connectionJson: '{"endpoint":"mysql://db/orders"}',
  };
  const { reader } = database(
    [
      {
        ...asset,
        sourceType: "jdbc",
        sourceStatus: "verified",
        connectionJson: source.connectionJson,
      },
    ],
    [source]
  );
  expect(
    await dataflowResourceDiagnostics(
      reader,
      "owned",
      definition([
        ["read", "source", { assetId: "asset", columns: ["id"] }],
        ["sql", "edit_sql", { datasourceId: "source" }],
      ])
    )
  ).toEqual([]);
  const result = await dataflowResourceDiagnostics(
    reader,
    "owned",
    definition([
      ["read", "source", { assetId: "asset", columns: ["id;delete"] }],
    ])
  );
  expect(result[0].location.field).toBe("columns");
});
it("SQL不接受内联数据源，未验证MySQL不通过，非法JSON不使检查崩溃", async () => {
  for (const source of [
    { id: "source", sourceType: "inline", status: "draft" },
    {
      id: "source",
      sourceType: "jdbc",
      status: "draft",
      connectionJson: '{"endpoint":"mysql://db/orders"}',
    },
    {
      id: "source",
      sourceType: "jdbc",
      status: "verified",
      connectionJson: "invalid",
    },
  ]) {
    const { reader } = database([], [source]);
    const result = await dataflowResourceDiagnostics(
      reader,
      "owned",
      definition([["sql", "sql", { datasourceId: "source" }]])
    );
    expect(result).toHaveLength(1);
    expect(result[0].location.field).toBe("datasourceId");
  }
});
it("函数须审核且绑定可执行内置实现，审核不能使任意脚本变成可执行", async () => {
  const flow = definition([["function", "udf", { udfId: "function" }]]);
  for (const row of [
    {
      id: "function",
      status: "draft",
      udfType: "javascript",
      artifactRef: "builtin:trim",
    },
    {
      id: "function",
      status: "approved",
      udfType: "python",
      artifactRef: "builtin:trim",
    },
  ]) {
    expect(
      await dataflowResourceDiagnostics(
        database([], [], [row]).reader,
        "owned",
        flow
      )
    ).toHaveLength(1);
  }
  expect(
    await dataflowResourceDiagnostics(
      database(
        [],
        [],
        [
          {
            id: "function",
            name: "trim",
            status: "approved",
            udfType: "javascript",
            artifactRef: "builtin:trim",
          },
        ]
      ).reader,
      "owned",
      flow
    )
  ).toEqual([]);
});
it("事务调用加共享锁，失败抛结构化诊断且全程只读元数据", async () => {
  const { reader, query } = database([{ ...asset, sourceStatus: "disabled" }]);
  await expect(
    assertDataflowResourcesReady(
      reader,
      "owned",
      definition([["read", "source", { assetId: "asset" }]]),
      true
    )
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        location: { kind: "node", nodeId: "read", field: "assetId" },
      }),
    ]),
  });
  expect(
    query.mock.calls.every(
      ([sql]) => sql.startsWith("SELECT ") && sql.endsWith(" FOR SHARE")
    )
  ).toBe(true);
});
