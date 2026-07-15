"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { supabase } from "@/lib/supabase";

type MachineOption = {
  id: string;
  machine_code: string;
  machine_name: string;
};

export type BreakdownFormValues = {
  machineId: string;
  symptom: string;
  reportedAtIso: string;
  technician: string | null;
};

type BreakdownFormProps = {
  // Preselects a machine once the active-machine list has loaded: the
  // ?machine=<uuid> query param on /breakdowns/new, or the breakdown's
  // existing machine_id when editing. Silently ignored if it matches no
  // active machine (an invalid/stale value never blocks the picker).
  initialMachineId?: string;
  initialSymptom?: string;
  // datetime-local formatted string; defaults to "now" when omitted,
  // matching the original report form's behaviour.
  initialReportedAt?: string;
  initialTechnician?: string;
  submitLabel: string;
  onCancel: () => void;
  // Returns an error message to display inline, or null on success. This
  // component never navigates itself -- the caller decides where "create"
  // vs "edit" goes next.
  onSubmit: (values: BreakdownFormValues) => Promise<string | null>;
};

// Bigger than the 44px used elsewhere in the app: this form is filled out
// by a technician standing next to a broken machine, often one-handed.
const inputClassName =
  "mt-1 block w-full min-h-[48px] rounded-md border border-primary/20 px-3 py-2 text-base text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function nowAsDatetimeLocal(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// datetime-local values have no timezone designator, so the JS Date
// constructor parses them as local time -- toISOString() then converts
// that same instant to the UTC ISO string Postgres expects.
function datetimeLocalToIso(value: string): string {
  return new Date(value).toISOString();
}

