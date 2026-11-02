/** Synthetic inputs and explicit expected IDs; no product comparator is used as an oracle. */
export function makeTypedSortFixture(assetId: string) {
  const rows: { id: string; group: string; v?: unknown; tie: number }[] = [];
  const asc: string[] = [],
    desc: string[] = [];
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const [index, order] of permutations.entries()) {
    const group = `P${index}`;
    for (const item of order)
      rows.push({
        id: `${group}-${item}`,
        group,
        v: [3, "2", "10"][item],
        tie: 0,
      });
    asc.push(`${group}-0`, `${group}-2`, `${group}-1`);
    desc.push(`${group}-1`, `${group}-2`, `${group}-0`);
  }
  rows.push(
    { id: "empty-missing", group: "Q", tie: 2 },
    { id: "empty-null", group: "Q", v: null, tie: 1 },
    { id: "empty-zero", group: "Q", v: 0, tie: 3 },
    { id: "object-second", group: "R", v: { b: 2, a: 1 }, tie: 2 },
    { id: "object-first", group: "R", v: { a: 1, b: 2 }, tie: 1 }
  );
  asc.push(
    "empty-null",
    "empty-missing",
    "empty-zero",
    "object-first",
    "object-second"
  );
  desc.push(
    "empty-zero",
    "empty-null",
    "empty-missing",
    "object-first",
    "object-second"
  );
  const specs = [
    ["start", "start", "开始", {}],
    ["source", "source", "隔离内联样本", { assetId, limit: 100 }],
    [
      "asc",
      "sort",
      "升序比较",
      { fields: ["group", { field: "v", direction: "asc" }, "tie"] },
    ],
    [
      "desc",
      "sort",
      "降序比较",
      { fields: ["group", { field: "v", direction: "desc" }, "tie"] },
    ],
    ["ascResult", "end", "升序结果", {}],
    ["descResult", "end", "降序结果", {}],
  ] as const;
  return {
    rows,
    expected: { ascResult: asc, descResult: desc },
    definition: {
      schemaVersion: 1,
      settings: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: specs.map(([id, type, name, config], index) => ({
        id,
        type,
        name,
        config,
        position: { x: index * 240, y: 0 },
      })),
      edges: [
        ["start", "source"],
        ["source", "asc"],
        ["source", "desc"],
        ["asc", "ascResult"],
        ["desc", "descResult"],
      ].map(([sourceNodeId, targetNodeId]) => ({
        id: `${sourceNodeId}-${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
      })),
    },
  };
}
