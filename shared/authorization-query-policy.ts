export function authorizationQueryPolicy(enabled: boolean) {
  return {
    enabled,
    retry: false as const,
    refetchInterval: enabled ? 30_000 : (false as const),
    refetchIntervalInBackground: false as const,
  };
}
