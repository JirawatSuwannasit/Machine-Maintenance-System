"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  computeMachineStatus,
  MACHINE_STATUS_COLORS,
  MACHINE_STATUS_LABELS,
  type MachineStatus,
} from "@/lib/machineStatus";
import { formatDateThai, computeDueDiffDays, computeDueDisplay } from "@/lib/pmDueDate";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MACHINE_OWN_STATUS_LABELS: Record<string, string> = {
  active: "ใช้งาน",
  inactive: "ไม่ใช้งาน",
  scrapped: "ปลดระวาง",
};

const REASON_LABEL: Record<string, string> = {
  planned: "ตามรอบ",
  breakdown: "เครื่องเสีย",
};

// ===== Types =====

type MachineReport = {
  id: string;
  machine_code: string;
  machine_name: string;
  category: string | null;
  location: string | null;
  status: string;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  purchase_date: string | null;
  install_date: string | null;
  warranty_expiry: string | null;
};

type BreakdownRow = {
  id: string;
  reported_at: string;
  symptom: string;
  cause: string | null;
  action_taken: string | null;
  downtime_minutes: number | null;
  repair_cost: number | string;
  technician: string | null;
};

type PlanRelation = { pm_name: string };
type PmRecordRow = {
  id: string;
  done_date: string;
  done_by: string | null;
  pm_cost: number | string;
  notes: string | null;
  checklist_result: unknown;
  pm_plans: PlanRelation | null;
};
type RawPmRecordRow = Omit<PmRecordRow, "pm_plans"> & {
  pm_plans: PlanRelation | PlanRelation[] | null;
};

type PartRelation = { part_code: string; part_name: string };
type ReplacementRow = {
  id: string;
  replaced_at: string;
  qty_used: number;
  unit_cost: number | string;
  total_cost: number | string;
  reason: string | null;
  replaced_by: string | null;
  spare_parts: PartRelation | null;
};
type RawReplacementRow = Omit<ReplacementRow, "spare_parts"> & {
  spare_parts: PartRelation | PartRelation[] | null;
};

type UpcomingRow = {
  kind: "pm" | "part";
  id: string;
  label: string;
  dueDate: string;
};
type RawUpcomingPartRow = {
  id: string;
  next_due_date: string;
  spare_parts: PartRelation | PartRelation[] | null;
};

// Without generated Database types, postgrest-js infers every embedded
// relation as an array regardless of actual FK cardinality, even though
// pm_records.pm_plan_id -> pm_plans.id and part_replacements.part_id /
// machine_parts.part_id -> spare_parts.id are all to-one and return plain
// objects at runtime.
function normalizePlanRelation(
  plan: PlanRelation | PlanRelation[] | null
): PlanRelation | null {
  if (!plan) return null;
  if (Array.isArray(plan)) return plan[0] ?? null;
  return plan;
}

function normalizePartRelation(
  part: PartRelation | PartRelation[] | null
): PartRelation | null {
  if (!part) return null;
  if (Array.isArray(part)) return part[0] ?? null;
  return part;
}

// ===== Formatting helpers =====

function coerceNumber(value: number | string): number {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return Number.isFinite(num) ? num : 0;
}

function formatMoneyThai(value: number | string): string {
  const num = coerceNumber(value);
  return `${num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

function formatDowntimeThai(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours} ชม. ${remainder} น.` : `${hours} ชม.`;
  }
  return `${minutes} นาที`;
}

function formatHoursDecimal(totalMinutes: number): string {
  return `${(totalMinutes / 60).toFixed(1)} ชม.`;
}

// reported_at is timestamptz ("YYYY-MM-DDTHH:mm:ss+00:00"); slicing the date
// portion before handing it to lib/pmDueDate.ts's formatDateThai (which
// expects a plain "YYYY-MM-DD" date) avoids any timezone-shift risk from
// re-parsing through `new Date()`.
function formatTimestampDateThai(isoTimestamp: string): string {
  return formatDateThai(isoTimestamp.slice(0, 10));
}

// lib/pmDueDate.ts's formatDateThai expects a non-null "YYYY-MM-DD" string;
// several machine asset fields (purchase_date, install_date,
// warranty_expiry) are optional, so this wraps it with the "-" fallback
// used throughout the rest of the app for empty dates.
function formatDateThaiOrDash(isoDate: string | null): string {
  return isoDate ? formatDateThai(isoDate) : "-";
}

