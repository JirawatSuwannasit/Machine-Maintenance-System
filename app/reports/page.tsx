"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { supabase } from "@/lib/supabase";
import {
  coerceNumber,
  computeMaintenanceCost,
  formatMoneyThai,
} from "@/lib/maintenanceCost";
import PrintReportStyles from "@/components/PrintReportStyles";

// ===== Colour choices (see dataviz skill: form/color/validate procedure) =====
// Single-series magnitude bars (charts 1, 2, 5) share one hue -- the app's
// own accent -- rather than a different color per bar, which would
// falsely imply the bars are meaningfully-colored categories (see
// anti-pattern: "a value-ramp / distinct hue on nominal categories").
const ACCENT_BLUE = "#005BAC";
// Fixed-order categorical slots (validated: node scripts/validate_palette.js
// "#2a78d6,#1baf7a,#eda100" --mode light -- ALL CHECKS PASS, CVD worst
// adjacent ΔE 47.2; aqua/yellow fall under 3:1 fill-contrast, mitigated by
// the always-present legend + direct axis/tooltip labels per the relief
// rule) for the 3-series stacked cost bar (chart 6) -- assigned in fixed
// order, never re-ranked.
const CATEGORICAL_SLOT_1 = "#2a78d6"; // ค่าซ่อม
const CATEGORICAL_SLOT_2 = "#1baf7a"; // ค่า PM
const CATEGORICAL_SLOT_3 = "#eda100"; // ค่าอะไหล่
// Fixed status palette (never themed, per dataviz skill) -- used only where
// color means good/bad, paired with a text label so meaning never rests on
// color alone: the pie chart's ตามรอบ/เครื่องเสีย split, and the PM
// on-time-rate badges.
const STATUS_GOOD = "#0ca30c";
const STATUS_WARNING = "#fab219";
const STATUS_CRITICAL = "#d03b3b";

const GRIDLINE_GRAY = "#e1e0d9";
const AXIS_GRAY = "#c3c2b7";
const TICK_GRAY = "#898781";
const LABEL_GRAY = "#52514e";

const REASON_LABEL: Record<string, string> = {
  planned: "ตามรอบ",
  breakdown: "เครื่องเสีย",
};

// ===== Date helpers =====

function isoDateFromDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayIsoDate(): string {
  return isoDateFromDate(new Date());
}

function monthsAgoIsoDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return isoDateFromDate(d);
}

function startOfThisMonthIso(): string {
  const d = new Date();
  return isoDateFromDate(new Date(d.getFullYear(), d.getMonth(), 1));
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

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return isoDateFromDate(d);
}

