import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function CreationDialog({ open, onOpenChange, title, description, submitLabel = "确认创建", pending, submitDisabled = false, onSubmit, children, className = "max-w-xl" }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; submitLabel?: string; pending: boolean; submitDisabled?: boolean; onSubmit: () => void | Promise<unknown>; children: ReactNode; className?: string }) {
  return <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}><DialogContent className={className}><form data-aiflow-creation-dialog onSubmit={event => { event.preventDefault(); void onSubmit(); }}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="mt-4 grid max-h-[65vh] gap-3 overflow-y-auto pr-1">{children}</div><DialogFooter className="mt-5"><Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" className="bg-[#2d6bea] hover:bg-[#255bc8]" disabled={pending || submitDisabled}>{pending && <Loader2 className="animate-spin" size={14} />}{submitLabel}</Button></DialogFooter></form></DialogContent></Dialog>;
}
