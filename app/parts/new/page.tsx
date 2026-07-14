"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PartForm, { type PartMachineOption } from "@/components/parts/PartForm";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NewPartPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [machineOptions, setMachineOptions] = useState<PartMachineOption[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase
        .from("machines")
        .select("id, machine_code, machine_name, status")
        .eq("status", "active")
        .order("machine_code", { ascending: true });

      if (cancelled) return;

      if (error) {
        setError(error.message);
      } else {
        setMachineOptions((data ?? []) as PartMachineOption[]);
      }
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // /parts/new?machine=<uuid> preselects that machine (linked from a
  // machine's page in MMS-017). An invalid uuid or one matching no active
  // machine is ignored silently -- PartForm falls back to no preselection.
  const machineParam = searchParams.get("machine");
  const preselectMachineId =
    machineParam && UUID_REGEX.test(machineParam) ? machineParam : null;

  function handleSuccess() {
    router.push("/parts?saved=1");
    router.refresh();
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">เพิ่มอะไหล่</h1>
      <div className="mt-4">
        {loading ? (
          <div className="max-w-lg animate-pulse space-y-4">
            <div className="h-12 rounded-md bg-primary/10" />
            <div className="h-12 rounded-md bg-primary/10" />
            <div className="h-12 rounded-md bg-primary/10" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs">
              {error}
            </pre>
          </div>
        ) : (
          <PartForm
            machineOptions={machineOptions}
            preselectMachineId={preselectMachineId}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    </div>
  );
}

export default function NewPartPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4">
          <h1 className="text-2xl font-bold">เพิ่มอะไหล่</h1>
        </div>
      }
    >
      <NewPartPageInner />
    </Suspense>
  );
}