// Same "เลยกำหนด/ครบกำหนดวันนี้/อีก" wording used elsewhere in the app, but
// written locally rather than reusing lib/pmDueDate.ts's computeDueDisplay()
// LABEL -- that helper's far-future branch returns a plain formatted date
// instead of "อีก X วัน" once past DUE_SOON_DAYS, which would look
// inconsistent in a table where every future row should read "อีก X วัน"
// regardless of how far out it is. The COLOUR from computeDueDisplay is
// still reused below, since urgency colour-coding is the same concept here
// as everywhere else in the app.
function formatUrgencyLabel(diffDays: number): string {
  if (diffDays < 0) return `เลยกำหนด ${Math.abs(diffDays)} วัน`;
  if (diffDays === 0) return "ครบกำหนดวันนี้";
  return `อีก ${diffDays} วัน`;
}

function countIssues(checklistResult: unknown): number | null {
  if (!Array.isArray(checklistResult) || checklistResult.length === 0) {
    return null;
  }
  return checklistResult.filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>).ok === false
  ).length;
}

function displayValue(value: string | null | undefined): string {
  return value && value.trim() !== "" ? value : "-";
}

function todayIsoDate(): string {
  return isoDateFromDate(new Date());
}

function isoDateFromDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthsAgoIsoDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return isoDateFromDate(d);
}

// breakdowns.reported_at is a timestamptz, so a plain .lte(reported_at, to)
// would silently exclude same-day breakdowns reported after midnight UTC.
// Using a strict "< the day after `to`" upper bound instead makes the whole
// of `to`'s calendar day inclusive regardless of time-of-day.
function dayAfterIsoDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + 1);
  return isoDateFromDate(d);
}

const EARLIEST_ISO_DATE = "2000-01-01";

// ===== Fetching =====

const BREAKDOWN_SELECT =
  "id, reported_at, symptom, cause, action_taken, downtime_minutes, repair_cost, technician";
const PM_RECORD_SELECT =
  "id, done_date, done_by, pm_cost, notes, checklist_result, pm_plans(pm_name)";
const REPLACEMENT_SELECT =
  "id, replaced_at, qty_used, unit_cost, total_cost, reason, replaced_by, spare_parts(part_code, part_name)";

type ReportData = {
  machine: MachineReport;
  computedStatus: MachineStatus;
  breakdowns: BreakdownRow[];
  pmRecords: PmRecordRow[];
  replacements: ReplacementRow[];
  upcoming: UpcomingRow[];
};

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: ReportData };

