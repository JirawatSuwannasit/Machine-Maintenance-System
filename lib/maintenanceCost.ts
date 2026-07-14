// Shared Total Maintenance Cost formula. Extracted here (MMS-019) so the
// per-machine report (app/machines/[id]/report/page.tsx, MMS-018) and the
// summary reports page (app/reports/page.tsx, MMS-019) can never compute it
// differently. MMS-018's page has its own equivalent inline calculation --
// app/machines is out of scope to edit in MMS-019, so it has not been
// retrofitted to import this, but a future ticket safely can (the formula
// is byte-for-byte the same).
//
// Total Maintenance Cost = SUM(breakdowns.repair_cost)       -- labour/outsourcing ONLY
//                        + SUM(pm_records.pm_cost)
//                        + SUM(part_replacements.total_cost) -- parts counted ONCE, here only
//
// breakdowns.repair_cost (supabase/migrations/001_init.sql) never includes
// part costs, even for a replacement linked to a breakdown via
// breakdown_id -- that link exists so a breakdown's full job cost can be
// ASSEMBLED by the caller (repair_cost + its matching part_replacements),
// not so repair_cost absorbs the part cost itself. Adding totalPartsCost
// into a repair figure anywhere would double-count parts used on a
// breakdown repair.

export function coerceNumber(value: number | string): number {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return Number.isFinite(num) ? num : 0;
}

export type MaintenanceCostBreakdown = {
  totalRepairCost: number;
  totalPmCost: number;
  totalPartsCost: number;
  totalMaintenanceCost: number;
};

export function computeMaintenanceCost(
  breakdowns: Array<{ repair_cost: number | string }>,
  pmRecords: Array<{ pm_cost: number | string }>,
  replacements: Array<{ total_cost: number | string }>
): MaintenanceCostBreakdown {
  const totalRepairCost = breakdowns.reduce(
    (sum, row) => sum + coerceNumber(row.repair_cost),
    0
  );
  const totalPmCost = pmRecords.reduce(
    (sum, row) => sum + coerceNumber(row.pm_cost),
    0
  );
  const totalPartsCost = replacements.reduce(
    (sum, row) => sum + coerceNumber(row.total_cost),
    0
  );
  return {
    totalRepairCost,
    totalPmCost,
    totalPartsCost,
    totalMaintenanceCost: totalRepairCost + totalPmCost + totalPartsCost,
  };
}

export function formatMoneyThai(value: number | string): string {
  const num = coerceNumber(value);
  return `${num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}
