"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { computeDueDisplay, formatDateThai } from "@/lib/pmDueDate";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Recency window for surfacing a machine's breakdowns in the "ผูกกับใบแจ้งเสีย"
// picker. Deliberately a separate constant from lib/machineStatus.ts's
// DUE_SOON_DAYS even though both happen to be 7 today -- one is a due-date
// proximity threshold, this is a breakdown-recency window, and they must be
// free to change independently.
const RECENT_CLOSED_DAYS = 7;

type MachineRelation = { id: string; machine_code: string; machine_name: string };

type PartSummary = {
  id: string;
  part_code: string;
  part_name: string;
  default_lifespan_days: number;
  unit_cost: number | string;
  stock_qty: number;
};

type LinkRow = {
  id: string;
  machine_id: string;
  lifespan_override_days: number | null;
  last_replaced_at: string | null;
  next_due_date: string | null;
  machines: MachineRelation | null;
};

// Same defensive pattern used throughout the app: without generated
// Database types, postgrest-js infers every embedded relation as an array
// regardless of actual FK cardinality, even though a to-one FK
// (machine_parts.machine_id -> machines.id) returns a plain object at
// runtime.
type RawLinkRow = Omit<LinkRow, "machines"> & {
  machines: MachineRelation | MachineRelation[] | null;
};

function normalizeMachineRelation(
  machines: RawLinkRow["machines"]
): MachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

type BreakdownOption = {
  id: string;
  reported_at: string;
  symptom: string;
  status: string;
  closed_at: string | null;
};

function coerceNumber(value: number | string): number {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return Number.isFinite(num) ? num : 0;
}

