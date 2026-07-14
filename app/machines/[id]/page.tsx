"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Pencil, Printer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  computeMachineStatus,
  MACHINE_STATUS_COLORS,
  MACHINE_STATUS_LABELS,
  type MachineStatus,
} from "@/lib/machineStatus";
import type { MachineRecord } from "@/components/machine/MachineForm";
import BreakdownHistoryTab from "@/components/machine/BreakdownHistoryTab";
import PmHistoryTab from "@/components/machine/PmHistoryTab";
import PartsTab from "@/components/machine/PartsTab";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MACHINE_OWN_STATUS_LABELS: Record<string, string> = {
  active: "ใช้งาน",
  inactive: "ไม่ใช้งาน",
  scrapped: "ปลดระวาง",
};

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; machine: MachineRecord; computedStatus: MachineStatus };

type TabKey = "breakdowns" | "pm" | "parts";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "breakdowns", label: "ประวัติเสีย" },
  { key: "pm", label: "ประวัติ PM" },
  { key: "parts", label: "อะไหล่" },
];

function displayValue(value: string | null | undefined): string {
  return value && value.trim() !== "" ? value : "-";
}

// Formats a "YYYY-MM-DD" date string as DD/MM/YYYY without going through
// Date/UTC parsing, which can shift the day depending on timezone.
function formatDateThai(isoDate: string | null | undefined): string {
  if (!isoDate) return "-";
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return "-";
  return `${day}/${month}/${year}`;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-primary/60">{label}</span>
      <span className="text-right text-primary">{value}</span>
    </div>
  );
}

