"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function NewBreakdownPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [machineOptions, setMachineOptions] = useState<MachineOption[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(true);
  const [machinesError, setMachinesError] = useState<string | null>(null);

  const [selectedMachine, setSelectedMachine] =
    useState<MachineOption | null>(null);
  const [machineSearch, setMachineSearch] = useState("");
  const [symptom, setSymptom] = useState("");
  const [reportedAt, setReportedAt] = useState(() => nowAsDatetimeLocal());
  const [technician, setTechnician] = useState("");

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

      // /breakdowns/new?machine=<uuid> preselects a machine (linked from
      // the machine profile page). An invalid uuid or a uuid that matches
      // no active machine is ignored -- never crash, just show the
      // normal picker.
      const machineParam = searchParams.get("machine");
      if (machineParam && UUID_REGEX.test(machineParam)) {
        const match = options.find((option) => option.id === machineParam);
        if (match) {
          setSelectedMachine(match);
        }
      }
    }

    loadMachines();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

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

    const { error } = await supabase.from("breakdowns").insert({
      machine_id: selectedMachine.id,
      symptom: trimmedSymptom,
      reported_at: datetimeLocalToIso(reportedAt),
      technician: trimmedTechnician === "" ? null : trimmedTechnician,
      status: "open",
    });

    if (error) {
      setFormError(error.message);
      setSubmitting(false);
      return;
    }

    router.push("/?saved=breakdown");
    router.refresh();
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">แจ้งเสีย</h1>

      {machinesLoading ? (
        <div className="mt-4 max-w-lg animate-pulse space-y-4">
          <div className="h-14 rounded-md bg-primary/10" />
          <div className="h-24 rounded-md bg-primary/10" />
          <div className="h-14 rounded-md bg-primary/10" />
        </div>
      ) : machinesError ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">
            {machinesError}
          </pre>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 max-w-lg space-y-4">
          <div>
            <label className="block text-sm font-medium">เครื่องจักร*</label>
            {selectedMachine ? (
              <div className="mt-1 flex items-center justify-between gap-3 rounded-md border border-accent bg-accent/5 px-3 py-3">
                <span className="text-base font-medium text-primary">
                  {selectedMachine.machine_code} —{" "}
                  {selectedMachine.machine_name}
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
            <label
              htmlFor="reported_at"
              className="block text-sm font-medium"
            >
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
              {submitting ? "กำลังบันทึก..." : "บันทึกแจ้งเสีย"}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="flex min-h-[48px] items-center justify-center rounded-md border border-primary/20 px-4 text-base font-medium text-primary hover:bg-primary/5"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function NewBreakdownPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4">
          <h1 className="text-2xl font-bold">แจ้งเสีย</h1>
        </div>
      }
    >
      <NewBreakdownPageInner />
    </Suspense>
  );
}
