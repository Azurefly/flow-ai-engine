import { trpc } from "@/lib/trpc";
import type { SettingsForm } from "@shared/system-settings-draft";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** Reuse the parent's independent draft, save, export and conflict protection. */
export default function ModelServiceFields({
  form,
  onChange,
  token,
  blocked,
  credential,
  onCredentialChange,
}: {
  form: SettingsForm;
  onChange: (patch: Partial<SettingsForm>) => void;
  token: string;
  blocked: boolean;
  credential: { value: string; clear: boolean };
  onCredentialChange: (value: string, clear?: boolean) => void;
}) {
  const status = trpc.config.modelService.useQuery(undefined, { retry: false });
  const check = trpc.config.checkModelService.useMutation({
    retry: false,
    onSettled: () => {
      void status.refetch();
    },
  });
  const current = !blocked && check.variables?.expectedConfigToken === token;
  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        {(
          [
            [
              "baseUrl",
              "API 基础地址",
              "https://your-provider.example/v1",
              2048,
            ],
            ["defaultModel", "默认模型 ID", "", 200],
          ] as const
        ).map(([field, label, placeholder, maxLength]) => (
          <label
            key={field}
            className="grid min-w-0 content-start gap-2 text-sm font-medium"
          >
            {label}
            <Input
              className="h-11 min-w-0"
              autoComplete="off"
              spellCheck={false}
              maxLength={maxLength}
              value={form[field]}
              placeholder={placeholder}
              onChange={event => onChange({ [field]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="grid gap-2 text-sm font-medium">
        API Key
        <Input
          className="h-11"
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={8192}
          value={credential.value}
          placeholder={
            status.data?.hasStoredKey
              ? "已配置；留空保留，填写新 Key 更新"
              : "填写大模型调用 Key"
          }
          onChange={event => onCredentialChange(event.target.value)}
        />
      </label>
      {status.data?.hasStoredKey && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={credential.clear}
            onChange={event => onCredentialChange("", event.target.checked)}
          />
          清除网页保存的 Key
        </label>
      )}
      <p className="text-sm text-muted-foreground">
        Key 加密保存，不回显、不导出；更新 Key 将清空高级引用。
        {location.protocol === "http:" &&
          "当前为 HTTP，真实 Key 应通过可信网络或 HTTPS 配置。"}
      </p>
      <details className="text-sm">
        <summary>高级配置：服务器凭据引用</summary>
        <label className="grid gap-2">
          服务器凭据引用
          <Input
            disabled={Boolean(credential.value)}
            maxLength={144}
            value={form.credentialRef}
            placeholder="env:FLOW_SECRET_GEMINI_API_KEY"
            onChange={event => onChange({ credentialRef: event.target.value })}
          />
        </label>
      </details>
      <p className="text-sm leading-6 text-muted-foreground">
        Key 留空保留；地址留空沿用服务器。节点模型优先。
      </p>
      <div className="min-w-0 space-y-3 rounded-xl border border-border bg-muted/40 p-4 text-sm leading-6 [overflow-wrap:anywhere]">
        <h2 className="aiflow-type-section-title font-semibold">连接检查</h2>
        <p role="status">
          {status.data?.message ||
            (status.isError ? "状态读取失败，请重试。" : "读取中…")}
        </p>
        {status.data && <p>生效地址：{status.data.baseUrl}</p>}
        <p className="text-muted-foreground">测试固定问候，可能产生费用。</p>
        <div className="flex flex-wrap gap-3">
          {(
            [
              ["models", "读取模型"],
              ["chat", "测试调用"],
            ] as const
          ).map(([mode, label]) => (
            <Button
              key={mode}
              type="button"
              variant="outline"
              disabled={
                blocked ||
                check.isPending ||
                (mode === "chat" && !form.defaultModel.trim())
              }
              onClick={() => check.mutate({ mode, expectedConfigToken: token })}
            >
              {check.isPending && check.variables?.mode === mode
                ? "检查中…"
                : label}
            </Button>
          ))}
        </div>
        {blocked && <p className="text-aiflow-warning">请先保存配置再检查。</p>}
        {current && (check.error || check.data) && (
          <p role={check.data?.ok ? "status" : "alert"}>
            {check.error?.message || check.data?.message}
          </p>
        )}
        {current && Boolean(check.data?.models.length) && (
          <label className="grid min-w-0 gap-2">
            选为默认模型（选择后需保存）
            <select
              className="h-11 min-w-0 max-w-full rounded-md border border-border bg-card px-3"
              value=""
              onChange={event => onChange({ defaultModel: event.target.value })}
            >
              <option value="" disabled>
                请选择模型
              </option>
              {check.data?.models.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
