import {
  OPERATING_IMPACT_BADGE_CLASSES,
  OPERATING_IMPACT_LABELS,
  type OperatingImpact,
} from "@/lib/operatingImpact";

export default function OperatingImpactBadge({ impact }: { impact: OperatingImpact }) {
  return (
    <span className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${OPERATING_IMPACT_BADGE_CLASSES[impact]}`}>
      {OPERATING_IMPACT_LABELS[impact]}
    </span>
  );
}
