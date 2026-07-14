"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { computeDueDisplay, formatDateThai } from "@/lib/pmDueDate";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SparePartDetail = {
  id: string;
  part_code: string;
  part_name: string;
  default_lifespan_days: number;
  unit_cost: number | string;
  stock_qty: number;
  min_stock: number;
};

type MachineRelation = { id: string; machine_code: string; machine_name: string };

type MachineLinkRow = {
  id: string;
  lifespan_override_days: number | null;
  last_replaced_at: string | null;
  next_due_date: string | null;
  machines: MachineRelation | null;
};

type RawMachineLinkRow = Omit<MachineLinkRow, "machines"> & {
  machines: MachineRelation | MachineRelation[] | null;
};

// Same defensive pattern used throughout the app: without generated
// Database types, postgrest-js infers every embedded relation as an array
// regardless of actual FK cardinality, even though a to-one FK
// (machine_parts.machine_id -> machines.id) returns a plain object at
// runtime.
function normalizeMachineRelation(
  machines: RawMachineLinkRow["machines"]
): MachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

function formatMoneyThai(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const safeNum = Number.isFinite(num) ? num : 0;
  return `${safeNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

// Reuses the shared due-date colour/label logic from lib/pmDueDate.ts
// (MMS-014) for every non-null case, so the red/yellow/green thresholds
// never drift from /pm/plans. Only the NULL case gets a part-specific
// label here ("ยังไม่เคยเปลี่ยน" instead of the PM-flavoured
// "รอทำครั้งแรก"), since a part that has never been replaced isn't quite
// the same concept as a PM plan that has never been done.
function DueDateBadge({ nextDueDate }: { nextDueDate: string | null }) {
  if (!nextDueDate) {
    return (
      <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
        ยังไม่เคยเปลี่ยน
      </span>
    );
  }
  const display = computeDueDisplay(nextDueDate);
  return (
    <span
      className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${display.className}`}
    >
      {display.label}
    </span>
  );
}

function LowStockBadge() {
  return (
    <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border border-orange-200 bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-800">
      สต๊อกต่ำ
    </span>
  );
}

type ReplacementMachineRelation = { id: string; machine_code: string };
type BreakdownRelation = { id: string; reported_at: string };

type ReplacementHistoryEntry = {
  id: string;
  replaced_at: string;
  replaced_by: string | null;
  reason: string | null;
  qty_used: number;
  unit_cost: number | string;
  total_cost: number | string;
  machines: ReplacementMachineRelation | null;
  breakdowns: BreakdownRelation | null;
};

type RawReplacementHistoryEntry = Omit<
  ReplacementHistoryEntry,
  "machines" | "breakdowns"
> & {
  machines: ReplacementMachineRelation | ReplacementMachineRelation[] | null;
  breakdowns: BreakdownRelation | BreakdownRelation[] | null;
};

function normalizeReplacementMachineRelation(
  machines: RawReplacementHistoryEntry["machines"]
): ReplacementMachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

function normalizeBreakdownRelation(
  breakdowns: RawReplacementHistoryEntry["breakdowns"]
): BreakdownRelation | null {
  if (!breakdowns) return null;
  if (Array.isArray(breakdowns)) return breakdowns[0] ?? null;
  return breakdowns;
}

const REPLACEMENT_HISTORY_SELECT =
  "id, replaced_at, replaced_by, reason, qty_used, unit_cost, total_cost, machines(id, machine_code), breakdowns(id, reported_at)";

const REASON_LABEL: Record<string, string> = {
  planned: "ตามรอบ",
  breakdown: "เครื่องเสีย",
};

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      part: SparePartDetail;
      links: MachineLinkRow[];
      replacements: ReplacementHistoryEntry[];
    };

