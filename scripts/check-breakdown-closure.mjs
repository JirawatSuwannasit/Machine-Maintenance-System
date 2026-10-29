// Run: node scripts/check-breakdown-closure.mjs
// Tests the production helpers in several browser-local timezone equivalents.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadTs(path) {
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  vm.runInNewContext(outputText, { exports, Date });
  return exports;
}
const { toDateTimeLocal, fromDateTimeLocal, computeDowntimePreview, validateClosedAtLocal } = loadTs('lib/breakdownClosure.ts');
const { computeMachineStatus, ONGOING_BREAKDOWN_FILTER } = loadTs('lib/machineStatus.ts');
const originalTz = process.env.TZ;
let checks = 0;
try {
  for (const timezone of ['UTC', 'Asia/Bangkok', 'Asia/Kolkata', 'America/Los_Angeles']) {
    process.env.TZ = timezone;
    const reported = fromDateTimeLocal('2026-10-20T08:00');
    const selected = fromDateTimeLocal('2026-10-22T14:00');
    const now = new Date('2026-10-29T12:34:56');
    assert.equal(toDateTimeLocal(selected), '2026-10-22T14:00');
    assert.equal(toDateTimeLocal(fromDateTimeLocal('2026-10-22T00:05')), '2026-10-22T00:05');
    assert.equal(toDateTimeLocal(fromDateTimeLocal('2026-10-22T23:55')), '2026-10-22T23:55');
    assert.equal(validateClosedAtLocal(toDateTimeLocal(now.toISOString()), reported, now), null);
    assert.equal(validateClosedAtLocal('2026-10-22T14:00', reported, now), null);
    assert.equal(validateClosedAtLocal('2026-10-20T08:00', reported, now), null);
    assert.equal(validateClosedAtLocal('2026-10-20T07:59', reported, now), 'วันเวลาปิดงานต้องไม่น้อยกว่าวันเวลาที่แจ้งเสีย');
    assert.equal(validateClosedAtLocal('2026-10-29T12:35', reported, now), 'ไม่สามารถเลือกวันเวลาปิดงานในอนาคตได้');
    assert.ok(validateClosedAtLocal('', reported, now));
    assert.ok(validateClosedAtLocal('invalid', reported, now));
    assert.equal(computeDowntimePreview(reported, selected), 3240);
    assert.equal(computeDowntimePreview(selected, reported), null);
    checks += 12;
  }
} finally {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
}
assert.equal(computeMachineStatus('active', ['stopped'], []), 'red');
assert.equal(computeMachineStatus('active', ['limited'], []), 'limited');
assert.equal(computeMachineStatus('active', [], []), 'green');
assert.ok(ONGOING_BREAKDOWN_FILTER.includes('closure_outcome.eq.not_repaired,impact_cleared_at.is.null'));
console.log(`${checks + 4} assertions passed: local datetime, validation, preview and unchanged machine impact rules.`);
