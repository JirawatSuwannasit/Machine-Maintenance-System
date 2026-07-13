"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type MachineRelation = { machine_code: string; machine_name: string };

type BreakdownRow = {
  id: string;
  machine_id: string;
  reported_at: string;
  symptom: string;
  downtime_minutes: number | null;
  status: string;
  machines: MachineRelation | null;
};

// Without generated Database types, postgrest-js infers every embedded
// relation as an array regardless of actual FK cardinality, even though a
// to-one FK (breakdowns.machine_id -> machines.id) returns a plain object
// at runtime. Rather than force a type cast, handle both shapes so a
// broken/missing join never crashes the page either way.
type RawBreakdownRow = Omit<BreakdownRow, "machines"> & {
  machines: MachineRelation | MachineRelation[] | null;
};

function normalizeMachineRelation(
  machines: RawBreakdownRow["machines"]
): MachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

type MachineOption = {
  id: string;
  machine_code: string;
  machine_name: string;
};

type FetchResult =
  | { ok: true; breakdowns: BreakdownRow[]; machines: MachineOption[] }
  | { ok: false; message: string };

// open first, then in_progress, then closed -- unresolved work orders must
// never be buried under closed ones.
const STATUS_RANK: Record<string, number> = {
  open: 0,
  in_progress: 1,
  closed: 2,
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  open: {
    label: "รอรับงาน",
    className: "bg-red-100 text-red-800 border border-red-200",
  },
  in_progress: {
    label: "กำลังซ่อม",
    className: "bg-amber-100 text-amber-800 border border-amber-200",
  },
  closed: {
    label: "ปิดงานแล้ว",
    className: "bg-green-100 text-green-800 border border-green-200",
  },
};

async function fetchBreakdownsData(): Promise<FetchResult> {
  const [breakdownsRes, machinesRes] = await Promise.all([
    supabase
      .from("breakdowns")
      .select(
        "id, machine_id, reported_at, symptom, downtime_minutes, status, machines(machine_code, machine_name)"
      )
      // PostgREST can't order by a custom status-rank expression, only real
      // columns. So the query orders by the easy part (newest first), and
      // the status-priority ordering is done afterward in JS with a STABLE
      // sort -- which preserves this reported_at-desc order within each
      // status group. One query, and the two-step ordering reads clearly.
      .order("reported_at", { ascending: false }),
    supabase
      .from("machines")
      .select("id, machine_code, machine_name")
      .order("machine_code", { ascending: true }),
  ]);

  const firstError = breakdownsRes.error ?? machinesRes.error;
  if (firstError) {
    return { ok: false, message: firstError.message };
  }

  const breakdowns = ((breakdownsRes.data ?? []) as RawBreakdownRow[])
    .map((row) => ({
      ...row,
      machines: normalizeMachineRelation(row.machines),
    }))
    .sort((a, b) => (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99));

  return {
    ok: true,
    breakdowns,
    machines: (machinesRes.data ?? []) as MachineOption[],
  };
}

function formatDateTimeThai(isoString: string): string {
  const date = new Date(isoString);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

// Local calendar date (not the UTC slice of the ISO string) so the
// จากวันที่/ถึงวันที่ filters match what the user sees, not UTC.
function toLocalDateString(isoString: string): string {
  const date = new Date(isoString);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDowntimeThai(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours} ชม. ${remainder} น.` : `${hours} ชม.`;
  }
  return `${minutes} นาที`;
}

function truncateSymptom(symptom: string): string {
  return symptom.length > 80 ? `${symptom.slice(0, 80)}…` : symptom;
}

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_BADGE[status] ?? {
    label: status,
    className: "bg-primary/10 text-primary/70 border border-primary/10",
  };
  return (
    <span
      className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${info.className}`}
    >
      {info.label}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-6 animate-pulse space-y-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-16 rounded-lg bg-primary/10" />
      ))}
    </div>
  );
}

