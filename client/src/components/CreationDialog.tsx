import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function CreationDialog({ open, onOpenChange, title, description, submitLabel = "确认创建", pending, submitDisabled = false, onSubmit, children, className = "max-w-xl" }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; submitLabel?: string; pending: boolean; submitDisabled?: boolean; onSubmit: () => void | Promise<unknown>; children: ReactNode; className?: string }) {
  const closeDialog = (next = false) => {
    if (!pending) onOpenChange(next);
  };
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
       if (event.key === "Escape") closeDialog();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
   }, [open, onOpenChange, pending]);
  if (!open) return null;
   return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="creation-dialog-title" className={`w-full ${className} max-h-[calc(100vh-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-2xl`}>
      <form data-aiflow-creation-dialog onSubmit={event => { event.preventDefault(); void onSubmit(); }}>
         <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id="creation-dialog-title" className="text-lg font-semibold leading-6 text-slate-800">{title}</h2><p className="mt-1 text-sm leading-5 text-slate-500">{description}</p></div><button type="button" aria-label="关闭" className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" disabled={pending} onClick={() => closeDialog()}>×</button></div>
        <div className="mt-4 grid max-h-[65vh] gap-3 overflow-y-auto pr-1">{children}</div>
         <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" disabled={pending} onClick={() => closeDialog()}>取消</Button><Button type="submit" className="bg-[#2d6bea] hover:bg-[#255bc8]" disabled={pending || submitDisabled}>{pending && <Loader2 className="animate-spin" size={14} />}{submitLabel}</Button></div>
      </form>
    </section>
  </div>;
}
