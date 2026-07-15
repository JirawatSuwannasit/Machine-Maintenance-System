"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export type PmPlanRecord = {
  id: string;
  machine_id: string;
  pm_name: string;
  frequency_days: number;
  checklist: string[];
  last_done_date: string | null;
};

export type PmPlanMachineOption = {
  id: string;
  machine_code: string;
  machine_name: string;
  status: string;
};

type PmPlanFormProps = {
  plan?: PmPlanRecord;
  machineOptions: PmPlanMachineOption[];
  onSuccess: () => void;
  onCancel: () => void;
};

const FREQUENCY_PRESETS: Array<{ days: number; hint: string }> = [
  { days: 30, hint: "รายเดือน" },
  { days: 90, hint: "3 เดือน" },
  { days: 180, hint: "6 เดือน" },
  { days: 365, hint: "1 ปี" },
  { days: 546, hint: "1.5 ปี" },
  { days: 730, hint: "2 ปี" },
];

const inputClassName =
  "mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

// Adds `days` calendar days to a "YYYY-MM-DD" string and returns a
// "YYYY-MM-DD" string, mirroring the plain calendar-day arithmetic
// trg_pm_records_after_insert performs in SQL
// ((done_date + (frequency_days || ' days')::interval)::date) --
// day-granularity only, no time-of-day/timezone component involved.
function addDaysToIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// New PM work should only be scheduled on machines currently in service, so
// the dropdown only offers status = 'active' machines. If an existing plan's
// machine has since gone inactive, that machine is appended so editing the
// plan still shows the correct assignment instead of appearing blank.
function buildSelectableMachines(
  machineOptions: PmPlanMachineOption[],
  plan: PmPlanRecord | undefined
): PmPlanMachineOption[] {
  const active = machineOptions.filter((machine) => machine.status === "active");
  if (plan && !active.some((machine) => machine.id === plan.machine_id)) {
    const current = machineOptions.find((machine) => machine.id === plan.machine_id);
    if (current) return [...active, current];
  }
  return active;
}

