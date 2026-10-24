import { expect, it } from "vitest";
import {
  canProbeDataSource,
  dataAssetReadiness,
  dataSourceCapability,
  dataSourceReadiness,
} from "./data-source-capabilities";

it("内联读取登记样本，无关联资源明确使用样本而非外部文件", () => {
  expect(
    dataSourceReadiness({ sourceType: "inline", status: "draft" })
  ).toMatchObject({ ready: true, mode: "inline" });
  expect(
    dataAssetReadiness({ name: "文件说明", status: "active" })
  ).toMatchObject({
    ready: true,
    mode: "inline",
    message: expect.stringContaining("登记样本"),
  });
});
it.each(["inline", "api", "file", "jdbc"])(
  "%s停用后不能读取或再次发起测试",
  sourceType => {
    const source = {
      sourceType,
      status: "disabled",
      connection: { endpoint: "mysql://db/orders" },
    };
    expect(dataSourceReadiness(source)).toMatchObject({
      ready: false,
      message: expect.stringContaining("停用"),
    });
    expect(canProbeDataSource(source)).toBe(false);
  }
);
it.each(["api", "file", "other"])(
  "%s即使标记verified也不能冒充可读取资源",
  sourceType => {
    expect(
      dataSourceReadiness({ sourceType, status: "verified" })
    ).toMatchObject({ ready: false, mode: null });
  }
);
it("API连通测试与读取是不同能力，文件和未知类型不提供测试", () => {
  expect(canProbeDataSource({ sourceType: "api", status: "draft" })).toBe(true);
  expect(dataSourceCapability("api").probeLabel).toBe("测试连通性");
  expect(canProbeDataSource({ sourceType: "file" })).toBe(false);
  expect(canProbeDataSource({ sourceType: "other" })).toBe(false);
});
it.each(["", "not a URL", "postgres://db/orders", "jdbc:mysql://db/orders"])(
  "未支持或非法JDBC地址%s不能读取",
  endpoint => {
    expect(
      dataSourceReadiness({
        sourceType: "jdbc",
        status: "verified",
        connection: { endpoint },
      }).ready
    ).toBe(false);
  }
);
it("MySQL须验证且使用受支持协议；检查结果不宣称执行时连接必定成功", () => {
  const source = {
    sourceType: "jdbc",
    status: "draft",
    connection: { endpoint: "mysql://db/orders" },
  };
  expect(dataSourceReadiness(source).ready).toBe(false);
  expect(dataSourceReadiness({ ...source, status: "verified" })).toMatchObject({
    ready: true,
    mode: "mysql",
    message: expect.stringContaining("执行时为准"),
  });
});
it("关联源缺失、资源停用及不合法表名阻止读取，不退回资源样本", () => {
  expect(
    dataAssetReadiness({ name: "orders", sourceId: "foreign" }).ready
  ).toBe(false);
  expect(dataAssetReadiness({ name: "orders", status: "disabled" }).ready).toBe(
    false
  );
  const source = {
    sourceType: "jdbc",
    status: "verified",
    connection: { endpoint: "mysql://db/orders" },
  };
  expect(
    dataAssetReadiness({ name: "orders;DELETE", sourceId: "mysql" }, source)
      .ready
  ).toBe(false);
  expect(
    dataAssetReadiness({ name: "order_items", sourceId: "mysql" }, source).ready
  ).toBe(true);
});
