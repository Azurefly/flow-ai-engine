export function httpResponseDiagnostic(status: number, statusText: string) {
  const hint =
    status === 401
      ? "远端要求认证，请检查项目服务端点的密钥和认证方式。"
      : status === 403
        ? "远端服务拒绝访问，请检查令牌权限、接口访问策略及限流；此响应不等同于本地网络策略拦截。"
        : status === 404
          ? "远端未找到接口，请检查服务端点基础地址与节点相对路径。"
          : status === 429
            ? "远端请求限流，请降低调用频率并稍后重试。"
            : status >= 500
              ? "远端服务异常，请检查服务状态或稍后重试。"
              : status >= 300 && status < 400
                ? "远端返回重定向；为保护认证信息，本节点不自动跟随，请登记最终服务地址。"
                : "请核对远端接口要求、请求方法和参数。";
  return `HTTP 节点请求失败：${status} ${statusText}。${hint}`;
}

export function httpTransportDiagnostic(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const hint: Record<string, string> = {
    ECONNREFUSED: "目标端口拒绝连接，请核对服务端点端口和远端监听状态。",
    ECONNRESET:
      "连接被远端或中间网络重置，请核对目标端口、HTTP/HTTPS 协议和反向代理配置。",
    ENOTFOUND: "无法解析服务域名，请检查地址和服务端 DNS 配置。",
    EAI_AGAIN: "服务域名解析暂时失败，请检查服务端 DNS 后重试。",
    ETIMEDOUT: "连接超时，请检查服务器到目标地址的网络连通性。",
  };
  return hint[code]
    ? new Error(`HTTP 连接失败（${code}）：${hint[code]}`)
    : error;
}
