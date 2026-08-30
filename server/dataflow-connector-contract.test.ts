import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./p2-service.ts", import.meta.url),
  "utf8"
);

describe("dataflow connector contract", () => {
  it("requires verified external sources and keeps the connector read-only", () => {
    expect(source).toContain('source.status !== "verified"');
    expect(source).toContain("DATA_CONNECTOR_ALLOWED_HOSTS");
    expect(source).toContain("SELECT ${projection} FROM");
    expect(source).toContain("assertReadOnlySql");
    expect(source).toContain("mysql_read_connector");
  });

  it("binds named SQL parameters instead of interpolating values", () => {
    expect(source).toMatch(/safeStatement\.replace\(\s*\/:\(\[A-Za-z_\]\[A-Za-z0-9_\]\*\)\/g/);
    expect(source).toContain('return "?"');
    expect(source).toContain("SQL 参数 ${name} 未提供");
    expect(source).toContain("SELECT * FROM (${bound}) AS _flow_query");
  });
});