export default function BreakdownForm({
  initialMachineId,
  initialSymptom,
  initialReportedAt,
  initialTechnician,
  submitLabel,
  onCancel,
  onSubmit,
}: BreakdownFormProps) {
  const [machineOptions, setMachineOptions] = useState<MachineOption[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(true);
  const [machinesError, setMachinesError] = useState<string | null>(null);

  const [selectedMachine, setSelectedMachine] =
    useState<MachineOption | null>(null);
  const [machineSearch, setMachineSearch] = useState("");
  const [symptom, setSymptom] = useState(initialSymptom ?? "");
  const [reportedAt, setReportedAt] = useState(
    () => initialReportedAt ?? nowAsDatetimeLocal()
  );
  const [technician, setTechnician] = useState(initialTechnician ?? "");

  const [machineError, setMachineError] = useState<string | null>(null);
  const [symptomError, setSymptomError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const symptomRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMachines() {
      const { data, error } = await supabase
        .from("machines")
        .select("id, machine_code, machine_name")
        .eq("status", "active")
        .order("machine_code", { ascending: true });

      if (cancelled) return;

      if (error) {
        setMachinesError(error.message);
        setMachinesLoading(false);
        return;
      }

      const options = (data ?? []) as MachineOption[];
      setMachineOptions(options);
      setMachinesLoading(false);

      if (initialMachineId) {
        const match = options.find((option) => option.id === initialMachineId);
        if (match) {
          setSelectedMachine(match);
        }
      }
    }

    loadMachines();

    return () => {
      cancelled = true;
    };
  }, [initialMachineId]);

  useEffect(() => {
    if (selectedMachine) {
      symptomRef.current?.focus();
    }
  }, [selectedMachine]);

  const filteredMachineOptions = useMemo(() => {
    const normalized = machineSearch.trim().toLowerCase();
    if (!normalized) return machineOptions;
    return machineOptions.filter(
      (option) =>
        option.machine_code.toLowerCase().includes(normalized) ||
        option.machine_name.toLowerCase().includes(normalized)
    );
  }, [machineOptions, machineSearch]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedSymptom = symptom.trim();

    let hasError = false;
    if (!selectedMachine) {
      setMachineError("กรุณาเลือกเครื่องจักร");
      hasError = true;
    } else {
      setMachineError(null);
    }
    if (trimmedSymptom === "") {
      setSymptomError("กรุณากรอกอาการเสีย");
      hasError = true;
    } else {
      setSymptomError(null);
    }

    if (hasError) return;
    if (!selectedMachine) return; // narrows for TypeScript; unreachable above

    setSubmitting(true);
    setFormError(null);

    const trimmedTechnician = technician.trim();

    const errorMessage = await onSubmit({
      machineId: selectedMachine.id,
      symptom: trimmedSymptom,
      reportedAtIso: datetimeLocalToIso(reportedAt),
      technician: trimmedTechnician === "" ? null : trimmedTechnician,
    });

    if (errorMessage) {
      setFormError(errorMessage);
      setSubmitting(false);
    }
    // On success the caller navigates away; this component may unmount
    // before reaching here, so submitting is intentionally left true.
  }

  if (machinesLoading) {
    return (
      <div className="mt-4 max-w-lg animate-pulse space-y-4">
        <div className="h-14 rounded-md bg-primary/10" />
        <div className="h-24 rounded-md bg-primary/10" />
        <div className="h-14 rounded-md bg-primary/10" />
      </div>
    );
  }

  if (machinesError) {
    return (
      <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        <pre className="whitespace-pre-wrap break-all font-mono text-xs">
          {machinesError}
        </pre>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 max-w-lg space-y-4">
      <div>
        <label className="block text-sm font-medium">เครื่องจักร*</label>
        {selectedMachine ? (
          <div className="mt-1 flex items-center justify-between gap-3 rounded-md border border-accent bg-accent/5 px-3 py-3">
            <span className="text-base font-medium text-primary">
              {selectedMachine.machine_code} — {selectedMachine.machine_name}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedMachine(null);
                setMachineSearch("");
              }}
              className="flex min-h-[48px] shrink-0 items-center rounded-md border border-primary/20 px-3 text-sm font-medium text-primary hover:bg-primary/5"
            >
              เปลี่ยน
            </button>
          </div>
        ) : (
          <div className="mt-1">
            <input
              type="text"
              value={machineSearch}
              onChange={(event) => setMachineSearch(event.target.value)}
              placeholder="พิมพ์รหัสหรือชื่อเครื่องจักร"
              className={inputClassName}
            />
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-primary/10">
              {filteredMachineOptions.length === 0 ? (
                <p className="p-3 text-sm text-primary/60">
                  ไม่พบเครื่องจักร
                </p>
              ) : (
                filteredMachineOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setSelectedMachine(option);
                      setMachineError(null);
                    }}
                    className="flex min-h-[48px] w-full items-center border-b border-primary/5 px-3 py-2 text-left text-base last:border-b-0 hover:bg-surface"
                  >
                    <span className="font-medium text-primary">
                      {option.machine_code}
                    </span>
                    <span className="ml-2 text-primary/70">
                      — {option.machine_name}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        {machineError && (
          <p className="mt-1 text-sm text-red-700">{machineError}</p>
        )}
      </div>

      <div>
        <label htmlFor="symptom" className="block text-sm font-medium">
          อาการเสีย*
        </label>
        <textarea
          id="symptom"
          ref={symptomRef}
          rows={3}
          value={symptom}
          onChange={(event) => setSymptom(event.target.value)}
          className={inputClassName}
        />
        {symptomError && (
          <p className="mt-1 text-sm text-red-700">{symptomError}</p>
        )}
      </div>

      <div>
        <label htmlFor="reported_at" className="block text-sm font-medium">
          วันเวลาที่แจ้ง
        </label>
        <input
          id="reported_at"
          type="datetime-local"
          value={reportedAt}
          onChange={(event) => setReportedAt(event.target.value)}
          className={inputClassName}
        />
      </div>

      <div>
        <label htmlFor="technician" className="block text-sm font-medium">
          ผู้แจ้ง
        </label>
        <input
          id="technician"
          type="text"
          value={technician}
          onChange={(event) => setTechnician(event.target.value)}
          className={inputClassName}
        />
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
          className="flex min-h-[48px] flex-1 items-center justify-center rounded-md bg-accent px-4 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "กำลังบันทึก..." : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-[48px] items-center justify-center rounded-md border border-primary/20 px-4 text-base font-medium text-primary hover:bg-primary/5"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
