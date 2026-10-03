import { expect, it } from "vitest";
import { prepareReadOnlyDataflowSql as prepare } from "./dataflow-sql-binding";

it("binds repeated named parameters only outside quotes and comments", () => {
  const sql =
    "SELECT :id AS a, :id AS b, ':missing?' AS literal, \"a:b\" AS quoted, `c:d` FROM t /* :comment ? */ -- :line ?\n WHERE n=:n # :ignored";
  expect(prepare(sql, { id: "x' OR 1=1", n: 3 })).toEqual({
    sql: sql.replaceAll(":id", "?").replace("n=:n", "n=?"),
    values: ["x' OR 1=1", "x' OR 1=1", 3],
  });
});
it("accepts read-only literals containing SQL words and punctuation", () => {
  expect(
    prepare("SELECT 1 -- :ignored\r + :value", { value: 2 }).values
  ).toEqual([2]);
  expect(
    prepare(
      "/* update :not_a_parameter */ SELECT 'update; :x ?' AS label, 1--2 AS n"
    ).values
  ).toEqual([]);
  expect(
    prepare("SELECT 'it''s :not_bound' AS label, :value", { value: null })
      .values
  ).toEqual([null]);
  expect(
    prepare("SELECT 'it\\'s :not_bound' AS label, :value", { value: 2 }).values
  ).toEqual([2]);
});
it("respects the database backslash mode", () => {
  expect(() => prepare("SELECT 'a\\' ; DELETE FROM t -- '", {}, true)).toThrow(
    "只读"
  );
  expect(
    prepare("SELECT 'a\\' AS label, :value", { value: 1 }, true).values
  ).toEqual([1]);
});
it("rejects executable comments, write statements, multiple statements and malformed SQL", () => {
  for (const sql of [
    "SELECT 1; SELECT 2",
    "DELETE FROM t",
    "SELECT 1 INTO @x",
    "SELECT 1 INTO OUTFILE '/tmp/x'",
    "SELECT 1 FOR UPDATE",
    "SELECT 1 /*! INTO OUTFILE '/tmp/x' */",
    "SELECT 1 /*M! ; DELETE FROM t */",
    "SELECT 'unterminated",
    "SELECT 1 /* unterminated",
    "SELECT ?",
  ])
    expect(() => prepare(sql)).toThrow();
});
it("rejects missing and nonscalar parameters before execution", () => {
  expect(() => prepare("SELECT :missing")).toThrow("未提供");
  for (const value of [{}, [], undefined, NaN, Infinity])
    expect(() => prepare("SELECT :value", { value })).toThrow("标量");
  expect(prepare("SELECT :value", { value: false }).values).toEqual([false]);
});
