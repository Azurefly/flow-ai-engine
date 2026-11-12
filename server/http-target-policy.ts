/** Extra public HTTP origins are granted by the deployment operator, never by a workflow. */
export function assertAllowedHttpPort(url: URL) {
  if (!url.port || ["80", "443"].includes(url.port)) return;
  const allowed = (process.env.FLOW_HTTP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .some(entry => {
      try {
        const candidate = new URL(entry.trim());
        return (
          ["http:", "https:"].includes(candidate.protocol) &&
          !candidate.username &&
          !candidate.password &&
          candidate.pathname === "/" &&
          !candidate.search &&
          !candidate.hash &&
          candidate.origin === url.origin
        );
      } catch {
        return false;
      }
    });
  if (!allowed)
    throw new Error(
      "服务端网络策略默认仅允许 80 或 443 端口。自建服务请使用 HTTPS 反向代理，或由部署管理员将准确的协议、主机和端口登记到 FLOW_HTTP_ALLOWED_ORIGINS；私有网络地址仍不允许访问。"
    );
}