async function loadReport(
  machineId: string,
  from: string,
  to: string
): Promise<LoadState> {
  const reportedAtUpperBound = dayAfterIsoDate(to);

  const [
    machineRes,
    breakdownsRes,
    openBreakdownsRes,
    pmRecordsRes,
    replacementsRes,
    pmPlansRes,
    machinePartsRes,
  ] = await Promise.all([
    supabase
      .from("machines")
      .select(
        "id, machine_code, machine_name, category, location, status, manufacturer, model, serial_no, purchase_date, install_date, warranty_expiry"
      )
      .eq("id", machineId)
      .maybeSingle(),
    supabase
      .from("breakdowns")
      .select(BREAKDOWN_SELECT)
      .eq("machine_id", machineId)
      .gte("reported_at", from)
      .lt("reported_at", reportedAtUpperBound)
      .order("reported_at", { ascending: false }),
    // Unfiltered by range on purpose -- the header status badge reflects
    // the machine's state right now, not whatever historical range the
    // report happens to be showing.
    supabase
      .from("breakdowns")
      .select("id")
      .eq("machine_id", machineId)
      .in("status", ["open", "in_progress"]),
    supabase
      .from("pm_records")
      .select(PM_RECORD_SELECT)
      .eq("machine_id", machineId)
      .gte("done_date", from)
      .lte("done_date", to)
      .order("done_date", { ascending: false }),
    supabase
      .from("part_replacements")
      .select(REPLACEMENT_SELECT)
      .eq("machine_id", machineId)
      .gte("replaced_at", from)
      .lte("replaced_at", to)
      .order("replaced_at", { ascending: false }),
    // Upcoming schedule is NEVER date-range filtered -- always "from today
    // forward", independent of the history range selected above.
    supabase
      .from("pm_plans")
      .select("id, pm_name, next_due_date")
      .eq("machine_id", machineId)
      .eq("is_active", true)
      .not("next_due_date", "is", null),
    supabase
      .from("machine_parts")
      .select("id, next_due_date, spare_parts(part_code, part_name)")
      .eq("machine_id", machineId)
      .not("next_due_date", "is", null),
  ]);

  if (machineRes.error) {
    if (machineRes.error.code === "PGRST116") {
      return { status: "not-found" };
    }
    return { status: "error", message: machineRes.error.message };
  }
  if (!machineRes.data) {
    return { status: "not-found" };
  }

  const firstError =
    breakdownsRes.error ??
    openBreakdownsRes.error ??
    pmRecordsRes.error ??
    replacementsRes.error ??
    pmPlansRes.error ??
    machinePartsRes.error;
  if (firstError) {
    return { status: "error", message: firstError.message };
  }

  const machine = machineRes.data as MachineReport;

  const pmRecords = ((pmRecordsRes.data ?? []) as RawPmRecordRow[]).map(
    (row) => ({ ...row, pm_plans: normalizePlanRelation(row.pm_plans) })
  );

  const replacements = (
    (replacementsRes.data ?? []) as RawReplacementRow[]
  ).map((row) => ({
    ...row,
    spare_parts: normalizePartRelation(row.spare_parts),
  }));

  const pmPlanDue: UpcomingRow[] = (
    (pmPlansRes.data ?? []) as Array<{
      id: string;
      pm_name: string;
      next_due_date: string;
    }>
  ).map((plan) => ({
    kind: "pm",
    id: plan.id,
    label: plan.pm_name,
    dueDate: plan.next_due_date,
  }));

  const partDue: UpcomingRow[] = (
    (machinePartsRes.data ?? []) as RawUpcomingPartRow[]
  ).map((row) => {
    const part = normalizePartRelation(row.spare_parts);
    return {
      kind: "part",
      id: row.id,
      label: part ? `${part.part_code} — ${part.part_name}` : "-",
      dueDate: row.next_due_date,
    };
  });

  const upcoming = [...pmPlanDue, ...partDue].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate)
  );

  const hasOpenBreakdown = (openBreakdownsRes.data ?? []).length > 0;
  const computedStatus = computeMachineStatus(
    machine.status,
    hasOpenBreakdown,
    upcoming.map((row) => row.dueDate)
  );

  return {
    status: "loaded",
    data: {
      machine,
      computedStatus,
      breakdowns: (breakdownsRes.data ?? []) as BreakdownRow[],
      pmRecords,
      replacements,
      upcoming,
    },
  };
}

// ===== Small presentational pieces =====

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-primary/60 print:text-black">{label}</span>
      <span className="text-right text-primary print:text-black">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: MachineStatus }) {
  return (
    <span
      className="report-badge inline-flex w-fit items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{
        borderColor: MACHINE_STATUS_COLORS[status],
        color: MACHINE_STATUS_COLORS[status],
      }}
    >
      {MACHINE_STATUS_LABELS[status]}
    </span>
  );
}

function UrgencyBadge({ dueDate }: { dueDate: string }) {
  const diffDays = computeDueDiffDays(dueDate) ?? 0;
  const display = computeDueDisplay(dueDate);
  return (
    <span
      className={`report-badge inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${display.className}`}
    >
      {formatUrgencyLabel(diffDays)}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-4 animate-pulse space-y-4 print:hidden">
      <div className="h-8 w-64 rounded-md bg-primary/10" />
      <div className="h-40 rounded-lg bg-primary/10" />
      <div className="h-40 rounded-lg bg-primary/10" />
    </div>
  );
}

