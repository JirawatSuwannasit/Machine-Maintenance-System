"use client";

export type MultiSelectOption = {
  value: string;
  label: string;
};

type Props = {
  label: string;
  allLabel: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
};

export default function MultiSelectFilter({
  label,
  allLabel,
  options,
  selected,
  onChange,
  className = "",
}: Props) {
  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value]
    );
  }

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((option) => option.value === selected[0])?.label ??
          selected[0]
        : `เลือกแล้ว ${selected.length} รายการ`;

  return (
    <div className={className}>
      <span className="block text-xs font-medium text-primary/60">{label}</span>
      <details className="group relative mt-1">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-primary/20 bg-white px-3 py-2 text-sm text-primary focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
          <span className="truncate">{summary}</span>
          <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">
            ▼
          </span>
        </summary>
        <fieldset className="absolute left-0 z-30 mt-1 max-h-72 min-w-full overflow-y-auto rounded-md border border-primary/20 bg-white p-2 shadow-lg">
          <legend className="sr-only">{label}</legend>
          {options.map((option) => (
            <label
              key={option.value}
              className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-primary hover:bg-primary/5"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
                className="h-4 w-4 shrink-0 rounded border-primary/30 text-accent focus:ring-accent"
              />
              <span className="whitespace-nowrap">{option.label}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 min-h-[36px] w-full rounded border border-primary/20 px-2 text-xs font-medium text-primary hover:bg-primary/5"
            >
              {allLabel}
            </button>
          )}
        </fieldset>
      </details>
    </div>
  );
}
