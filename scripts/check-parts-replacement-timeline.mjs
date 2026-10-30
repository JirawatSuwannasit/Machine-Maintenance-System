// Run from the repository root: node scripts/check-parts-replacement-timeline.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const cache = new Map();
function load(path) {
  const file = resolve(path);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  vm.runInNewContext(outputText, { exports, Date, require: (name) => load(
    (name.startsWith('@/') ? resolve(name.slice(2)) : resolve(dirname(file), name)) + '.ts'
  ) });
  return exports;
}
const { systemYears, timelineYears, localCalendarDate, buildTimelineRows, timelineRecommendation, defaultTimelineRange, validateTimelineRange, reconcileTimelineVisibility, installationYear } = load('lib/partsReplacementTimeline.ts');
let assertions = 0;
function equal(actual, expected) { assert.equal(actual, expected); assertions++; }
const originalTz = process.env.TZ;
try {
  for (const timezone of ['UTC', 'Asia/Bangkok', 'America/Los_Angeles']) {
    process.env.TZ = timezone;
    for (const [year, age] of [[1997,null],[1998,0],[1999,1],[2024,26],[2025,27],[2026,28],[2027,29]]) equal(systemYears('1998-04-30',year),age);
    equal(systemYears(null,2026),null);
    equal(systemYears('2000-02-29',2026),26);
    equal(localCalendarDate(new Date(2026,0,1,0,5)),'2026-01-01');
    const range=defaultTimelineRange(null,new Date(2026,9,30));
    const years=timelineYears(range.startYear,range.endYear);
    equal(years.length,11); equal(years[0],2017); equal(years[10],2027);
    const installed=defaultTimelineRange('2011-04-30',new Date(2026,9,30));
    equal(installed.startYear,2011);equal(installed.endYear,2027);
    const older=defaultTimelineRange('1990-12-31',new Date(2026,9,30));
    equal(older.startYear,1990);equal(older.endYear,2019);equal(timelineYears(older.startYear,older.endYear).length,30);
    equal(installationYear('2011-01-01'),2011);equal(installationYear(null),null);
  }
} finally { if (originalTz===undefined) delete process.env.TZ; else process.env.TZ=originalTz; }
const part = {part_code:'P1',part_name:'Part one',default_lifespan_days:365,stock_tracking_enabled:false};
const link = {id:'l1',part_id:'p1',next_due_date:'2026-10-29',lifespan_override_days:null,schedule_disabled:false,spare_parts:part};
const replacement = {id:'r1',part_id:'p1',replaced_at:'2024-01-01',qty_used:2,unit_cost:'12.50',total_cost:'25.00',reason:'planned',replaced_by:'Tester',spare_parts:[part]};
const rows = buildTimelineRows([
  link, {...link,id:'l2',part_id:'p2',spare_parts:{...part,part_code:'P2'},last_replaced_at:'2024-01-01'},
], [replacement,replacement,{...replacement,id:'r2',replaced_at:'2024-12-31'},
  {...replacement,id:'r3',part_id:'p3',replaced_at:'2025-01-01',spare_parts:{...part,part_code:'P3'}},
  {...replacement,id:'future1',replaced_at:'2027-01-01'}, {...replacement,id:'future2',replaced_at:'2026-12-31'}], '2026-10-30');
equal(rows.length,3);
equal(rows[0].byYear.get(2024).length,2);
equal(rows[0].byYear.get(2024)[0].id,'r2');
equal(rows[0].byYear.has(2023),false); equal(rows[0].byYear.has(2026),false); equal(rows[0].byYear.has(2027),false);
equal(rows[1].byYear.size,0); // A link/last_replaced_at never creates history.
equal(rows[2].link,null); equal(rows[2].byYear.get(2025)[0].id,'r3');
const now=new Date(2026,9,30,12);
const recommend=(changes={},partChanges={})=>timelineRecommendation({...rows[0],part:{...part,...partChanges},link:{...link,...changes}},now);
equal(recommend().label,'แนะนำเปลี่ยน');
equal(recommend().className.includes('red'),true);
equal(recommend({next_due_date:'2026-10-30'}).label,'ครบกำหนดวันนี้');
equal(recommend({next_due_date:'2026-11-06'}).label,'อีก 7 วัน');
equal(recommend({next_due_date:'2026-11-07'}).label,'ตามรอบ');
equal(recommend({next_due_date:null}).label,'ยังไม่มีวันครบกำหนด');
equal(recommend({schedule_disabled:true}).label,'ไม่กำหนดรอบ');
equal(recommend({}, {default_lifespan_days:null}).label,'ไม่กำหนดรอบ');
equal(recommend({lifespan_override_days:7}, {default_lifespan_days:null}).label,'แนะนำเปลี่ยน');
equal(timelineRecommendation(rows[2],now).label,'ไม่ได้ผูกกับเครื่องแล้ว');
for (const [start,end,length] of [[2010,2026,17],[2024,2026,3],[2000,2029,30],[2024,2024,1],[1998,2026,29]]) {
  equal(validateTimelineRange(String(start),String(end)),null);
  const years=timelineYears(start,end);
  equal(years.length,length);equal(years[0],start);equal(years[length-1],end);
  equal(systemYears('1998-04-30',years[0]),start-1998);
}
for (const [start,end] of [['','2026'],['2024',''],['2027','2026'],['2000','2030'],['2024.5','2026'],['abc','2026'],['-1','2026'],['2024','10000'],['2024','Infinity'],['1e3','1020']]) {
  equal(typeof validateTimelineRange(start,end),'string');
}
equal(timelineYears(2000,2030).length,0);equal(timelineYears(2026,2024).length,0);
const previous={machineId:'machine-one',hiddenPartIds:new Set(['p1','removed'])};
const refreshed=reconcileTimelineVisibility(previous,'machine-one',['p1','p2','new-part']);
equal(refreshed.hiddenPartIds.has('p1'),true);
equal(refreshed.hiddenPartIds.has('p2'),false);
equal(refreshed.hiddenPartIds.has('new-part'),false);
equal(refreshed.hiddenPartIds.has('removed'),false);
equal(previous.hiddenPartIds.has('removed'),true); // Reconciliation does not mutate the previous state.
const changedMachine=reconcileTimelineVisibility(previous,'machine-two',['p1','new-part']);
equal(changedMachine.hiddenPartIds.size,0);equal(changedMachine.machineId,'machine-two');
equal(validateTimelineRange('2010','2026','2011-04-30'),'ปีเริ่มต้นต้องไม่ก่อนปีที่ติดตั้งเครื่องจักร (2011)');
equal(validateTimelineRange('2011','2026','2011-04-30'),null);
equal(validateTimelineRange('2015','2027','2011-04-30'),null);
equal(validateTimelineRange('2011','2041','2011-04-30'),'เลือกช่วงปีได้ไม่เกิน 30 ปี');
equal(validateTimelineRange('2010','2026',null),null);
equal(defaultTimelineRange('1998-04-30',now).endYear,2027);
equal(defaultTimelineRange('2028-01-01',now).startYear,2028);
equal(defaultTimelineRange('2028-01-01',now).endYear,2028);
equal(defaultTimelineRange('9999-12-31',now).endYear,9999);
console.log(`PASS: ${assertions} assertions covering calendar ages, grouping/deduplication, real due dates, installation boundaries, bounded defaults, custom ranges and selection reconciliation.`);
