import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function CreationDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel = "确认创建",
  pending,
  submitDisabled = false,
  onSubmit,
  children,
  className = "max-w-xl",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel?: string;
  pending: boolean;
  submitDisabled?: boolean;
  onSubmit: () => void | Promise<unknown>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={`flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-4 shadow-2xl max-h-[calc(100vh-1rem)] supports-[height:100dvh]:max-h-[calc(100dvh-1rem)] sm:p-5 ${className}`}
      >
        <form
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          data-aiflow-creation-dialog
          onSubmit={event => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <DialogHeader className="flex shrink-0 flex-row items-start justify-between gap-3 text-left">
            <div className="min-w-0">
              <DialogTitle className="aiflow-type-section-title font-semibold leading-6 text-foreground">
                {title}
              </DialogTitle>
              <DialogDescription className="aiflow-type-body mt-1 leading-5 text-muted-foreground">
                {description}
              </DialogDescription>
            </div>
            <DialogClose asChild disabled={pending}>
              <button
                type="button"
                aria-label="关闭"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground min-[1024px]:h-10 min-[1024px]:w-10"
                disabled={pending}
              >
                ×
              </button>
            </DialogClose>
          </DialogHeader>
          <div className="mt-4 min-h-0 flex-auto overflow-y-auto overscroll-contain pr-1">
            <div className="grid min-w-0 gap-3">{children}</div>
          </div>
          <div className="mt-5 flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11 min-[1024px]:h-10"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="h-11 bg-blue-600 font-medium text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10"
              disabled={pending || submitDisabled}
            >
              {pending && <Loader2 className="animate-spin" size={14} />}
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
