import { describe, expect, it } from "vitest";
import { parseProjectImport, projectImportByteLimit } from "./project-import";

describe("业务 CSV 预检", () => {
  it.each(["\n", "\r\n"])(
    "保留说明内的换行、逗号和双引号，并跟踪源行",
    newline => {
      const csv = [
        "\uFEFF业务代号,业务名称,业务说明",
        ' a1 ,审批,"第一行,""甲""',
        '第二行"',
        "BB,入库,完成",
      ].join(newline);
      const result = parseProjectImport(csv);
      expect(result.issues).toEqual([]);
      expect(result.records).toEqual([
        {
          line: 2,
          code: "A1",
          name: "审批",
          domainCode: "",
          description: '第一行,"甲"' + newline + "第二行",
        },
        {
          line: 4,
          code: "BB",
          name: "入库",
          domainCode: "",
          description: "完成",
        },
      ]);
    }
  );
  it.each([
    ["", "文件"],
    ["code,name", "记录"],
    ["code,name,业务名称\nAA,甲,乙", "业务名称"],
    ['code,name,description\nAA,甲,"缺尾', "description"],
    ['code,name\nAA,"甲"乙', "name"],
    ["code,name\nAA,甲\n aa ,乙", "业务代号"],
    ["code,name\n,甲", "业务代号"],
    ["code,name\nAA," + "中".repeat(161), "业务名称"],
  ])("报告错误字段（%s）", (input, field) => {
    expect(parseProjectImport(input).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })])
    );
  });
  it("边界按逻辑数据行数和 UTF-8 字节计算", () => {
    const rows = Array.from({ length: 501 }, (_, i) => "P" + i + ",业务");
    expect(
      parseProjectImport(["code,name", ...rows.slice(0, 500)].join("\n")).issues
    ).toEqual([]);
    expect(
      parseProjectImport(["code,name", ...rows].join("\n")).issues
    ).toMatchObject([{ line: 502, field: "记录" }]);
    expect(
      parseProjectImport("中".repeat(Math.ceil(projectImportByteLimit / 3)))
        .issues[0].field
    ).toBe("文件");
  });
});