function formatDateThai(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function enumerateMonths(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const months: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  return `${m}/${y}`;
}

// reported_at/done_date/replaced_at all begin with "YYYY-MM-...", so the
// first 7 characters are the month key regardless of whether the source
// column is a plain date or a timestamptz.
function monthKeyFromIsoDate(iso: string): string {
  return iso.slice(0, 7);
}

function formatHoursDecimal(totalMinutes: number): string {
  return `${(totalMinutes / 60).toFixed(1)} ชม.`;
}

function formatHoursDecimalOrDash(hours: number | null): string {
  return hours === null ? "-" : `${hours.toFixed(1)} ชม.`;
}

// ===== Data types =====

type MachineRow = { id: string; machine_code: string };
type BreakdownRow = {
  id: string;
  machine_id: string;
  reported_at: string;
  downtime_minutes: number | null;
  repair_cost: number | string;
  status: string;
};
type PmPlanRow = {
  id: string;
  pm_name: string;
  frequency_days: number;
  machine_id: string;
};
type PmRecordRow = {
  id: string;
  pm_plan_id: string;
  machine_id: string;
  done_date: string;
  pm_cost: number | string;
};
type ReplacementRow = {
  id: string;
  machine_id: string;
  replaced_at: string;
  qty_used: number;
  unit_cost: number | string;
  total_cost: number | string;
  reason: string | null;
};

type ReportsData = {
  machines: MachineRow[];
  breakdowns: BreakdownRow[];
  pmPlans: PmPlanRow[];
  pmRecordsAll: PmRecordRow[];
  replacements: ReplacementRow[];
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: ReportsData };

async function loadReportsData(from: string, to: string): Promise<LoadState> {
  const breakdownUpperBound = dayAfterIsoDate(to);

  const [machinesRes, breakdownsRes, pmPlansRes, pmRecordsRes, replacementsRes] =
    await Promise.all([
      supabase.from("machines").select("id, machine_code"),
      supabase
        .from("breakdowns")
        .select(
          "id, machine_id, reported_at, downtime_minutes, repair_cost, status"
        )
        .gte("reported_at", from)
        .lt("reported_at", breakdownUpperBound),
      supabase
        .from("pm_plans")
        .select("id, pm_name, frequency_days, machine_id")
        .eq("is_active", true),
      // Unfiltered by range on purpose -- reconstructing each historical due
      // date (see computeOnTimeStats below) needs a plan's FULL done_date
      // history, not just the records inside the selected window, so the
      // "previous record" lookup for the first in-range record stays
      // correct. The in-range subset (for cost totals / monthly charts) is
      // filtered back out of this same result client-side.
      supabase
        .from("pm_records")
        .select("id, pm_plan_id, machine_id, done_date, pm_cost")
        .order("done_date", { ascending: true }),
      supabase
        .from("part_replacements")
        .select(
          "id, machine_id, replaced_at, qty_used, unit_cost, total_cost, reason"
        )
        .gte("replaced_at", from)
        .lte("replaced_at", to),
    ]);

  const firstError =
    machinesRes.error ??
    breakdownsRes.error ??
    pmPlansRes.error ??
    pmRecordsRes.error ??
    replacementsRes.error;
  if (firstError) {
    return { status: "error", message: firstError.message };
  }

  return {
    status: "loaded",
    data: {
      machines: (machinesRes.data ?? []) as MachineRow[],
      breakdowns: (breakdownsRes.data ?? []) as BreakdownRow[],
      pmPlans: (pmPlansRes.data ?? []) as PmPlanRow[],
      pmRecordsAll: (pmRecordsRes.data ?? []) as PmRecordRow[],
      replacements: (replacementsRes.data ?? []) as ReplacementRow[],
    },
  };
}

// ===== PM on-time-rate reconstruction =====

type OnTimePlanStat = {
  planId: string;
  pmName: string;
  machineCode: string;
  eligibleCount: number;
  onTimeRate: number | null;
};

// pm_plans.next_due_date only stores the CURRENT value -- it is overwritten
// on every new pm_record insert by trg_pm_records_after_insert
// (supabase/migrations/001_init.sql), so there is no separately stored
// history of what the due date was at any earlier point in time. This
// reconstructs each historical due date as
// (previous record's done_date + plan.frequency_days), ordering each
// plan's records by done_date first. The very first record for a plan has
// no prior record to compare against, so it can never be judged
// on-time/late and is always excluded from both the numerator and the
// denominator.
function computeOnTimeStats(
  plans: PmPlanRow[],
  machineCodeById: Map<string, string>,
  pmRecordsAll: PmRecordRow[],
  rangeFrom: string,
  rangeTo: string
): OnTimePlanStat[] {
  const recordsByPlan = new Map<string, PmRecordRow[]>();
  for (const record of pmRecordsAll) {
    const list = recordsByPlan.get(record.pm_plan_id) ?? [];
    list.push(record);
    recordsByPlan.set(record.pm_plan_id, list);
  }
  // pmRecordsAll is fetched ordered by done_date ascending, so each plan's
  // list here is already in chronological order.

  return plans.map((plan) => {
    const records = recordsByPlan.get(plan.id) ?? [];
    let eligibleCount = 0;
    let onTimeCount = 0;
    for (let i = 1; i < records.length; i++) {
      const current = records[i];
      if (current.done_date < rangeFrom || current.done_date > rangeTo) continue;
      const priorDueDate = addDaysIso(records[i - 1].done_date, plan.frequency_days);
      eligibleCount += 1;
      if (current.done_date <= priorDueDate) onTimeCount += 1;
    }
    return {
      planId: plan.id,
      pmName: plan.pm_name,
      machineCode: machineCodeById.get(plan.machine_id) ?? "-",
      eligibleCount,
      onTimeRate: eligibleCount === 0 ? null : (onTimeCount / eligibleCount) * 100,
    };
  });
}

function onTimeRateColor(rate: number | null): string {
  if (rate === null) return TICK_GRAY;
  if (rate >= 80) return STATUS_GOOD;
  if (rate >= 50) return STATUS_WARNING;
  return STATUS_CRITICAL;
}

// ===== Small presentational pieces =====

function StatTile({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-primary/10 bg-white p-3 shadow-sm print:break-inside-avoid print:rounded-none print:border-black print:shadow-none sm:p-4">
      <p className="text-xs text-primary/60 print:text-black">{label}</p>
      <p className="mt-1 text-lg font-bold text-primary print:text-black sm:text-xl">
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[11px] leading-tight text-primary/50 print:text-black">
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

function OnTimeBadge({ rate }: { rate: number | null }) {
  if (rate === null) {
    return (
      <span className="report-badge inline-flex w-fit items-center whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
        -
      </span>
    );
  }
  const color = onTimeRateColor(rate);
  return (
    <span
      className="report-badge inline-flex w-fit items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{ borderColor: color, color }}
    >
      {rate.toFixed(0)}%
    </span>
  );
}

function ChartEmptyState() {
  return (
    <p className="mt-4 py-8 text-center text-sm text-primary/60 print:text-black">
      ไม่มีข้อมูลในช่วงเวลาที่เลือก
    </p>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-4 animate-pulse space-y-4 print:hidden">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 rounded-lg bg-primary/10" />
        ))}
      </div>
      <div className="h-72 rounded-lg bg-primary/10" />
      <div className="h-72 rounded-lg bg-primary/10" />
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 print:hidden">
      <pre className="whitespace-pre-wrap break-all font-mono text-xs">
        {message}
      </pre>
    </div>
  );
}