export default function MachineProfilePage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<TabKey>("breakdowns");

  useEffect(() => {
    let cancelled = false;

    async function loadMachine() {
      // The route param is machines.id (a uuid), not machine_code. Same
      // guard as app/machines/[id]/edit/page.tsx so a mistyped/copy-pasted
      // code in the URL shows a friendly empty state, not a raw Postgres
      // cast error.
      if (!UUID_REGEX.test(params.id)) {
        setState({ status: "not-found" });
        return;
      }

      const [machineRes, breakdownsRes, pmPlansRes, machinePartsRes] =
        await Promise.all([
          supabase
            .from("machines")
            .select(
              "id, machine_code, machine_name, category, location, status, manufacturer, model, serial_no, purchase_date, install_date, warranty_expiry"
            )
            .eq("id", params.id)
            .maybeSingle(),
          supabase
            .from("breakdowns")
            .select("id")
            .eq("machine_id", params.id)
            .in("status", ["open", "in_progress"]),
          supabase
            .from("pm_plans")
            .select("next_due_date")
            .eq("machine_id", params.id)
            .eq("is_active", true)
            .not("next_due_date", "is", null),
          supabase
            .from("machine_parts")
            .select("next_due_date")
            .eq("machine_id", params.id)
            .not("next_due_date", "is", null),
        ]);

      if (cancelled) return;

      if (machineRes.error) {
        // PGRST116 = no rows found (only ever raised by .single(), but
        // handled here too in case of a PostgREST version difference).
        if (machineRes.error.code === "PGRST116") {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: machineRes.error.message });
        }
        return;
      }
      if (!machineRes.data) {
        setState({ status: "not-found" });
        return;
      }

      const firstRelatedError =
        breakdownsRes.error ?? pmPlansRes.error ?? machinePartsRes.error;
      if (firstRelatedError) {
        setState({ status: "error", message: firstRelatedError.message });
        return;
      }

      const hasOpenBreakdown = (breakdownsRes.data ?? []).length > 0;
      const dueDates = [
        ...(pmPlansRes.data ?? []).map(
          (row: { next_due_date: string }) => row.next_due_date
        ),
        ...(machinePartsRes.data ?? []).map(
          (row: { next_due_date: string }) => row.next_due_date
        ),
      ];

      const machine = machineRes.data as MachineRecord;
      const computedStatus = computeMachineStatus(
        machine.status,
        hasOpenBreakdown,
        dueDates
      );

      setState({ status: "loaded", machine, computedStatus });
    }

    loadMachine();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <div className="p-4">
      {state.status === "loading" && (
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded-md bg-primary/10" />
          <div className="h-40 rounded-lg bg-primary/10" />
          <div className="h-40 rounded-lg bg-primary/10" />
        </div>
      )}

      {state.status === "not-found" && (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">ไม่พบเครื่องจักรนี้</p>
          <Link
            href="/"
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            กลับหน้าแรก
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
          <div className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span
                className="h-4 w-4 shrink-0 rounded-full"
                style={{
                  backgroundColor: MACHINE_STATUS_COLORS[state.computedStatus],
                }}
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-primary/70">
                {MACHINE_STATUS_LABELS[state.computedStatus]}
              </span>
            </div>

            <h1 className="mt-2 text-2xl font-bold text-primary">
              {state.machine.machine_code}
            </h1>
            <p className="text-primary/80">{state.machine.machine_name}</p>
            {state.machine.category && (
              <span className="mt-2 inline-block w-fit rounded-full border border-primary/10 bg-surface px-2 py-0.5 text-xs text-primary/70">
                {state.machine.category}
              </span>
            )}

            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              <div>
                <h2 className="border-b border-primary/10 pb-1 text-sm font-semibold text-primary/70">
                  ข้อมูลเครื่องจักร
                </h2>
                <div className="divide-y divide-primary/5">
                  <InfoRow
                    label="ตำแหน่ง/Line"
                    value={displayValue(state.machine.location)}
                  />
                  <InfoRow
                    label="สถานะ"
                    value={
                      MACHINE_OWN_STATUS_LABELS[state.machine.status] ??
                      state.machine.status
                    }
                  />
                </div>
              </div>

              <div>
                <h2 className="border-b border-primary/10 pb-1 text-sm font-semibold text-primary/70">
                  ข้อมูลทรัพย์สิน
                </h2>
                <div className="divide-y divide-primary/5">
                  <InfoRow
                    label="ยี่ห้อ/ผู้ผลิต"
                    value={displayValue(state.machine.manufacturer)}
                  />
                  <InfoRow
                    label="รุ่น"
                    value={displayValue(state.machine.model)}
                  />
                  <InfoRow
                    label="หมายเลขเครื่อง S/N"
                    value={displayValue(state.machine.serial_no)}
                  />
                  <InfoRow
                    label="วันที่ซื้อ"
                    value={formatDateThai(state.machine.purchase_date)}
                  />
                  <InfoRow
                    label="วันติดตั้ง"
                    value={formatDateThai(state.machine.install_date)}
                  />
                  <InfoRow
                    label="วันหมดประกัน"
                    value={formatDateThai(state.machine.warranty_expiry)}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/breakdowns/new?machine=${state.machine.id}`}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
              >
                <AlertTriangle size={16} aria-hidden="true" />
                <span>+ แจ้งเสีย</span>
              </Link>
              <Link
                href={`/machines/${state.machine.id}/edit`}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
              >
                <Pencil size={16} aria-hidden="true" />
                <span>แก้ไข</span>
              </Link>
              <Link
                href={`/machines/${state.machine.id}/report`}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
              >
                <Printer size={16} aria-hidden="true" />
                <span>พิมพ์รายงาน PDF</span>
              </Link>
              <Link
                href="/"
                className="flex min-h-[44px] items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
              >
                กลับหน้าแรก
              </Link>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex gap-1 border-b border-primary/10">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`min-h-[44px] flex-1 border-b-2 px-2 text-sm font-medium transition-colors sm:flex-none sm:px-4 ${
                    activeTab === tab.key
                      ? "border-accent text-accent"
                      : "border-transparent text-primary/60 hover:text-primary"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="rounded-b-lg border border-t-0 border-primary/10 bg-white p-4">
              {activeTab === "breakdowns" && (
                <BreakdownHistoryTab machineId={state.machine.id} />
              )}
              {activeTab === "pm" && (
                <PmHistoryTab machineId={state.machine.id} />
              )}
              {activeTab === "parts" && (
                <PartsTab machineId={state.machine.id} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
