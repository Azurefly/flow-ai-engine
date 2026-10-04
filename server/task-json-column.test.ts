import { expect, it } from "vitest";
import mysql from "mysql2/promise";
import { taskJsonColumnValue } from "./p1-service";
it("JSON 数组和对象以单个值绑定，驱动不会展开列或值", () => {
  const values = [
    { fields: ["serial"], input: { serial: "001" } },
    ["approved", "rejected"],
    ["end"],
  ];
  const parameters = values.map(taskJsonColumnValue);
  expect(parameters).toEqual(values.map(value => JSON.stringify(value)));
  const sql = mysql.format(
    "INSERT INTO test_task (payload,outcomes,nextNodes) VALUES (?,?,?)",
    parameters
  );
  expect(sql).not.toContain("`fields` =");
  expect(parameters.every(value => typeof value === "string")).toBe(true);
  expect(parameters.map(value => JSON.parse(value!))).toEqual(values);
});
it("保留已序列化 JSON 字符串，空值不改成字符串 null", () => {
  expect(taskJsonColumnValue('{"serial":"001"}')).toBe('{"serial":"001"}');
  expect(taskJsonColumnValue(null)).toBeNull();
  expect(taskJsonColumnValue(undefined)).toBeNull();
  expect(taskJsonColumnValue(false)).toBe("false");
});
