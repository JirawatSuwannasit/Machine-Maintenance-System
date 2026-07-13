"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MachineRelation = { machine_code: string; machine_name: string };

type BreakdownDetail = {
  id: string;
  machine_id: string;
  reported_at: string;
  symptom: string;
  cause: string | null;
  action_taken: string | null;
  downtime_minutes: number | null;
  repair_cost: number | string;
  technician: string | null;
  status: string;
  closed_at: string | null;
  machines: MachineRelation | null;
};

// Same defensive pattern as app/breakdowns/page.tsx: without generated
// Database types, postgrest-js infers every embedded relation as an array
// regardless of actual FK cardinality, even though a to-one FK
// (breakdowns.machine_id -> machines.id) returns a plain object at
// runtime. Handle both shapes so a broken/missing join never crashes.
type RawBreakdownDetail = Omit<BreakdownDetail, "machines"> & {
  machines: MachineRelation | MachineRelation[] | null;
};

function normalizeMachineRelation(
  machines: RawBreakdownDetail["machines"]
): MachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

function normalizeBreakdown(raw: RawBreakdownDetail): BreakdownDetail {
  return { ...raw, machines: normalizeMachineRelation(raw.machines) };
}

const BREAKDOWN_SELECT =
  "id, machine_id, reported_at, symptom, cause, action_taken, downtime_minutes, repair_cost, technician, status, closed_at, machines(machine_code, machine_name)";

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

