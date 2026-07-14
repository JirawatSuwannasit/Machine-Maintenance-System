"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type MachineBadge = { machine_code: string };

type RawMachinePartRow = {
  machine_id: string;
  machines: MachineBadge | MachineBadge[] | null;
};

type SparePartRow = {
  id: string;
  part_code: string;
  part_name: string;
  default_lifespan_days: number;
  unit_cost: number | string;
  stock_qty: number;
  min_stock: number;
  machineBadges: string[];
};

type RawSparePartRow = Omit<SparePartRow, "machineBadges"> & {
  machine_parts: RawMachinePartRow[];
};

// Without generated Database types, postgrest-js infers every embedded
// relation as an array regardless of actual FK cardinality. machine_parts
// itself is a genuine one-to-many relation (a part can have many linked
// machines), so no defensive handling is needed there -- but the nested
// `machines` inside each machine_parts row is a to-one FK
// (machine_parts.machine_id -> machines.id) and needs the usual
// array-or-object normalization.
function normalizeMachineBadges(rows: RawMachinePartRow[]): string[] {
  return rows
    .map((row) => {
      const machine = row.machines;
      if (!machine) return null;
      return Array.isArray(machine) ? machine[0]?.machine_code ?? null : machine.machine_code;
    })
    .filter((code): code is string => code !== null);
}

const PART_SELECT =
  "id, part_code, part_name, default_lifespan_days, unit_cost, stock_qty, min_stock, machine_parts(machine_id, machines(machine_code))";