const inputClassName =
  "mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export default function MachineReportPage() {
  const params = useParams<{ id: string }>();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [rangeFrom, setRangeFrom] = useState(() => monthsAgoIsoDate(12));
  const [rangeTo, setRangeTo] = useState(() => todayIsoDate());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!UUID_REGEX.test(params.id)) {
        setState({ status: "not-found" });
        return;
      }
      const result = await loadReport(params.id, rangeFrom, rangeTo);
      if (!cancelled) setState(result);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [params.id, rangeFrom, rangeTo]);

  function applyMonthsRange(months: number) {
    setRangeFrom(monthsAgoIsoDate(months));
    setRangeTo(todayIsoDate());
  }

  function applyAllRange() {
    setRangeFrom(EARLIEST_ISO_DATE);
    setRangeTo(todayIsoDate());
  }

  const summary = useMemo(() => {
    if (state.status !== "loaded") return null;
    const { breakdowns, pmRecords, replacements } = state.data;

    const totalDowntimeMinutes = breakdowns.reduce(
      (sum, b) => sum + (b.downtime_minutes ?? 0),
      0
    );
    const totalRepairCost = breakdowns.reduce(
      (sum, b) => sum + coerceNumber(b.repair_cost),
      0
    );
    const totalPmCost = pmRecords.reduce(
      (sum, r) => sum + coerceNumber(r.pm_cost),
      0
    );
    const totalPartsCost = replacements.reduce(
      (sum, r) => sum + coerceNumber(r.total_cost),
      0
    );

    // Total Maintenance Cost = repair labour + PM cost + part costs, each
    // summed from exactly ONE table (supabase/migrations/001_init.sql):
    // breakdowns.repair_cost is labour/outsourcing only and never includes
    // part costs -- part_replacements.breakdown_id exists so a breakdown's
    // full job cost can be ASSEMBLED here by the caller, not so repair_cost
    // absorbs it. Adding totalPartsCost again anywhere else would
    // double-count parts used on a breakdown repair.
    const totalMaintenanceCost = totalRepairCost + totalPmCost + totalPartsCost;

    return {
      breakdownCount: breakdowns.length,
      totalDowntimeMinutes,
      pmCount: pmRecords.length,
      replacementCount: replacements.length,
      totalRepairCost,
      totalPmCost,
      totalPartsCost,
      totalMaintenanceCost,
    };
  }, [state]);

  return (
    <div id="printable-report" className="p-4 print:p-0">
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-report,
          #printable-report * {
            visibility: visible;
          }
          #printable-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
          }
          @page {
            size: A4 portrait;
            margin: 15mm;
          }
          /* !important is required here: <body> carries the app-wide
             bg-surface/text-primary Tailwind classes (from app/layout.tsx,
             out of scope for this ticket), and a class selector always
             outranks a plain element selector regardless of source order. */
          body {
            background: #fff !important;
            color: #000 !important;
            font-size: 12px;
          }
          thead {
            display: table-header-group;
          }
          tr {
            break-inside: avoid;
          }
          h2 {
            break-after: avoid;
          }
          .report-badge {
            border: 1px solid #000 !important;
            color: #000 !important;
            background: transparent !important;
          }
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold">รายงานประวัติเครื่องจักร</h1>
        <Link
          href={`/machines/${params.id}`}
          className="flex min-h-[44px] items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
        >
          กลับ
        </Link>
      </div>

      {state.status === "loading" && <LoadingSkeleton />}

      {state.status === "not-found" && (
        <div className="mt-10 flex flex-col items-center gap-4 text-center print:hidden">
          <p className="text-primary/70">ไม่พบเครื่องจักรนี้</p>
          <Link
            href="/"
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            กลับหน้าแรก
          </Link>
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 print:hidden">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">
            {state.message}
          </pre>
        </div>
      )}

      {state.status === "loaded" && summary && (
        <>
          {/* Screen-only controls */}
          <div className="mt-4 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:hidden">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div>
                <label className="block text-xs font-medium text-primary/60">
                  จากวันที่
                </label>
                <input
                  type="date"
                  value={rangeFrom}
                  onChange={(event) => setRangeFrom(event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-primary/60">
                  ถึงวันที่
                </label>
                <input
                  type="date"
                  value={rangeTo}
                  onChange={(event) => setRangeTo(event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {[3, 6, 12].map((months) => (
                  <button
                    key={months}
                    type="button"
                    onClick={() => applyMonthsRange(months)}
                    className="flex min-h-[40px] items-center justify-center rounded-md border border-primary/20 px-3 text-sm font-medium text-primary hover:bg-primary/5"
                  >
                    {months} เดือน
                  </button>
                ))}
                <button
                  type="button"
                  onClick={applyAllRange}
                  className="flex min-h-[40px] items-center justify-center rounded-md border border-primary/20 px-3 text-sm font-medium text-primary hover:bg-primary/5"
                >
                  ทั้งหมด
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 sm:w-fit"
            >
              🖨 พิมพ์ / บันทึก PDF
            </button>
          </div>

          {/* Print-only banner */}
          <div className="hidden print:mb-4 print:block">
            <h1 className="text-lg font-bold text-black">
              รายงานประวัติเครื่องจักร {state.data.machine.machine_code} —
              พิมพ์วันที่ {formatDateThai(todayIsoDate())}
            </h1>
            <p className="text-sm text-black">
              ช่วงเวลา: {formatDateThai(rangeFrom)} - {formatDateThai(rangeTo)}
            </p>
          </div>

          {/* 1. Machine info header */}
          <div className="mt-4 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:mt-0 print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-primary print:text-black">
                  {state.data.machine.machine_code}
                </h2>
                <p className="text-primary/80 print:text-black">
                  {state.data.machine.machine_name}
                </p>
                {state.data.machine.category && (
                  <span className="mt-2 inline-block w-fit rounded-full border border-primary/10 bg-surface px-2 py-0.5 text-xs text-primary/70 print:border-black print:bg-transparent print:text-black">
                    {state.data.machine.category}
                  </span>
                )}
              </div>
              <StatusBadge status={state.data.computedStatus} />
            </div>

            <div className="mt-4 grid gap-6 sm:grid-cols-2 print:grid-cols-2 print:gap-4">
              <div>
                <h3 className="border-b border-primary/10 pb-1 text-sm font-semibold text-primary/70 print:border-black print:text-black">
                  ข้อมูลเครื่องจักร
                </h3>
                <div className="divide-y divide-primary/5 print:divide-black/20">
                  <InfoRow
                    label="ส่วนงาน"
                    value={displayValue(state.data.machine.location)}
                  />
                  <InfoRow
                    label="สถานะ"
                    value={
                      MACHINE_OWN_STATUS_LABELS[state.data.machine.status] ??
                      state.data.machine.status
                    }
                  />
                </div>
              </div>
              <div>
                <h3 className="border-b border-primary/10 pb-1 text-sm font-semibold text-primary/70 print:border-black print:text-black">
                  ข้อมูลทรัพย์สิน
                </h3>
                <div className="divide-y divide-primary/5 print:divide-black/20">
                  <InfoRow
                    label="ยี่ห้อ/ผู้ผลิต"
                    value={displayValue(state.data.machine.manufacturer)}
                  />
                  <InfoRow
                    label="รุ่น"
                    value={displayValue(state.data.machine.model)}
                  />
                  <InfoRow
                    label="หมายเลขเครื่อง S/N"
                    value={displayValue(state.data.machine.serial_no)}
                  />
                  <InfoRow
                    label="วันที่ซื้อ"
                    value={formatDateThaiOrDash(state.data.machine.purchase_date)}
                  />
                  <InfoRow
                    label="วันติดตั้ง"
                    value={formatDateThaiOrDash(state.data.machine.install_date)}
                  />
                  <InfoRow
                    label="วันหมดประกัน"
                    value={formatDateThaiOrDash(state.data.machine.warranty_expiry)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 2. สรุป */}
          <div className="mt-4 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:break-inside-avoid print:rounded-none print:border print:border-black print:shadow-none">
            <h2 className="text-lg font-bold text-primary print:text-black">
              สรุป
            </h2>
            <dl className="mt-2 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60 print:text-black">
                  จำนวนครั้งที่เสีย
                </dt>
                <dd className="text-right text-primary print:text-black">
                  {summary.breakdownCount} ครั้ง
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60 print:text-black">
                  Downtime รวม
                </dt>
                <dd className="text-right text-primary print:text-black">
                  {formatHoursDecimal(summary.totalDowntimeMinutes)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60 print:text-black">
                  จำนวนครั้งทำ PM
                </dt>
                <dd className="text-right text-primary print:text-black">
                  {summary.pmCount} ครั้ง
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60 print:text-black">
                  จำนวนครั้งเปลี่ยนอะไหล่
                </dt>
                <dd className="text-right text-primary print:text-black">
                  {summary.replacementCount} ครั้ง
                </dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-primary/10 pt-3 print:border-black">
              <div className="flex justify-between text-sm">
                <span className="text-primary/70 print:text-black">
                  ค่าซ่อม (แรงงาน)
                </span>
                <span className="text-right tabular-nums text-primary print:text-black">
                  {formatMoneyThai(summary.totalRepairCost)}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-primary/70 print:text-black">ค่า PM</span>
                <span className="text-right tabular-nums text-primary print:text-black">
                  {formatMoneyThai(summary.totalPmCost)}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-primary/70 print:text-black">
                  ค่าอะไหล่
                </span>
                <span className="text-right tabular-nums text-primary print:text-black">
                  {formatMoneyThai(summary.totalPartsCost)}
                </span>
              </div>
              <div className="mt-2 flex justify-between border-t border-primary/20 pt-2 text-base font-bold print:border-black">
                <span className="text-primary print:text-black">
                  ต้นทุนบำรุงรักษารวม
                </span>
                <span className="text-right tabular-nums text-primary print:text-black">
                  {formatMoneyThai(summary.totalMaintenanceCost)}
                </span>
              </div>
            </div>
          </div>

          {/* 3. ประวัติแจ้งเสีย */}
          <section className="mt-6 print:mt-4">
            <h2 className="text-lg font-bold text-primary print:text-black">
              ประวัติแจ้งเสีย
            </h2>

            {state.data.breakdowns.length === 0 ? (
              <p className="mt-4 py-4 text-center text-sm text-primary/60 print:text-black">
                ไม่มีข้อมูลในช่วงเวลาที่เลือก
              </p>
            ) : (
              <>
                <div className="mt-3 hidden overflow-x-auto md:block print:!block">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-primary/10 text-left text-primary/60 print:border-black print:text-black">
                        <th className="py-2 pr-4 font-medium">วันที่</th>
                        <th className="py-2 pr-4 font-medium">อาการ</th>
                        <th className="py-2 pr-4 font-medium">สาเหตุ</th>
                        <th className="py-2 pr-4 font-medium">วิธีแก้ไข</th>
                        <th className="py-2 pr-4 font-medium">Downtime</th>
                        <th className="py-2 pr-4 font-medium">ค่าซ่อม</th>
                        <th className="py-2 pr-4 font-medium">ผู้ซ่อม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.breakdowns.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-primary/5 print:border-black/30"
                        >
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary print:text-black">
                            {formatTimestampDateThai(row.reported_at)}
                          </td>
                          <td className="max-w-xs break-words py-2 pr-4 align-top text-primary print:text-black">
                            {row.symptom}
                          </td>
                          <td className="max-w-xs break-words py-2 pr-4 align-top text-primary/70 print:text-black">
                            {row.cause ?? "-"}
                          </td>
                          <td className="max-w-xs break-words py-2 pr-4 align-top text-primary/70 print:text-black">
                            {row.action_taken ?? "-"}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                            {row.downtime_minutes != null
                              ? formatDowntimeThai(row.downtime_minutes)
                              : "-"}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                            {formatMoneyThai(row.repair_cost)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                            {row.technician ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-primary/20 font-bold print:border-black">
                        <td
                          colSpan={4}
                          className="py-2 pr-4 text-right text-primary print:text-black"
                        >
                          รวม
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4 text-primary print:text-black">
                          {formatDowntimeThai(summary.totalDowntimeMinutes)}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4 text-primary print:text-black">
                          {formatMoneyThai(summary.totalRepairCost)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="mt-3 space-y-3 md:hidden print:!hidden">
                  {state.data.breakdowns.map((row) => (
                    <div
                      key={row.id}
                      className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-primary">
                          {formatTimestampDateThai(row.reported_at)}
                        </span>
                        <span className="text-sm font-medium text-primary">
                          {formatMoneyThai(row.repair_cost)}
                        </span>
                      </div>
                      <p className="mt-2 break-words text-sm text-primary">
                        {row.symptom}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary/60">
                        <span>สาเหตุ: {row.cause ?? "-"}</span>
                        <span>วิธีแก้ไข: {row.action_taken ?? "-"}</span>
                        <span>
                          Downtime:{" "}
                          {row.downtime_minutes != null
                            ? formatDowntimeThai(row.downtime_minutes)
                            : "-"}
                        </span>
                        <span>ผู้ซ่อม: {row.technician ?? "-"}</span>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-lg border border-primary/10 bg-surface p-4 text-sm font-bold text-primary">
                    รวม: Downtime {formatDowntimeThai(summary.totalDowntimeMinutes)}{" "}
                    · ค่าซ่อม {formatMoneyThai(summary.totalRepairCost)}
                  </div>
                </div>
              </>
            )}
          </section>

          {/* 4. ประวัติ PM */}
          <section className="mt-6 print:mt-4">
            <h2 className="text-lg font-bold text-primary print:text-black">
              ประวัติ PM
            </h2>

            {state.data.pmRecords.length === 0 ? (
              <p className="mt-4 py-4 text-center text-sm text-primary/60 print:text-black">
                ไม่มีข้อมูลในช่วงเวลาที่เลือก
              </p>
            ) : (
              <>
                <div className="mt-3 hidden overflow-x-auto md:block print:!block">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-primary/10 text-left text-primary/60 print:border-black print:text-black">
                        <th className="py-2 pr-4 font-medium">วันที่</th>
                        <th className="py-2 pr-4 font-medium">ชื่องาน PM</th>
                        <th className="py-2 pr-4 font-medium">ผู้ทำ</th>
                        <th className="py-2 pr-4 font-medium">พบปัญหา</th>
                        <th className="py-2 pr-4 font-medium">ค่า PM</th>
                        <th className="py-2 pr-4 font-medium">หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.pmRecords.map((row) => {
                        const issueCount = countIssues(row.checklist_result);
                        return (
                          <tr
                            key={row.id}
                            className="border-b border-primary/5 print:border-black/30"
                          >
                            <td className="whitespace-nowrap py-2 pr-4 align-top text-primary print:text-black">
                              {formatDateThai(row.done_date)}
                            </td>
                            <td className="max-w-xs break-words py-2 pr-4 align-top text-primary print:text-black">
                              {row.pm_plans?.pm_name ?? "-"}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                              {row.done_by ?? "-"}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                              {issueCount != null ? `${issueCount} ข้อ` : "-"}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                              {formatMoneyThai(row.pm_cost)}
                            </td>
                            <td className="max-w-xs break-words py-2 pr-4 align-top text-primary/70 print:text-black">
                              {row.notes ?? "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-primary/20 font-bold print:border-black">
                        <td
                          colSpan={4}
                          className="py-2 pr-4 text-right text-primary print:text-black"
                        >
                          รวม
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4 text-primary print:text-black">
                          {formatMoneyThai(summary.totalPmCost)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="mt-3 space-y-3 md:hidden print:!hidden">
                  {state.data.pmRecords.map((row) => {
                    const issueCount = countIssues(row.checklist_result);
                    return (
                      <div
                        key={row.id}
                        className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-primary">
                            {formatDateThai(row.done_date)}
                          </span>
                          <span className="text-sm font-medium text-primary">
                            {formatMoneyThai(row.pm_cost)}
                          </span>
                        </div>
                        <p className="mt-2 break-words text-sm text-primary">
                          {row.pm_plans?.pm_name ?? "-"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary/60">
                          <span>ผู้ทำ: {row.done_by ?? "-"}</span>
                          <span>
                            พบปัญหา:{" "}
                            {issueCount != null ? `${issueCount} ข้อ` : "-"}
                          </span>
                          {row.notes && <span>หมายเหตุ: {row.notes}</span>}
                        </div>
                      </div>
                    );
                  })}
                  <div className="rounded-lg border border-primary/10 bg-surface p-4 text-sm font-bold text-primary">
                    รวม: ค่า PM {formatMoneyThai(summary.totalPmCost)}
                  </div>
                </div>
              </>
            )}
          </section>

          {/* 5. ประวัติเปลี่ยนอะไหล่ */}
          <section className="mt-6 print:mt-4">
            <h2 className="text-lg font-bold text-primary print:text-black">
              ประวัติเปลี่ยนอะไหล่
            </h2>

            {state.data.replacements.length === 0 ? (
              <p className="mt-4 py-4 text-center text-sm text-primary/60 print:text-black">
                ไม่มีข้อมูลในช่วงเวลาที่เลือก
              </p>
            ) : (
              <>
                <div className="mt-3 hidden overflow-x-auto md:block print:!block">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-primary/10 text-left text-primary/60 print:border-black print:text-black">
                        <th className="py-2 pr-4 font-medium">วันที่</th>
                        <th className="py-2 pr-4 font-medium">อะไหล่</th>
                        <th className="py-2 pr-4 font-medium">จำนวน</th>
                        <th className="py-2 pr-4 font-medium">ราคา/หน่วย</th>
                        <th className="py-2 pr-4 font-medium">รวม</th>
                        <th className="py-2 pr-4 font-medium">เหตุผล</th>
                        <th className="py-2 pr-4 font-medium">ผู้เปลี่ยน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.replacements.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-primary/5 print:border-black/30"
                        >
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary print:text-black">
                            {formatDateThai(row.replaced_at)}
                          </td>
                          <td className="max-w-xs break-words py-2 pr-4 align-top text-primary print:text-black">
                            {row.spare_parts?.part_code ?? "-"}{" "}
                            <span className="text-primary/60 print:text-black">
                              {row.spare_parts?.part_name ?? ""}
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                            {row.qty_used}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                            {formatMoneyThai(row.unit_cost)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary print:text-black">
                            {formatMoneyThai(row.total_cost)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                            {row.reason
                              ? REASON_LABEL[row.reason] ?? row.reason
                              : "-"}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                            {row.replaced_by ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-primary/20 font-bold print:border-black">
                        <td
                          colSpan={4}
                          className="py-2 pr-4 text-right text-primary print:text-black"
                        >
                          รวม
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4 text-primary print:text-black">
                          {formatMoneyThai(summary.totalPartsCost)}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="mt-3 space-y-3 md:hidden print:!hidden">
                  {state.data.replacements.map((row) => (
                    <div
                      key={row.id}
                      className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-primary">
                          {formatDateThai(row.replaced_at)}
                        </span>
                        <span className="text-sm font-medium text-primary">
                          {formatMoneyThai(row.total_cost)}
                        </span>
                      </div>
                      <p className="mt-2 break-words text-sm text-primary">
                        {row.spare_parts?.part_code ?? "-"} —{" "}
                        {row.spare_parts?.part_name ?? ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary/60">
                        <span>จำนวน: {row.qty_used}</span>
                        <span>ราคา/หน่วย: {formatMoneyThai(row.unit_cost)}</span>
                        <span>
                          เหตุผล:{" "}
                          {row.reason
                            ? REASON_LABEL[row.reason] ?? row.reason
                            : "-"}
                        </span>
                        <span>ผู้เปลี่ยน: {row.replaced_by ?? "-"}</span>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-lg border border-primary/10 bg-surface p-4 text-sm font-bold text-primary">
                    รวม: ค่าอะไหล่ {formatMoneyThai(summary.totalPartsCost)}
                  </div>
                </div>
              </>
            )}
          </section>

          {/* 6. กำหนดการถัดไป */}
          <section className="mt-6 print:mt-4">
            <h2 className="text-lg font-bold text-primary print:text-black">
              กำหนดการถัดไป
            </h2>

            {state.data.upcoming.length === 0 ? (
              <p className="mt-4 py-4 text-center text-sm text-primary/60 print:text-black">
                ไม่มีกำหนดการถัดไป
              </p>
            ) : (
              <>
                <div className="mt-3 hidden overflow-x-auto md:block print:!block">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-primary/10 text-left text-primary/60 print:border-black print:text-black">
                        <th className="py-2 pr-4 font-medium">ประเภท</th>
                        <th className="py-2 pr-4 font-medium">รายการ</th>
                        <th className="py-2 pr-4 font-medium">กำหนด</th>
                        <th className="py-2 pr-4 font-medium">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.upcoming.map((row) => (
                        <tr
                          key={`${row.kind}-${row.id}`}
                          className="border-b border-primary/5 print:border-black/30"
                        >
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary print:text-black">
                            {row.kind === "pm" ? "[PM]" : "[อะไหล่]"}
                          </td>
                          <td className="max-w-xs break-words py-2 pr-4 align-top text-primary print:text-black">
                            {row.label}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 align-top text-primary/70 print:text-black">
                            {formatDateThai(row.dueDate)}
                          </td>
                          <td className="py-2 pr-4 align-top">
                            <UrgencyBadge dueDate={row.dueDate} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 space-y-3 md:hidden print:!hidden">
                  {state.data.upcoming.map((row) => (
                    <div
                      key={`${row.kind}-${row.id}`}
                      className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-xs font-medium text-primary/60">
                            {row.kind === "pm" ? "[PM]" : "[อะไหล่]"}
                          </span>
                          <p className="break-words text-sm font-medium text-primary">
                            {row.label}
                          </p>
                          <p className="mt-1 text-xs text-primary/60">
                            กำหนด: {formatDateThai(row.dueDate)}
                          </p>
                        </div>
                        <UrgencyBadge dueDate={row.dueDate} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