export default function PartDetailPage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!UUID_REGEX.test(params.id)) {
        setState({ status: "not-found" });
        return;
      }

      const [partRes, linksRes, replacementsRes] = await Promise.all([
        supabase
          .from("spare_parts")
          .select(
            "id, part_code, part_name, default_lifespan_days, unit_cost, stock_qty, min_stock"
          )
          .eq("id", params.id)
          .maybeSingle(),
        supabase
          .from("machine_parts")
          .select(
            "id, lifespan_override_days, last_replaced_at, next_due_date, machines(id, machine_code, machine_name)"
          )
          .eq("part_id", params.id),
        supabase
          .from("part_replacements")
          .select(REPLACEMENT_HISTORY_SELECT)
          .eq("part_id", params.id)
          .order("replaced_at", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

      if (cancelled) return;

      if (partRes.error) {
        if (partRes.error.code === "PGRST116") {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: partRes.error.message });
        }
        return;
      }
      if (!partRes.data) {
        setState({ status: "not-found" });
        return;
      }
      if (linksRes.error) {
        setState({ status: "error", message: linksRes.error.message });
        return;
      }
      if (replacementsRes.error) {
        setState({ status: "error", message: replacementsRes.error.message });
        return;
      }

      const links = ((linksRes.data ?? []) as RawMachineLinkRow[])
        .map((row) => ({
          ...row,
          machines: normalizeMachineRelation(row.machines),
        }))
        .sort((a, b) =>
          (a.machines?.machine_code ?? "").localeCompare(
            b.machines?.machine_code ?? ""
          )
        );

      const replacements = (
        (replacementsRes.data ?? []) as RawReplacementHistoryEntry[]
      ).map((row) => ({
        ...row,
        machines: normalizeReplacementMachineRelation(row.machines),
        breakdowns: normalizeBreakdownRelation(row.breakdowns),
      }));

      setState({
        status: "loaded",
        part: partRes.data as SparePartDetail,
        links,
        replacements,
      });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">รายละเอียดอะไหล่</h1>

      {state.status === "loading" && (
        <div className="mt-4 animate-pulse space-y-4">
          <div className="h-40 rounded-lg bg-primary/10" />
          <div className="h-40 rounded-lg bg-primary/10" />
        </div>
      )}

      {state.status === "not-found" && (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">ไม่พบอะไหล่นี้</p>
          <Link
            href="/parts"
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            กลับหน้าอะไหล่
          </Link>
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">
            {state.message}
          </pre>
        </div>
      )}

      {state.status === "loaded" && (
        <>
          {/* Part info card */}
          <div className="mt-4 rounded-lg border border-primary/10 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-xl font-bold text-primary">
                  {state.part.part_code}
                </h2>
                <p className="break-words text-primary/80">
                  {state.part.part_name}
                </p>
              </div>
              <Link
                href={`/parts/${state.part.id}/edit`}
                className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
              >
                <Pencil size={16} aria-hidden="true" />
                <span>แก้ไข</span>
              </Link>
            </div>

            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">อายุใช้งานมาตรฐาน</dt>
                <dd className="text-right text-primary">
                  {state.part.default_lifespan_days} วัน
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">ราคาต่อหน่วย</dt>
                <dd className="text-right text-primary">
                  {formatMoneyThai(state.part.unit_cost)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-primary/60">จำนวนคงเหลือ</dt>
                <dd className="flex items-center gap-2 text-right text-primary">
                  <span>{state.part.stock_qty}</span>
                  {state.part.stock_qty < state.part.min_stock && (
                    <LowStockBadge />
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">จุดสั่งซื้อ</dt>
                <dd className="text-right text-primary">
                  {state.part.min_stock}
                </dd>
              </div>
            </dl>
          </div>

          {/* Machines using this part */}
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-primary">
                เครื่องที่ใช้อะไหล่นี้
              </h2>
              <Link
                href="/parts/schedule"
                className="text-sm font-medium text-accent hover:underline"
              >
                ตารางกำหนดเปลี่ยน
              </Link>
            </div>

            {state.links.length === 0 ? (
              <p className="mt-6 py-4 text-center text-primary/70">
                ยังไม่ผูกกับเครื่องจักรใด
              </p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="mt-4 hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-primary/10 text-left text-primary/60">
                        <th className="py-2 pr-4 font-medium">เครื่องจักร</th>
                        <th className="py-2 pr-4 font-medium">
                          อายุใช้งานที่ใช้จริง
                        </th>
                        <th className="py-2 pr-4 font-medium">เปลี่ยนล่าสุด</th>
                        <th className="py-2 pr-4 font-medium">
                          กำหนดครั้งถัดไป
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.links.map((link) => {
                        const effectiveDays =
                          link.lifespan_override_days ??
                          state.part.default_lifespan_days;
                        const isOverride = link.lifespan_override_days != null;
                        return (
                          <tr
                            key={link.id}
                            className="border-b border-primary/5 hover:bg-surface"
                          >
                            <td className="p-0">
                              <Link
                                href={`/machines/${link.machines?.id ?? ""}`}
                                className="block px-2 py-3"
                              >
                                <span className="break-words font-bold text-primary">
                                  {link.machines?.machine_code ?? "-"}
                                </span>
                                <span className="block break-words text-xs text-primary/60">
                                  {link.machines?.machine_name ??
                                    "(ไม่พบข้อมูลเครื่องจักร)"}
                                </span>
                              </Link>
                            </td>
                            <td className="whitespace-nowrap px-2 py-3 text-primary/70">
                              {effectiveDays} วัน
                              {isOverride && (
                                <span className="ml-1 text-xs text-primary/50">
                                  (เฉพาะเครื่อง)
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-3 text-primary/70">
                              {link.last_replaced_at
                                ? formatDateThai(link.last_replaced_at)
                                : "-"}
                            </td>
                            <td className="px-2 py-3">
                              <DueDateBadge nextDueDate={link.next_due_date} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="mt-4 space-y-3 md:hidden">
                  {state.links.map((link) => {
                    const effectiveDays =
                      link.lifespan_override_days ??
                      state.part.default_lifespan_days;
                    const isOverride = link.lifespan_override_days != null;
                    return (
                      <Link
                        key={link.id}
                        href={`/machines/${link.machines?.id ?? ""}`}
                        className="block rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-words text-base font-bold text-primary">
                              {link.machines?.machine_code ?? "-"}
                            </p>
                            <p className="break-words text-sm text-primary/70">
                              {link.machines?.machine_name ??
                                "(ไม่พบข้อมูลเครื่องจักร)"}
                            </p>
                          </div>
                          <DueDateBadge nextDueDate={link.next_due_date} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary/60">
                          <span>
                            อายุใช้งาน: {effectiveDays} วัน
                            {isOverride && " (เฉพาะเครื่อง)"}
                          </span>
                          <span>
                            เปลี่ยนล่าสุด:{" "}
                            {link.last_replaced_at
                              ? formatDateThai(link.last_replaced_at)
                              : "-"}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Replacement history across all machines */}
          <div className="mt-4">
            <h2 className="text-lg font-bold text-primary">
              ประวัติการเปลี่ยนอะไหล่นี้
            </h2>

            {state.replacements.length === 0 ? (
              <p className="mt-6 py-4 text-center text-primary/70">
                ยังไม่มีประวัติการเปลี่ยน
              </p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="mt-4 hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-primary/10 text-left text-primary/60">
                        <th className="py-2 pr-4 font-medium">วันที่</th>
                        <th className="py-2 pr-4 font-medium">เครื่องจักร</th>
                        <th className="py-2 pr-4 font-medium">ผู้เปลี่ยน</th>
                        <th className="py-2 pr-4 font-medium">เหตุผล</th>
                        <th className="py-2 pr-4 font-medium">จำนวน</th>
                        <th className="py-2 pr-4 font-medium">ราคา/หน่วย</th>
                        <th className="py-2 pr-4 font-medium">รวม</th>
                        <th className="py-2 pr-4 font-medium">ใบแจ้งเสีย</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.replacements.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-primary/5 hover:bg-surface"
                        >
                          <td className="whitespace-nowrap py-3 pr-4 text-primary">
                            {formatDateThai(entry.replaced_at)}
                          </td>
                          <td className="py-3 pr-4">
                            <Link
                              href={`/machines/${entry.machines?.id ?? ""}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {entry.machines?.machine_code ?? "-"}
                            </Link>
                          </td>
                          <td className="py-3 pr-4 text-primary/70">
                            {entry.replaced_by ?? "-"}
                          </td>
                          <td className="py-3 pr-4 text-primary/70">
                            {entry.reason
                              ? REASON_LABEL[entry.reason] ?? entry.reason
                              : "-"}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-4 text-primary/70">
                            {entry.qty_used}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-4 text-primary/70">
                            {formatMoneyThai(entry.unit_cost)}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-4 font-medium text-primary">
                            {formatMoneyThai(entry.total_cost)}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-4">
                            {entry.breakdowns ? (
                              <Link
                                href={`/breakdowns/${entry.breakdowns.id}`}
                                className="font-medium text-accent hover:underline"
                              >
                                {formatDateThai(
                                  entry.breakdowns.reported_at.slice(0, 10)
                                )}
                              </Link>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-primary/20">
                        <td
                          colSpan={6}
                          className="py-3 pr-4 text-right font-bold text-primary"
                        >
                          รวมทั้งหมด
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 font-bold text-primary">
                          {formatMoneyThai(
                            state.replacements.reduce(
                              (sum, entry) =>
                                sum +
                                (typeof entry.total_cost === "string"
                                  ? parseFloat(entry.total_cost)
                                  : entry.total_cost),
                              0
                            )
                          )}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="mt-4 space-y-3 md:hidden">
                  {state.replacements.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-primary">
                            {formatDateThai(entry.replaced_at)}
                          </p>
                          <Link
                            href={`/machines/${entry.machines?.id ?? ""}`}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {entry.machines?.machine_code ?? "-"}
                          </Link>
                        </div>
                        <p className="text-right font-bold text-primary">
                          {formatMoneyThai(entry.total_cost)}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary/60">
                        <span>ผู้เปลี่ยน: {entry.replaced_by ?? "-"}</span>
                        <span>
                          เหตุผล:{" "}
                          {entry.reason
                            ? REASON_LABEL[entry.reason] ?? entry.reason
                            : "-"}
                        </span>
                        <span>จำนวน: {entry.qty_used}</span>
                        <span>ราคา/หน่วย: {formatMoneyThai(entry.unit_cost)}</span>
                        {entry.breakdowns ? (
                          <Link
                            href={`/breakdowns/${entry.breakdowns.id}`}
                            className="font-medium text-accent hover:underline"
                          >
                            ใบแจ้งเสีย:{" "}
                            {formatDateThai(
                              entry.breakdowns.reported_at.slice(0, 10)
                            )}
                          </Link>
                        ) : (
                          <span>ใบแจ้งเสีย: -</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="rounded-lg border border-primary/10 bg-surface p-4 text-right text-sm font-bold text-primary">
                    รวมทั้งหมด:{" "}
                    {formatMoneyThai(
                      state.replacements.reduce(
                        (sum, entry) =>
                          sum +
                          (typeof entry.total_cost === "string"
                            ? parseFloat(entry.total_cost)
                            : entry.total_cost),
                        0
                      )
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
