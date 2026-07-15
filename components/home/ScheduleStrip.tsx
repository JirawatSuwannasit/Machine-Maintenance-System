"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DUE_SOON_DAYS } from "@/lib/machineStatus";
import {
  computeDueDisplay,
  formatDateThai,
  parseIsoDateAsLocalDay,
  toLocalDayStart,
} from "@/lib/pmDueDate";

export type PmPlanScheduleInput = {
  id: string;
  pm_name: string;
  machine_id: string;
  next_due_date: string;
};

export type MachinePartScheduleInput = {
  id: string;
  machine_id: string;
  part_id: string;
  next_due_date: string;
  part_code: string;
  part_name: string;
};

export type ScheduleMachineInput = {
  id: string;
  machine_code: string;
  status: string;
};

type ScheduleStripProps = {
  pmPlans: PmPlanScheduleInput[];
  machineParts: MachinePartScheduleInput[];
  machines: ScheduleMachineInput[];
};

type ScheduleItem = {
  key: string;
  kind: "pm" | "part";
  machineCode: string;
  taskName: string;
  dueDate: string;
  href: string;
  actionLabel: string;
};

// Merges pm_plans + machine_parts due dates into one sorted list, keeping
// only items due within DUE_SOON_DAYS (overdue items included -- they sort
// first since overdue dates are chronologically earliest). Machines that
// are inactive/scrapped are excluded, matching the gray status board tiles.
function buildScheduleItems(
  pmPlans: PmPlanScheduleInput[],
  machineParts: MachinePartScheduleInput[],
  machines: ScheduleMachineInput[]
): ScheduleItem[] {
  const machinesById = new Map(
    machines.map((machine) => [machine.id, machine])
  );
  const cutoff = toLocalDayStart(new Date());
  cutoff.setDate(cutoff.getDate() + DUE_SOON_DAYS);

  function schedulableMachine(machineId: string): ScheduleMachineInput | null {
    const machine = machinesById.get(machineId);
    if (!machine) return null;
    if (machine.status === "inactive" || machine.status === "scrapped") {
      return null;
    }
    return machine;
  }

  const items: ScheduleItem[] = [];

  for (const plan of pmPlans) {
    const machine = schedulableMachine(plan.machine_id);
    if (!machine) continue;
    if (parseIsoDateAsLocalDay(plan.next_due_date) > cutoff) continue;
    items.push({
      key: `pm-${plan.id}`,
      kind: "pm",
      machineCode: machine.machine_code,
      taskName: plan.pm_name,
      dueDate: plan.next_due_date,
      href: `/pm/record?plan=${plan.id}`,
      actionLabel: "ทำ PM",
    });
  }

  for (const link of machineParts) {
    const machine = schedulableMachine(link.machine_id);
    if (!machine) continue;
    if (parseIsoDateAsLocalDay(link.next_due_date) > cutoff) continue;
    items.push({
      key: `part-${link.id}`,
      kind: "part",
      machineCode: machine.machine_code,
      taskName: `${link.part_code} — ${link.part_name}`,
      dueDate: link.next_due_date,
      href: `/parts/replace?machine=${link.machine_id}&part=${link.part_id}`,
      actionLabel: "บันทึกเปลี่ยน",
    });
  }

  items.sort(
    (a, b) =>
      parseIsoDateAsLocalDay(a.dueDate).getTime() -
      parseIsoDateAsLocalDay(b.dueDate).getTime()
  );

  return items;
}

function TypeBadge({ kind }: { kind: "pm" | "part" }) {
  if (kind === "pm") {
    return (
      <span className="inline-flex w-fit shrink-0 items-center rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
        PM
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit shrink-0 items-center rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
      อะไหล่
    </span>
  );
}

export default function ScheduleStrip({
  pmPlans,
  machineParts,
  machines,
}: ScheduleStripProps) {
  // Collapsed by default (matches mobile) to keep the server- and
  // first-client-render markup identical; the effect below expands it on
  // desktop viewports right after mount.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (window.innerWidth >= 768) {
      setExpanded(true);
    }
  }, []);

  const items = useMemo(
    () => buildScheduleItems(pmPlans, machineParts, machines),
    [pmPlans, machineParts, machines]
  );

  return (
    <section className="mt-4 rounded-lg border border-primary/10 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-primary">
            กำหนดการ {DUE_SOON_DAYS} วันข้างหน้า
          </span>
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {items.length} งาน
          </span>
        </div>
        <ChevronDown
          size={20}
          aria-hidden="true"
          className={`shrink-0 text-primary/60 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="border-t border-primary/10 p-4">
          {items.length === 0 ? (
            <p className="py-4 text-center text-sm text-primary/60">
              ไม่มีงานครบกำหนดใน {DUE_SOON_DAYS} วันนี้ 🎉
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const due = computeDueDisplay(item.dueDate);
                return (
                  <div
                    key={item.key}
                    className="flex flex-col gap-3 rounded-md border border-primary/10 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <TypeBadge kind={item.kind} />
                        <span className="break-words font-bold text-primary">
                          {item.machineCode}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-sm text-primary/80">
                        {item.taskName}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-primary/60">
                          {formatDateThai(item.dueDate)}
                        </span>
                        <span
                          className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${due.className}`}
                        >
                          {due.label}
                        </span>
                      </div>
                    </div>
                    <Link
                      href={item.href}
                      className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 sm:shrink-0"
                    >
                      {item.actionLabel}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
