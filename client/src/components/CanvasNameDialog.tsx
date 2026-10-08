import { useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export function CanvasNameDialog({
  title,
  initialName,
  onClose,
  onSave,
}: {
  title: string;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => void | Promise<unknown>;
}) {
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const trimmed = name.trim();
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            填写清晰易识别的名称，最多 160 个字符。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async event => {
            event.preventDefault();
            if (pending || !trimmed || trimmed.length > 160) return;
            setPending(true);
            setError("");
            try {
              await onSave(trimmed);
              onClose();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "保存失败，请重试。"
              );
            } finally {
              setPending(false);
            }
          }}
          className="space-y-4"
        >
          <label className="block space-y-2">
            <span className="aiflow-type-control font-medium">名称</span>
            <input
              autoFocus
              value={name}
              maxLength={160}
              disabled={pending}
              onChange={event => {
                setName(event.target.value);
                setError("");
              }}
              className="aiflow-type-body w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {!trimmed && (
            <p className="aiflow-type-meta text-muted-foreground">
              名称不能为空。
            </p>
          )}
          {error && (
            <p role="alert" className="aiflow-type-body text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={pending || !trimmed || trimmed.length > 160}
            >
              {pending ? "正在保存…" : "保存名称"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