function formatMoneyThai(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const safeNum = Number.isFinite(num) ? num : 0;
  return `${safeNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

function todayIsoDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// reported_at/closed_at are timestamptz, not a plain "YYYY-MM-DD" date, so
// this can't reuse lib/pmDueDate.ts's formatDateThai (which splits on "-").
function formatDateThaiFromTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function truncateSymptom(symptom: string, maxLength = 40): string {
  const trimmed = symptom.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

async function fetchBreakdownOptions(machineId: string): Promise<BreakdownOption[]> {
  const { data, error } = await supabase
    .from("breakdowns")
    .select("id, reported_at, symptom, status, closed_at")
    .eq("machine_id", machineId)
    .order("reported_at", { ascending: false });

  if (error || !data) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENT_CLOSED_DAYS);

  return (data as BreakdownOption[]).filter((breakdown) => {
    if (breakdown.status !== "closed") return true;
    if (!breakdown.closed_at) return true;
    return new Date(breakdown.closed_at) >= cutoff;
  });
}

const inputClassName =
  "mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

// Reuses the shared due-date colour/label logic from lib/pmDueDate.ts
// (MMS-014) for every non-null case. Only the NULL case gets a
// replacement-specific label ("ยังไม่เคยเปลี่ยน" instead of the
// PM-flavoured "รอทำครั้งแรก"), matching the convention already
// established in app/parts/[id]/page.tsx (MMS-015).
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

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "no-machine-linked"; part: PartSummary }
  | { status: "picking-machine"; part: PartSummary; options: LinkRow[] }
  | {
      status: "loaded";
      part: PartSummary;
      link: LinkRow;
      siblingCount: number;
      breakdownOptions: BreakdownOption[];
    };

type SubmitResult = {
  nextDueDate: string | null;
  stockQty: number | null;
  totalCost: number;
};

function PageHeading() {
  return <h1 className="text-2xl font-bold">บันทึกการเปลี่ยนอะไหล่</h1>;
}

function LoadingSkeleton() {
  return (
    <div className="mt-4 max-w-lg animate-pulse space-y-4">
      <div className="h-8 w-48 rounded-md bg-primary/10" />
      <div className="h-32 rounded-lg bg-primary/10" />
      <div className="h-40 rounded-lg bg-primary/10" />
    </div>
  );
}

function PartReplacePageInner() {
  const searchParams = useSearchParams();

  const [state, setState] = useState<LoadState>({ status: "loading" });

  const [replacedAt, setReplacedAt] = useState(todayIsoDate());
  const [replacedBy, setReplacedBy] = useState("");
  const [qtyUsed, setQtyUsed] = useState<number | "">(1);
  const [unitCost, setUnitCost] = useState<number | "">(0);
  const [reason, setReason] = useState<"" | "planned" | "breakdown">("");
  const [breakdownId, setBreakdownId] = useState("");
  const [notes, setNotes] = useState("");

  const [replacedAtError, setReplacedAtError] = useState<string | null>(null);
  const [replacedByError, setReplacedByError] = useState<string | null>(null);
  const [qtyUsedError, setQtyUsedError] = useState<string | null>(null);
  const [unitCostError, setUnitCostError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    function resetFormFields(prefillUnitCost: number) {
      setReplacedAt(todayIsoDate());
      setReplacedBy("");
      setQtyUsed(1);
      setUnitCost(prefillUnitCost);
      setReason("");
      setBreakdownId("");
      setNotes("");
    }

    async function load() {
      const partIdParam = searchParams.get("part");
      const machineIdParam = searchParams.get("machine");

      if (!partIdParam || !UUID_REGEX.test(partIdParam)) {
        setState({ status: "not-found" });
        return;
      }

      const partRes = await supabase
        .from("spare_parts")
        .select("id, part_code, part_name, default_lifespan_days, unit_cost, stock_qty")
        .eq("id", partIdParam)
        .maybeSingle();

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
      const part = partRes.data as PartSummary;

      const linksRes = await supabase
        .from("machine_parts")
        .select(
          "id, machine_id, lifespan_override_days, last_replaced_at, next_due_date, machines(id, machine_code, machine_name)"
        )
        .eq("part_id", partIdParam);

      if (cancelled) return;

      if (linksRes.error) {
        setState({ status: "error", message: linksRes.error.message });
        return;
      }

      const links = ((linksRes.data ?? []) as RawLinkRow[]).map((row) => ({
        ...row,
        machines: normalizeMachineRelation(row.machines),
      }));

      let targetLink: LinkRow | undefined;

      if (machineIdParam) {
        if (!UUID_REGEX.test(machineIdParam)) {
          setState({ status: "not-found" });
          return;
        }
        targetLink = links.find((link) => link.machine_id === machineIdParam);
        if (!targetLink) {
          setState({ status: "not-found" });
          return;
        }
      } else if (links.length === 0) {
        setState({ status: "no-machine-linked", part });
        return;
      } else if (links.length === 1) {
        targetLink = links[0];
      } else {
        setState({ status: "picking-machine", part, options: links });
        return;
      }

      const breakdownOptions = await fetchBreakdownOptions(targetLink.machine_id);
      if (cancelled) return;

      resetFormFields(coerceNumber(part.unit_cost));
      setState({
        status: "loaded",
        part,
        link: targetLink,
        siblingCount: links.length,
        breakdownOptions,
      });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  async function handlePickMachine(link: LinkRow) {
    if (state.status !== "picking-machine") return;
    const part = state.part;
    const siblingCount = state.options.length;

    const breakdownOptions = await fetchBreakdownOptions(link.machine_id);

    setReplacedAt(todayIsoDate());
    setReplacedBy("");
    setQtyUsed(1);
    setUnitCost(coerceNumber(part.unit_cost));
    setReason("");
    setBreakdownId("");
    setNotes("");

    setState({ status: "loaded", part, link, siblingCount, breakdownOptions });
  }

  function handleReasonSelect(value: "planned" | "breakdown") {
    setReason(value);
    if (value === "planned") {
      setBreakdownId("");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "loaded") return;

    let hasError = false;

    if (replacedAt.trim() === "") {
      setReplacedAtError("กรุณาระบุวันที่เปลี่ยน");
      hasError = true;
    } else {
      setReplacedAtError(null);
    }

    const trimmedReplacedBy = replacedBy.trim();
    if (trimmedReplacedBy === "") {
      setReplacedByError("กรุณาระบุผู้เปลี่ยน");
      hasError = true;
    } else {
      setReplacedByError(null);
    }

    const qtyUsedNum = qtyUsed === "" ? NaN : Number(qtyUsed);
    if (!Number.isFinite(qtyUsedNum) || qtyUsedNum < 1) {
      setQtyUsedError("กรุณาระบุจำนวนที่ใช้อย่างน้อย 1 ชิ้น");
      hasError = true;
    } else {
      setQtyUsedError(null);
    }

    const unitCostNum = unitCost === "" ? NaN : Number(unitCost);
    if (!Number.isFinite(unitCostNum) || unitCostNum < 0) {
      setUnitCostError("ราคาต่อหน่วยต้องไม่ติดลบ");
      hasError = true;
    } else {
      setUnitCostError(null);
    }

    if (reason === "") {
      setReasonError("กรุณาเลือกเหตุผล");
      hasError = true;
    } else {
      setReasonError(null);
    }

    if (hasError) return;

    setSubmitting(true);
    setFormError(null);

    // Insert only -- trg_part_replacements_after_insert (supabase/migrations/
    // 001_init.sql) owns machine_parts.last_replaced_at/next_due_date and
    // decrements spare_parts.stock_qty automatically. total_cost is a
    // GENERATED STORED column computed by Postgres itself; this must never
    // compute or send it. Reading it back from the insert's own response
    // (rather than qty * unit_cost in JS) is what proves the number on the
    // confirmation screen came from the database.
    const { data: insertedRow, error: insertError } = await supabase
      .from("part_replacements")
      .insert({
        part_id: state.part.id,
        machine_id: state.link.machine_id,
        replaced_at: replacedAt,
        replaced_by: trimmedReplacedBy,
        reason,
        qty_used: Math.trunc(qtyUsedNum),
        unit_cost: unitCostNum,
        breakdown_id: reason === "breakdown" && breakdownId !== "" ? breakdownId : null,
        notes: notes.trim() === "" ? null : notes.trim(),
      })
      .select("id, total_cost")
      .single();

    if (insertError || !insertedRow) {
      setFormError(insertError?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
      setSubmitting(false);
      return;
    }

    // Re-query machine_parts and spare_parts -- both are updated by the
    // trigger as a side effect on OTHER tables, so their new values can
    // only be observed with a fresh SELECT issued after the insert has
    // committed. This is the acceptance test that the trigger actually
    // fired.
    const [linkRes, partRes] = await Promise.all([
      supabase
        .from("machine_parts")
        .select("next_due_date")
        .eq("id", state.link.id)
        .maybeSingle(),
      supabase
        .from("spare_parts")
        .select("stock_qty")
        .eq("id", state.part.id)
        .maybeSingle(),
    ]);

    setSubmitResult({
      nextDueDate: linkRes.data?.next_due_date ?? null,
      stockQty: partRes.data?.stock_qty ?? null,
      totalCost: coerceNumber(insertedRow.total_cost),
    });
    setSubmitting(false);
  }

  const qtyUsedNum = qtyUsed === "" ? NaN : Number(qtyUsed);
  const unitCostNum = unitCost === "" ? NaN : Number(unitCost);
  const liveTotal =
    Number.isFinite(qtyUsedNum) && Number.isFinite(unitCostNum)
      ? qtyUsedNum * unitCostNum
      : 0;

  if (state.status === "loading") {
    return (
      <div className="p-4">
        <PageHeading />
        <LoadingSkeleton />
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="p-4">
        <PageHeading />
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">ไม่พบอะไหล่หรือเครื่องจักรที่ต้องการ</p>
          <Link
            href="/parts"
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            ไปหน้าอะไหล่
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="p-4">
        <PageHeading />
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">
            {state.message}
          </pre>
        </div>
      </div>
    );
  }

  if (state.status === "no-machine-linked") {
    return (
      <div className="p-4">
        <PageHeading />
        <div className="mt-4 max-w-lg rounded-lg border border-primary/10 bg-white p-4 shadow-sm">
          <p className="break-words text-lg font-bold text-primary">
            {state.part.part_code}
          </p>
          <p className="break-words text-sm text-primary/70">
            {state.part.part_name}
          </p>
        </div>
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">อะไหล่นี้ยังไม่ได้ผูกกับเครื่องใด</p>
          <Link
            href={`/parts/${state.part.id}/edit`}
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            ไปผูกเครื่องจักร
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "picking-machine") {
    return (
      <div className="p-4">
        <PageHeading />
        <div className="mt-4 max-w-lg">
          <div className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm">
            <p className="break-words text-lg font-bold text-primary">
              {state.part.part_code}
            </p>
            <p className="break-words text-sm text-primary/70">
              {state.part.part_name}
            </p>
          </div>

          <p className="mt-4 text-sm font-semibold text-primary/70">
            เลือกเครื่องจักรที่จะบันทึกการเปลี่ยน
          </p>
          <div className="mt-2 space-y-2">
            {state.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handlePickMachine(option)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-primary/10 bg-white p-4 text-left shadow-sm hover:bg-surface"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium text-primary">
                    {option.machines?.machine_code ?? "-"}
                  </p>
                  <p className="break-words text-sm text-primary/70">
                    {option.machines?.machine_name ?? "(ไม่พบข้อมูลเครื่องจักร)"}
                  </p>
                </div>
                <DueDateBadge nextDueDate={option.next_due_date} />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // state.status === "loaded"
  const { part, link, siblingCount, breakdownOptions } = state;
  const effectiveDays = link.lifespan_override_days ?? part.default_lifespan_days;
  const isOverride = link.lifespan_override_days != null;

  return (
    <div className="p-4">
      <PageHeading />

      {submitResult ? (
        <div className="mt-4 max-w-lg space-y-4">
          <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-center">
            <p className="text-lg font-bold text-green-800">
              ✅ บันทึกการเปลี่ยนอะไหล่แล้ว
            </p>
          </div>

          <div className="rounded-lg border border-primary/10 bg-white p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">
                  กำหนดเปลี่ยนรอบถัดไปของเครื่องนี้
                </dt>
                <dd className="text-right text-primary">
                  {submitResult.nextDueDate
                    ? formatDateThai(submitResult.nextDueDate)
                    : "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">สต๊อกคงเหลือ (ก้อนรวม)</dt>
                <dd className="text-right text-primary">
                  {submitResult.stockQty != null
                    ? `${submitResult.stockQty} ชิ้น`
                    : "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-primary/10 pt-2">
                <dt className="text-primary/60">ค่าอะไหล่ครั้งนี้</dt>
                <dd className="font-bold text-primary">
                  {formatMoneyThai(submitResult.totalCost)}
                </dd>
              </div>
            </dl>

            {!submitResult.nextDueDate && (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                กำหนดเปลี่ยนรอบถัดไปยังไม่ถูกคำนวณ — กรุณาแจ้งผู้ดูแลระบบ
              </p>
            )}
            {siblingCount > 1 && (
              <p className="mt-3 text-xs text-primary/60">
                กำหนดเปลี่ยนของเครื่องอื่นที่ใช้อะไหล่ตัวนี้ไม่เปลี่ยนแปลง
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/parts"
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
            >
              กลับหน้าอะไหล่
            </Link>
            <Link
              href={`/machines/${link.machine_id}`}
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
            >
              ดูเครื่องนี้
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-4 max-w-lg">
          {/* Always-visible, read-only header */}
          <div className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm">
            <p className="break-words text-lg font-bold text-primary">
              {part.part_code}
            </p>
            <p className="break-words text-sm text-primary/70">{part.part_name}</p>

            <Link
              href={`/machines/${link.machine_id}`}
              className="mt-2 inline-block hover:underline"
            >
              <span className="text-sm font-medium text-primary">
                {link.machines?.machine_code ?? "-"}
              </span>
              <span className="text-sm text-primary/70">
                {" "}
                — {link.machines?.machine_name ?? "(ไม่พบข้อมูลเครื่องจักร)"}
              </span>
            </Link>

            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">สต๊อกคงเหลือ (ก้อนรวม)</dt>
                <dd className="text-right text-primary">{part.stock_qty} ชิ้น</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-primary/60">
                  กำหนดเปลี่ยนครั้งถัดไปของเครื่องนี้ (ปัจจุบัน)
                </dt>
                <dd className="text-right">
                  <DueDateBadge nextDueDate={link.next_due_date} />
                </dd>
              </div>
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
            </dl>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="replaced_at" className="block text-sm font-medium">
                วันที่เปลี่ยน*
              </label>
              <input
                id="replaced_at"
                type="date"
                value={replacedAt}
                onChange={(event) => setReplacedAt(event.target.value)}
                className={inputClassName}
              />
              {replacedAtError && (
                <p className="mt-1 text-sm text-red-700">{replacedAtError}</p>
              )}
            </div>

            <div>
              <label htmlFor="replaced_by" className="block text-sm font-medium">
                ผู้เปลี่ยน*
              </label>
              <input
                id="replaced_by"
                type="text"
                value={replacedBy}
                onChange={(event) => setReplacedBy(event.target.value)}
                className={inputClassName}
              />
              {replacedByError && (
                <p className="mt-1 text-sm text-red-700">{replacedByError}</p>
              )}
            </div>

            <div>
              <label htmlFor="qty_used" className="block text-sm font-medium">
                จำนวนที่ใช้*
              </label>
              <input
                id="qty_used"
                type="number"
                min="1"
                step="1"
                value={qtyUsed}
                onChange={(event) =>
                  setQtyUsed(event.target.value === "" ? "" : Number(event.target.value))
                }
                className={inputClassName}
              />
              {qtyUsedError && (
                <p className="mt-1 text-sm text-red-700">{qtyUsedError}</p>
              )}
              {Number.isFinite(qtyUsedNum) && qtyUsedNum > part.stock_qty && (
                <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  จำนวนที่ใช้มากกว่าสต๊อกคงเหลือ — สต๊อกจะติดลบ กรุณาปรับสต๊อกภายหลัง
                </p>
              )}
            </div>

            <div>
              <label htmlFor="unit_cost" className="block text-sm font-medium">
                ราคาต่อหน่วย (บาท)*
              </label>
              <input
                id="unit_cost"
                type="number"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(event) =>
                  setUnitCost(event.target.value === "" ? "" : Number(event.target.value))
                }
                className={inputClassName}
              />
              <p className="mt-1 text-xs text-primary/50">
                ราคาจริง ณ วันที่เปลี่ยน — บันทึกเป็น snapshot
                ราคามาสเตอร์เปลี่ยนภายหลังไม่กระทบประวัตินี้
              </p>
              {unitCostError && (
                <p className="mt-1 text-sm text-red-700">{unitCostError}</p>
              )}
            </div>

            <div className="rounded-md border border-primary/10 bg-surface px-3 py-2 text-sm">
              <span className="text-primary/70">รวม </span>
              <span className="font-bold text-primary">
                {formatMoneyThai(liveTotal)}
              </span>
            </div>

            <div>
              <label className="block text-sm font-medium">เหตุผล*</label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleReasonSelect("planned")}
                  aria-pressed={reason === "planned"}
                  className={`flex min-h-[48px] flex-1 items-center justify-center rounded-md border px-3 text-sm font-medium ${
                    reason === "planned"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-primary/20 text-primary/70 hover:bg-primary/5"
                  }`}
                >
                  ตามรอบ
                </button>
                <button
                  type="button"
                  onClick={() => handleReasonSelect("breakdown")}
                  aria-pressed={reason === "breakdown"}
                  className={`flex min-h-[48px] flex-1 items-center justify-center rounded-md border px-3 text-sm font-medium ${
                    reason === "breakdown"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-primary/20 text-primary/70 hover:bg-primary/5"
                  }`}
                >
                  เครื่องเสีย
                </button>
              </div>
              {reasonError && (
                <p className="mt-1 text-sm text-red-700">{reasonError}</p>
              )}
            </div>

            {reason === "breakdown" && (
              <div>
                <label htmlFor="breakdown_id" className="block text-sm font-medium">
                  ผูกกับใบแจ้งเสีย (ถ้ามี)
                </label>
                <select
                  id="breakdown_id"
                  value={breakdownId}
                  onChange={(event) => setBreakdownId(event.target.value)}
                  className={inputClassName}
                >
                  <option value="">ไม่ผูก</option>
                  {breakdownOptions.map((breakdown) => (
                    <option key={breakdown.id} value={breakdown.id}>
                      {formatDateThaiFromTimestamp(breakdown.reported_at)} —{" "}
                      {truncateSymptom(breakdown.symptom)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="notes" className="block text-sm font-medium">
                หมายเหตุ
              </label>
              <textarea
                id="notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className={inputClassName}
              />
            </div>

            {formError && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex min-h-[48px] w-full items-center justify-center rounded-md bg-accent px-6 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? "กำลังบันทึก..." : "บันทึกการเปลี่ยน"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function PartReplacePage() {
  return (
    <Suspense
      fallback={
        <div className="p-4">
          <PageHeading />
          <LoadingSkeleton />
        </div>
      }
    >
      <PartReplacePageInner />
    </Suspense>
  );
}
