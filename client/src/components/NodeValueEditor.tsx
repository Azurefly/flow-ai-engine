import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  makeValueReference,
  readValueParts,
  referenceLocation,
  writeValueParts,
  type ValuePart,
  type ValueSource,
} from "@shared/node-value-reference";

export const NodeValueSources = createContext<ValueSource[]>([]);
const control = "node-value-control";

/** A visual front end for existing templates, including type-preserving exact references. */
export function NodeValueEditor({
  value,
  onChange,
  disabled,
  label = "值",
  multiline = false,
  textOnly = false,
  referenceOnly = false,
  singleField = false,
  singleReference = false,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  label?: string;
  multiline?: boolean;
  textOnly?: boolean;
  referenceOnly?: boolean;
  singleField?: boolean;
  singleReference?: boolean;
}) {
  const parse = (next: unknown): ValuePart[] =>
    singleField &&
    typeof next === "string" &&
    !/^\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}$/.test(next)
      ? [{ kind: "text", value: next }]
      : readValueParts(next);
  const sources = useContext(NodeValueSources);
  const id = useId();
  const [parts, setParts] = useState(() => parse(value));
  const emitted = useRef(value);
  const [editing, setEditing] = useState<number | null>(null);
  const [sourceKey, setSourceKey] = useState("input");
  const [field, setField] = useState("");
  const [pickerError, setPickerError] = useState("");
  const [numberDraft, setNumberDraft] = useState(String(value ?? ""));
  useEffect(() => {
    if (!Object.is(value, emitted.current)) {
      emitted.current = value;
      setParts(parse(value));
      setNumberDraft(String(value ?? ""));
      setEditing(null);
    }
  }, [value]);
  const commit = (next: unknown, nextParts = parse(next)) => {
    emitted.current = next;
    setParts(nextParts);
    onChange(next);
  };
  const changeParts = (next: ValuePart[]) =>
    commit(writeValueParts(next), next);
  const hasReferences = parts.some(part => part.kind === "reference");
  const fixedType =
    value === null
      ? "null"
      : typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "text";
  const source = sources.find(item => item.key === sourceKey);
  const openPicker = (index: number) => {
    const part = parts[index];
    const location =
      part?.kind === "reference" ? referenceLocation(part.path, sources) : null;
    setSourceKey(location?.source.key ?? sources[0]?.key ?? "input");
    setField(location?.field ?? "");
    setPickerError("");
    setEditing(index);
  };
  const applyReference = () => {
    const reference = makeValueReference(sourceKey, field);
    if (
      !source ||
      !reference ||
      (singleField && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.trim()))
    ) {
      setPickerError("请选择数据来源，并填写有效字段名称。嵌套字段用点分隔。");
      return;
    }
    const next = singleField || singleReference ? [] : [...parts];
    if (singleField || singleReference) next.push(reference);
    else if (editing === -1) next.push(reference);
    else next[editing!] = reference;
    changeParts(next.filter(part => part.kind !== "text" || part.value !== ""));
    setEditing(null);
  };
  return (
    <div className="node-value-editor" role="group" aria-label={label}>
      {!referenceOnly && (
        <div className="node-value-heading">
          <span>
            {hasReferences
              ? parts.length === 1
                ? "引用数据"
                : "拼接内容"
              : "固定值"}
          </span>
          {!textOnly && !singleReference && !hasReferences && (
            <select
              aria-label={`${label}类型`}
              className={control}
              disabled={disabled}
              value={fixedType}
              onChange={event => {
                const type = event.target.value;
                const next =
                  type === "number"
                    ? Number.isFinite(Number(value))
                      ? Number(value)
                      : 0
                    : type === "boolean"
                      ? value === true
                      : type === "null"
                        ? null
                        : String(value ?? "");
                setNumberDraft(String(next ?? ""));
                commit(next);
              }}
            >
              <option value="text">文字</option>
              <option value="number">数字</option>
              <option value="boolean">是／否</option>
              <option value="null">空值</option>
            </select>
          )}
        </div>
      )}
      <div className="node-value-body">
        {!referenceOnly &&
          (!hasReferences && fixedType === "boolean" ? (
            <select
              className={control}
              aria-label={label}
              value={String(value)}
              disabled={disabled}
              onChange={event => commit(event.target.value === "true")}
            >
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          ) : !hasReferences && fixedType === "null" ? (
            <p className="node-value-hint">不提供值。</p>
          ) : !hasReferences && fixedType === "number" ? (
            <input
              className={control}
              type="number"
              step="any"
              aria-label={label}
              value={numberDraft}
              disabled={disabled}
              onChange={event => {
                setNumberDraft(event.target.value);
                // Keep invalid drafts visible and in the definition, so preflight cannot silently use an old number.
                const next =
                  event.target.value === "" ? "" : Number(event.target.value);
                emitted.current = next;
                onChange(next);
              }}
              onBlur={() => {
                if (numberDraft === "") commit("");
              }}
            />
          ) : (
            (parts.length
              ? parts
              : [{ kind: "text", value: String(value ?? "") } as ValuePart]
            ).map((part, index) => {
              if (part.kind === "reference") {
                const location = referenceLocation(part.path, sources);
                const fieldLabel =
                  location?.source.fields.find(
                    item => item.value === location.field
                  )?.label ?? location?.field;
                return (
                  <div className="node-value-reference" key={index}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`修改${label}的数据引用${index + 1}`}
                      onClick={() => openPicker(index)}
                    >
                      <strong>
                        {location?.source.label ?? "已有数据引用"}
                      </strong>
                      <span>
                        {location ? fieldLabel || "全部数据" : part.path}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`移除${label}的数据引用${index + 1}`}
                      disabled={disabled}
                      onClick={() =>
                        changeParts(
                          parts.filter((_, partIndex) => partIndex !== index)
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                    {!location && (
                      <p className="node-value-hint">
                        此来源未在当前上游目录中，原引用已保留；可重新选择。
                      </p>
                    )}
                  </div>
                );
              }
              if (singleReference)
                return (
                  <p key={index} className="node-value-hint">
                    请选择包含字段的一组数据，或改为逐项填写字段；此处不使用文字拼接。
                  </p>
                );
              const props = {
                className: control,
                "aria-label": hasReferences
                  ? `${label}文字${index + 1}`
                  : label,
                value: part.value,
                disabled,
                onChange: (
                  event: React.ChangeEvent<
                    HTMLInputElement | HTMLTextAreaElement
                  >
                ) => {
                  const next = parts.length ? [...parts] : [part];
                  next[index] = { kind: "text", value: event.target.value };
                  // Pasted old templates become readable reference cards too.
                  if (event.target.value.includes("{{"))
                    commit(writeValueParts(next));
                  else changeParts(next);
                },
              };
              return (
                <div className="node-value-text" key={index}>
                  {multiline ? <textarea {...props} /> : <input {...props} />}
                  {hasReferences && (
                    <button
                      type="button"
                      aria-label={`删除${label}的文字${index + 1}`}
                      disabled={disabled}
                      onClick={() =>
                        changeParts(
                          parts.filter((_, partIndex) => partIndex !== index)
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })
          ))}
        {editing === null ? (
          <div className="node-value-actions">
            {!((singleField || singleReference) && hasReferences) && (
              <button
                type="button"
                disabled={disabled || !sources.length}
                onClick={() => openPicker(-1)}
              >
                <Plus size={13} />
                {hasReferences ? "继续插入数据" : "引用流程数据"}
              </button>
            )}
            {hasReferences && !singleField && !singleReference && (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  setParts([...parts, { kind: "text", value: "" }])
                }
              >
                <Plus size={13} />
                添加文字
              </button>
            )}
          </div>
        ) : (
          <div
            className="node-value-picker"
            role="group"
            aria-label={`${label}数据来源`}
          >
            <label>
              数据来源
              <select
                className={control}
                value={sourceKey}
                disabled={disabled}
                onChange={event => {
                  setSourceKey(event.target.value);
                  setField("");
                  setPickerError("");
                }}
              >
                {sources.map(item => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              读取字段
              <input
                className={control}
                value={field}
                disabled={disabled}
                list={`${id}-fields`}
                placeholder={
                  singleField ? "选择或填写字段名称" : "留空使用全部数据"
                }
                onChange={event => {
                  setField(event.target.value);
                  setPickerError("");
                }}
              />
            </label>
            <datalist id={`${id}-fields`}>
              {source?.fields.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </datalist>
            {source?.fields.length ? (
              <div className="node-value-suggestions" aria-label="可选字段">
                {source.fields.slice(0, 12).map(item => (
                  <button
                    type="button"
                    disabled={disabled}
                    key={item.value}
                    onClick={() => setField(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="node-value-hint">
              {source?.hint || "选择字段，或填写实际字段名称。"}{" "}
              {!singleField && "嵌套字段例如 body.orderId，无需填写大括号。"}
            </p>
            {pickerError && <p role="alert">{pickerError}</p>}
            <div className="node-value-actions">
              <button
                type="button"
                className="node-value-apply"
                disabled={disabled}
                onClick={applyReference}
              >
                使用此数据
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
