"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateThai } from "@/lib/pmDueDate";
import ChecklistResultView, {
  type ChecklistResultItem,
} from "@/components/pm/ChecklistResultView";

type PmHistoryTabProps = {
  machineId: string;
};

type PlanRelation = { pm_name: string };

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

type PmHistoryEntry = {
  id: string;
  done_date: string;
  done_by: string | null;
  pm_cost: number | string;
  notes: string | null;
  checklist_result: ChecklistResultItem[];
  pm_plans: PlanRelation | null;
};

type RawPmHistoryEntry = Omit<
  PmHistoryEntry,
  "pm_plans" | "checklist_result"
> & {
  pm_plans: PlanRelation | PlanRelation[] | null;
  checklist_result: unknown;
};

const PM_HISTORY_SELECT =
  "id, done_date, done_by, pm_cost, notes, checklist_result, pm_plans(pm_name)";

type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; entries: PmHistoryEntry[] };

async function fetchPmHistory(machineId: string): Promise<HistoryState> {
  const { data, error } = await supabase
    .from("pm_records")
    .select(PM_HISTORY_SELECT)
    .eq("machine_id", machineId)
    .order("done_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return { status: "error", message: error.message };
  }

  const entries = ((data ?? []) as RawPmHistoryEntry[]).map((row) => ({
    ...row,
    pm_plans: normalizePlanRelation(row.pm_plans),
    checklist_result: normalizeChecklistResult(row.checklist_result),
  }));

  return { status: "loaded", entries };
}

type ActivePlanOption = {
  id: string;
  pm_name: string;
  next_due_date: string | null;
};

type ActivePlansState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; plans: ActivePlanOption[] };

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-20 rounded-lg bg-primary/10" />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      <pre className="whitespace-pre-wrap break-all font-mono text-xs">
        {message}
      </pre>
    </div>
  );
}

export default function PmHistoryTab({ machineId }: PmHistoryTabProps) {
  const [historyState, setHistoryState] = useState<HistoryState>({
    status: "loading",
  });
  const [activePlansState, setActivePlansState] = useState<ActivePlansState>({
    status: "loading",
  });
  const [showPicker, setShowPicker] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [historyResult, plansRes] = await Promise.all([
        fetchPmHistory(machineId),
        supabase
          .from("pm_plans")
          .select("id, pm_name, next_due_date")
          .eq("machine_id", machineId)
          .eq("is_active", true)
          .order("pm_name", { ascending: true }),
      ]);

      if (cancelled) return;

      setHistoryState(historyResult);

      if (plansRes.error) {
        setActivePlansState({ status: "error", message: plansRes.error.message });
      } else {
        setActivePlansState({
          status: "loaded",
          plans: (plansRes.data ?? []) as ActivePlanOption[],
        });
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [machineId]);

  return (
    <div>
      {/* "ทำ PM เครื่องนี้" entry point */}
      <div className="mb-4">
        {activePlansState.status === "loading" ? (
          <div className="h-11 w-40 animate-pulse rounded-md bg-primary/10" />
        ) : activePlansState.status === "error" ? (
          <ErrorBox message={activePlansState.message} />
        ) : activePlansState.plans.length === 0 ? (
          <div className="rounded-md border border-primary/10 bg-surface p-3 text-sm text-primary/70">
            เครื่องนี้ยังไม่มีแผน PM ·{" "}
            <Link
              href="/pm/plans"
              className="font-medium text-accent hover:underline"
            >
              ไปหน้าแผน PM
            </Link>
          </div>
        ) : activePlansState.plans.length === 1 ? (
          <Link
            href={`/pm/record?plan=${activePlansState.plans[0].id}`}
            className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 sm:w-fit"
          >
            ทำ PM เครื่องนี้
          </Link>
        ) : (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPicker((prev) => !prev)}
              className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 sm:w-fit"
            >
              ทำ PM เครื่องนี้
            </button>
            {showPicker && (
              <div className="mt-2 space-y-2 rounded-lg border border-primary/10 bg-white p-3 shadow-sm sm:max-w-sm">
                {activePlansState.plans.map((plan) => (
                  <Link
                    key={plan.id}
                    href={`/pm/record?plan=${plan.id}`}
                    className="block rounded-md border border-primary/10 p-3 hover:bg-surface"
                  >
                    <p className="break-words text-sm font-medium text-primary">
                      {plan.pm_name}
                    </p>
                    <p className="mt-0.5 text-xs text-primary/60">
                      กำหนดครั้งถัดไป:{" "}
                      {plan.next_due_date
                        ? formatDateThai(plan.next_due_date)
                        : "รอทำครั้งแรก"}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* History list */}
      {historyState.status === "loading" ? (
        <LoadingSkeleton />
      ) : historyState.status === "error" ? (
        <ErrorBox message={historyState.message} />
      ) : historyState.entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-primary/60">
          ยังไม่มีประวัติการทำ PM
        </p>
      ) : (
        <div className="space-y-3">
          {historyState.entries.map((entry) => {
            const issueCount = entry.checklist_result.filter(
              (item) => !item.ok
            ).length;
            const isExpanded = expandedId === entry.id;
            return (
              <div
                key={entry.id}
                className="rounded-lg border border-primary/10 bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-primary">
                        {formatDateThai(entry.done_date)}
                      </span>
                      <IssueBadge issueCount={issueCount} />
                    </div>
                    <p className="mt-1 break-words text-sm text-primary/80">
                      {entry.pm_plans?.pm_name ?? "-"}
                    </p>
                    <p className="mt-1 text-xs text-primary/60">
                      ผู้ทำ: {entry.done_by ?? "-"} ·{" "}
                      {formatMoneyThai(entry.pm_cost)}
                    </p>
                  </div>
                  <ChevronDown
                    size={18}
                    aria-hidden="true"
                    className={`shrink-0 text-primary/50 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {isExpanded && (
                  <div className="border-t border-primary/10 p-4">
                    <ChecklistResultView items={entry.checklist_result} />
                    {entry.notes && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-primary/60">
                          หมายเหตุ
                        </h4>
                        <p className="mt-1 break-words text-sm text-primary">
                          {entry.notes}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
