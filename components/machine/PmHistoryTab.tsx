"use client";

// Placeholder tab. Implemented by MMS-014 (PM history for this machine).
// Kept as its own file so that ticket can fill it in without editing
// app/machines/[id]/page.tsx.

type PmHistoryTabProps = {
  machineId: string;
};

export default function PmHistoryTab({ machineId }: PmHistoryTabProps) {
  return (
    <div className="flex min-h-[160px] items-center justify-center text-center text-sm text-primary/60">
      ยังไม่มีข้อมูล
    </div>
  );
}
