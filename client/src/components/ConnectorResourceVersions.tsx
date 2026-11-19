import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const labels = {
  api_read: "API 分页读取",
  file_read: "CSV 文件读取",
  receipt_write: "外部写回",
};
type Kind = keyof typeof labels;
const selectClass =
  "h-10 min-w-0 w-full rounded border border-border bg-card px-2";
const asBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const input = new FileReader();
    input.onload = () => resolve(String(input.result).split(",")[1]);
    input.onerror = () => reject(Error("读取所选文件失败。"));
    input.readAsDataURL(file);
  });
export default function ConnectorResourceVersions({
  projectId,
  assets,
  sources,
  canEdit,
}: {
  projectId: string;
  assets: Array<{ id: string; name: string; sourceId?: string | null }>;
  sources: Array<{ id: string; sourceType: string; status: string }>;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [assetId, setAsset] = useState(""),
    [kind, setKind] = useState<Kind>("api_read");
  const [label, setLabel] = useState(""),
    [endpoint, setEndpoint] = useState(""),
    [path, setPath] = useState("rows"),
    [dataset, setDataset] = useState(""),
    [rowKey, setRowKey] = useState("id");
  const [file, setFile] = useState<File | null>(null),
    [mapping, setMapping] = useState("{}"),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  const [pages, setPages] = useState(50),
    [rows, setRows] = useState(1000),
    [bytes, setBytes] = useState(524288),
    [timeout, setTimeoutMs] = useState(8000);
  const versions = trpc.connector.versions.useQuery({ projectId });
  const endpoints = trpc.project.serviceEndpoints.useQuery(
    { projectId },
    { enabled: open && kind !== "file_read" }
  );
  const register = trpc.connector.register.useMutation(),
    utils = trpc.useUtils();
  const eligible = assets.filter(asset =>
    sources.some(
      s =>
        s.id === asset.sourceId &&
        s.status !== "disabled" &&
        s.sourceType === (kind === "file_read" ? "file" : "api")
    )
  );
  if (
    !assets.some(a =>
      sources.some(
        s => s.id === a.sourceId && ["file", "api"].includes(s.sourceType)
      )
    )
  )
    return null;
  const submit = async () => {
    setPending(true);
    setMessage("");
    try {
      const common = { projectId, assetId, label };
      let saved;
      if (kind === "file_read") {
        if (!file || file.size > 524288)
          throw Error("请选择 512 KiB 以内的 UTF-8 CSV。");
        saved = await register.mutateAsync({
          ...common,
          kind,
          fileName: file.name,
          base64: await asBase64(file),
        });
      } else if (kind === "api_read") {
        saved = await register.mutateAsync({
          ...common,
          kind,
          endpointRef: endpoint,
          path,
          rowKey,
          datasetVersion: dataset,
          mapping: JSON.parse(mapping),
          maxPages: pages,
          maxRows: rows,
          maxBytes: bytes,
          timeoutMs: timeout,
        });
      } else
        saved = await register.mutateAsync({
          ...common,
          kind,
          endpointRef: endpoint,
          path,
          rowKey,
        });
      await Promise.all([
        versions.refetch(),
        utils.data.resourceOptions.invalidate({ projectId }),
      ]);
      setOpen(false);
      setMessage("已保存版本 " + saved.versionId.slice(0, 12));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "版本保存失败。");
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      className="grid gap-3 rounded-lg border p-4"
      aria-label="数据连接器版本"
    >
      <h3 className="font-semibold">数据连接器版本</h3>
      {versions.error && <p role="alert">{versions.error.message}</p>}
      {!!versions.data?.items.length && (
        <ul className="grid gap-1">
          {versions.data.items.map(v => (
            <li key={v.id}>
              {v.assetName} · {v.label} · {labels[v.kind]} ·{" "}
              <code>{v.id.slice(0, 12)}</code>
              {!v.enabled && " · 已停用"}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !open && (
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => setOpen(true)}
        >
          登记资源版本
        </Button>
      )}
      {canEdit && open && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            操作
            <select
              aria-label="版本操作"
              className={selectClass}
              value={kind}
              onChange={e => {
                const k = e.target.value as Kind;
                setKind(k);
                setAsset("");
                setPath(k === "receipt_write" ? "receipts" : "rows");
              }}
            >
              {Object.entries(labels).map(([k, v]) => (
                <option
                  key={k}
                  value={k}
                  disabled={versions.data?.capabilities[k] === false}
                >
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            资源
            <select
              required
              aria-label="版本所属资源"
              className={selectClass}
              value={assetId}
              onChange={e => setAsset(e.target.value)}
            >
              <option value="">选择项目资源</option>
              {eligible.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            版本名称
            <Input
              required
              maxLength={128}
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
          </label>
          {kind === "file_read" ? (
            <label>
              UTF-8 CSV 文件
              <Input
                required
                type="file"
                accept=".csv,text/csv"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : (
            <>
              <label>
                受管服务端点
                <select
                  required
                  aria-label="版本受管服务端点"
                  className={selectClass}
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                >
                  <option value="">选择已启用端点</option>
                  {endpoints.data
                    ?.filter(e => e.status === "active")
                    .map(e => (
                      <option key={e.refCode} value={e.refCode}>
                        {e.name} · {e.refCode}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                端点内资源路径
                <Input
                  required
                  value={path}
                  onChange={e => setPath(e.target.value)}
                />
              </label>
              <label>
                行唯一键
                <Input
                  required
                  value={rowKey}
                  onChange={e => setRowKey(e.target.value)}
                />
              </label>
              {kind === "api_read" && (
                <>
                  <label>
                    对端数据集版本
                    <Input
                      required
                      value={dataset}
                      onChange={e => setDataset(e.target.value)}
                    />
                  </label>
                  <label>
                    字段映射（目标字段到来源字段的 JSON）
                    <Input
                      value={mapping}
                      onChange={e => setMapping(e.target.value)}
                    />
                  </label>
                  <label>
                    最多页数
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={pages}
                      onChange={e => setPages(e.target.valueAsNumber)}
                    />
                  </label>
                  <label>
                    最多行数
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      value={rows}
                      onChange={e => setRows(e.target.valueAsNumber)}
                    />
                  </label>
                  <label>
                    响应总字节上限
                    <Input
                      type="number"
                      min={1}
                      max={524288}
                      value={bytes}
                      onChange={e => setBytes(e.target.valueAsNumber)}
                    />
                  </label>
                  <label>
                    每页超时（毫秒）
                    <Input
                      type="number"
                      min={500}
                      max={10000}
                      value={timeout}
                      onChange={e => setTimeoutMs(e.target.valueAsNumber)}
                    />
                  </label>
                </>
              )}
            </>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "保存中…" : "保存版本"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
