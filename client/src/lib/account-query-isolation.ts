import type { QueryClient, QueryKey } from "@tanstack/react-query";

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
}
