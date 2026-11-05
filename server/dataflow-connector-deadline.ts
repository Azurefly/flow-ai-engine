/** Bound one connector operation without promising to kill a remote server query. */
export async function withDataflowConnectorDeadline<T>(
  connection: { destroy: () => void },
  run: () => Promise<T>,
  configured = Number(process.env.DATA_CONNECTOR_TIMEOUT_MS ?? 60_000)
) {
  const timeoutMs = Number.isFinite(configured)
    ? Math.min(120_000, Math.max(1_000, configured))
    : 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try { connection.destroy(); } catch { /* Deadline still rejects if cleanup itself fails. */ }
          reject(
            new Error(`数据连接器等待超过${timeoutMs / 1000}秒，连接已关闭。`)
          );
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