export default function PmPlanForm({
  plan,
  machineOptions,
  onSuccess,
  onCancel,
}: PmPlanFormProps) {
  const isEditMode = plan !== undefined;
  const selectableMachines = buildSelectableMachines(machineOptions, plan);

  const [machineId, setMachineId] = useState(plan?.machine_id ?? "");
  const [pmName, setPmName] = useState(plan?.pm_name ?? "");
  const [frequencyDays, setFrequencyDays] = useState(
    plan ? String(plan.frequency_days) : ""
  );
  const [checklist, setChecklist] = useState<string[]>(plan?.checklist ?? []);
  const [checklistInput, setChecklistInput] = useState("");

  const [machineIdError, setMachineIdError] = useState<string | null>(null);
  const [pmNameError, setPmNameError] = useState<string | null>(null);
  const [frequencyDaysError, setFrequencyDaysError] = useState<string | null>(
    null
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleAddChecklistItem() {
    const trimmed = checklistInput.trim();
    if (trimmed === "") return;
    setChecklist((prev) => [...prev, trimmed]);
    setChecklistInput("");
  }

  function handleChecklistInputKeyDown(
    event: KeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddChecklistItem();
    }
  }

  function handleRemoveChecklistItem(index: number) {
    setChecklist((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPmName = pmName.trim();
    const parsedFrequency = Number(frequencyDays);

    let hasError = false;
    if (machineId === "") {
      setMachineIdError("กรุณาเลือกเครื่องจักร");
      hasError = true;
    } else {
      setMachineIdError(null);
    }
    if (trimmedPmName === "") {
      setPmNameError("กรุณากรอกชื่องาน PM");
      hasError = true;
    } else {
      setPmNameError(null);
    }
    if (
      frequencyDays.trim() === "" ||
      !Number.isFinite(parsedFrequency) ||
      parsedFrequency < 1
    ) {
      setFrequencyDaysError("รอบทำซ้ำต้องมากกว่า 0 วัน");
      hasError = true;
    } else {
      setFrequencyDaysError(null);
    }

    if (hasError) return;

    setSubmitting(true);
    setFormError(null);

    const truncatedFrequency = Math.trunc(parsedFrequency);

    // last_done_date is owned by trg_pm_records_after_insert
    // (supabase/migrations/001_init.sql): it stamps it only when a
    // pm_record is inserted. This form must never write to it.
    //
    // next_due_date is normally owned by that same trigger, but the trigger
    // only fires on pm_records insert -- it never reacts to a plan's
    // frequency_days being edited (MMS-022 bug fix #2). So when the user
    // changes frequency_days on an existing plan, this is a deliberate,
    // narrow exception: recompute next_due_date here from last_done_date so
    // the due date follows the new frequency immediately, instead of
    // staying stuck on the old one until the next PM is performed. If the
    // plan has never been done (last_done_date is null), there is nothing
    // to recompute from -- leave next_due_date untouched (still null).
    const frequencyChanged =
      isEditMode && plan !== undefined && truncatedFrequency !== plan.frequency_days;
    const recomputedNextDueDate =
      frequencyChanged && plan?.last_done_date
        ? addDaysToIsoDate(plan.last_done_date, truncatedFrequency)
        : undefined;

    const payload = {
      machine_id: machineId,
      pm_name: trimmedPmName,
      frequency_days: truncatedFrequency,
      checklist,
      ...(recomputedNextDueDate !== undefined && {
        next_due_date: recomputedNextDueDate,
      }),
    };

    const { error } =
      isEditMode && plan
        ? await supabase.from("pm_plans").update(payload).eq("id", plan.id)
        : await supabase.from("pm_plans").insert(payload);

    if (error) {
      setFormError(error.message);
      setSubmitting(false);
      return;
    }

    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="pm_machine_id" className="block text-sm font-medium">
          เครื่องจักร*
        </label>
        <select
          id="pm_machine_id"
          value={machineId}
          onChange={(event) => setMachineId(event.target.value)}
          className={inputClassName}
        >
          <option value="">-- เลือกเครื่องจักร --</option>
          {selectableMachines.map((machine) => (
            <option key={machine.id} value={machine.id}>
              {machine.machine_code} — {machine.machine_name}
            </option>
          ))}
        </select>
        {machineIdError && (
          <p className="mt-1 text-sm text-red-700">{machineIdError}</p>
        )}
      </div>

      <div>
        <label htmlFor="pm_name" className="block text-sm font-medium">
          ชื่องาน PM*
        </label>
        <input
          id="pm_name"
          type="text"
          value={pmName}
          onChange={(event) => setPmName(event.target.value)}
          placeholder="เช่น PM รายเดือน"
          className={inputClassName}
        />
        {pmNameError && (
          <p className="mt-1 text-sm text-red-700">{pmNameError}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="pm_frequency_days"
          className="block text-sm font-medium"
        >
          รอบทำซ้ำ (วัน)*
        </label>
        <input
          id="pm_frequency_days"
          type="number"
          min={1}
          value={frequencyDays}
          onChange={(event) => setFrequencyDays(event.target.value)}
          className={inputClassName}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {FREQUENCY_PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => setFrequencyDays(String(preset.days))}
              className={`min-h-[44px] rounded-md border px-3 text-xs font-medium ${
                frequencyDays === String(preset.days)
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-primary/20 text-primary/70 hover:bg-primary/5"
              }`}
            >
              {preset.days} วัน ({preset.hint})
            </button>
          ))}
        </div>
        {frequencyDaysError && (
          <p className="mt-1 text-sm text-red-700">{frequencyDaysError}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="pm_checklist_input"
          className="block text-sm font-medium"
        >
          รายการตรวจ
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="pm_checklist_input"
            type="text"
            value={checklistInput}
            onChange={(event) => setChecklistInput(event.target.value)}
            onKeyDown={handleChecklistInputKeyDown}
            placeholder="เช่น เช็คน้ำมัน"
            className={`${inputClassName} mt-0 flex-1`}
          />
          <button
            type="button"
            onClick={handleAddChecklistItem}
            className="min-h-[44px] shrink-0 whitespace-nowrap rounded-md border border-primary/20 px-3 text-sm font-medium text-primary hover:bg-primary/5"
          >
            เพิ่มรายการ
          </button>
        </div>
        {checklist.length > 0 && (
          <ul className="mt-2 space-y-1">
            {checklist.map((item, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-2 rounded-md border border-primary/10 bg-surface px-3 py-2 text-sm"
              >
                <span className="break-words">{item}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveChecklistItem(index)}
                  aria-label="ลบรายการ"
                  className="shrink-0 text-red-600 hover:text-red-800"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
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
          onClick={onCancel}
          disabled={submitting}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-70"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
