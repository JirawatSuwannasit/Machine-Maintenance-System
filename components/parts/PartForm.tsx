"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export type SparePartRecord = {
  id: string;
  part_code: string;
  part_name: string;
  default_lifespan_days: number;
  unit_cost: number | string;
  stock_qty: number;
  min_stock: number;
};

export type PartMachineOption = {
  id: string;
  machine_code: string;
  machine_name: string;
  status: string;
};

export type ExistingMachinePartLink = {
  id: string;
  machine_id: string;
  lifespan_override_days: number | null;
  last_replaced_at: string | null;
  machine_code: string;
  machine_name: string;
};

type PartFormProps = {
  part?: SparePartRecord;
  existingLinks?: ExistingMachinePartLink[];
  machineOptions: PartMachineOption[];
  preselectMachineId?: string | null;
  onSuccess: () => void;
};

type SelectedMachineEntry = {
  machineId: string;
  machineCode: string;
  machineName: string;
  overrideDaysInput: string;
  hasReplacementHistory: boolean;
};

const inputClassName =
  "mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

const sectionHeadingClassName =
  "border-b border-primary/10 pb-1 text-sm font-semibold text-primary/70";

function buildInitialSelection(
  existingLinks: ExistingMachinePartLink[] | undefined,
  machineOptions: PartMachineOption[],
  preselectMachineId: string | null | undefined
): SelectedMachineEntry[] {
  if (existingLinks && existingLinks.length > 0) {
    return existingLinks.map((link) => ({
      machineId: link.machine_id,
      machineCode: link.machine_code,
      machineName: link.machine_name,
      overrideDaysInput:
        link.lifespan_override_days != null
          ? String(link.lifespan_override_days)
          : "",
      hasReplacementHistory: link.last_replaced_at !== null,
    }));
  }
  if (preselectMachineId) {
    const match = machineOptions.find((m) => m.id === preselectMachineId);
    if (match) {
      return [
        {
          machineId: match.id,
          machineCode: match.machine_code,
          machineName: match.machine_name,
          overrideDaysInput: "",
          hasReplacementHistory: false,
        },
      ];
    }
  }
  return [];
}