function formatDateTimeThai(isoString: string): string {
  const date = new Date(isoString);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatDowntimeThai(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours} ชม. ${remainder} น.` : `${hours} ชม.`;
  }
  return `${minutes} นาที`;
}

// Supabase serializes `numeric` columns (repair_cost, total_cost) as JSON
// strings to avoid float precision loss, so always coerce before display.
function formatMoneyThai(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const safeNum = Number.isFinite(num) ? num : 0;
  return `${safeNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

function computeDefaultDowntimeMinutes(reportedAtIso: string): number {
  const reportedAt = new Date(reportedAtIso).getTime();
  const diffMinutes = Math.floor((Date.now() - reportedAt) / 60000);
  return diffMinutes > 0 ? diffMinutes : 0;
}

const inputClassName =
  "mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; breakdown: BreakdownDetail; partsCost: number };

async function fetchPartsCost(breakdownId: string): Promise<number> {
  const { data } = await supabase
    .from("part_replacements")
    .select("total_cost")
    .eq("breakdown_id", breakdownId);
  return (data ?? []).reduce(
    (sum: number, row: { total_cost: number | string }) =>
      sum + (typeof row.total_cost === "string" ? parseFloat(row.total_cost) : row.total_cost),
    0
  );
}

export default function BreakdownDetailPage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // The technician value "as captured at report time" -- frozen once on
  // initial load. The `technician` column itself gets overwritten later
  // (accept-job, then close-out), so this snapshot is the only way to
  // keep showing who originally reported it in the always-visible header.
  const [reporterSnapshot, setReporterSnapshot] = useState<string | null>(
    null
  );

  const [acceptingJob, setAcceptingJob] = useState(false);
  const [acceptTechnician, setAcceptTechnician] = useState("");
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [acceptSubmitting, setAcceptSubmitting] = useState(false);

  const [cause, setCause] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [downtimeMinutes, setDowntimeMinutes] = useState<number | "">(0);
  const [repairCost, setRepairCost] = useState<number | "">(0);
  const [closeTechnician, setCloseTechnician] = useState("");

  const [causeError, setCauseError] = useState<string | null>(null);
  const [actionTakenError, setActionTakenError] = useState<string | null>(
    null
  );
  const [downtimeError, setDowntimeError] = useState<string | null>(null);
  const [closeFormError, setCloseFormError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [showCloseSuccess, setShowCloseSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadBreakdown() {
      if (!UUID_REGEX.test(params.id)) {
        setState({ status: "not-found" });
        return;
      }

      const [breakdownRes, partsCost] = await Promise.all([
        supabase
          .from("breakdowns")
          .select(BREAKDOWN_SELECT)
          .eq("id", params.id)
          .maybeSingle(),
        fetchPartsCost(params.id),
      ]);

      if (cancelled) return;

      if (breakdownRes.error) {
        if (breakdownRes.error.code === "PGRST116") {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: breakdownRes.error.message });
        }
        return;
      }
      if (!breakdownRes.data) {
        setState({ status: "not-found" });
        return;
      }

      const breakdown = normalizeBreakdown(
        breakdownRes.data as unknown as RawBreakdownDetail
      );

      setReporterSnapshot(breakdown.technician);
      setCause(breakdown.cause ?? "");
      setActionTaken(breakdown.action_taken ?? "");
      setDowntimeMinutes(
        breakdown.downtime_minutes ?? computeDefaultDowntimeMinutes(breakdown.reported_at)
      );
      setRepairCost(
        breakdown.repair_cost
          ? typeof breakdown.repair_cost === "string"
            ? parseFloat(breakdown.repair_cost)
            : breakdown.repair_cost
          : 0
      );
      setCloseTechnician(breakdown.technician ?? "");

      setState({ status: "loaded", breakdown, partsCost });
    }

    loadBreakdown();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function handleAcceptConfirm() {
    if (state.status !== "loaded") return;

    const trimmed = acceptTechnician.trim();
    if (trimmed === "") {
      setAcceptError("กรุณากรอกชื่อผู้รับงาน");
      return;
    }
    setAcceptError(null);
    setAcceptSubmitting(true);

    const { data, error } = await supabase
      .from("breakdowns")
      .update({ status: "in_progress", technician: trimmed })
      .eq("id", state.breakdown.id)
      .select(BREAKDOWN_SELECT)
      .maybeSingle();

    if (error || !data) {
      setAcceptError(error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
      setAcceptSubmitting(false);
      return;
    }

    const updated = normalizeBreakdown(data as unknown as RawBreakdownDetail);
    setState({ status: "loaded", breakdown: updated, partsCost: state.partsCost });
    setDowntimeMinutes(computeDefaultDowntimeMinutes(updated.reported_at));
    setCloseTechnician(updated.technician ?? "");
    setAcceptingJob(false);
    setAcceptTechnician("");
    setAcceptSubmitting(false);
  }

  async function handleCloseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "loaded") return;

    const trimmedCause = cause.trim();
    const trimmedActionTaken = actionTaken.trim();

    let hasError = false;
    if (trimmedCause === "") {
      setCauseError("กรุณากรอกสาเหตุ");
      hasError = true;
    } else {
      setCauseError(null);
    }
    if (trimmedActionTaken === "") {
      setActionTakenError("กรุณากรอกวิธีการแก้ไข");
      hasError = true;
    } else {
      setActionTakenError(null);
    }

    const downtimeValue = downtimeMinutes === "" ? NaN : Number(downtimeMinutes);
    if (!Number.isFinite(downtimeValue) || downtimeValue < 0) {
      setDowntimeError("กรุณากรอกเวลาหยุดเครื่องให้ถูกต้อง (ต้องไม่ติดลบ)");
      hasError = true;
    } else {
      setDowntimeError(null);
    }

    const repairCostValue = repairCost === "" ? 0 : Number(repairCost);
    if (!Number.isFinite(repairCostValue) || repairCostValue < 0) {
      setCloseFormError("ค่าซ่อมต้องไม่ติดลบ");
      hasError = true;
    } else {
      setCloseFormError(null);
    }

    if (hasError) return;

    setClosing(true);
    setCloseFormError(null);

    const { data, error } = await supabase
      .from("breakdowns")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        cause: trimmedCause,
        action_taken: trimmedActionTaken,
        downtime_minutes: downtimeValue,
        repair_cost: repairCostValue,
        technician: closeTechnician.trim() === "" ? null : closeTechnician.trim(),
      })
      .eq("id", state.breakdown.id)
      .select(BREAKDOWN_SELECT)
      .maybeSingle();

    if (error || !data) {
      setCloseFormError(error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
      setClosing(false);
      return;
    }

    const updated = normalizeBreakdown(data as unknown as RawBreakdownDetail);
    const partsCost = await fetchPartsCost(state.breakdown.id);

    setState({ status: "loaded", breakdown: updated, partsCost });
    setClosing(false);
    setShowCloseSuccess(true);
  }

  useEffect(() => {
    if (!showCloseSuccess) return;
    const timer = setTimeout(() => setShowCloseSuccess(false), 3000);
    return () => clearTimeout(timer);
  }, [showCloseSuccess]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">รายละเอียดใบแจ้งเสีย</h1>

      {state.status === "loading" && (
        <div className="mt-4 max-w-lg animate-pulse space-y-4">
          <div className="h-8 w-48 rounded-md bg-primary/10" />
          <div className="h-24 rounded-lg bg-primary/10" />
          <div className="h-32 rounded-lg bg-primary/10" />
        </div>
      )}

      {state.status === "not-found" && (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">ไม่พบใบแจ้งเสียนี้</p>
          <Link
            href="/breakdowns"
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            กลับหน้ารายการ
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
        <div className="mt-4 max-w-lg">
          {showCloseSuccess && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
              <span>ปิดงานเรียบร้อยแล้ว</span>
              <button
                type="button"
                onClick={() => setShowCloseSuccess(false)}
                className="text-green-700/70 hover:text-green-900"
                aria-label="ปิด"
              >
                ✕
              </button>
            </div>
          )}

          {/* Always-visible header */}
          <div className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm">
            <Link
              href={`/machines/${state.breakdown.machine_id}`}
              className="inline-block"
            >
              <p className="text-lg font-bold text-primary hover:underline">
                {state.breakdown.machines?.machine_code ?? "-"}
              </p>
              <p className="text-sm text-primary/70 hover:underline">
                {state.breakdown.machines?.machine_name ??
                  "(ไม่พบข้อมูลเครื่องจักร)"}
              </p>
            </Link>

            <div className="mt-3">
              <StatusBadge status={state.breakdown.status} />
            </div>

            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">วันเวลาที่แจ้ง</dt>
                <dd className="text-right text-primary">
                  {formatDateTimeThai(state.breakdown.reported_at)}
                </dd>
              </div>
              <div>
                <dt className="text-primary/60">อาการเสีย</dt>
                <dd className="mt-1 break-words text-primary">
                  {state.breakdown.symptom}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">ผู้แจ้ง</dt>
                <dd className="text-right text-primary">
                  {reporterSnapshot ?? "-"}
                </dd>
              </div>
            </dl>
          </div>

          {/* View A: open -> accept the job */}
          {state.breakdown.status === "open" && (
            <div className="mt-4">
              {!acceptingJob ? (
                <button
                  type="button"
                  onClick={() => setAcceptingJob(true)}
                  className="flex min-h-[48px] w-full items-center justify-center rounded-md bg-accent px-6 text-base font-medium text-white hover:bg-accent/90"
                >
                  รับงาน
                </button>
              ) : (
                <div className="space-y-3 rounded-lg border border-primary/10 bg-white p-4">
                  <div>
                    <label
                      htmlFor="accept_technician"
                      className="block text-sm font-medium"
                    >
                      ชื่อผู้รับงาน*
                    </label>
                    <input
                      id="accept_technician"
                      type="text"
                      autoFocus
                      value={acceptTechnician}
                      onChange={(event) =>
                        setAcceptTechnician(event.target.value)
                      }
                      className={inputClassName}
                    />
                    {acceptError && (
                      <p className="mt-1 text-sm text-red-700">
                        {acceptError}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleAcceptConfirm}
                      disabled={acceptSubmitting}
                      className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {acceptSubmitting ? "กำลังบันทึก..." : "ยืนยัน"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAcceptingJob(false);
                        setAcceptTechnician("");
                        setAcceptError(null);
                      }}
                      className="flex min-h-[44px] items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* View B: in_progress -> close-out form */}
          {state.breakdown.status === "in_progress" && (
            <form
              onSubmit={handleCloseSubmit}
              className="mt-4 space-y-4 rounded-lg border border-primary/10 bg-white p-4"
            >
              <div>
                <label htmlFor="cause" className="block text-sm font-medium">
                  สาเหตุ*
                </label>
                <textarea
                  id="cause"
                  rows={3}
                  value={cause}
                  onChange={(event) => setCause(event.target.value)}
                  className={inputClassName}
                />
                {causeError && (
                  <p className="mt-1 text-sm text-red-700">{causeError}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="action_taken"
                  className="block text-sm font-medium"
                >
                  วิธีการแก้ไข*
                </label>
                <textarea
                  id="action_taken"
                  rows={3}
                  value={actionTaken}
                  onChange={(event) => setActionTaken(event.target.value)}
                  className={inputClassName}
                />
                {actionTakenError && (
                  <p className="mt-1 text-sm text-red-700">
                    {actionTakenError}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="downtime_minutes"
                  className="block text-sm font-medium"
                >
                  เวลาหยุดเครื่อง (นาที)*
                </label>
                <input
                  id="downtime_minutes"
                  type="number"
                  min="0"
                  step="1"
                  value={downtimeMinutes}
                  onChange={(event) =>
                    setDowntimeMinutes(
                      event.target.value === "" ? "" : Number(event.target.value)
                    )
                  }
                  className={inputClassName}
                />
                {downtimeError && (
                  <p className="mt-1 text-sm text-red-700">{downtimeError}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="repair_cost"
                  className="block text-sm font-medium"
                >
                  ค่าซ่อม (บาท)
                </label>
                <input
                  id="repair_cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={repairCost}
                  onChange={(event) =>
                    setRepairCost(
                      event.target.value === "" ? "" : Number(event.target.value)
                    )
                  }
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-primary/50">
                  กรอกเฉพาะค่าแรง/ค่าจ้างซ่อมภายนอก — ค่าอะไหล่จะถูกบันทึกแยกตอนบันทึกการเปลี่ยนอะไหล่
                  เพื่อไม่ให้ต้นทุนถูกนับซ้ำ
                </p>
              </div>

              <div>
                <label
                  htmlFor="close_technician"
                  className="block text-sm font-medium"
                >
                  ผู้ซ่อม
                </label>
                <input
                  id="close_technician"
                  type="text"
                  value={closeTechnician}
                  onChange={(event) => setCloseTechnician(event.target.value)}
                  className={inputClassName}
                />
              </div>

              {closeFormError && (
                <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                  {closeFormError}
                </div>
              )}

              <button
                type="submit"
                disabled={closing}
                className="flex min-h-[48px] w-full items-center justify-center rounded-md bg-accent px-6 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {closing ? "กำลังบันทึก..." : "ปิดงาน"}
              </button>
            </form>
          )}

          {/* View C: closed -> read-only summary */}
          {state.breakdown.status === "closed" && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-primary/10 bg-white p-4">
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-primary/60">สาเหตุ</dt>
                    <dd className="mt-1 break-words text-primary">
                      {state.breakdown.cause ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-primary/60">วิธีการแก้ไข</dt>
                    <dd className="mt-1 break-words text-primary">
                      {state.breakdown.action_taken ?? "-"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-primary/60">เวลาหยุดเครื่อง</dt>
                    <dd className="text-right text-primary">
                      {state.breakdown.downtime_minutes != null
                        ? formatDowntimeThai(state.breakdown.downtime_minutes)
                        : "-"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-primary/60">ผู้ซ่อม</dt>
                    <dd className="text-right text-primary">
                      {state.breakdown.technician ?? "-"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-primary/60">ปิดงานเมื่อ</dt>
                    <dd className="text-right text-primary">
                      {state.breakdown.closed_at
                        ? formatDateTimeThai(state.breakdown.closed_at)
                        : "-"}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg border border-primary/10 bg-surface p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-primary/70">ค่าซ่อม (แรงงาน)</span>
                  <span className="text-right tabular-nums text-primary">
                    {formatMoneyThai(state.breakdown.repair_cost)}
                  </span>
                </div>
                {/* part cost is legitimately 0 until MMS-016 ships the
                    part-replacement form that creates part_replacements rows */}
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-primary/70">ค่าอะไหล่</span>
                  <span className="text-right tabular-nums text-primary">
                    {formatMoneyThai(state.partsCost)}
                  </span>
                </div>
                <div className="mt-2 flex justify-between border-t border-primary/20 pt-2 text-sm font-bold">
                  <span className="text-primary">รวมทั้งสิ้น</span>
                  <span className="text-right tabular-nums text-primary">
                    {formatMoneyThai(
                      (typeof state.breakdown.repair_cost === "string"
                        ? parseFloat(state.breakdown.repair_cost)
                        : state.breakdown.repair_cost) + state.partsCost
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
