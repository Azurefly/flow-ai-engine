import { Button } from "@/components/ui/button";
import { CreationDialog } from "@/components/CreationDialog";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type ResourceMutation = {
  mutateAsync: (input: any) => Promise<unknown>;
  isPending: boolean;
};

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
  const [source, setSource] = useState({
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
  const [schemaRows, setSchemaRows] = useState([{ name: "", type: "string" }]);
  const [sampleRows, setSampleRows] = useState<
    Array<{ key: string; value: string }>
  >([]);
  const [open, setOpen] = useState(false);
  const fieldClass =
    "h-11 w-full min-w-0 rounded border border-border bg-card px-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10";
  const panel =
    "grid h-fit min-w-0 gap-3 rounded-lg border border-aiflow-info-border bg-card p-4 shadow-sm";
  const title = tab === "sources" ? "添加数据源" : "资源探查结果";
  const description =
    tab === "sources"
      ? "登记连接说明、地址和部署环境中的凭据引用。请勿填写实际密钥。"
      : "填写字段名称、类型和样本数据，登记可供流程引用的资源。";
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
        await createSource.mutateAsync({
          projectId,
          name: source.name,
          sourceType: source.sourceType,
          connection: {
            description: source.description,
            endpoint: source.endpoint || undefined,
          },
          credentialRef: source.credentialReference || undefined,
        });
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
        setSchemaRows([{ name: "", type: "string" }]);
        setSampleRows([]);
      }
      setOpen(false);
    } catch {
      /* mutation reports the error and preserves the form */
    }
  };
  const fields =
    tab === "sources" ? (
      <>
        <ResourceField label="数据源名称">
          <Input
            placeholder="例如：订单服务"
            value={source.name}
            onChange={event =>
              setSource({ ...source, name: event.target.value })
            }
            required
          />
        </ResourceField>
        <ResourceField label="数据源类型">
          <select
            className={fieldClass}
            value={source.sourceType}
            onChange={event =>
              setSource({ ...source, sourceType: event.target.value })
            }
          >
            <option value="inline">内联样本</option>
            <option value="file">文件</option>
            <option value="api">API</option>
            <option value="jdbc">JDBC</option>
          </select>
        </ResourceField>
        <ResourceField label="连接说明">
          <Input
            placeholder="说明用途和访问范围，例如：只读查询订单"
            value={source.description}
            onChange={event =>
              setSource({ ...source, description: event.target.value })
            }
            required
          />
        </ResourceField>
        <ResourceField label="服务地址或文件位置（可选）">
          <Input
            placeholder="填写 URL 或文件位置"
            value={source.endpoint}
            onChange={event =>
              setSource({ ...source, endpoint: event.target.value })
            }
          />
        </ResourceField>
        <ResourceField label="凭据引用名称（可选）">
          <Input
            placeholder="只填写部署环境中的引用名，不输入密钥"
            value={source.credentialReference}
            onChange={event =>
              setSource({ ...source, credentialReference: event.target.value })
            }
          />
        </ResourceField>
      </>
    ) : (
      <>
        <ResourceField label="资源名称">
          <Input
            placeholder="例如：订单明细"
            value={asset.name}
            onChange={event => setAsset({ ...asset, name: event.target.value })}
            required
          />
        </ResourceField>
        <ResourceField label="关联数据源">
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
        </ResourceField>
        <ResourceField label="资源类型">
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
        </ResourceField>
        <RowEditor
          title="字段结构"
          helpText="至少填写字段名和类型；类型默认为 string。"
          rows={schemaRows}
          requiredFields
          minimumRows={1}
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
          helpText="样本行可选；不需要样本时保持空白。"
          emptyMessage="未添加样本行。"
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
        <p className="aiflow-type-card-title font-semibold text-foreground">
          {title}
        </p>
        <p className="aiflow-type-body mt-1 text-muted-foreground">
          {description}
        </p>
      </div>
      <Button
        type="button"
        className="h-11 w-fit bg-blue-600 text-white shadow-2xs hover:bg-blue-700 sm:h-10"
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
        submitDisabled={
          tab === "assets" &&
          !schemaRows.some(row => row.name.trim() && row.type.trim())
        }
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
  helpText,
  emptyMessage,
  rows,
  requiredFields = false,
  minimumRows = 0,
  onAdd,
  onDelete,
  firstPlaceholder,
  secondPlaceholder,
  onChange,
}: {
  title: string;
  helpText?: string;
  emptyMessage?: string;
  rows: Array<Record<string, string>>;
  requiredFields?: boolean;
  minimumRows?: number;
  onAdd: () => void;
  onDelete: (index: number) => void;
  firstPlaceholder: string;
  secondPlaceholder: string;
  onChange: (index: number, first: string, second: string) => void;
}) {
  return (
    <div className="rounded border border-border bg-muted p-3">
      <p className="aiflow-type-body font-semibold text-foreground">{title}</p>
      {helpText && (
        <p className="aiflow-type-body mt-1 text-muted-foreground">
          {helpText}
        </p>
      )}
      <div className="mt-2 grid gap-2">
        {rows.length === 0 && emptyMessage && (
          <p className="aiflow-type-body text-muted-foreground">
            {emptyMessage}
          </p>
        )}
        {rows.map((row, index) => {
          const values = Object.values(row);
          return (
            <div
              key={index}
              className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <ResourceField label={firstPlaceholder}>
                <Input
                  placeholder={firstPlaceholder}
                  aria-label={`${title}第 ${index + 1} 行${firstPlaceholder}`}
                  value={values[0] ?? ""}
                  required={requiredFields}
                  onChange={event =>
                    onChange(index, event.target.value, values[1] ?? "")
                  }
                />
              </ResourceField>
              <ResourceField label={secondPlaceholder}>
                <Input
                  placeholder={secondPlaceholder}
                  aria-label={`${title}第 ${index + 1} 行${secondPlaceholder}`}
                  value={values[1] ?? ""}
                  required={requiredFields}
                  onChange={event =>
                    onChange(index, values[0] ?? "", event.target.value)
                  }
                />
              </ResourceField>
              <button
                type="button"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center justify-self-end rounded text-muted-foreground hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 sm:h-10 sm:w-10 sm:self-end"
                disabled={rows.length <= minimumRows}
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
          className="aiflow-type-control inline-flex min-h-11 w-fit items-center rounded px-2 text-aiflow-info hover:underline sm:min-h-10"
          onClick={onAdd}
        >
          + 添加一行
        </button>
      </div>
    </div>
  );
}

function ResourceField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="aiflow-type-control grid min-w-0 gap-1 font-medium text-muted-foreground [&_input]:h-11 [&_select]:h-11 sm:[&_input]:h-10 sm:[&_select]:h-10">
      <span>{label}</span>
      {children}
    </label>
  );
}