export default function PartForm({
  part,
  existingLinks,
  machineOptions,
  preselectMachineId,
  onSuccess,
}: PartFormProps) {
  const router = useRouter();
  const isEditMode = part !== undefined;

  const [partCode, setPartCode] = useState(part?.part_code ?? "");
  const [partName, setPartName] = useState(part?.part_name ?? "");
  const [defaultLifespanDays, setDefaultLifespanDays] = useState(
    part ? String(part.default_lifespan_days) : ""
  );
  const [unitCost, setUnitCost] = useState<number | "">(
    part
      ? typeof part.unit_cost === "string"
        ? parseFloat(part.unit_cost)
        : part.unit_cost
      : 0
  );
  const [stockQty, setStockQty] = useState<number | "">(part?.stock_qty ?? 0);
  const [minStock, setMinStock] = useState<number | "">(part?.min_stock ?? 1);

  const [selectedMachines, setSelectedMachines] = useState<
    SelectedMachineEntry[]
  >(() => buildInitialSelection(existingLinks, machineOptions, preselectMachineId));
  const [machineSearch, setMachineSearch] = useState("");

  const [partCodeError, setPartCodeError] = useState<string | null>(null);
  const [partNameError, setPartNameError] = useState<string | null>(null);
  const [lifespanError, setLifespanError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [minStockError, setMinStockError] = useState<string | null>(null);
  const [overrideErrors, setOverrideErrors] = useState<Record<string, string>>(
    {}
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedIds = useMemo(
    () => new Set(selectedMachines.map((entry) => entry.machineId)),
    [selectedMachines]
  );

  const filteredMachineOptions = useMemo(() => {
    const normalized = machineSearch.trim().toLowerCase();
    return machineOptions
      .filter((machine) => machine.status === "active")
      .filter((machine) => !selectedIds.has(machine.id))
      .filter(
        (machine) =>
          normalized === "" ||
          machine.machine_code.toLowerCase().includes(normalized) ||
          machine.machine_name.toLowerCase().includes(normalized)
      );
  }, [machineOptions, machineSearch, selectedIds]);

  function handleAddMachine(machine: PartMachineOption) {
    setSelectedMachines((prev) => [
      ...prev,
      {
        machineId: machine.id,
        machineCode: machine.machine_code,
        machineName: machine.machine_name,
        overrideDaysInput: "",
        hasReplacementHistory: false,
      },
    ]);
    setMachineSearch("");
  }

  function handleRemoveMachine(machineId: string) {
    const entry = selectedMachines.find((e) => e.machineId === machineId);
    if (entry?.hasReplacementHistory) {
      const confirmed = window.confirm(
        "ปลดการผูกจะลบประวัติกำหนดเปลี่ยนของเครื่องนี้ (ประวัติการเปลี่ยนใน part_replacements ยังอยู่) ยืนยันหรือไม่?"
      );
      if (!confirmed) return;
    }
    setSelectedMachines((prev) => prev.filter((e) => e.machineId !== machineId));
  }

  function handleOverrideChange(machineId: string, value: string) {
    setSelectedMachines((prev) =>
      prev.map((e) => (e.machineId === machineId ? { ...e, overrideDaysInput: value } : e))
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedCode = partCode.trim();
    const trimmedName = partName.trim();
    const parsedLifespan = Number(defaultLifespanDays);
    const costValue = unitCost === "" ? 0 : Number(unitCost);
    const stockValue = stockQty === "" ? 0 : Number(stockQty);
    const minStockValue = minStock === "" ? 0 : Number(minStock);

    let hasError = false;

    if (trimmedCode === "") {
      setPartCodeError("กรุณากรอกรหัสอะไหล่");
      hasError = true;
    } else {
      setPartCodeError(null);
    }
    if (trimmedName === "") {
      setPartNameError("กรุณากรอกชื่ออะไหล่");
      hasError = true;
    } else {
      setPartNameError(null);
    }
    if (
      defaultLifespanDays.trim() === "" ||
      !Number.isFinite(parsedLifespan) ||
      parsedLifespan < 1
    ) {
      setLifespanError("อายุการใช้งานมาตรฐานต้องมากกว่า 0 วัน");
      hasError = true;
    } else {
      setLifespanError(null);
    }
    if (!Number.isFinite(costValue) || costValue < 0) {
      setCostError("ราคาต่อหน่วยต้องไม่ติดลบ");
      hasError = true;
    } else {
      setCostError(null);
    }
    if (!Number.isFinite(stockValue) || stockValue < 0) {
      setStockError("จำนวนคงเหลือต้องไม่ติดลบ");
      hasError = true;
    } else {
      setStockError(null);
    }
    if (!Number.isFinite(minStockValue) || minStockValue < 0) {
      setMinStockError("จุดสั่งซื้อต้องไม่ติดลบ");
      hasError = true;
    } else {
      setMinStockError(null);
    }

    const newOverrideErrors: Record<string, string> = {};
    for (const entry of selectedMachines) {
      if (entry.overrideDaysInput.trim() === "") continue;
      const parsedOverride = Number(entry.overrideDaysInput);
      if (!Number.isFinite(parsedOverride) || parsedOverride < 1) {
        newOverrideErrors[entry.machineId] = "ต้องเป็นตัวเลขมากกว่า 0";
        hasError = true;
      }
    }
    setOverrideErrors(newOverrideErrors);

    if (hasError) return;

    setSubmitting(true);
    setFormError(null);

    const partPayload = {
      part_code: trimmedCode,
      part_name: trimmedName,
      default_lifespan_days: Math.trunc(parsedLifespan),
      unit_cost: costValue,
      stock_qty: Math.trunc(stockValue),
      min_stock: Math.trunc(minStockValue),
    };

    let partId: string;

    if (isEditMode && part) {
      const { error } = await supabase
        .from("spare_parts")
        .update(partPayload)
        .eq("id", part.id);

      if (error) {
        if (error.code === "23505") {
          setPartCodeError("รหัสอะไหล่นี้มีอยู่แล้ว");
        } else {
          setFormError(error.message);
        }
        setSubmitting(false);
        return;
      }
      partId = part.id;
    } else {
      const { data, error } = await supabase
        .from("spare_parts")
        .insert(partPayload)
        .select("id")
        .single();

      if (error || !data) {
        if (error?.code === "23505") {
          setPartCodeError("รหัสอะไหล่นี้มีอยู่แล้ว");
        } else {
          setFormError(error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
        }
        setSubmitting(false);
        return;
      }
      partId = data.id;
    }

    // Reconcile machine_parts against the current selection. The trigger
    // trg_part_replacements_after_insert (supabase/migrations/001_init.sql)
    // owns last_replaced_at, next_due_date, and spare_parts.stock_qty -- it
    // fills them in only when a part_replacement is inserted. This form
    // only ever inserts a fresh link (both dates NULL), deletes an
    // unselected link, or updates lifespan_override_days on an unchanged
    // link. It must never write the two trigger-owned date columns.
    const existingByMachineId = new Map(
      (existingLinks ?? []).map((link) => [link.machine_id, link])
    );

    const toDelete = (existingLinks ?? []).filter(
      (link) => !selectedIds.has(link.machine_id)
    );
    const toInsert = selectedMachines.filter(
      (entry) => !existingByMachineId.has(entry.machineId)
    );
    const toUpdate = selectedMachines
      .filter((entry) => existingByMachineId.has(entry.machineId))
      .map((entry) => {
        const existing = existingByMachineId.get(entry.machineId)!;
        const newOverride =
          entry.overrideDaysInput.trim() === ""
            ? null
            : Math.trunc(Number(entry.overrideDaysInput));
        return { existing, newOverride };
      })
      .filter(({ existing, newOverride }) => existing.lifespan_override_days !== newOverride);

    if (toDelete.length > 0) {
      const { error } = await supabase
        .from("machine_parts")
        .delete()
        .in("id", toDelete.map((link) => link.id));
      if (error) {
        setFormError(error.message);
        setSubmitting(false);
        return;
      }
    }

    if (toInsert.length > 0) {
      const payload = toInsert.map((entry) => ({
        machine_id: entry.machineId,
        part_id: partId,
        lifespan_override_days:
          entry.overrideDaysInput.trim() === ""
            ? null
            : Math.trunc(Number(entry.overrideDaysInput)),
      }));
      const { error } = await supabase.from("machine_parts").insert(payload);
      if (error) {
        setFormError(error.message);
        setSubmitting(false);
        return;
      }
    }

    for (const { existing, newOverride } of toUpdate) {
      const { error } = await supabase
        .from("machine_parts")
        .update({ lifespan_override_days: newOverride })
        .eq("id", existing.id);
      if (error) {
        setFormError(error.message);
        setSubmitting(false);
        return;
      }
    }

    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-6">
      <div className="space-y-4">
        <h2 className={sectionHeadingClassName}>ข้อมูลอะไหล่</h2>

        <div>
          <label htmlFor="part_code" className="block text-sm font-medium">
            รหัสอะไหล่*
          </label>
          <input
            id="part_code"
            type="text"
            value={partCode}
            onChange={(event) => setPartCode(event.target.value)}
            className={inputClassName}
          />
          {partCodeError && (
            <p className="mt-1 text-sm text-red-700">{partCodeError}</p>
          )}
        </div>

        <div>
          <label htmlFor="part_name" className="block text-sm font-medium">
            ชื่ออะไหล่*
          </label>
          <input
            id="part_name"
            type="text"
            value={partName}
            onChange={(event) => setPartName(event.target.value)}
            className={inputClassName}
          />
          {partNameError && (
            <p className="mt-1 text-sm text-red-700">{partNameError}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="default_lifespan_days"
            className="block text-sm font-medium"
          >
            อายุการใช้งานมาตรฐาน (วัน)*
          </label>
          <input
            id="default_lifespan_days"
            type="number"
            min="1"
            value={defaultLifespanDays}
            onChange={(event) => setDefaultLifespanDays(event.target.value)}
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-primary/50">
            ใช้เมื่อไม่ได้ตั้งอายุเฉพาะเครื่อง
          </p>
          {lifespanError && (
            <p className="mt-1 text-sm text-red-700">{lifespanError}</p>
          )}
        </div>

        <div>
          <label htmlFor="unit_cost" className="block text-sm font-medium">
            ราคาต่อหน่วย (บาท)
          </label>
          <input
            id="unit_cost"
            type="number"
            min="0"
            step="0.01"
            value={unitCost}
            onChange={(event) =>
              setUnitCost(event.target.value === "" ? "" : Number(event.target.value))
            }
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-primary/50">
            ราคามาตรฐาน ใช้เติมอัตโนมัติตอนบันทึกการเปลี่ยน (แก้ราคาจริงได้ตอนเปลี่ยน)
          </p>
          {costError && <p className="mt-1 text-sm text-red-700">{costError}</p>}
        </div>

        <div>
          <label htmlFor="stock_qty" className="block text-sm font-medium">
            จำนวนคงเหลือ
          </label>
          <input
            id="stock_qty"
            type="number"
            min="0"
            step="1"
            value={stockQty}
            onChange={(event) =>
              setStockQty(event.target.value === "" ? "" : Number(event.target.value))
            }
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-primary/50">
            สต๊อกก้อนรวม ใช้ร่วมกันทุกเครื่อง
          </p>
          {stockError && <p className="mt-1 text-sm text-red-700">{stockError}</p>}
        </div>

        <div>
          <label htmlFor="min_stock" className="block text-sm font-medium">
            จุดสั่งซื้อ
          </label>
          <input
            id="min_stock"
            type="number"
            min="0"
            step="1"
            value={minStock}
            onChange={(event) =>
              setMinStock(event.target.value === "" ? "" : Number(event.target.value))
            }
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-primary/50">
            แจ้งเตือนเมื่อสต๊อกต่ำกว่าค่านี้
          </p>
          {minStockError && (
            <p className="mt-1 text-sm text-red-700">{minStockError}</p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className={sectionHeadingClassName}>ใช้กับเครื่อง</h2>

        <div>
          <label className="block text-sm font-medium">
            ค้นหาเครื่องจักรเพื่อผูก
          </label>
          <input
            type="text"
            value={machineSearch}
            onChange={(event) => setMachineSearch(event.target.value)}
            placeholder="พิมพ์รหัสหรือชื่อเครื่องจักร"
            className={inputClassName}
          />
          {machineSearch.trim() !== "" && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-primary/10">
              {filteredMachineOptions.length === 0 ? (
                <p className="p-3 text-sm text-primary/60">ไม่พบเครื่องจักร</p>
              ) : (
                filteredMachineOptions.map((machine) => (
                  <button
                    key={machine.id}
                    type="button"
                    onClick={() => handleAddMachine(machine)}
                    className="flex min-h-[44px] w-full items-center border-b border-primary/5 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface"
                  >
                    <span className="font-medium text-primary">
                      {machine.machine_code}
                    </span>
                    <span className="ml-2 text-primary/70">
                      — {machine.machine_name}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {selectedMachines.length === 0 ? (
          <p className="text-sm text-primary/60">ยังไม่ได้ผูกกับเครื่องจักรใด</p>
        ) : (
          <div className="space-y-3">
            {selectedMachines.map((entry) => (
              <div
                key={entry.machineId}
                className="rounded-md border border-primary/10 bg-surface p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="break-words font-medium text-primary">
                      {entry.machineCode}
                    </span>
                    <span className="break-words text-sm text-primary/70">
                      {" "}
                      — {entry.machineName}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveMachine(entry.machineId)}
                    aria-label="ปลดผูกเครื่องนี้"
                    className="shrink-0 text-red-600 hover:text-red-800"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-2">
                  <label
                    htmlFor={`override_${entry.machineId}`}
                    className="block text-xs font-medium text-primary/60"
                  >
                    อายุใช้งานเฉพาะเครื่องนี้ (วัน)
                  </label>
                  <input
                    id={`override_${entry.machineId}`}
                    type="number"
                    min="1"
                    value={entry.overrideDaysInput}
                    onChange={(event) =>
                      handleOverrideChange(entry.machineId, event.target.value)
                    }
                    className="mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 bg-white px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="mt-1 text-xs text-primary/50">
                    {entry.overrideDaysInput.trim() === ""
                      ? `ค่าเริ่มต้น: ${
                          defaultLifespanDays.trim() !== "" ? defaultLifespanDays : "-"
                        } วัน`
                      : `แทนที่ค่าเริ่มต้น (${
                          defaultLifespanDays.trim() !== "" ? defaultLifespanDays : "-"
                        } วัน)`}
                  </p>
                  {overrideErrors[entry.machineId] && (
                    <p className="mt-1 text-sm text-red-700">
                      {overrideErrors[entry.machineId]}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {formError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {formError}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "กำลังบันทึก..." : "บันทึก"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
