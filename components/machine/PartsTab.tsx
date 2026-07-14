"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { computeDueDisplay, formatDateThai, parseIsoDateAsLocalDay } from "@/lib/pmDueDate";

type PartsTabProps = {
  machineId: string;
};

type SparePartRelation = {
  id: string;
  part_code: string;
  part_name: string;
  default_lifespan_days: number;
  stock_qty: number;
  min_stock: number;
};

type PartLinkRow = {
  id: string;
  part_id: string;
  lifespan_override_days: number | null;
  last_replaced_at: string | null;
  next_due_date: string | null;
  spare_parts: SparePartRelation | null;
};

// Same defensive pattern used throughout the app: without generated
// Database types, postgrest-js infers every embedded relation as an array
// regardless of actual FK cardinality, even though a to-one FK
// (machine_parts.part_id -> spare_parts.id) returns a plain object at
// runtime.
type RawPartLinkRow = Omit<PartLinkRow, "spare_parts"> & {
  spare_parts: SparePartRelation | SparePartRelation[] | null;
};

function normalizeSparePartRelation(
  parts: RawPartLinkRow["spare_parts"]
): SparePartRelation | null {
  if (!parts) return null;
  if (Array.isArray(parts)) return parts[0] ?? null;
  return parts;
}

const LINKS_SELECT =
  "id, part_id, lifespan_override_days, last_replaced_at, next_due_date, spare_parts(id, part_code, part_name, default_lifespan_days, stock_qty, min_stock)";

type ReplacementRow = {
  id: string;
  part_id: string;
  replaced_at: string;
  replaced_by: string | null;
  reason: string | null;
  qty_used: number;
  total_cost: number | string;
};

const REASON_LABEL: Record<string, string> = {
  planned: "ตามรอบ",
  breakdown: "เครื่องเสีย",
};