export default function BreakdownsPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breakdowns, setBreakdowns] = useState<BreakdownRow[]>([]);
  const [machineOptions, setMachineOptions] = useState<MachineOption[]>([]);

  const [statusFilter, setStatusFilter] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await fetchBreakdownsData();
      if (cancelled) return;

      if (result.ok) {
        setBreakdowns(result.breakdowns);
        setMachineOptions(result.machines);
        setError(null);
      } else {
        setError(result.message);
      }
      setInitialLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredBreakdowns = useMemo(() => {
    return breakdowns.filter((breakdown) => {
      if (statusFilter && breakdown.status !== statusFilter) return false;
      if (machineFilter && breakdown.machine_id !== machineFilter) return false;
      if (dateFrom || dateTo) {
        const reportedDate = toLocalDateString(breakdown.reported_at);
        if (dateFrom && reportedDate < dateFrom) return false;
        if (dateTo && reportedDate > dateTo) return false;
      }
      return true;
    });
  }, [breakdowns, statusFilter, machineFilter, dateFrom, dateTo]);

  const hasActiveFilter =
    statusFilter !== "" || machineFilter !== "" || dateFrom !== "" || dateTo !== "";

  function handleClearFilters() {
    setStatusFilter("");
    setMachineFilter("");
    setDateFrom("");
    setDateTo("");
  }

  const pendingCount = breakdowns.filter(
    (breakdown) => breakdown.status === "open" || breakdown.status === "in_progress"
  ).length;
  const totalCount = breakdowns.length;

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">แจ้งเสีย</h1>
          {!initialLoading && !error && (
            <p className="mt-1 text-sm text-primary/60">
              งานค้าง {pendingCount} ใบ · ทั้งหมด {totalCount} ใบ
            </p>
          )}
        </div>
        <Link
          href="/breakdowns/new"
          className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
        >
          + แจ้งเสีย
        </Link>
      </div>

      {initialLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">
            {error}
          </pre>
        </div>
      ) : breakdowns.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">ยังไม่มีใบแจ้งเสีย</p>
          <Link
            href="/breakdowns/new"
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            + แจ้งเสีย
          </Link>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <div>
              <label className="block text-xs font-medium text-primary/60">
                สถานะ
              </label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:w-auto"
              >
                <option value="">ทุกสถานะ</option>
                <option value="open">รอรับงาน</option>
                <option value="in_progress">กำลังซ่อม</option>
                <option value="closed">ปิดงานแล้ว</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-primary/60">
                เครื่องจักร
              </label>
              <select
                value={machineFilter}
                onChange={(event) => setMachineFilter(event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:w-auto"
              >
                <option value="">ทุกเครื่อง</option>
                {machineOptions.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.machine_code} — {machine.machine_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-primary/60">
                จากวันที่
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:w-auto"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-primary/60">
                ถึงวันที่
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:w-auto"
              />
            </div>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="flex min-h-[44px] items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>

          {/* Content */}
          {filteredBreakdowns.length === 0 ? (
            <p className="mt-10 text-center text-primary/70">
              ไม่พบใบแจ้งเสียตามเงื่อนไขที่เลือก
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="mt-6 hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-primary/10 text-left text-primary/60">
                      <th className="py-2 pr-4 font-medium">สถานะ</th>
                      <th className="py-2 pr-4 font-medium">เครื่องจักร</th>
                      <th className="py-2 pr-4 font-medium">อาการเสีย</th>
                      <th className="py-2 pr-4 font-medium">วันที่แจ้ง</th>
                      <th className="py-2 pr-4 font-medium">เวลาหยุดเครื่อง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBreakdowns.map((breakdown) => {
                      const machineCode = breakdown.machines?.machine_code ?? "-";
                      const machineName =
                        breakdown.machines?.machine_name ??
                        "(ไม่พบข้อมูลเครื่องจักร)";
                      return (
                        <tr
                          key={breakdown.id}
                          className="border-b border-primary/5 hover:bg-surface"
                        >
                          <td className="p-0">
                            <Link
                              href={`/breakdowns/${breakdown.id}`}
                              className="flex items-center px-2 py-3"
                            >
                              <StatusBadge status={breakdown.status} />
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={`/breakdowns/${breakdown.id}`}
                              className="block px-2 py-3"
                            >
                              <span className="break-words font-bold text-primary">
                                {machineCode}
                              </span>
                              <span className="block break-words text-xs text-primary/60">
                                {machineName}
                              </span>
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={`/breakdowns/${breakdown.id}`}
                              className="block max-w-xs break-words px-2 py-3 text-primary/80"
                            >
                              {truncateSymptom(breakdown.symptom)}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={`/breakdowns/${breakdown.id}`}
                              className="block whitespace-nowrap px-2 py-3 text-primary/70"
                            >
                              {formatDateTimeThai(breakdown.reported_at)}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={`/breakdowns/${breakdown.id}`}
                              className="block whitespace-nowrap px-2 py-3 text-primary/70"
                            >
                              {breakdown.status === "closed" &&
                              breakdown.downtime_minutes != null
                                ? formatDowntimeThai(breakdown.downtime_minutes)
                                : ""}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="mt-6 space-y-3 md:hidden">
                {filteredBreakdowns.map((breakdown) => {
                  const machineCode = breakdown.machines?.machine_code ?? "-";
                  const machineName =
                    breakdown.machines?.machine_name ??
                    "(ไม่พบข้อมูลเครื่องจักร)";
                  return (
                    <Link
                      key={breakdown.id}
                      href={`/breakdowns/${breakdown.id}`}
                      className="block rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={breakdown.status} />
                        <span className="text-xs text-primary/60">
                          {formatDateTimeThai(breakdown.reported_at)}
                        </span>
                      </div>
                      <p className="mt-2 break-words text-base font-bold text-primary">
                        {machineCode}
                      </p>
                      <p className="break-words text-sm text-primary/70">
                        {machineName}
                      </p>
                      <p className="mt-2 break-words text-sm text-primary/80">
                        {truncateSymptom(breakdown.symptom)}
                      </p>
                      {breakdown.status === "closed" &&
                        breakdown.downtime_minutes != null && (
                          <p className="mt-2 text-xs text-primary/60">
                            เวลาหยุดเครื่อง:{" "}
                            {formatDowntimeThai(breakdown.downtime_minutes)}
                          </p>
                        )}
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
