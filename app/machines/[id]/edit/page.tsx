"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import MachineForm, { type MachineRecord } from "@/components/machine/MachineForm";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; machine: MachineRecord };

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EditMachinePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadMachine() {
      // The route param is machines.id (a uuid), not machine_code. A
      // technician visiting /machines/TS-04/edit by code instead of id
      // must see a friendly empty state, not a raw Postgres cast error.
      if (!UUID_REGEX.test(params.id)) {
        setState({ status: "not-found" });
        return;
      }

      const { data, error } = await supabase
        .from("machines")
        .select(
          "id, machine_code, machine_name, category, location, status, manufacturer, model, serial_no, purchase_date, install_date, warranty_expiry"
        )
        .eq("id", params.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        // PGRST116 = no rows found (only ever raised by .single(), but
        // handled here too in case of a PostgREST version difference).
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
      setState({ status: "loaded", machine: data as MachineRecord });
    }

    loadMachine();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  function handleSuccess() {
    router.push("/?saved=1");
    router.refresh();
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">แก้ไขเครื่องจักร</h1>

      {state.status === "loading" && (
        <div className="mt-4 max-w-lg animate-pulse space-y-4">
          <div className="h-12 rounded-md bg-primary/10" />
          <div className="h-12 rounded-md bg-primary/10" />
          <div className="h-12 rounded-md bg-primary/10" />
          <div className="h-12 rounded-md bg-primary/10" />
          <div className="h-12 rounded-md bg-primary/10" />
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
        <div className="mt-4">
          <MachineForm machine={state.machine} onSuccess={handleSuccess} />
        </div>
      )}
    </div>
  );
}
