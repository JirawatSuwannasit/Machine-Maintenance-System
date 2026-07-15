"use client";

import { useRef } from "react";
import { Trash2 } from "lucide-react";

export type LinkedPart = {
  part_id: string;
  part_code: string;
  part_name: string;
  unit_cost: number;
  stock_qty: number;
};

export type PartLine = {
  key: string;
  // The part_replacements.id this line was loaded from, or null for a
  // brand-new line the user just added. The page component uses this to
  // diff against the originally-loaded lines on save (MMS-024 Part B) --
  // never mutated by this component itself.
  id: string | null;
  partId: string;
  qtyUsed: number | "";
  unitCost: number | "";
};

type PartsUsedEditorProps = {
  linkedParts: LinkedPart[];
  lines: PartLine[];
  onChange: (lines: PartLine[]) => void;
  lineErrors: Record<string, string>;
};

const inputClassName =
  "mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function formatMoneyThai(value: number): string {
  const safeNum = Number.isFinite(value) ? value : 0;
  return `${safeNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

export default function PartsUsedEditor({
  linkedParts,
  lines,
  onChange,
  lineErrors,
}: PartsUsedEditorProps) {
  // Stable per-line React keys, independent of array position so removing a
  // line in the middle never reassigns another line's identity.
  const nextKeyRef = useRef(0);

  function handleAddLine() {
    nextKeyRef.current += 1;
    onChange([
      ...lines,
      {
        key: `line-${nextKeyRef.current}`,
        id: null,
        partId: "",
        qtyUsed: 1,
        unitCost: 0,
      },
    ]);
  }

  function handleRemoveLine(key: string) {
    onChange(lines.filter((line) => line.key !== key));
  }

  function handlePartChange(key: string, partId: string) {
    const part = linkedParts.find((p) => p.part_id === partId);
    onChange(
      lines.map((line) =>
        line.key === key
          ? { ...line, partId, unitCost: part ? part.unit_cost : line.unitCost }
          : line
      )
    );
  }

  function handleQtyChange(key: string, qtyUsed: number | "") {
    onChange(
      lines.map((line) => (line.key === key ? { ...line, qtyUsed } : line))
    );
  }

  function handleUnitCostChange(key: string, unitCost: number | "") {
    onChange(
      lines.map((line) => (line.key === key ? { ...line, unitCost } : line))
    );
  }

  const totalPartsCost = lines.reduce((sum, line) => {
    const qty = line.qtyUsed === "" ? 0 : line.qtyUsed;
    const cost = line.unitCost === "" ? 0 : line.unitCost;
    return sum + qty * cost;
  }, 0);

  return (
    <div>
      <label className="block text-sm font-medium">
        อะไหล่ที่เปลี่ยน (ถ้ามี)
      </label>

      {linkedParts.length === 0 ? (
        <p className="mt-2 rounded-md border border-primary/10 bg-surface px-3 py-2 text-sm text-primary/60">
          เครื่องนี้ยังไม่มีอะไหล่ที่ผูกไว้ — ผูกอะไหล่ได้ที่แท็บอะไหล่ของเครื่อง
        </p>
      ) : (
        <>
          {lines.length > 0 && (
            <div className="mt-2 space-y-3">
              {lines.map((line) => {
                const selectedPart = linkedParts.find(
                  (p) => p.part_id === line.partId
                );
                const qtyNum = line.qtyUsed === "" ? 0 : line.qtyUsed;
                const costNum = line.unitCost === "" ? 0 : line.unitCost;
                const lineTotal = qtyNum * costNum;
                const isOverStock =
                  selectedPart != null && qtyNum > selectedPart.stock_qty;

                // A part chosen on another line is not selectable again --
                // one line per part; a second unit of the same part is
                // expressed as qty, not a second line.
                const availableOptions = linkedParts.filter(
                  (p) =>
                    p.part_id === line.partId ||
                    !lines.some((other) => other.partId === p.part_id)
                );

                return (
                  <div
                    key={line.key}
                    className="rounded-md border border-primary/10 bg-surface p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-2">
                        {line.id !== null && (
                          <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-primary/10 bg-white px-2 py-0.5 text-xs text-primary/50">
                            บันทึกแล้ว
                          </span>
                        )}
                        <select
                          value={line.partId}
                          onChange={(event) =>
                            handlePartChange(line.key, event.target.value)
                          }
                          className={inputClassName}
                          aria-label="อะไหล่"
                        >
                          <option value="">-- เลือกอะไหล่ --</option>
                          {availableOptions.map((part) => (
                            <option key={part.part_id} value={part.part_id}>
                              {part.part_code} — {part.part_name}
                            </option>
                          ))}
                        </select>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-primary/60">
                              จำนวน
                            </label>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={line.qtyUsed}
                              onChange={(event) =>
                                handleQtyChange(
                                  line.key,
                                  event.target.value === ""
                                    ? ""
                                    : Number(event.target.value)
                                )
                              }
                              aria-label="จำนวน"
                              className={inputClassName}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-primary/60">
                              ราคาต่อหน่วย (บาท)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={line.unitCost}
                              onChange={(event) =>
                                handleUnitCostChange(
                                  line.key,
                                  event.target.value === ""
                                    ? ""
                                    : Number(event.target.value)
                                )
                              }
                              aria-label="ราคาต่อหน่วย"
                              className={inputClassName}
                            />
                          </div>
                        </div>

                        <p className="text-sm text-primary/70">
                          รวม{" "}
                          <span className="font-bold text-primary">
                            {formatMoneyThai(lineTotal)}
                          </span>
                        </p>

                        {isOverStock && selectedPart && (
                          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            จำนวนมากกว่าสต๊อกคงเหลือ ({selectedPart.stock_qty}) —
                            สต๊อกจะติดลบ
                          </p>
                        )}

                        {lineErrors[line.key] && (
                          <p className="text-sm text-red-700">
                            {lineErrors[line.key]}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveLine(line.key)}
                        aria-label="ลบรายการนี้"
                        className="mt-1 shrink-0 text-red-600 hover:text-red-800"
                      >
                        <Trash2 size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={handleAddLine}
            disabled={lines.length >= linkedParts.length}
            className="mt-3 flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            + เพิ่มอะไหล่
          </button>

          {lines.length > 0 && (
            <div className="mt-3 flex justify-between rounded-md border border-primary/10 bg-white px-3 py-2 text-sm">
              <span className="text-primary/70">รวมค่าอะไหล่</span>
              <span className="font-bold text-primary">
                {formatMoneyThai(totalPartsCost)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
