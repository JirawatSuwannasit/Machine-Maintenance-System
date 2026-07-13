"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type BreakdownHistoryTabProps = {
  machineId: string;
};

type BreakdownHistoryEntry = {
  id: string;
  reported_at: string;
  symptom: string;
  cause: string | null;
  downtime_minutes: number | null;
  repair_cost: number | string;
  status: string;
};

type FetchResult =
  | { ok: true; entries: BreakdownHistoryEntry[] }
  | { ok: false; message: string };

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

function formatDateThai(isoString: string): string {
  const date = new Date(isoString);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatDowntimeThai(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours} ชม. ${remainder} น.` : `${hours} ชม.`;
  }
  return `${minutes} นาที`;
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

async function fetchBreakdownHistory(machineId: string): Promise<FetchResult> {
  const { data, error } = await supabase
    .from("breakdowns")
    .select("id, reported_at, symptom, cause, downtime_minutes, repair_cost, status")
    .eq("machine_id", machineId)
    .order("reported_at", { ascending: false });

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, entries: (data ?? []) as BreakdownHistoryEntry[] };
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-24 rounded-lg bg-primary/10" />
      ))}
    </div>
  );
}

export default function BreakdownHistoryTab({
  machineId,
}: BreakdownHistoryTabProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<BreakdownHistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await fetchBreakdownHistory(machineId);
      if (cancelled) return;

      if (result.ok) {
        setEntries(result.entries);
        setError(null);
      } else {
        setError(result.message);
      }
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [machineId]);

  return (
    <div>
      <Link
        href={`/breakdowns/new?machine=${machineId}`}
        className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 sm:w-fit"
      >
        + แจ้งเสียเครื่องนี้
      </Link>

      <div className="mt-4">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs">
              {error}
            </pre>
          </div>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-primary/60">
            ยังไม่มีประวัติการเสีย
          </p>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <Link
                key={entry.id}
                href={`/breakdowns/${entry.id}`}
                className="block rounded-lg border border-primary/10 bg-white p-4 shadow-sm hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={entry.status} />
                  <span className="text-xs text-primary/60">
                    {formatDateThai(entry.reported_at)}
                  </span>
                </div>
                <p className="mt-2 break-words text-sm text-primary">
                  {entry.symptom}
                </p>
                {entry.cause && (
                  <p className="mt-1 break-words text-xs text-primary/60">
                    สาเหตุ: {entry.cause}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary/60">
                  {entry.status === "closed" && entry.downtime_minutes != null && (
                    <span>
                      เวลาหยุดเครื่อง: {formatDowntimeThai(entry.downtime_minutes)}
                    </span>
                  )}
                  {entry.status === "closed" && (
                    <span>ค่าซ่อม: {formatMoneyThai(entry.repair_cost)}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
