"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  computeMachineStatus,
  MACHINE_STATUS_COLORS,
  MACHINE_STATUS_LABELS,
  MACHINE_STATUS_ORDER,
  type MachineStatus,
} from "@/lib/machineStatus";

const REFRESH_INTERVAL_MS = 60000;

type MachineRow = {
  id: string;
  machine_code: string;
  machine_name: string;
  category: string | null;
  location: string | null;
  status: string;
};

type BreakdownRow = { machine_id: string };
type DueDateRow = { machine_id: string; next_due_date: string };

type DashboardData = {
  machines: MachineRow[];
  breakdownMachineIds: Set<string>;
  dueDatesByMachine: Map<string, string[]>;
};

type FetchResult =
  | ({ ok: true } & DashboardData)
  | { ok: false; message: string };

async function fetchDashboardData(): Promise<FetchResult> {
  const [machinesRes, breakdownsRes, pmPlansRes, machinePartsRes] =
    await Promise.all([
      supabase
        .from("machines")
        .select("id, machine_code, machine_name, category, location, status")
        .order("machine_code", { ascending: true }),
      supabase
        .from("breakdowns")
        .select("machine_id")
        .in("status", ["open", "in_progress"]),
      supabase
        .from("pm_plans")
        .select("machine_id, next_due_date")
        .eq("is_active", true)
        .not("next_due_date", "is", null),
      supabase
        .from("machine_parts")
        .select("machine_id, next_due_date")
        .not("next_due_date", "is", null),
    ]);

  const firstError =
    machinesRes.error ??
    breakdownsRes.error ??
    pmPlansRes.error ??
    machinePartsRes.error;

  if (firstError) {
    return { ok: false, message: firstError.message };
  }

  const breakdownMachineIds = new Set<string>(
    (breakdownsRes.data as BreakdownRow[]).map((row) => row.machine_id)
  );

  const dueDatesByMachine = new Map<string, string[]>();
  const addDueDate = (machineId: string, dueDate: string) => {
    const existing = dueDatesByMachine.get(machineId);
    if (existing) {
      existing.push(dueDate);
    } else {
      dueDatesByMachine.set(machineId, [dueDate]);
    }
  };
  (pmPlansRes.data as DueDateRow[]).forEach((row) =>
    addDueDate(row.machine_id, row.next_due_date)
  );
  (machinePartsRes.data as DueDateRow[]).forEach((row) =>
    addDueDate(row.machine_id, row.next_due_date)
  );

  return {
    ok: true,
    machines: (machinesRes.data ?? []) as MachineRow[],
    breakdownMachineIds,
    dueDatesByMachine,
  };
}

// Maps ?saved=<key> to its toast message. "1" is the original MachineForm
// save flow (kept for backwards compatibility); "breakdown" is used by
// app/breakdowns/new/page.tsx.
const SAVED_TOAST_MESSAGES: Record<string, string> = {
  "1": "บันทึกเครื่องจักรแล้ว",
  breakdown: "บันทึกใบแจ้งเสียแล้ว",
};

