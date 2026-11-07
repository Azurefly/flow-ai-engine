import type { QueryClient, QueryKey } from "@tanstack/react-query";

// 会话错误先向站内身份接口确认；复用在途读取，避免旧请求误退出新登录账号。
export function refreshAccountIdentity(client: QueryClient) {
  return client.refetchQueries(
    { queryKey: [["auth", "me"]] },
    { cancelRefetch: false }
  ).catch(() => {});
}

export function isPublicSessionQuery(key: QueryKey) {
  const path = key[0];
  return Array.isArray(path) && path.length === 2 &&
    ((path[0] === "auth" && path[1] === "me") ||
     (path[0] === "config" && path[1] === "publicGeneral"));
}

export async function clearAccountQueries(client: QueryClient) {
  const filters = { predicate: (query: { queryKey: QueryKey }) => !isPublicSessionQuery(query.queryKey) };
  await client.cancelQueries(filters);
  client.removeQueries(filters);
  client.getMutationCache().clear();
}
