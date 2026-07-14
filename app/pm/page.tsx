"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DUE_SOON_DAYS } from "@/lib/machineStatus";
import { formatDateThai, computeDueDisplay, toLocalDayStart } from "@/lib/pmDueDate";
import ChecklistResultView, {
  type ChecklistResultItem,
} from "@/components/pm/ChecklistResultView";

type MachineRelation = { machine_code: string; machine_name: string };
type PlanRelation = { pm_name: string };

// Without generated Database types, postgrest-js infers every embedded
// relation as an array regardless of actual FK cardinality, even though a
// to-one FK returns a plain object at runtime. Handle both shapes so a
// broken/missing join never crashes the page.
function normalizeMachineRelation(
  machines: MachineRelation | MachineRelation[] | null
): MachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

function normalizePlanRelation(
  plan: PlanRelation | PlanRelation[] | null
): PlanRelation | null {
  if (!plan) return null;
  if (Array.isArray(plan)) return plan[0] ?? null;
  return plan;
}

function normalizeChecklistResult(value: unknown): ChecklistResultItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null
    )
    .map((entry) => ({
      item: typeof entry.item === "string" ? entry.item : "",
      ok: entry.ok === true,
      note: typeof entry.note === "string" ? entry.note : "",
    }));
}

// Supabase serializes `numeric` columns as JSON strings to avoid float
// precision loss, so always coerce before display.
function formatMoneyThai(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const safeNum = Number.isFinite(num) ? num : 0;
  return `${safeNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

function computeCutoffIsoDate(days: number): string {
  const d = toLocalDayStart(new Date());
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function DueBadge({ nextDueDate }: { nextDueDate: string | null }) {
  const display = computeDueDisplay(nextDueDate);
  return (
    <span
      className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${display.className}`}
    >
      {display.label}
    </span>
  );
}

function IssueBadge({ issueCount }: { issueCount: number }) {
  if (issueCount > 0) {
    return (
      <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-red-200 bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
        พบปัญหา {issueCount} ข้อ
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-green-200 bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">
      ปกติ
    </span>
  );
}

// ===== Section A: due-soon plans =====

type DueSoonPlan = {
  id: string;
  pm_name: string;
  next_due_date: string;
  machines: MachineRelation | null;
};

type RawDueSoonPlan = Omit<DueSoonPlan, "machines"> & {
  machines: MachineRelation | MachineRelation[] | null;
};

type DueSoonState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; plans: DueSoonPlan[] };

async function fetchDueSoonPlans(): Promise<DueSoonState> {
  const cutoff = computeCutoffIsoDate(DUE_SOON_DAYS);

  const { data, error } = await supabase
    .from("pm_plans")
    .select("id, pm_name, next_due_date, machines(machine_code, machine_name)")
    .eq("is_active", true)
    .not("next_due_date", "is", null)
    .lte("next_due_date", cutoff)
    .order("next_due_date", { ascending: true });

  if (error) {
    return { status: "error", message: error.message };
  }

  const plans = ((data ?? []) as RawDueSoonPlan[]).map((row) => ({
    ...row,
    machines: normalizeMachineRelation(row.machines),
  }));

  return { status: "loaded", plans };
}

// ===== Section B: recent pm_records =====

type ChecklistResultRaw = unknown;

type PmRecordRow = {
  id: string;
  done_date: string;
  done_by: string | null;
  pm_cost: number | string;
  notes: string | null;
  checklist_result: ChecklistResultItem[];
  pm_plans: PlanRelation | null;
  machines: MachineRelation | null;
};

type RawPmRecordRow = Omit<
  PmRecordRow,
  "pm_plans" | "machines" | "checklist_result"
> & {
  pm_plans: PlanRelation | PlanRelation[] | null;
  machines: MachineRelation | MachineRelation[] | null;
  checklist_result: ChecklistResultRaw;
};

type RecentRecordsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; records: PmRecordRow[] };

const PM_RECORD_SELECT =
  "id, done_date, done_by, pm_cost, notes, checklist_result, pm_plans(pm_name), machines(machine_code, machine_name)";

async function fetchRecentRecords(): Promise<RecentRecordsState> {
  const { data, error } = await supabase
    .from("pm_records")
    .select(PM_RECORD_SELECT)
    .order("done_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return { status: "error", message: error.message };
  }

  const records = ((data ?? []) as RawPmRecordRow[]).map((row) => ({
    ...row,
    pm_plans: normalizePlanRelation(row.pm_plans),
    machines: normalizeMachineRelation(row.machines),
    checklist_result: normalizeChecklistResult(row.checklist_result),
  }));

  return { status: "loaded", records };
}