// Reads ?saved=<key>, shows a green toast with the matching message, then
// strips the query param so a refresh doesn't re-trigger it.
// useSearchParams() requires a Suspense boundary in the App Router, so
// this is a separate component rather than inline in Home().
function SavedToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const savedKey = searchParams.get("saved");
    const text = savedKey ? SAVED_TOAST_MESSAGES[savedKey] : undefined;
    if (text) {
      setMessage(text);
      router.replace("/", { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  return (
    <div className="fixed inset-x-4 top-16 z-[60] mx-auto max-w-sm rounded-md bg-green-600 px-4 py-3 text-center text-sm text-white shadow-lg md:left-1/2 md:right-auto md:top-4 md:-translate-x-1/2">
      <div className="flex items-center justify-between gap-3">
        <span>{message}</span>
        <button
          type="button"
          onClick={() => setMessage(null)}
          className="text-white/80 hover:text-white"
          aria-label="ปิด"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-4 animate-pulse space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 rounded-lg bg-primary/10" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-32 rounded-lg bg-primary/10" />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [breakdownMachineIds, setBreakdownMachineIds] = useState<Set<string>>(
    new Set()
  );
  const [dueDatesByMachine, setDueDatesByMachine] = useState<
    Map<string, string[]>
  >(new Map());

  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<MachineStatus | null>(
    null
  );

  const loadData = useCallback(async (isInitial: boolean) => {
    const result = await fetchDashboardData();
    if (result.ok) {
      setMachines(result.machines);
      setBreakdownMachineIds(result.breakdownMachineIds);
      setDueDatesByMachine(result.dueDatesByMachine);
      setError(null);
    } else {
      setError(result.message);
    }
    if (isInitial) {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => {
      loadData(false);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadData]);

  const machinesWithStatus = useMemo(() => {
    return machines.map((machine) => ({
      ...machine,
      computedStatus: computeMachineStatus(
        machine.status,
        breakdownMachineIds.has(machine.id),
        dueDatesByMachine.get(machine.id) ?? []
      ),
    }));
  }, [machines, breakdownMachineIds, dueDatesByMachine]);

  const summary = useMemo(() => {
    let red = 0;
    let yellow = 0;
    let green = 0;
    for (const machine of machinesWithStatus) {
      if (machine.computedStatus === "red") red += 1;
      else if (machine.computedStatus === "yellow") yellow += 1;
      else if (machine.computedStatus === "green") green += 1;
    }
    return { total: machinesWithStatus.length, red, yellow, green };
  }, [machinesWithStatus]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const machine of machinesWithStatus) {
      if (machine.category) set.add(machine.category);
    }
    return Array.from(set).sort();
  }, [machinesWithStatus]);

  const filteredMachines = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return machinesWithStatus.filter((machine) => {
      if (statusFilter && machine.computedStatus !== statusFilter) {
        return false;
      }
      if (categoryFilter && machine.category !== categoryFilter) {
        return false;
      }
      if (normalizedSearch) {
        const matchesCode = machine.machine_code
          .toLowerCase()
          .includes(normalizedSearch);
        const matchesName = machine.machine_name
          .toLowerCase()
          .includes(normalizedSearch);
        if (!matchesCode && !matchesName) {
          return false;
        }
      }
      return true;
    });
  }, [machinesWithStatus, statusFilter, categoryFilter, searchText]);

  function handleStatCardClick(target: MachineStatus | null) {
    setStatusFilter((prev) => (prev === target ? null : target));
  }

  const statCards: Array<{
    key: MachineStatus | "all";
    label: string;
    count: number;
    color: string;
  }> = [
    { key: "all", label: "ทั้งหมด", count: summary.total, color: "#0B1F3A" },
    {
      key: "red",
      label: "เสียอยู่",
      count: summary.red,
      color: MACHINE_STATUS_COLORS.red,
    },
    {
      key: "yellow",
      label: "เลยกำหนด",
      count: summary.yellow,
      color: MACHINE_STATUS_COLORS.yellow,
    },
    {
      key: "green",
      label: "ปกติ",
      count: summary.green,
      color: MACHINE_STATUS_COLORS.green,
    },
  ];

  return (
    <div className="p-4">
      <Suspense fallback={null}>
        <SavedToast />
      </Suspense>

      <h1 className="text-2xl font-bold">ภาพรวมเครื่องจักร</h1>

      {initialLoading ? (
        <LoadingSkeleton />
      ) : error && machines.length === 0 ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">
            {error}
          </pre>
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {statCards.map((card) => {
              const isActive =
                card.key === "all"
                  ? statusFilter === null
                  : statusFilter === card.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() =>
                    handleStatCardClick(
                      card.key === "all" ? null : card.key
                    )
                  }
                  className={`min-h-[44px] rounded-lg border bg-white p-3 text-left shadow-sm transition-colors ${
                    isActive
                      ? "border-accent ring-1 ring-accent"
                      : "border-primary/10 hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: card.color }}
                      aria-hidden="true"
                    />
                    <span className="text-xs text-primary/70">
                      {card.label}
                    </span>
                  </div>
                  <p className="mt-1 text-2xl font-bold text-primary">
                    {card.count}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Search + filters + add button */}
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="ค้นหารหัสหรือชื่อเครื่องจักร"
                className="min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent sm:max-w-xs"
              />
              <select
                value={categoryFilter ?? ""}
                onChange={(event) =>
                  setCategoryFilter(event.target.value || null)
                }
                className="min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">ทุกประเภท</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter ?? ""}
                onChange={(event) =>
                  setStatusFilter(
                    (event.target.value || null) as MachineStatus | null
                  )
                }
                className="min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">ทุกสถานะ</option>
                {MACHINE_STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {MACHINE_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            <Link
              href="/machines/new"
              className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
            >
              + เพิ่มเครื่องจักร
            </Link>
          </div>

          {/* Content area */}
          {machines.length === 0 ? (
            <div className="mt-10 flex flex-col items-center gap-4 text-center">
              <p className="text-primary/70">ยังไม่มีเครื่องจักรในระบบ</p>
              <Link
                href="/machines/new"
                className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
              >
                + เพิ่มเครื่องจักร
              </Link>
            </div>
          ) : filteredMachines.length === 0 ? (
            <p className="mt-10 text-center text-primary/70">
              ไม่พบเครื่องจักรที่ค้นหา
            </p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {filteredMachines.map((machine) => (
                <Link
                  key={machine.id}
                  href={`/machines/${machine.id}`}
                  className="flex flex-col gap-2 rounded-lg border border-primary/10 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          MACHINE_STATUS_COLORS[machine.computedStatus],
                      }}
                      aria-hidden="true"
                    />
                    <span className="text-xs font-medium text-primary/70">
                      {MACHINE_STATUS_LABELS[machine.computedStatus]}
                    </span>
                  </div>
                  <p className="text-lg font-bold text-primary">
                    {machine.machine_code}
                  </p>
                  <p className="text-sm text-primary/80">
                    {machine.machine_name}
                  </p>
                  {machine.category && (
                    <span className="w-fit rounded-full border border-primary/10 bg-surface px-2 py-0.5 text-xs text-primary/70">
                      {machine.category}
                    </span>
                  )}
                  {machine.location && (
                    <p className="text-xs text-primary/60">
                      {machine.location}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
