"use client";

import { useRouter } from "next/navigation";
import MachineForm from "@/components/machine/MachineForm";

export default function NewMachinePage() {
  const router = useRouter();

  function handleSuccess() {
    router.push("/?saved=1");
    router.refresh();
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">เพิ่มเครื่องจักร</h1>
      <div className="mt-4">
        <MachineForm onSuccess={handleSuccess} />
      </div>
    </div>
  );
}
