import { useState, type ReactNode } from "react";

export function ConfigDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="min-w-0 rounded-md border border-border bg-card p-2" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer break-words py-1 text-sm font-medium">{title}</summary>
      {open && children}
    </details>
  );
}
