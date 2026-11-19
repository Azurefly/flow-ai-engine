export type SourceDescriptor = {
  sourceType?: unknown;
  status?: unknown;
  connection?: { endpoint?: unknown } | null;
};

export const dataSourceTypes = [
  {
    value: "inline",
    label: "内联样本",
    description: "校验登记信息；流程读取资源中登记的样本，不连接外部系统。",
    probeLabel: "校验登记",
    canProbe: true,
  },
  {
    value: "jdbc",
    label: "MySQL（JDBC）",
    description:
      "当前仅支持 mysql://；连接验证后可只读查询表或执行只读SQL，不能写回数据库。",
    probeLabel: "测试连接",
    canProbe: true,
  },
  {
    value: "api",
    label: "API（版本化读取 / 受控写回）",
    description:
      "可测试连通性。在数据资源登记受管端点及版本后，流程可分页读取或生成外部写回预览。",
    probeLabel: "测试连通性",
    canProbe: true,
  },
  {
    value: "file",
    label: "文件（版本化 CSV）",
    description:
      "在数据资源中上传 UTF-8 CSV。流程读取所选版本的原始对象。",
    probeLabel: "暂不支持测试",
    canProbe: false,
  },
] as const;

export function dataSourceCapability(sourceType: unknown) {
  return (
    dataSourceTypes.find(type => type.value === sourceType) ?? {
      value: String(sourceType ?? ""),
      label: "未知数据源类型",
      description: "当前版本未提供该类型的测试与读取能力。",
      probeLabel: "暂不支持测试",
      canProbe: false,
    }
  );
}

export type DataReadiness = {
  ready: boolean;
  mode: "inline" | "mysql" | null;
  message: string;
};
const blocked = (message: string): DataReadiness => ({
  ready: false,
  mode: null,
  message,
});
export const isMysqlIdentifier = (value: string) =>
  /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value);

export function dataSourceReadiness(source: SourceDescriptor): DataReadiness {
  if (source.status === "disabled")
    return blocked("数据源已停用，请先恢复并重新核对配置。");
  if (source.sourceType === "inline")
    return { ready: true, mode: "inline", message: "可读取登记样本" };
  if (source.sourceType === "api")
    return blocked("读取 API 需要先在数据资源登记接口合同，并在节点选择固定版本。");
  if (source.sourceType === "file")
    return blocked("读取文件需要先上传 UTF-8 CSV，并在节点选择固定版本。");
  if (source.sourceType !== "jdbc")
    return blocked("当前数据源类型尚不支持流程读取。");
  try {
    if (
      new URL(String(source.connection?.endpoint ?? "").trim()).protocol !==
      "mysql:"
    )
      return blocked("当前仅支持mysql://数据源，其他JDBC驱动尚不可执行。");
  } catch {
    return blocked("请配置合法的mysql://连接地址后测试连接。");
  }
  if (source.status !== "verified")
    return blocked("MySQL数据源尚未通过连接测试，请在数据资源中测试连接。");
  return {
    ready: true,
    mode: "mysql",
    message: "可只读查询MySQL；连通性与读取权限仍以执行时为准",
  };
}

export function dataAssetReadiness(
  asset: { name?: unknown; sourceId?: unknown; status?: unknown },
  source?: SourceDescriptor
): DataReadiness {
  if (asset.status !== undefined && asset.status !== "active")
    return blocked("数据资源已停用，不能用于流程读取。");
  if (!asset.sourceId)
    return {
      ready: true,
      mode: "inline",
      message: "读取登记样本；未关联外部数据源",
    };
  if (!source)
    return blocked("关联数据源不存在或不属于当前业务，请重新选择资源。");
  const readiness = dataSourceReadiness(source);
  if (
    readiness.ready &&
    readiness.mode === "mysql" &&
    !isMysqlIdentifier(String(asset.name ?? ""))
  )
    return blocked(
      "MySQL资源名称必须填写实际表名，以字母或下划线开头，仅允许字母、数字、下划线和美元符。"
    );
  return readiness;
}

export function canProbeDataSource(source: SourceDescriptor) {
  return (
    source.status !== "disabled" &&
    dataSourceCapability(source.sourceType).canProbe
  );
}
