import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  searchSelectOptions,
  toggleSearchSelection,
  type SearchSelectOption,
} from "../../../shared/search-select";

type SearchableMultiSelectProps = {
  ariaLabel: string;
  value: string[];
  options: SearchSelectOption[];
  query: string;
  onQueryChange: (query: string) => void;
  onChange: (value: string[]) => void;
  placeholder: string;
  searchPlaceholder: string;
  startSearchMessage?: string;
  emptyMessage: string;
  noResultsMessage?: string;
  loading?: boolean;
  error?: boolean;
  disabled?: boolean;
  requireSearch?: boolean;
  maxSelected?: number;
  maxResults?: number;
  hasMore?: boolean;
};

export function SearchableMultiSelect({
  ariaLabel,
  value,
  options,
  query,
  onQueryChange,
  onChange,
  placeholder,
  searchPlaceholder,
  startSearchMessage = "输入名称或代号开始搜索。",
  emptyMessage,
  noResultsMessage = "没有匹配项，请更换搜索词。",
  loading = false,
  error = false,
  disabled = false,
  requireSearch = false,
  maxSelected = Number.POSITIVE_INFINITY,
  maxResults = 50,
  hasMore = false,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const optionCache = useRef(new Map<string, SearchSelectOption>());
  options.forEach(option => optionCache.current.set(option.value, option));

  const results = useMemo(
    () => searchSelectOptions(options, query, maxResults),
    [maxResults, options, query]
  );
  const selectedOptions = value.map(
    selectedValue =>
      optionCache.current.get(selectedValue) ?? {
        value: selectedValue,
        label: selectedValue,
      }
  );
  const selectedLabel =
    selectedOptions.length === 0
      ? placeholder
      : maxSelected === 1
        ? selectedOptions[0]?.label
        : selectedOptions.length === 1
          ? selectedOptions[0]?.label
          : `${selectedOptions[0]?.label} 等 ${selectedOptions.length} 项`;
  const awaitingSearch = requireSearch && !query.trim();
  const statusMessage = loading
    ? "正在搜索…"
    : error
      ? "目录查询失败，请重试后继续。"
      : awaitingSearch
        ? startSearchMessage
        : results.totalMatches === 0
          ? !requireSearch && options.length === 0
            ? emptyMessage
            : noResultsMessage
          : null;
  const visibleOptions =
    loading || error || awaitingSearch ? [] : results.options;

  const toggle = (optionValue: string) => {
    onChange(toggleSearchSelection(value, optionValue, maxSelected));
  };

  return (
    <div className="min-w-0 space-y-2">
      <Popover
        open={open}
        onOpenChange={nextOpen => {
          setOpen(nextOpen);
          if (!nextOpen) onQueryChange("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            disabled={disabled}
            className="h-11 w-full justify-between gap-2 px-3 text-left font-normal"
          >
            <span className="min-w-0 truncate">{selectedLabel}</span>
            <ChevronsUpDown
              size={16}
              className="shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="p-0"
          style={{ width: "var(--radix-popover-trigger-width)" }}
        >
          <Command shouldFilter={false}>
            <CommandInput
              aria-label={`${ariaLabel}搜索`}
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={onQueryChange}
            />
            <CommandList>
              {statusMessage ? (
                <CommandEmpty>{statusMessage}</CommandEmpty>
              ) : visibleOptions.length ? (
                <CommandGroup
                  heading={
                    hasMore || results.hasMore
                      ? `匹配超过 ${maxResults} 项`
                      : `匹配 ${results.totalMatches} 项`
                  }
                >
                  {visibleOptions.map(option => {
                    const selected = value.includes(option.value);
                    const atLimit =
                      maxSelected > 1 &&
                      !selected &&
                      value.length >= maxSelected;
                    return (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        disabled={atLimit}
                        onSelect={() => toggle(option.value)}
                        className="min-h-11 items-center py-2"
                      >
                        <Check
                          size={16}
                          className={selected ? "opacity-100" : "opacity-0"}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 truncate">{option.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : (
                <CommandEmpty>{noResultsMessage}</CommandEmpty>
              )}
            </CommandList>
            {(hasMore || results.hasMore) &&
              !loading &&
              !error &&
              !awaitingSearch && (
                <p className="aiflow-type-body border-t px-3 py-2 text-muted-foreground">
                  当前结果超过 {maxResults} 项；继续输入以缩小范围。
                </p>
              )}
          </Command>
        </PopoverContent>
      </Popover>
      {selectedOptions.length > 0 && (
        <div
          role="list"
          aria-label={`${ariaLabel}已选项目`}
          aria-live="polite"
          className="flex max-h-28 flex-wrap gap-1 overflow-y-auto"
        >
          {selectedOptions.map(option => (
            <span
              key={option.value}
              role="listitem"
              className="inline-flex max-w-full items-center rounded-md border border-aiflow-info-border bg-aiflow-info-surface pl-2 text-xs text-aiflow-info"
            >
              <span className="max-w-64 truncate">{option.label}</span>
              <button
                type="button"
                aria-label={`移除${option.label}`}
                className="ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-r-md text-aiflow-info hover:bg-aiflow-info-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                onClick={() => toggle(option.value)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
