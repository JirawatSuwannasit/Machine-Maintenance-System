export type ChecklistResultItem = {
  item: string;
  ok: boolean;
  note: string;
};

type ChecklistResultViewProps = {
  items: ChecklistResultItem[];
};

// Shared by app/pm/page.tsx's history modal (MMS-014) and
// components/machine/PmHistoryTab.tsx's accordion so the checklist_result
// rendering never drifts between the two places it appears.
export default function ChecklistResultView({ items }: ChecklistResultViewProps) {
  if (items.length === 0) {
    return <p className="text-sm text-primary/60">แผนนี้ไม่มีรายการตรวจ</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((entry, index) => (
        <li
          key={index}
          className={`rounded-md border p-2 text-sm ${
            entry.ok
              ? "border-primary/10 bg-white"
              : "border-red-200 bg-red-50"
          }`}
        >
          <div className="flex items-start gap-2">
            <span
              className={entry.ok ? "text-green-600" : "text-red-600"}
              aria-hidden="true"
            >
              {entry.ok ? "✓" : "✗"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-primary">{entry.item}</p>
              {entry.note && (
                <p className="mt-0.5 break-words text-xs text-primary/60">
                  หมายเหตุ: {entry.note}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
