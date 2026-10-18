import React, { useEffect, useId, useState } from "react";
import {
  nodeNumberDraftError,
  parseNodeNumberDraft,
  stepNodeNumberDraft,
  type NodeNumberConstraints,
} from "@shared/node-number-input";

export function NodeNumberInput({
  field,
  value,
  disabled,
  className,
  onChange,
}: {
  field: NodeNumberConstraints;
  value: unknown;
  disabled: boolean;
  className: string;
  onChange: (value: number | string) => void;
}) {
  const scalar = value == null ? "" : String(value);
  const [draft, setDraft] = useState(scalar);
  const id = useId();
  useEffect(() => setDraft(scalar), [scalar]);
  const parsed = parseNodeNumberDraft(draft);
  const error = nodeNumberDraftError(field, draft);
  const update = (raw: string) => {
    setDraft(raw);
    onChange(parseNodeNumberDraft(raw));
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <input
        type="text"
        role="spinbutton"
        inputMode="decimal"
        aria-label={field.label}
        aria-required={field.required || undefined}
        aria-valuemin={field.min}
        aria-valuemax={field.max}
        aria-valuenow={typeof parsed === "number" ? parsed : undefined}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? id : undefined}
        className={className}
        disabled={disabled}
        value={draft}
        onChange={event => update(event.target.value)}
        onKeyDown={event => {
          if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !["ArrowUp", "ArrowDown"].includes(event.key)
          )
            return;
          event.preventDefault();
          update(
            stepNodeNumberDraft(draft, event.key === "ArrowUp" ? 1 : -1, field)
          );
        }}
      />
      {error && (
        <p id={id} role="alert" className="aiflow-type-body text-aiflow-danger">
          {error}
        </p>
      )}
    </div>
  );
}
