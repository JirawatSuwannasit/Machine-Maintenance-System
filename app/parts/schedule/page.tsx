"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatDateThai, computeDueDiffDays } from "@/lib/pmDueDate";

// This page's own procurement/planning horizon -- deliberately LONGER than
// lib/machineStatus.ts's DUE_SOON_DAYS (7), which drives the shop-floor
// "act now" status light. This page groups rows out to 30 days so there is
// enough lead time to actually order parts; the two constants are
// independent and must not be conflated.
const SCHEDULE_HORIZON_DAYS = 30;

type MachineRelation = { id: string; machine_code: string; machine_name: string };
type PartRelation = {
  id: string;
  part_code: string;
  part_name: string;
  stock_qty: number;
  min_stock: number;
};

type ScheduleRow = {
  id: string;
  machine_id: string;
  part_id: string;
  next_due_date: string;
  machines: MachineRelation | null;
  spare_parts: PartRelation | null;
};

// Same defensive pattern used throughout the app: without generated
// Database types, postgrest-js infers every embedded relation as an array
// regardless of actual FK cardinality, even though both FKs here
// (machine_parts.machine_id -> machines.id, machine_parts.part_id ->
// spare_parts.id) are to-one and return plain objects at runtime.
type RawScheduleRow = Omit<ScheduleRow, "machines" | "spare_parts"> & {
  machines: MachineRelation | MachineRelation[] | null;
  spare_parts: PartRelation | PartRelation[] | null;
};

function normalizeMachineRelation(
  machines: RawScheduleRow["machines"]
): MachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

function normalizePartRelation(
  parts: RawScheduleRow["spare_parts"]
): PartRelation | null {
  if (!parts) return null;
  if (Array.isArray(parts)) return parts[0] ?? null;
  return parts;
}

const SCHEDULE_SELECT =
  "id, machine_id, part_id, next_due_date, machines(id, machine_code, machine_name), spare_parts(id, part_code, part_name, stock_qty, min_stock)";

type Bucket = "overdue" | "within30" | "later";

type RowWithDiff = ScheduleRow & { diffDays: number; bucket: Bucket };

function bucketOf(diffDays: number): Bucket {
  if (diffDays < 0) return "overdue";
  if (diffDays <= SCHEDULE_HORIZON_DAYS) return "within30";
  return "later";
}

// Same three-way "เลยกำหนด/ครบกำหนดวันนี้/อีก" wording used elsewhere, but
// deliberately NOT lib/pmDueDate.ts's computeDueDisplay() colour helper --
// that helper's green/yellow split is tied to DUE_SOON_DAYS (7), while this
// page's rows span the full SCHEDULE_HORIZON_DAYS (30).
function formatUrgencyLabel(diffDays: number): string {
  if (diffDays < 0) return `เลยกำหนด ${Math.abs(diffDays)} วัน`;
  if (diffDays === 0) return "ครบกำหนดวันนี้";
  return `อีก ${diffDays} วัน`;
}

type ShortageInfo = { demand: number; stockQty: number };

// A shared stock pool means a part's rows compete with each other for the
// same stock_qty -- so shortage must be judged per PART across its overdue
// + within-horizon rows, never per row in isolation.
function getShortageInfo(
  row: RowWithDiff,
  demandByPart: Map<string, number>
): ShortageInfo | null {
  if (row.bucket === "later") return null;
  const demand = demandByPart.get(row.part_id) ?? 0;
  const stockQty = row.spare_parts?.stock_qty ?? 0;
  if (demand <= stockQty) return null;
  return { demand, stockQty };
}

function LowStockBadge() {
  return (
    <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-orange-200 bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-800">
      สต๊อกต่ำ
    </span>
  );
}

function InsufficientStockBadge() {
  return (
    <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
      สต๊อกไม่พอ
    </span>
  );
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; rows: RowWithDiff[] };

async function fetchSchedule(): Promise<LoadState> {
  const { data, error } = await supabase
    .from("machine_parts")
    .select(SCHEDULE_SELECT)
    .not("next_due_date", "is", null);

  if (error) {
    return { status: "error", message: error.message };
  }

  const today = new Date();
  const rows = ((data ?? []) as RawScheduleRow[])
    .map((row) => ({
      ...row,
      machines: normalizeMachineRelation(row.machines),
      spare_parts: normalizePartRelation(row.spare_parts),
    }))
    .map((row) => {
      // next_due_date can never be null here (filtered above), so this
      // fallback is unreachable -- kept only to satisfy the number|null type.
      const diffDays = computeDueDiffDays(row.next_due_date, today) ?? 0;
      return { ...row, diffDays, bucket: bucketOf(diffDays) };
    });

  return { status: "loaded", rows };
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

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      <pre className="whitespace-pre-wrap break-all font-mono text-xs">
        {message}
      </pre>
    </div>
  );
}

