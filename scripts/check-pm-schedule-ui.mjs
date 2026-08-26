import { readFile } from "node:fs/promises";

const formPath = "components/pm/PmPlanForm.tsx";
const plansPath = "app/pm/plans/page.tsx";
const form = await readFile(formPath, "utf8");
const plans = await readFile(plansPath, "utf8");

const forbiddenFormTokens = [
  "start_date",
  "pm_start_date",
  "วันที่เริ่มนับรอบ PM",
  "last_done_date:",
  "next_due_date:",
];

const failures = [];
for (const token of forbiddenFormTokens) {
  if (form.includes(token)) {
    failures.push(`${formPath} still contains ${JSON.stringify(token)}`);
  }
}

if (plans.includes("เริ่มนับรอบ")) {
  failures.push(`${plansPath} still displays the deprecated start-date label`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("PM plan UI has no deprecated start-date or derived-date writes.");