function formatMoneyThai(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const safeNum = Number.isFinite(num) ? num : 0;
  return `${safeNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

type FetchResult =
  | { ok: true; parts: SparePartRow[] }
  | { ok: false; message: string };

async function fetchParts(): Promise<FetchResult> {
  const { data, error } = await supabase
    .from("spare_parts")
    .select(PART_SELECT)
    .order("part_code", { ascending: true });

  if (error) {
    return { ok: false, message: error.message };
  }

  const parts = ((data ?? []) as unknown as RawSparePartRow[]).map((row) => ({
    ...row,
    machineBadges: normalizeMachineBadges(row.machine_parts),
  }));

  return { ok: true, parts };
}

function LowStockBadge() {
  return (
    <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-orange-200 bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-800">
      สต๊อกต่ำ
    </span>
  );
}

function MachineBadges({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
        ยังไม่ผูกเครื่อง
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {codes.map((code, index) => (
        <span
          key={`${code}-${index}`}
          className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-primary/10 bg-surface px-2 py-0.5 text-xs text-primary/70"
        >
          {code}
        </span>
      ))}
    </div>
  );
}

// Maps ?saved=<key> to its toast message, mirroring the pattern in
// app/page.tsx -- kept local here since app/parts/page.tsx is out of scope
// for editing app/page.tsx itself.
const SAVED_TOAST_MESSAGES: Record<string, string> = {
  "1": "บันทึกอะไหล่แล้ว",
};

function SavedToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const savedKey = searchParams.get("saved");
    const text = savedKey ? SAVED_TOAST_MESSAGES[savedKey] : undefined;
    if (text) {
      setMessage(text);
      router.replace("/parts", { scroll: false });
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
    <div className="mt-6 animate-pulse space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-16 rounded-lg bg-primary/10" />
      ))}
    </div>
  );
}

export default function PartsPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parts, setParts] = useState<SparePartRow[]>([]);

  const [searchText, setSearchText] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await fetchParts();
      if (cancelled) return;

      if (result.ok) {
        setParts(result.parts);
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

  const filteredParts = useMemo(() => {
    const normalized = searchText.trim().toLowerCase();
    return parts.filter((part) => {
      if (lowStockOnly && part.stock_qty >= part.min_stock) return false;
      if (normalized) {
        const matchesCode = part.part_code.toLowerCase().includes(normalized);
        const matchesName = part.part_name.toLowerCase().includes(normalized);
        if (!matchesCode && !matchesName) return false;
      }
      return true;
    });
  }, [parts, searchText, lowStockOnly]);

  return (
    <div className="p-4">
      <Suspense fallback={null}>
        <SavedToast />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">อะไหล่</h1>
        <Link
          href="/parts/new"
          className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
        >
          + เพิ่มอะไหล่
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
      ) : parts.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">ยังไม่มีอะไหล่ในระบบ</p>
          <Link
            href="/parts/new"
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            + เพิ่มอะไหล่
          </Link>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <div>
              <label className="block text-xs font-medium text-primary/60">
                ค้นหา
              </label>
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="ค้นหารหัสหรือชื่ออะไหล่"
                className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:w-64"
              />
            </div>

            <label className="flex min-h-[44px] items-center gap-2 text-sm text-primary">
              <input
                type="checkbox"
                checked={lowStockOnly}
                onChange={(event) => setLowStockOnly(event.target.checked)}
                className="h-4 w-4 rounded border-primary/30 text-accent focus:ring-accent"
              />
              แสดงเฉพาะสต๊อกต่ำ
            </label>
          </div>

          {/* Content */}
          {filteredParts.length === 0 ? (
            <p className="mt-10 text-center text-primary/70">
              ไม่พบอะไหล่ตามเงื่อนไขที่เลือก
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="mt-6 hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-primary/10 text-left text-primary/60">
                      <th className="py-2 pr-4 font-medium">รหัสอะไหล่</th>
                      <th className="py-2 pr-4 font-medium">ชื่ออะไหล่</th>
                      <th className="py-2 pr-4 font-medium">อายุใช้งาน</th>
                      <th className="py-2 pr-4 font-medium">ราคา/หน่วย</th>
                      <th className="py-2 pr-4 font-medium">สต๊อก</th>
                      <th className="py-2 pr-4 font-medium">ใช้กับ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParts.map((part) => {
                      const isLowStock = part.stock_qty < part.min_stock;
                      return (
                        <tr
                          key={part.id}
                          className="border-b border-primary/5 hover:bg-surface"
                        >
                          <td className="p-0">
                            <Link
                              href={`/parts/${part.id}`}
                              className="block whitespace-nowrap px-2 py-3 font-bold text-primary"
                            >
                              {part.part_code}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={`/parts/${part.id}`}
                              className="block max-w-xs break-words px-2 py-3 text-primary/80"
                            >
                              {part.part_name}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={`/parts/${part.id}`}
                              className="block whitespace-nowrap px-2 py-3 text-primary/70"
                            >
                              {part.default_lifespan_days} วัน
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={`/parts/${part.id}`}
                              className="block whitespace-nowrap px-2 py-3 text-primary/70"
                            >
                              {formatMoneyThai(part.unit_cost)}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={`/parts/${part.id}`}
                              className="flex items-center gap-2 px-2 py-3"
                            >
                              <span className="text-primary">{part.stock_qty}</span>
                              {isLowStock && <LowStockBadge />}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={`/parts/${part.id}`}
                              className="block px-2 py-3"
                            >
                              <MachineBadges codes={part.machineBadges} />
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
                {filteredParts.map((part) => {
                  const isLowStock = part.stock_qty < part.min_stock;
                  return (
                    <Link
                      key={part.id}
                      href={`/parts/${part.id}`}
                      className="block rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words text-base font-bold text-primary">
                            {part.part_code}
                          </p>
                          <p className="break-words text-sm text-primary/70">
                            {part.part_name}
                          </p>
                        </div>
                        {isLowStock && <LowStockBadge />}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary/60">
                        <span>อายุใช้งาน: {part.default_lifespan_days} วัน</span>
                        <span>ราคา: {formatMoneyThai(part.unit_cost)}</span>
                        <span>สต๊อก: {part.stock_qty}</span>
                      </div>

                      <div className="mt-2">
                        <MachineBadges codes={part.machineBadges} />
                      </div>
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
