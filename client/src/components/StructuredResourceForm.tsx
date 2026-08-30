import { Button } from "@/components/ui/button";
import { CreationDialog } from "@/components/CreationDialog";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type ResourceMutation = {
  mutateAsync: (input: any) => Promise<unknown>;
  isPending: boolean;
};

type SourceDraft = {
  name: string;
  sourceType: "jdbc" | "api" | "file" | "inline";
  description: string;
  endpoint: string;
  credentialReference: string;
};

/** Keep the UI field name compatible with the server's top-level credentialRef contract. */
export function buildDataSourceCreateInput(
  projectId: string,
  source: SourceDraft
) {
  const credentialRef = source.credentialReference.trim() || undefined;
  return {
    projectId,
    name: source.name,
    sourceType: source.sourceType,
    connection: {
      description: source.description,
      endpoint: source.endpoint || undefined,
      credentialReference: credentialRef,
    },
    credentialRef,
  };
}

export function StructuredResourceForm({
  tab,
  projectId,
  sources,
  createSource,
  createAsset,
}: {
  tab: "sources" | "assets";
  projectId: string;
  sources: any[];
  createSource: ResourceMutation;
  createAsset: ResourceMutation;
}) {
  const [source, setSource] = useState<SourceDraft>({
    name: "",
    sourceType: "inline",
    description: "",
    endpoint: "",
    credentialReference: "",
  });
  const [asset, setAsset] = useState({
    name: "",
    sourceId: "",
    assetType: "dataset",
  });
  const [schemaRows, setSchemaRows] = useState([
    { name: "id", type: "string" },
  ]);
  const [sampleRows, setSampleRows] = useState([
    { key: "id", value: "sample-1" },
  ]);
  const [open, setOpen] = useState(false);
  const fieldClass =
    "h-9 w-full rounded border border-slate-200 bg-white px-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
  const panel =
    "grid h-fit gap-3 rounded-lg border border-[#cbd9f5] bg-white p-4 shadow-sm";
  const title = tab === "sources" ? "添加数据源" : "资源探查结果";
  const description =
    tab === "sources"
      ? "使用普通字段登记连接说明、地址和凭据引用；不显示或要求 JSON，不允许录入实际密钥。"
      : "通过字段行和样本键值对录入资源结构，不需要编辑 JSON。";
  const updateSchema = (index: number, key: "name" | "type", value: string) =>
    setSchemaRows(rows =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      )
    );
  const updateSample = (index: number, key: "key" | "value", value: string) =>
    setSampleRows(rows =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      )
    );
  const submit = async () => {
    try {
      if (tab === "sources") {
        await createSource.mutateAsync(
          buildDataSourceCreateInput(projectId, source)
        );
        setSource({
          name: "",
          sourceType: "inline",
          description: "",
          endpoint: "",
          credentialReference: "",
        });
      } else {
        await createAsset.mutateAsync({
          projectId,
          sourceId: asset.sourceId || null,
          name: asset.name,
          assetType: asset.assetType,
          schema: schemaRows.filter(row => row.name.trim()),
          sample: sampleRows.some(row => row.key.trim())
            ? [
                Object.fromEntries(
                  sampleRows
                    .filter(row => row.key.trim())
                    .map(row => [row.key, row.value])
                ),
              ]
            : [],
        });
        setAsset({ name: "", sourceId: "", assetType: "dataset" });
      }
      setOpen(false);
    } catch {
      /* mutation reports the error and preserves the form */
    }
  };
  const fields =
    tab === "sources" ? (
      <>
        <Input
          placeholder="数据源名称"
          value={source.name}
          onChange={event => setSource({ ...source, name: event.target.value })}
          required
        />
        <select
          className={fieldClass}
          value={source.sourceType}
          onChange={event =>
            setSource({
              ...source,
              sourceType: event.target.value as SourceDraft["sourceType"],
            })
          }
        >
          <option value="inline">内联样本</option>
          <option value="file">文件</option>
          <option value="api">API</option>
          <option value="jdbc">JDBC</option>
        </select>
        <Input
          placeholder="连接说明，例如：订单服务只读接口"
          value={source.description}
          onChange={event =>
            setSource({ ...source, description: event.target.value })
          }
          required
        />
        <Input
          placeholder="服务地址或文件位置（可选）"
          value={source.endpoint}
          onChange={event =>
            setSource({ ...source, endpoint: event.target.value })
          }
        />
        <Input
          placeholder="凭据引用名称（可选，不输入实际密钥）"
          value={source.credentialReference}
          onChange={event =>
            setSource({ ...source, credentialReference: event.target.value })
          }
        />
      </>
    ) : (
      <>
        <Input
          placeholder="资源名称"
          value={asset.name}
          onChange={event => setAsset({ ...asset, name: event.target.value })}
          required
        />
        <select
          className={fieldClass}
          value={asset.sourceId}
          onChange={event =>
            setAsset({ ...asset, sourceId: event.target.value })
          }
        >
          <option value="">不关联数据源</option>
          {sources.map(sourceItem => (
            <option key={sourceItem.id} value={sourceItem.id}>
              {sourceItem.name}
            </option>
          ))}
        </select>
        <select
          className={fieldClass}
          value={asset.assetType}
          onChange={event =>
            setAsset({ ...asset, assetType: event.target.value })
          }
        >
          <option value="dataset">数据集</option>
          <option value="table">表</option>
          <option value="view">视图</option>
          <option value="file">文件</option>
          <option value="endpoint">端点</option>
        </select>
        <RowEditor
          title="字段结构"
          rows={schemaRows}
          onAdd={() =>
            setSchemaRows(rows => [...rows, { name: "", type: "string" }])
          }
          onDelete={index =>
            setSchemaRows(rows =>
              rows.filter((_, rowIndex) => rowIndex !== index)
            )
          }
          firstPlaceholder="字段名"
          secondPlaceholder="类型"
          onChange={(index, first, second) => {
            updateSchema(index, "name", first);
            updateSchema(index, "type", second);
          }}
        />
        <RowEditor
          title="一行样本"
          rows={sampleRows}
          onAdd={() => setSampleRows(rows => [...rows, { key: "", value: "" }])}
          onDelete={index =>
            setSampleRows(rows =>
              rows.filter((_, rowIndex) => rowIndex !== index)
            )
          }
          firstPlaceholder="字段名"
          secondPlaceholder="样本值"
          onChange={(index, first, second) => {
            updateSample(index, "key", first);
            updateSample(index, "value", second);
          }}
        />
      </>
    );
  return (
    <div className={panel}>
      <div>
        <p className="font-semibold text-slate-800">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <Button
        type="button"
        className="w-fit bg-[#2d6bea] hover:bg-[#255bc8]"
        onClick={() => setOpen(true)}
      >
        <Plus size={14} />
        {title}
      </Button>
      <CreationDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        submitLabel="保存"
        pending={
          tab === "sources" ? createSource.isPending : createAsset.isPending
        }
        onSubmit={submit}
        className="max-w-2xl"
      >
        {fields}
      </CreationDialog>
    </div>
  );
}

function RowEditor({
  title,
  rows,
  onAdd,
  onDelete,
  firstPlaceholder,
  secondPlaceholder,
  onChange,
}: {
  title: string;
  rows: Array<Record<string, string>>;
  onAdd: () => void;
  onDelete: (index: number) => void;
  firstPlaceholder: string;
  secondPlaceholder: string;
  onChange: (index: number, first: string, second: string) => void;
}) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      <div className="mt-2 grid gap-2">
        {rows.map((row, index) => {
          const values = Object.values(row);
          return (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                placeholder={firstPlaceholder}
                value={values[0] ?? ""}
                onChange={event =>
                  onChange(index, event.target.value, values[1] ?? "")
                }
              />
              <Input
                placeholder={secondPlaceholder}
                value={values[1] ?? ""}
                onChange={event =>
                  onChange(index, values[0] ?? "", event.target.value)
                }
              />
              <button
                type="button"
                className="text-slate-400 hover:text-red-600"
                onClick={() => onDelete(index)}
                aria-label={`删除${title}行`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="w-fit text-xs text-[#245fc8] hover:underline"
          onClick={onAdd}
        >
          + 添加一行
        </button>
      </div>
    </div>
  );
}