function TableLoadingSkeleton() {
  return (
    <div className="mt-4 animate-pulse space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-16 rounded-lg bg-primary/10" />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      <pre className="whitespace-pre-wrap break-all font-mono text-xs">
        {message}
      </pre>
    </div>
  );
}

export default function PmHomePage() {
  const [dueSoonState, setDueSoonState] = useState<DueSoonState>({
    status: "loading",
  });
  const [recentState, setRecentState] = useState<RecentRecordsState>({
    status: "loading",
  });
  const [selectedRecord, setSelectedRecord] = useState<PmRecordRow | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await fetchDueSoonPlans();
      if (!cancelled) setDueSoonState(result);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await fetchRecentRecords();
      if (!cancelled) setRecentState(result);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedRecord) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedRecord(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedRecord]);

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">งาน PM</h1>
        <Link
          href="/pm/plans"
          className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
        >
          จัดการแผน PM
        </Link>
      </div>

      {/* Section A: due soon */}
      <section className="mt-6">
        <h2 className="text-lg font-bold text-primary">
          ถึงกำหนด
          {dueSoonState.status === "loaded" && ` (${dueSoonState.plans.length})`}
        </h2>

        {dueSoonState.status === "loading" ? (
          <TableLoadingSkeleton />
        ) : dueSoonState.status === "error" ? (
          <ErrorBox message={dueSoonState.message} />
        ) : dueSoonState.plans.length === 0 ? (
          <p className="mt-6 py-4 text-center text-primary/70">
            ไม่มีงาน PM ถึงกำหนดใน {DUE_SOON_DAYS} วันนี้ 🎉
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-primary/10 text-left text-primary/60">
                    <th className="py-2 pr-4 font-medium">เครื่องจักร</th>
                    <th className="py-2 pr-4 font-medium">ชื่องาน PM</th>
                    <th className="py-2 pr-4 font-medium">กำหนด</th>
                    <th className="py-2 pr-4 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {dueSoonState.plans.map((plan) => (
                    <tr
                      key={plan.id}
                      className="border-b border-primary/5 hover:bg-surface"
                    >
                      <td className="py-3 pr-4">
                        <span className="break-words font-bold text-primary">
                          {plan.machines?.machine_code ?? "-"}
                        </span>
                        <span className="block break-words text-xs text-primary/60">
                          {plan.machines?.machine_name ??
                            "(ไม่พบข้อมูลเครื่องจักร)"}
                        </span>
                      </td>
                      <td className="max-w-xs break-words py-3 pr-4 text-primary/80">
                        {plan.pm_name}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="whitespace-nowrap text-primary">
                          {formatDateThai(plan.next_due_date)}
                        </div>
                        <div className="mt-1">
                          <DueBadge nextDueDate={plan.next_due_date} />
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <Link
                          href={`/pm/record?plan=${plan.id}`}
                          className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
                        >
                          ทำ PM
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="mt-4 space-y-3 md:hidden">
              {dueSoonState.plans.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-base font-bold text-primary">
                        {plan.machines?.machine_code ?? "-"}
                      </p>
                      <p className="break-words text-sm text-primary/70">
                        {plan.machines?.machine_name ??
                          "(ไม่พบข้อมูลเครื่องจักร)"}
                      </p>
                    </div>
                    <DueBadge nextDueDate={plan.next_due_date} />
                  </div>
                  <p className="mt-2 break-words text-sm font-medium text-primary">
                    {plan.pm_name}
                  </p>
                  <p className="mt-1 text-xs text-primary/60">
                    กำหนด: {formatDateThai(plan.next_due_date)}
                  </p>
                  <Link
                    href={`/pm/record?plan=${plan.id}`}
                    className="mt-3 flex min-h-[44px] items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
                  >
                    ทำ PM
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Section B: recent history */}
      <section className="mt-8">
        <h2 className="text-lg font-bold text-primary">ประวัติล่าสุด</h2>

        {recentState.status === "loading" ? (
          <TableLoadingSkeleton />
        ) : recentState.status === "error" ? (
          <ErrorBox message={recentState.message} />
        ) : recentState.records.length === 0 ? (
          <p className="mt-6 py-4 text-center text-primary/70">
            ยังไม่มีประวัติการทำ PM
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-primary/10 text-left text-primary/60">
                    <th className="py-2 pr-4 font-medium">วันที่ทำ</th>
                    <th className="py-2 pr-4 font-medium">เครื่องจักร</th>
                    <th className="py-2 pr-4 font-medium">ชื่องาน PM</th>
                    <th className="py-2 pr-4 font-medium">ผู้ทำ</th>
                    <th className="py-2 pr-4 font-medium">ค่าใช้จ่าย</th>
                    <th className="py-2 pr-4 font-medium">ผลตรวจ</th>
                  </tr>
                </thead>
                <tbody>
                  {recentState.records.map((record) => {
                    const issueCount = record.checklist_result.filter(
                      (entry) => !entry.ok
                    ).length;
                    return (
                      <tr
                        key={record.id}
                        className="border-b border-primary/5"
                      >
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            className="block w-full whitespace-nowrap px-2 py-3 text-left text-primary hover:bg-surface"
                          >
                            {formatDateThai(record.done_date)}
                          </button>
                        </td>
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            className="block w-full px-2 py-3 text-left hover:bg-surface"
                          >
                            <span className="break-words font-bold text-primary">
                              {record.machines?.machine_code ?? "-"}
                            </span>
                            <span className="block break-words text-xs text-primary/60">
                              {record.machines?.machine_name ??
                                "(ไม่พบข้อมูลเครื่องจักร)"}
                            </span>
                          </button>
                        </td>
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            className="block w-full max-w-xs break-words px-2 py-3 text-left text-primary/80 hover:bg-surface"
                          >
                            {record.pm_plans?.pm_name ?? "-"}
                          </button>
                        </td>
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            className="block w-full px-2 py-3 text-left text-primary/70 hover:bg-surface"
                          >
                            {record.done_by ?? "-"}
                          </button>
                        </td>
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            className="block w-full whitespace-nowrap px-2 py-3 text-left text-primary/70 hover:bg-surface"
                          >
                            {formatMoneyThai(record.pm_cost)}
                          </button>
                        </td>
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            className="flex w-full items-center px-2 py-3 text-left hover:bg-surface"
                          >
                            <IssueBadge issueCount={issueCount} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="mt-4 space-y-3 md:hidden">
              {recentState.records.map((record) => {
                const issueCount = record.checklist_result.filter(
                  (entry) => !entry.ok
                ).length;
                return (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => setSelectedRecord(record)}
                    className="block w-full rounded-lg border border-primary/10 bg-white p-4 text-left shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-primary">
                        {formatDateThai(record.done_date)}
                      </span>
                      <IssueBadge issueCount={issueCount} />
                    </div>
                    <p className="mt-2 break-words text-sm font-medium text-primary">
                      {record.machines?.machine_code ?? "-"} —{" "}
                      {record.machines?.machine_name ??
                        "(ไม่พบข้อมูลเครื่องจักร)"}
                    </p>
                    <p className="mt-1 break-words text-sm text-primary/70">
                      {record.pm_plans?.pm_name ?? "-"}
                    </p>
                    <p className="mt-2 text-xs text-primary/60">
                      ผู้ทำ: {record.done_by ?? "-"} ·{" "}
                      {formatMoneyThai(record.pm_cost)}
                    </p>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Section B row detail modal */}
      {selectedRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelectedRecord(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-lg font-bold text-primary">
                  {selectedRecord.pm_plans?.pm_name ?? "-"}
                </p>
                <p className="break-words text-sm text-primary/70">
                  {selectedRecord.machines?.machine_code ?? "-"} —{" "}
                  {selectedRecord.machines?.machine_name ??
                    "(ไม่พบข้อมูลเครื่องจักร)"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                aria-label="ปิด"
                className="shrink-0 text-primary/50 hover:text-primary"
              >
                ✕
              </button>
            </div>

            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">วันที่ทำ</dt>
                <dd className="text-right text-primary">
                  {formatDateThai(selectedRecord.done_date)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">ผู้ทำ</dt>
                <dd className="text-right text-primary">
                  {selectedRecord.done_by ?? "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">ค่าใช้จ่ายในการทำ PM</dt>
                <dd className="text-right font-bold text-primary">
                  {formatMoneyThai(selectedRecord.pm_cost)}
                </dd>
              </div>
            </dl>

            <div className="mt-4">
              <h3 className="text-sm font-semibold text-primary/70">
                รายการตรวจ
              </h3>
              <div className="mt-2">
                <ChecklistResultView items={selectedRecord.checklist_result} />
              </div>
            </div>

            {selectedRecord.notes && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-primary/70">
                  หมายเหตุ
                </h3>
                <p className="mt-1 break-words text-sm text-primary">
                  {selectedRecord.notes}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
