export function updateAggregateMetric(
  metrics: Record<string, unknown>[],
  index: number,
  patch: Record<string, unknown>
) {
  return metrics.map((metric, itemIndex) =>
    itemIndex === index ? { ...metric, ...patch } : metric
  );
}

export function appendAggregateMetric(metrics: Record<string, unknown>[]) {
  const names = new Set(metrics.map(metric => String(metric.name ?? "")));
  let suffix = 1;
  while (names.has(`count_${suffix}`)) suffix++;
  return [
    ...metrics,
    { name: `count_${suffix}`, operation: "count", field: "" },
  ];
}