function formatMoneyThai(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const safeNum = Number.isFinite(num) ? num : 0;
  return `${safeNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

// Reuses the shared due-date colour/label logic from lib/pmDueDate.ts
// (MMS-014) for every non-null case. Only the NULL case gets a
// replacement-specific label ("ยังไม่เคยเปลี่ยน"), matching the convention
// already established in app/parts/[id]/page.tsx (MMS-015).
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

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      <pre className="whitespace-pre-wrap break-all font-mono text-xs">
        {message}
      </pre>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-32 rounded-lg bg-primary/10" />
      ))}
    </div>
  );
}

type LinksResult =
  | { ok: true; links: PartLinkRow[]; historyByPart: Map<string, ReplacementRow[]> }
  | { ok: false; message: string };

async function fetchLinksAndHistory(machineId: string): Promise<LinksResult> {
  const [linksRes, historyRes] = await Promise.all([
    supabase.from("machine_parts").select(LINKS_SELECT).eq("machine_id", machineId),
    supabase
      .from("part_replacements")
      .select("id, part_id, replaced_at, replaced_by, reason, qty_used, total_cost")
      .eq("machine_id", machineId)
      .order("replaced_at", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (linksRes.error) return { ok: false, message: linksRes.error.message };
  if (historyRes.error) return { ok: false, message: historyRes.error.message };

  const links = ((linksRes.data ?? []) as RawPartLinkRow[]).map((row) => ({
    ...row,
    spare_parts: normalizeSparePartRelation(row.spare_parts),
  }));

  const historyByPart = new Map<string, ReplacementRow[]>();
  for (const row of (historyRes.data ?? []) as ReplacementRow[]) {
    const list = historyByPart.get(row.part_id) ?? [];
    list.push(row);
    historyByPart.set(row.part_id, list);
  }

  return { ok: true, links, historyByPart };
}

type TabState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      links: PartLinkRow[];
      historyByPart: Map<string, ReplacementRow[]>;
    };

type SparePartOption = { id: string; part_code: string; part_name: string };

type PickerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; options: SparePartOption[] };

export default function PartsTab({ machineId }: PartsTabProps) {
  const [state, setState] = useState<TabState>({ status: "loading" });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [showPicker, setShowPicker] = useState(false);
  const [pickerState, setPickerState] = useState<PickerState>({ status: "idle" });
  const [pickerSearch, setPickerSearch] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await fetchLinksAndHistory(machineId);
      if (cancelled) return;
      setState(
        result.ok
          ? { status: "loaded", links: result.links, historyByPart: result.historyByPart }
          : { status: "error", message: result.message }
      );
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [machineId]);

  const sortedLinks = useMemo(() => {
    if (state.status !== "loaded") return [];
    // Overdue first, then soonest due, then never-replaced -- a single
    // ascending sort on next_due_date (nulls pushed to +Infinity) produces
    // exactly that order, since overdue dates are chronologically earliest.
    return [...state.links].sort((a, b) => {
      const aTime = a.next_due_date
        ? parseIsoDateAsLocalDay(a.next_due_date).getTime()
        : Infinity;
      const bTime = b.next_due_date
        ? parseIsoDateAsLocalDay(b.next_due_date).getTime()
        : Infinity;
      return aTime - bTime;
    });
  }, [state]);

  const linkedPartIds = useMemo(
    () => new Set(state.status === "loaded" ? state.links.map((l) => l.part_id) : []),
    [state]
  );

  const filteredPickerOptions = useMemo(() => {
    if (pickerState.status !== "loaded") return [];
    const normalized = pickerSearch.trim().toLowerCase();
    return pickerState.options
      .filter((option) => !linkedPartIds.has(option.id))
      .filter(
        (option) =>
          normalized === "" ||
          option.part_code.toLowerCase().includes(normalized) ||
          option.part_name.toLowerCase().includes(normalized)
      );
  }, [pickerState, pickerSearch, linkedPartIds]);

  function toggleExpanded(partId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) {
        next.delete(partId);
      } else {
        next.add(partId);
      }
      return next;
    });
  }

  async function handleTogglePicker() {
    setShowPicker((prev) => !prev);
    setLinkError(null);

    if (pickerState.status === "idle") {
      setPickerState({ status: "loading" });
      const { data, error } = await supabase
        .from("spare_parts")
        .select("id, part_code, part_name")
        .order("part_code", { ascending: true });

      if (error) {
        setPickerState({ status: "error", message: error.message });
      } else {
        setPickerState({ status: "loaded", options: (data ?? []) as SparePartOption[] });
      }
    }
  }

  async function handleLinkExisting(option: SparePartOption) {
    const confirmed = window.confirm(
      `ผูกอะไหล่ ${option.part_code} — ${option.part_name} กับเครื่องนี้หรือไม่?`
    );
    if (!confirmed) return;

    setLinking(true);
    setLinkError(null);

    // last_replaced_at/next_due_date are left unset (NULL by default) --
    // they are owned by trg_part_replacements_after_insert and only get
    // filled in once a part_replacements row is inserted for this
    // machine-part pair (via /parts/replace).
    const { error } = await supabase.from("machine_parts").insert({
      machine_id: machineId,
      part_id: option.id,
      lifespan_override_days: null,
    });

    if (error) {
      setLinkError(error.message);
      setLinking(false);
      return;
    }

    const result = await fetchLinksAndHistory(machineId);
    if (result.ok) {
      setState({ status: "loaded", links: result.links, historyByPart: result.historyByPart });
      setShowPicker(false);
      setPickerSearch("");
    } else {
      setLinkError(result.message);
    }
    setLinking(false);
  }

  const topButtons = (
    <div className="flex flex-wrap gap-3">
      <Link
        href={`/parts/new?machine=${machineId}`}
        className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
      >
        + ผูกอะไหล่กับเครื่องนี้
      </Link>
      <button
        type="button"
        onClick={handleTogglePicker}
        className="flex min-h-[44px] items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
      >
        เลือกจากทะเบียนอะไหล่
      </button>
    </div>
  );

  const picker = showPicker && (
    <div className="mt-3 rounded-lg border border-primary/10 bg-white p-4 shadow-sm">
      <label className="block text-sm font-medium">ค้นหาอะไหล่ที่มีอยู่แล้ว</label>
      <input
        type="text"
        value={pickerSearch}
        onChange={(event) => setPickerSearch(event.target.value)}
        placeholder="พิมพ์รหัสหรือชื่ออะไหล่"
        className="mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />

      {pickerState.status === "loading" && (
        <div className="mt-2 h-24 animate-pulse rounded-md bg-primary/10" />
      )}
      {pickerState.status === "error" && (
        <div className="mt-2">
          <ErrorBox message={pickerState.message} />
        </div>
      )}
      {pickerState.status === "loaded" && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-primary/10">
          {filteredPickerOptions.length === 0 ? (
            <p className="p-3 text-sm text-primary/60">
              ไม่พบอะไหล่ในทะเบียนที่ยังไม่ได้ผูกกับเครื่องนี้
            </p>
          ) : (
            filteredPickerOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={linking}
                onClick={() => handleLinkExisting(option)}
                className="flex min-h-[44px] w-full items-center border-b border-primary/5 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="font-medium text-primary">{option.part_code}</span>
                <span className="ml-2 text-primary/70">— {option.part_name}</span>
              </button>
            ))
          )}
        </div>
      )}
      {linkError && <p className="mt-2 text-sm text-red-700">{linkError}</p>}
    </div>
  );

  if (state.status === "loading") {
    return (
      <div>
        {topButtons}
        <div className="mt-4">
          <LoadingSkeleton />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        {topButtons}
        <div className="mt-4">
          <ErrorBox message={state.message} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {topButtons}
      {picker}

      {sortedLinks.length === 0 ? (
        <p className="mt-8 py-4 text-center text-sm text-primary/60">
          เครื่องนี้ยังไม่มีอะไหล่ที่ผูกไว้
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {sortedLinks.map((link) => {
            const part = link.spare_parts;
            const effectiveDays = link.lifespan_override_days ?? part?.default_lifespan_days ?? 0;
            const isOverride = link.lifespan_override_days != null;
            const isLowStock = (part?.stock_qty ?? 0) < (part?.min_stock ?? 0);
            const isExpanded = expandedIds.has(link.part_id);
            const history = state.historyByPart.get(link.part_id) ?? [];

            return (
              <div
                key={link.id}
                className="rounded-lg border border-primary/10 bg-white shadow-sm"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/parts/${part?.id ?? ""}`} className="min-w-0 hover:underline">
                      <p className="break-words text-base font-bold text-primary">
                        {part?.part_code ?? "-"}
                      </p>
                      <p className="break-words text-sm text-primary/70">
                        {part?.part_name ?? "(ไม่พบข้อมูลอะไหล่)"}
                      </p>
                    </Link>
                    <DueDateBadge nextDueDate={link.next_due_date} />
                  </div>

                  <dl className="mt-3 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-primary/60">อายุใช้งานที่ใช้จริง</dt>
                      <dd className="text-right text-primary">
                        {effectiveDays} วัน
                        {isOverride && (
                          <span className="ml-1 text-xs text-primary/50">
                            (เฉพาะเครื่อง)
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-primary/60">เปลี่ยนล่าสุด</dt>
                      <dd className="text-right text-primary">
                        {link.last_replaced_at ? formatDateThai(link.last_replaced_at) : "-"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-primary/60">สต๊อกคงเหลือ</dt>
                      <dd className="flex items-center gap-2 text-right text-primary">
                        <span>{part?.stock_qty ?? 0} ชิ้น</span>
                        {isLowStock && <LowStockBadge />}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={`/parts/replace?machine=${machineId}&part=${link.part_id}`}
                      className="flex min-h-[40px] flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 sm:flex-none"
                    >
                      บันทึกเปลี่ยน
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(link.part_id)}
                      className="flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5 sm:flex-none"
                    >
                      ประวัติการเปลี่ยนของเครื่องนี้
                      <ChevronDown
                        size={16}
                        aria-hidden="true"
                        className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-primary/10 p-4">
                    {history.length === 0 ? (
                      <p className="py-2 text-center text-sm text-primary/60">
                        ยังไม่มีประวัติการเปลี่ยน
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {history.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-md border border-primary/10 bg-surface p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-primary">
                                {formatDateThai(entry.replaced_at)}
                              </span>
                              <span className="text-primary/70">
                                {entry.reason ? REASON_LABEL[entry.reason] ?? entry.reason : "-"}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary/60">
                              <span>ผู้เปลี่ยน: {entry.replaced_by ?? "-"}</span>
                              <span>จำนวน: {entry.qty_used}</span>
                              <span>รวม: {formatMoneyThai(entry.total_cost)}</span>
                            </div>
                          </div>
                        ))}
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
