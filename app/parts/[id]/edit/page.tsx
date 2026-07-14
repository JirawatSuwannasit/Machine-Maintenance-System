"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PartForm, {
  type ExistingMachinePartLink,
  type PartMachineOption,
  type SparePartRecord,
} from "@/components/parts/PartForm";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MachineRelation = { machine_code: string; machine_name: string };

type RawLinkRow = {
  id: string;
  machine_id: string;
  lifespan_override_days: number | null;
  last_replaced_at: string | null;
  machines: MachineRelation | MachineRelation[] | null;
};

// Same defensive pattern used throughout the app: without generated
// Database types, postgrest-js infers every embedded relation as an array
// regardless of actual FK cardinality, even though a to-one FK
// (machine_parts.machine_id -> machines.id) returns a plain object at
// runtime.
function normalizeMachineRelation(
  machines: RawLinkRow["machines"]
): MachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      part: SparePartRecord;
      links: ExistingMachinePartLink[];
      machineOptions: PartMachineOption[];
    };

export default function EditPartPage() {
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

      const [partRes, linksRes, machinesRes] = await Promise.all([
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
            "id, machine_id, lifespan_override_days, last_replaced_at, machines(machine_code, machine_name)"
          )
          .eq("part_id", params.id),
        supabase
          .from("machines")
          .select("id, machine_code, machine_name, status")
          .eq("status", "active")
          .order("machine_code", { ascending: true }),
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

      const otherError = linksRes.error ?? machinesRes.error;
      if (otherError) {
        setState({ status: "error", message: otherError.message });
        return;
      }

      const links: ExistingMachinePartLink[] = (
        (linksRes.data ?? []) as RawLinkRow[]
      ).map((row) => {
        const machine = normalizeMachineRelation(row.machines);
        return {
          id: row.id,
          machine_id: row.machine_id,
          lifespan_override_days: row.lifespan_override_days,
          last_replaced_at: row.last_replaced_at,
          machine_code: machine?.machine_code ?? "-",
          machine_name: machine?.machine_name ?? "(ไม่พบข้อมูลเครื่องจักร)",
        };
      });

      // The searchable picker only offers active machines. A machine
      // already linked to this part that has since gone inactive is
      // appended so it still appears (correctly checked) instead of
      // silently vanishing from the form -- same defensive pattern as
      // components/pm/PmPlanForm.tsx's buildSelectableMachines.
      const activeMachines = (machinesRes.data ?? []) as PartMachineOption[];
      const activeIds = new Set(activeMachines.map((m) => m.id));
      const inactiveLinkedMachines: PartMachineOption[] = links
        .filter((link) => !activeIds.has(link.machine_id))
        .map((link) => ({
          id: link.machine_id,
          machine_code: link.machine_code,
          machine_name: link.machine_name,
          status: "inactive",
        }));

      setState({
        status: "loaded",
        part: partRes.data as SparePartRecord,
        links,
        machineOptions: [...activeMachines, ...inactiveLinkedMachines],
      });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  function handleSuccess() {
    router.push("/parts?saved=1");
    router.refresh();
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">แก้ไขอะไหล่</h1>

      {state.status === "loading" && (
        <div className="mt-4 max-w-lg animate-pulse space-y-4">
          <div className="h-12 rounded-md bg-primary/10" />
          <div className="h-12 rounded-md bg-primary/10" />
          <div className="h-12 rounded-md bg-primary/10" />
          <div className="h-12 rounded-md bg-primary/10" />
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
        <div className="mt-4">
          <PartForm
            part={state.part}
            existingLinks={state.links}
            machineOptions={state.machineOptions}
            onSuccess={handleSuccess}
          />
        </div>
      )}
    </div>
  );
}