const inputClassName =
  "mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

const CHART_CONTAINER_HEIGHT = 280;

type RangePreset = "month" | "3m" | "6m" | "custom";

const PRESET_LABEL: Record<RangePreset, string> = {
  month: "เดือนนี้",
  "3m": "3 เดือน",
  "6m": "6 เดือน",
  custom: "กำหนดเอง",
};

export default function ReportsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [preset, setPreset] = useState<RangePreset>("3m");
  const [rangeFrom, setRangeFrom] = useState(() => monthsAgoIsoDate(3));
  const [rangeTo, setRangeTo] = useState(() => todayIsoDate());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await loadReportsData(rangeFrom, rangeTo);
      if (!cancelled) setState(result);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [rangeFrom, rangeTo]);

  function applyPreset(newPreset: RangePreset) {
    setPreset(newPreset);
    if (newPreset === "month") {
      setRangeFrom(startOfThisMonthIso());
      setRangeTo(todayIsoDate());
    } else if (newPreset === "3m") {
      setRangeFrom(monthsAgoIsoDate(3));
      setRangeTo(todayIsoDate());
    } else if (newPreset === "6m") {
      setRangeFrom(monthsAgoIsoDate(6));
      setRangeTo(todayIsoDate());
    }
    // "custom" leaves rangeFrom/rangeTo untouched and reveals the two date
    // inputs below instead.
  }

  const months = useMemo(
    () => enumerateMonths(rangeFrom, rangeTo),
    [rangeFrom, rangeTo]
  );

  const machineCodeById = useMemo(() => {
    if (state.status !== "loaded") return new Map<string, string>();
    return new Map(state.data.machines.map((m) => [m.id, m.machine_code]));
  }, [state]);

  const pmRecordsInRange = useMemo(() => {
    if (state.status !== "loaded") return [];
    return state.data.pmRecordsAll.filter(
      (r) => r.done_date >= rangeFrom && r.done_date <= rangeTo
    );
  }, [state, rangeFrom, rangeTo]);

  const top5BreakdownMachines = useMemo(() => {
    if (state.status !== "loaded") return [];
    const counts = new Map<string, number>();
    for (const b of state.data.breakdowns) {
      counts.set(b.machine_id, (counts.get(b.machine_id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([machineId, count]) => ({
        machine_code: machineCodeById.get(machineId) ?? "-",
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [state, machineCodeById]);

  const monthlyDowntime = useMemo(() => {
    if (state.status !== "loaded") return [];
    const minutesByMonth = new Map<string, number>();
    for (const b of state.data.breakdowns) {
      const key = monthKeyFromIsoDate(b.reported_at);
      minutesByMonth.set(
        key,
        (minutesByMonth.get(key) ?? 0) + (b.downtime_minutes ?? 0)
      );
    }
    return months.map((month) => ({
      month,
      label: formatMonthLabel(month),
      hours: Math.round(((minutesByMonth.get(month) ?? 0) / 60) * 10) / 10,
    }));
  }, [state, months]);

  const partReasonCounts = useMemo(() => {
    if (state.status !== "loaded") return { planned: 0, breakdown: 0 };
    let planned = 0;
    let breakdown = 0;
    for (const r of state.data.replacements) {
      if (r.reason === "planned") planned += 1;
      else if (r.reason === "breakdown") breakdown += 1;
    }
    return { planned, breakdown };
  }, [state]);

  const onTimeStats = useMemo(() => {
    if (state.status !== "loaded") return [];
    return computeOnTimeStats(
      state.data.pmPlans,
      machineCodeById,
      state.data.pmRecordsAll,
      rangeFrom,
      rangeTo
    );
  }, [state, machineCodeById, rangeFrom, rangeTo]);

  const top5CostMachines = useMemo(() => {
    if (state.status !== "loaded") return [];
    const costByMachine = new Map<string, number>();
    for (const b of state.data.breakdowns) {
      costByMachine.set(
        b.machine_id,
        (costByMachine.get(b.machine_id) ?? 0) + coerceNumber(b.repair_cost)
      );
    }
    for (const r of pmRecordsInRange) {
      costByMachine.set(
        r.machine_id,
        (costByMachine.get(r.machine_id) ?? 0) + coerceNumber(r.pm_cost)
      );
    }
    for (const r of state.data.replacements) {
      costByMachine.set(
        r.machine_id,
        (costByMachine.get(r.machine_id) ?? 0) + coerceNumber(r.total_cost)
      );
    }
    return Array.from(costByMachine.entries())
      .map(([machineId, cost]) => ({
        machine_code: machineCodeById.get(machineId) ?? "-",
        cost,
      }))
      .filter((row) => row.cost > 0)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);
  }, [state, machineCodeById, pmRecordsInRange]);

  const monthlyCostStacked = useMemo(() => {
    if (state.status !== "loaded") return [];
    const byMonth = new Map<
      string,
      { repair: number; pm: number; parts: number }
    >();
    for (const month of months) byMonth.set(month, { repair: 0, pm: 0, parts: 0 });
    for (const b of state.data.breakdowns) {
      const bucket = byMonth.get(monthKeyFromIsoDate(b.reported_at));
      if (bucket) bucket.repair += coerceNumber(b.repair_cost);
    }
    for (const r of pmRecordsInRange) {
      const bucket = byMonth.get(monthKeyFromIsoDate(r.done_date));
      if (bucket) bucket.pm += coerceNumber(r.pm_cost);
    }
    for (const r of state.data.replacements) {
      const bucket = byMonth.get(monthKeyFromIsoDate(r.replaced_at));
      if (bucket) bucket.parts += coerceNumber(r.total_cost);
    }
    return months.map((month) => ({
      month,
      label: formatMonthLabel(month),
      ...(byMonth.get(month) ?? { repair: 0, pm: 0, parts: 0 }),
    }));
  }, [state, months, pmRecordsInRange]);

  const summary = useMemo(() => {
    if (state.status !== "loaded") return null;
    const { breakdowns, replacements } = state.data;
    const cost = computeMaintenanceCost(breakdowns, pmRecordsInRange, replacements);

    const totalDowntimeMinutes = breakdowns.reduce(
      (sum, b) => sum + (b.downtime_minutes ?? 0),
      0
    );

    const closedBreakdowns = breakdowns.filter((b) => b.status === "closed");
    const mttrHours =
      closedBreakdowns.length === 0
        ? null
        : closedBreakdowns.reduce(
            (sum, b) => sum + (b.downtime_minutes ?? 0),
            0
          ) /
          closedBreakdowns.length /
          60;

    return {
      breakdownCount: breakdowns.length,
      totalDowntimeMinutes,
      mttrHours,
      cost,
    };
  }, [state, pmRecordsInRange]);

  const hasAnyCostData =
    state.status === "loaded" &&
    (state.data.breakdowns.length > 0 ||
      pmRecordsInRange.length > 0 ||
      state.data.replacements.length > 0);

  const pieData = [
    { name: "ตามรอบ", value: partReasonCounts.planned, color: STATUS_GOOD },
    { name: "เครื่องเสีย", value: partReasonCounts.breakdown, color: STATUS_CRITICAL },
  ];

  return (
    <div id="printable-report" className="p-4 print:p-0">
      <PrintReportStyles />
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style jsx global>{`
        @media print {
          .report-chart-card {
            break-inside: avoid;
          }
          .report-chart-container {
            width: 700px !important;
            height: 260px !important;
          }
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold">รายงาน</h1>
      </div>

      {state.status === "loading" && <LoadingSkeleton />}
      {state.status === "error" && <ErrorBox message={state.message} />}

      {state.status === "loaded" && summary && (
        <>
          {/* Screen-only controls */}
          <div className="mt-4 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:hidden">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PRESET_LABEL) as RangePreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={`flex min-h-[40px] items-center justify-center rounded-md border px-3 text-sm font-medium ${
                    preset === p
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-primary/20 text-primary hover:bg-primary/5"
                  }`}
                >
                  {PRESET_LABEL[p]}
                </button>
              ))}
            </div>

            {preset === "custom" && (
              <div className="mt-3 flex flex-wrap gap-3">
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
              </div>
            )}

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
              รายงานสรุปภาพรวม — {formatDateThai(rangeFrom)} -{" "}
              {formatDateThai(rangeTo)} — พิมพ์วันที่ {formatDateThai(todayIsoDate())}
            </h1>
          </div>

          {/* Summary tiles */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="จำนวนครั้งที่เสียทั้งหมด"
              value={`${summary.breakdownCount} ครั้ง`}
            />
            <StatTile
              label="Downtime รวม"
              value={formatHoursDecimal(summary.totalDowntimeMinutes)}
            />
            <StatTile
              label="MTTR เฉลี่ย"
              value={formatHoursDecimalOrDash(summary.mttrHours)}
              hint="เวลาเฉลี่ยต่อการซ่อม 1 ครั้ง (เฉพาะงานที่ปิดแล้ว)"
            />
            <StatTile
              label="ต้นทุนบำรุงรักษารวม"
              value={formatMoneyThai(summary.cost.totalMaintenanceCost)}
            >
              <div className="mt-2 space-y-0.5 text-[11px] text-primary/60 print:text-black">
                <div className="flex justify-between gap-2">
                  <span>ค่าซ่อม</span>
                  <span>{formatMoneyThai(summary.cost.totalRepairCost)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>ค่า PM</span>
                  <span>{formatMoneyThai(summary.cost.totalPmCost)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>ค่าอะไหล่</span>
                  <span>{formatMoneyThai(summary.cost.totalPartsCost)}</span>
                </div>
              </div>
            </StatTile>
          </div>

          {/* Chart 1: Top 5 breakdown machines */}
          <section className="report-chart-card mt-6 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:mt-4 print:rounded-none print:border-black print:shadow-none">
            <h2 className="text-lg font-bold text-primary print:text-black">
              Top 5 เครื่องที่เสียบ่อยที่สุด
            </h2>
            {top5BreakdownMachines.length === 0 ? (
              <ChartEmptyState />
            ) : (
              <div
                className="report-chart-container mt-4"
                style={{ width: "100%", height: CHART_CONTAINER_HEIGHT }}
              >
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  initialDimension={{ width: 680, height: CHART_CONTAINER_HEIGHT }}
                >
                  <BarChart
                    data={top5BreakdownMachines}
                    margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke={GRIDLINE_GRAY} />
                    <XAxis
                      dataKey="machine_code"
                      tick={{ fill: LABEL_GRAY, fontSize: 12 }}
                      axisLine={{ stroke: AXIS_GRAY }}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: TICK_GRAY, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={36}
                    />
                    <Tooltip
                      formatter={(value: number) => [`${value} ครั้ง`, "จำนวนครั้งที่เสีย"]}
                    />
                    <Bar
                      dataKey="count"
                      fill={ACCENT_BLUE}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Chart 2: Monthly downtime */}
          <section className="report-chart-card mt-6 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:mt-4 print:rounded-none print:border-black print:shadow-none">
            <h2 className="text-lg font-bold text-primary print:text-black">
              Downtime รายเดือน (ชม.)
            </h2>
            {state.data.breakdowns.length === 0 ? (
              <ChartEmptyState />
            ) : (
              <div
                className="report-chart-container mt-4"
                style={{ width: "100%", height: CHART_CONTAINER_HEIGHT }}
              >
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  initialDimension={{ width: 680, height: CHART_CONTAINER_HEIGHT }}
                >
                  <BarChart
                    data={monthlyDowntime}
                    margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke={GRIDLINE_GRAY} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: LABEL_GRAY, fontSize: 12 }}
                      axisLine={{ stroke: AXIS_GRAY }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: TICK_GRAY, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip formatter={(value: number) => [`${value.toFixed(1)} ชม.`, "Downtime"]} />
                    <Bar
                      dataKey="hours"
                      fill={ACCENT_BLUE}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Chart 3: Part replacement reason pie */}
          <section className="report-chart-card mt-6 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:mt-4 print:rounded-none print:border-black print:shadow-none">
            <h2 className="text-lg font-bold text-primary print:text-black">
              การเปลี่ยนอะไหล่: ตามรอบ vs เครื่องเสีย
            </h2>
            {state.data.replacements.length === 0 ? (
              <ChartEmptyState />
            ) : (
              <>
                <div
                  className="report-chart-container mt-4"
                  style={{ width: "100%", height: CHART_CONTAINER_HEIGHT }}
                >
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    initialDimension={{ width: 680, height: CHART_CONTAINER_HEIGHT }}
                  >
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        isAnimationActive={false}
                        label={(entry: { name: string; value: number }) =>
                          `${entry.name} ${entry.value}`
                        }
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string) => [`${value} ครั้ง`, name]}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-3 text-xs text-primary/60 print:text-black">
                  สัดส่วน &quot;เครื่องเสีย&quot; ที่สูง แปลว่ารอบเปลี่ยนอะไหล่อาจตั้งไว้ยาวเกินไป
                </p>
              </>
            )}
          </section>

          {/* Chart 4: PM on-time rate table */}
          <section className="report-chart-card mt-6 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:mt-4 print:rounded-none print:border-black print:shadow-none">
            <h2 className="text-lg font-bold text-primary print:text-black">
              อัตราการทำ PM ตรงเวลา
            </h2>
            {onTimeStats.length === 0 ? (
              <ChartEmptyState />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-primary/10 text-left text-primary/60 print:border-black print:text-black">
                      <th className="py-2 pr-4 font-medium">เครื่อง</th>
                      <th className="py-2 pr-4 font-medium">ชื่องาน PM</th>
                      <th className="py-2 pr-4 font-medium">จำนวนครั้ง</th>
                      <th className="py-2 pr-4 font-medium">ตรงเวลา</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onTimeStats.map((row) => (
                      <tr
                        key={row.planId}
                        className="border-b border-primary/5 print:border-black/30"
                      >
                        <td className="whitespace-nowrap py-2 pr-4 text-primary print:text-black">
                          {row.machineCode}
                        </td>
                        <td className="max-w-xs break-words py-2 pr-4 text-primary print:text-black">
                          {row.pmName}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4 text-primary/70 print:text-black">
                          {row.eligibleCount}
                        </td>
                        <td className="py-2 pr-4">
                          <OnTimeBadge rate={row.onTimeRate} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Chart 5: Top 5 highest-cost machines */}
          <section className="report-chart-card mt-6 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:mt-4 print:rounded-none print:border-black print:shadow-none">
            <h2 className="text-lg font-bold text-primary print:text-black">
              Top 5 เครื่องที่มีต้นทุนบำรุงรักษาสูงสุด
            </h2>
            {top5CostMachines.length === 0 ? (
              <ChartEmptyState />
            ) : (
              <div
                className="report-chart-container mt-4"
                style={{ width: "100%", height: CHART_CONTAINER_HEIGHT }}
              >
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  initialDimension={{ width: 680, height: CHART_CONTAINER_HEIGHT }}
                >
                  <BarChart
                    data={top5CostMachines}
                    margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke={GRIDLINE_GRAY} />
                    <XAxis
                      dataKey="machine_code"
                      tick={{ fill: LABEL_GRAY, fontSize: 12 }}
                      axisLine={{ stroke: AXIS_GRAY }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: TICK_GRAY, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={90}
                      tickFormatter={(v: number) => `${v.toLocaleString("en-US")} บาท`}
                    />
                    <Tooltip formatter={(value: number) => [formatMoneyThai(value), "ต้นทุนรวม"]} />
                    <Bar
                      dataKey="cost"
                      fill={ACCENT_BLUE}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Chart 6: Monthly stacked maintenance cost */}
          <section className="report-chart-card mt-6 rounded-lg border border-primary/10 bg-white p-4 shadow-sm print:mt-4 print:rounded-none print:border-black print:shadow-none">
            <h2 className="text-lg font-bold text-primary print:text-black">
              ต้นทุนบำรุงรักษารายเดือน
            </h2>
            {!hasAnyCostData ? (
              <ChartEmptyState />
            ) : (
              <div
                className="report-chart-container mt-4"
                style={{ width: "100%", height: CHART_CONTAINER_HEIGHT }}
              >
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  initialDimension={{ width: 680, height: CHART_CONTAINER_HEIGHT }}
                >
                  <BarChart
                    data={monthlyCostStacked}
                    margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke={GRIDLINE_GRAY} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: LABEL_GRAY, fontSize: 12 }}
                      axisLine={{ stroke: AXIS_GRAY }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: TICK_GRAY, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={90}
                      tickFormatter={(v: number) => `${v.toLocaleString("en-US")} บาท`}
                    />
                    <Tooltip formatter={(value: number, name: string) => [formatMoneyThai(value), name]} />
                    <Legend />
                    <Bar
                      dataKey="repair"
                      stackId="cost"
                      fill={CATEGORICAL_SLOT_1}
                      name="ค่าซ่อม"
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="pm"
                      stackId="cost"
                      fill={CATEGORICAL_SLOT_2}
                      name="ค่า PM"
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="parts"
                      stackId="cost"
                      fill={CATEGORICAL_SLOT_3}
                      name="ค่าอะไหล่"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
