"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import BreakdownForm, {
  type BreakdownFormValues,
} from "@/components/breakdowns/BreakdownForm";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BreakdownEditRow = {
  id: string;
  machine_id: string;
  reported_at: string;
  symptom: string;
  technician: string | null;
  status: string;
};

// Inverse of BreakdownForm's datetimeLocalToIso: a UTC ISO timestamp -> the
// local wall-clock datetime-local string the <input> expects. Date's
// getters (getHours, etc.) already resolve to local time, so this needs no
// timezone math of its own.
function isoToDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "not-open" }
  | { status: "ready"; row: BreakdownEditRow };

export default function EditBreakdownPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!UUID_REGEX.test(params.id)) {
        setState({ status: "not-found" });
        return;
      }

      const { data, error } = await supabase
        .from("breakdowns")
        .select("id, machine_id, reported_at, symptom, technician, status")
        .eq("id", params.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        if (error.code === "PGRST116") {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: error.message });
        }
        return;
      }
      if (!data) {
        setState({ status: "not-found" });
        return;
      }

      const row = data as BreakdownEditRow;

      // Once accepted, cause/action/parts/cost are in play and editing
      // must go through the close-out / reopen flow, not this simple
      // editor -- this also protects against a stale link editing a job
      // someone else already accepted.
      if (row.status !== "open") {
        setState({ status: "not-open" });
        return;
      }

      setState({ status: "ready", row });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function handleSubmit(
    values: BreakdownFormValues
  ): Promise<string | null> {
    if (state.status !== "ready") return null;

    // Guard against a race: only save if the row is still 'open' server-
    // side (mirrors the reopen race guard on the detail page). If someone
    // accepted the job in between this page loading and the save, this
    // UPDATE must not silently overwrite the accepted job's technician and
    // other fields -- it matches zero rows instead, surfaced below.
    const { data, error } = await supabase
      .from("breakdowns")
      .update({
        machine_id: values.machineId,
        symptom: values.symptom,
        reported_at: values.reportedAtIso,
        technician: values.technician,
      })
      .eq("id", state.row.id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();

    if (error) return error.message;

    if (!data) {
      return "ใบแจ้งเสียนี้ถูกรับงานไปแล้วระหว่างที่แก้ไข ไม่สามารถบันทึกได้ กรุณากลับไปหน้ารายละเอียดเพื่อดูสถานะล่าสุด";
    }

    router.push(`/breakdowns/${state.row.id}`);
    router.refresh();
    return null;
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">แก้ไขใบแจ้งเสีย</h1>

      {state.status === "loading" && (
        <div className="mt-4 max-w-lg animate-pulse space-y-4">
          <div className="h-14 rounded-md bg-primary/10" />
          <div className="h-24 rounded-md bg-primary/10" />
          <div className="h-14 rounded-md bg-primary/10" />
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

      {state.status === "not-open" && (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">
            ใบแจ้งเสียนี้ถูกรับงานแล้ว ไม่สามารถแก้ไขได้ที่นี่
          </p>
          <Link
            href={`/breakdowns/${params.id}`}
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            กลับไปหน้ารายละเอียด
          </Link>
        </div>
      )}

      {state.status === "ready" && (
        <BreakdownForm
          initialMachineId={state.row.machine_id}
          initialSymptom={state.row.symptom}
          initialReportedAt={isoToDatetimeLocal(state.row.reported_at)}
          initialTechnician={state.row.technician ?? ""}
          submitLabel="บันทึกการแก้ไข"
          onCancel={() => router.push(`/breakdowns/${state.row.id}`)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
