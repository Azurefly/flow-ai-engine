import { describe, expect, it, vi, afterEach } from "vitest";
import {
  byteLimit,
  connectorEnabled,
  decodeFile,
  mapRows,
  parsePage,
  rowsHash,
  validateRowKeys,
  versionInput,
} from "./data-connector-contract";
const base64 = (s: string) => Buffer.from(s).toString("base64");
const page = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
describe("版本化数据交换合同", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("保留 UTF-8 BOM 后的标题、嵌入 CRLF 和转义双引号", () => {
    expect(
      decodeFile(base64('\uFEFFid,name\r\n1,"一,\r\n二"\r\n2,"他说""好"""'))
        .rows
    ).toEqual([
      { id: "1", name: "一,\r\n二" },
      { id: "2", name: '他说"好"' },
    ]);
  });
  it.each([
    "a,a\n1,2",
    "a,b\n1",
    'a,b\n1,"未闭',
    "__proto__,b\n1,2",
    'a,b\n1,"x"y',
  ])("无效文件明确定位原始记录和字段", s =>
    expect(() => decodeFile(base64(s))).toThrow(/第.*行，第.*列/)
  );
  it("拒绝错误 UTF-8、过大文件和非标准内容编码", () => {
    expect(() => decodeFile(Buffer.from([255]).toString("base64"))).toThrow(
      /UTF-8/
    );
    expect(() => decodeFile("=a=8")).toThrow(/编码/);
    expect(() =>
      decodeFile(Buffer.alloc(byteLimit + 1).toString("base64"))
    ).toThrow(/大小/);
  });
  it("页必须携带所选不可变快照及明确末页游标", () => {
    expect(
      parsePage(page({ version: "r1", rows: [{ id: 1 }], nextCursor: null }), {
        datasetVersion: "r1",
      })
    ).toMatchObject({ rows: [{ id: 1 }] });
    for (const value of [
      { version: "r2", rows: [], nextCursor: null },
      { version: "r1", rows: [] },
      { version: "r1", rows: [1], nextCursor: null },
    ])
      expect(() => parsePage(page(value), { datasetVersion: "r1" })).toThrow(
        /分页合同/
      );
  });
  it("跨页校验行键、映射后投影，以独立于对象键次序的摘要核对", () => {
    const seen = new Set<string>();
    validateRowKeys([{ id: "x" }], "id", seen);
    expect(() => validateRowKeys([{ id: "x" }], "id", seen)).toThrow(/重复/);
    expect(() => validateRowKeys([{ id: {} }], "id")).toThrow(/行键/);
    expect(() => mapRows([{ x: 1 }], { y: "missing" }, [])).toThrow(/缺少/);
    expect(mapRows([{ x: 1, y: 2 }], { renamed: "x" }, ["renamed"])).toEqual([
      { renamed: 1 },
    ]);
    expect(rowsHash([{ b: 1, a: 2 }])).toBe(rowsHash([{ a: 2, b: 1 }]));
  });
  it("每个连接器可分别关闭，版本合同不得改写端点边界", () => {
    vi.stubEnv("FLOW_DATA_CONNECTOR_DISABLED", "api_read, receipt_write");
    expect(connectorEnabled("api_read")).toBe(false);
    expect(connectorEnabled("file_read")).toBe(true);
    expect(
      versionInput.safeParse({
        kind: "receipt_write",
        projectId: "project123",
        assetId: "resource123",
        label: "sink",
        endpointRef: "TEST_TARGET",
        path: "../other",
        rowKey: "id",
      }).success
    ).toBe(false);
  });
});