function ScheduleGroupSection({
  icon,
  title,
  rows,
  demandByPart,
}: {
  icon: string;
  title: string;
  rows: RowWithDiff[];
  demandByPart: Map<string, number>;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-primary">
        {icon} {title} ({rows.length})
      </h2>

      {rows.length === 0 ? (
        <p className="mt-4 py-4 text-center text-sm text-primary/60">
          ไม่มีรายการ
        </p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-primary/10 text-left text-primary/60">
                  <th className="py-2 pr-4 font-medium">อะไหล่</th>
                  <th className="py-2 pr-4 font-medium">เครื่องจักร</th>
                  <th className="py-2 pr-4 font-medium">กำหนดเปลี่ยน</th>
                  <th className="py-2 pr-4 font-medium">สต๊อก</th>
                  <th className="py-2 pr-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const shortage = getShortageInfo(row, demandByPart);
                  const lowStock =
                    (row.spare_parts?.stock_qty ?? 0) <
                    (row.spare_parts?.min_stock ?? 0);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-primary/5 align-top hover:bg-surface"
                    >
                      <td className="py-3 pr-4">
                        <Link
                          href={`/parts/${row.spare_parts?.id ?? ""}`}
                          className="block hover:underline"
                        >
                          <span className="break-words font-bold text-primary">
                            {row.spare_parts?.part_code ?? "-"}
                          </span>
                          <span className="block break-words text-xs text-primary/60">
                            {row.spare_parts?.part_name ?? "(ไม่พบข้อมูลอะไหล่)"}
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <Link
                          href={`/machines/${row.machines?.id ?? ""}`}
                          className="block hover:underline"
                        >
                          <span className="break-words font-bold text-primary">
                            {row.machines?.machine_code ?? "-"}
                          </span>
                          <span className="block break-words text-xs text-primary/60">
                            {row.machines?.machine_name ??
                              "(ไม่พบข้อมูลเครื่องจักร)"}
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="whitespace-nowrap text-primary">
                          {formatDateThai(row.next_due_date)}
                        </div>
                        <div className="mt-1 whitespace-nowrap text-xs text-primary/60">
                          {formatUrgencyLabel(row.diffDays)}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-primary">
                            {row.spare_parts?.stock_qty ?? 0} ชิ้น
                          </span>
                          {lowStock && <LowStockBadge />}
                          {shortage && <InsufficientStockBadge />}
                        </div>
                        {shortage && (
                          <p className="mt-1 max-w-[240px] text-xs text-amber-800">
                            อะไหล่ {row.spare_parts?.part_code ?? "-"} ถึงกำหนด{" "}
                            {shortage.demand} เครื่อง แต่สต๊อกเหลือ{" "}
                            {shortage.stockQty} — สั่งซื้อเพิ่ม
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <Link
                          href={`/parts/replace?machine=${row.machine_id}&part=${row.part_id}`}
                          className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
                        >
                          บันทึกเปลี่ยน
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="mt-4 space-y-3 md:hidden">
            {rows.map((row) => {
              const shortage = getShortageInfo(row, demandByPart);
              const lowStock =
                (row.spare_parts?.stock_qty ?? 0) <
                (row.spare_parts?.min_stock ?? 0);
              return (
                <div
                  key={row.id}
                  className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                >
                  <Link
                    href={`/parts/${row.spare_parts?.id ?? ""}`}
                    className="block hover:underline"
                  >
                    <p className="break-words text-base font-bold text-primary">
                      {row.spare_parts?.part_code ?? "-"}
                    </p>
                    <p className="break-words text-sm text-primary/70">
                      {row.spare_parts?.part_name ?? "(ไม่พบข้อมูลอะไหล่)"}
                    </p>
                  </Link>

                  <Link
                    href={`/machines/${row.machines?.id ?? ""}`}
                    className="mt-2 block hover:underline"
                  >
                    <span className="text-sm font-medium text-primary">
                      {row.machines?.machine_code ?? "-"}
                    </span>
                    <span className="text-sm text-primary/70">
                      {" "}
                      — {row.machines?.machine_name ?? "(ไม่พบข้อมูลเครื่องจักร)"}
                    </span>
                  </Link>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-primary/60">
                    <span>
                      กำหนดเปลี่ยน: {formatDateThai(row.next_due_date)} (
                      {formatUrgencyLabel(row.diffDays)})
                    </span>
                    <span className="flex items-center gap-2">
                      สต๊อก: {row.spare_parts?.stock_qty ?? 0} ชิ้น
                      {lowStock && <LowStockBadge />}
                      {shortage && <InsufficientStockBadge />}
                    </span>
                  </div>

                  {shortage && (
                    <p className="mt-1 text-xs text-amber-800">
                      อะไหล่ {row.spare_parts?.part_code ?? "-"} ถึงกำหนด{" "}
                      {shortage.demand} เครื่อง แต่สต๊อกเหลือ {shortage.stockQty} —
                      สั่งซื้อเพิ่ม
                    </p>
                  )}

                  <Link
                    href={`/parts/replace?machine=${row.machine_id}&part=${row.part_id}`}
                    className="mt-3 flex min-h-[44px] items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
                  >
                    บันทึกเปลี่ยน
                  </Link>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export default function PartsSchedulePage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [machineFilter, setMachineFilter] = useState("");
  const [partFilter, setPartFilter] = useState("");
  const [insufficientOnly, setInsufficientOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await fetchSchedule();
      if (!cancelled) setState(result);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () => (state.status === "loaded" ? state.rows : []),
    [state]
  );

  const demandByPart = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.bucket === "later") continue;
      map.set(row.part_id, (map.get(row.part_id) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  const machineOptions = useMemo(() => {
    const map = new Map<string, MachineRelation>();
    for (const row of rows) {
      if (row.machines) map.set(row.machines.id, row.machines);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.machine_code.localeCompare(b.machine_code)
    );
  }, [rows]);

  const partOptions = useMemo(() => {
    const map = new Map<string, PartRelation>();
    for (const row of rows) {
      if (row.spare_parts) map.set(row.spare_parts.id, row.spare_parts);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.part_code.localeCompare(b.part_code)
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (machineFilter && row.machine_id !== machineFilter) return false;
      if (partFilter && row.part_id !== partFilter) return false;
      if (insufficientOnly && !getShortageInfo(row, demandByPart)) return false;
      return true;
    });
  }, [rows, machineFilter, partFilter, insufficientOnly, demandByPart]);

  const overdueRows = filteredRows
    .filter((r) => r.bucket === "overdue")
    .sort((a, b) => a.diffDays - b.diffDays);
  const within30Rows = filteredRows
    .filter((r) => r.bucket === "within30")
    .sort((a, b) => a.diffDays - b.diffDays);
  const laterRows = filteredRows
    .filter((r) => r.bucket === "later")
    .sort((a, b) => a.diffDays - b.diffDays);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">ตารางกำหนดเปลี่ยนอะไหล่</h1>

      {state.status === "loading" ? (
        <LoadingSkeleton />
      ) : state.status === "error" ? (
        <ErrorBox message={state.message} />
      ) : rows.length === 0 ? (
        <p className="mt-10 py-4 text-center text-primary/70">
          ยังไม่มีกำหนดเปลี่ยนอะไหล่ — จะแสดงหลังบันทึกการเปลี่ยนครั้งแรก
        </p>
      ) : (
        <>
          {/* Filters */}
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <div>
              <label className="block text-xs font-medium text-primary/60">
                เครื่องจักร
              </label>
              <select
                value={machineFilter}
                onChange={(event) => setMachineFilter(event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:w-64"
              >
                <option value="">ทั้งหมด</option>
                {machineOptions.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.machine_code} — {machine.machine_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-primary/60">
                อะไหล่
              </label>
              <select
                value={partFilter}
                onChange={(event) => setPartFilter(event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:w-64"
              >
                <option value="">ทั้งหมด</option>
                {partOptions.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.part_code} — {part.part_name}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex min-h-[44px] items-center gap-2 text-sm text-primary">
              <input
                type="checkbox"
                checked={insufficientOnly}
                onChange={(event) => setInsufficientOnly(event.target.checked)}
                className="h-4 w-4 rounded border-primary/30 text-accent focus:ring-accent"
              />
              แสดงเฉพาะที่สต๊อกไม่พอ
            </label>
          </div>

          {filteredRows.length === 0 ? (
            <p className="mt-10 py-4 text-center text-primary/70">
              ไม่พบรายการตามเงื่อนไขที่เลือก
            </p>
          ) : (
            <>
              <ScheduleGroupSection
                icon="🔴"
                title="เลยกำหนดแล้ว"
                rows={overdueRows}
                demandByPart={demandByPart}
              />
              <ScheduleGroupSection
                icon="🟡"
                title={`ภายใน ${SCHEDULE_HORIZON_DAYS} วัน`}
                rows={within30Rows}
                demandByPart={demandByPart}
              />
              <ScheduleGroupSection
                icon="🟢"
                title={`เกิน ${SCHEDULE_HORIZON_DAYS} วัน`}
                rows={laterRows}
                demandByPart={demandByPart}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
