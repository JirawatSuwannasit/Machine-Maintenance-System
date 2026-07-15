"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabase } from "@/lib/supabase";
import BreakdownForm, {
  type BreakdownFormValues,
} from "@/components/breakdowns/BreakdownForm";

function NewBreakdownPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // /breakdowns/new?machine=<uuid> preselects a machine (linked from the
  // machine profile page). BreakdownForm itself only applies this once
  // the active-machine list has loaded, and ignores it if it matches no
  // active machine -- never crashes, just falls back to the normal picker.
  const machineParam = searchParams.get("machine") ?? undefined;

  async function handleSubmit(
    values: BreakdownFormValues
  ): Promise<string | null> {
    const { error } = await supabase.from("breakdowns").insert({
      machine_id: values.machineId,
      symptom: values.symptom,
      reported_at: values.reportedAtIso,
      technician: values.technician,
      status: "open",
    });

    if (error) return error.message;

    router.push("/?saved=breakdown");
    router.refresh();
    return null;
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">แจ้งเสีย</h1>
      <BreakdownForm
        initialMachineId={machineParam}
        submitLabel="บันทึกแจ้งเสีย"
        onCancel={() => router.back()}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

export default function NewBreakdownPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4">
          <h1 className="text-2xl font-bold">แจ้งเสีย</h1>
        </div>
      }
    >
      <NewBreakdownPageInner />
    </Suspense>
  );
}
