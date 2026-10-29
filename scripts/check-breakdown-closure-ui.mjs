// Isolated integration tests: actual page, React, PartsUsedEditor and Tailwind;
// in-memory Supabase transport only. No credentials or Production requests.
// npm install --prefix /tmp/mms032-tools --no-package-lock playwright esbuild @electric-sql/pglite
// MMS032_TEST_TOOLS=/tmp/mms032-tools node scripts/check-breakdown-closure-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
const requireTools = createRequire(resolve(process.env.MMS032_TEST_TOOLS || '.', 'package.json'));
const { build } = requireTools('esbuild');
const { chromium } = requireTools('playwright');
const { PGlite } = requireTools('@electric-sql/pglite');
const repo = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'mms032-'));
const id = '11111111-1111-4111-8111-111111111111';
const part = { part_code: 'P1', part_name: 'Part', unit_cost: 10, stock_qty: 0, stock_tracking_enabled: false };
const record = {
  id, machine_id: 'machine', reported_at: '2026-10-20T01:00:00.000Z',
  symptom: 'Test breakdown', cause: 'Test cause', action_taken: 'Test repair',
  downtime_minutes: null, repair_cost: 0, technician: 'Tester', status: 'in_progress',
  operating_impact: 'stopped', closed_at: null, closure_outcome: null,
  no_repair_reason: null, impact_cleared_at: null,
  machines: { machine_code: 'M1', machine_name: 'Machine', location: 'REL' },
};
const transport = `
export const supabase = { from(table) {
  const q = { table, op: 'read', payload: null, filters: [] };
  const chain = {
    select() { return chain }, eq(k,v) { q.filters.push([k,v]); return chain },
    order() { return chain }, in() { return chain }, is() { return chain },
    update(payload) { q.op='update'; q.payload=payload; return chain },
    insert(payload) { q.op='insert'; q.payload=payload; return chain },
    delete() { q.op='delete'; return chain },
    maybeSingle() { return execute() }, then(a,b) { return execute().then(a,b) }
  };
  async function execute() {
    const db = window.__db;
    if (q.op !== 'read') {
      db.calls.push(JSON.parse(JSON.stringify(q)));
      if (table==='breakdowns') {
        if (db.race) return { data: null, error: null };
        Object.assign(db.record,q.payload);
      }
      if (table==='part_replacements' && q.op==='insert') db.inserts.push(...q.payload);
    }
    let data = table==='breakdowns' ? db.record : table==='machine_parts'
      ? [{part_id:'part',spare_parts:db.part}] : db.parts;
    return {data:JSON.parse(JSON.stringify(data)),error:null};
  }
  return chain;
}};`;
let browser;
let server;
const db = new PGlite();
try {
  // Execute the existing trigger function verbatim against a local throwaway table.
  const sql = readFileSync('supabase/migrations/013_mms_030_repair_outcome.sql','utf8');
  const fn = sql.slice(sql.indexOf('create or replace function'), sql.indexOf('-- The trigger'));
  await db.exec(`create table breakdowns (status text, closure_outcome text, operating_impact text,
    downtime_minutes integer, closed_at timestamptz, reported_at timestamptz); ${fn}
    create trigger test_downtime before insert or update on breakdowns
    for each row execute function fn_set_closed_breakdown_downtime();`);
  for (const [outcome, impact, manual, expected] of [
    ['repaired','stopped',null,3240], ['repaired','stopped',17,17],
    ['not_repaired','stopped',null,null], ['not_repaired','stopped',11,11],
    ['repaired','running',null,null], ['repaired','limited',null,null],
    ['repaired','limited',23,23],
  ]) {
    const result = await db.query(`insert into breakdowns values ('closed',$1,$2,$3,
      '2026-10-22T14:00:00+07','2026-10-20T08:00:00+07') returning downtime_minutes`, [outcome,impact,manual]);
    assert.equal(result.rows[0].downtime_minutes, expected);
  }
  console.log('PASS: 7 existing PostgreSQL trigger cases in local PGlite (no remote SQL).');

  await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import Page from './app/breakdowns/[id]/page';
      import {AccessProvider} from './components/AccessContext';
      createRoot(document.getElementById('root')).render(<AccessProvider access={{role:'admin',section:null}}><Page/></AccessProvider>);`,
      resolveDir:repo, loader:'tsx' },
    bundle:true, write:true, outfile:join(temp,'app.js'), jsx:'automatic',
    plugins:[{name:'offline-fixtures',setup(b) {
      b.onResolve({filter:/^next\/(link|navigation)$/}, a=>({path:a.path,namespace:'mock'}));
      b.onResolve({filter:/^@\/lib\/supabase$/}, ()=>({path:'supabase',namespace:'mock'}));
      b.onLoad({filter:/.*/,namespace:'mock'}, a=>({contents:a.path==='supabase' ? transport
        : a.path==='next/navigation' ? `export const useParams=()=>({id:'${id}'}); export const useRouter=()=>({push(){},refresh(){}});`
        : `import React from 'react'; export default function Link({children,...props}){return React.createElement('a',props,children)}`,loader:'js',resolveDir:repo}));
    }}],
  });
  execFileSync(join(repo,'node_modules/.bin/tailwindcss'), ['-i','app/globals.css','-o',join(temp,'app.css')],{stdio:'pipe'});
  server=createServer((req,res)=>{
    const file = req.url==='/app.js' ? 'app.js' : req.url==='/app.css' ? 'app.css' : null;
    res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');
    res.end(file?readFileSync(join(temp,file)):'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  async function open(overrides={},parts=[],race=false,timezone='Asia/Bangkok') {
    const context=await browser.newContext({viewport:{width:375,height:812},timezoneId:timezone});
    await context.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
    const page=await context.newPage();
    await page.addInitScript(({record,part,parts,race})=>{window.__db={record,part,parts,race,calls:[],inserts:[]};},
      {record:{...record,...overrides},part,parts,race});
    await page.goto(url);
    await page.locator(overrides.status==='closed'?'text=แก้ไขประวัติ':'#closed_at').waitFor();
    page.on('dialog',dialog=>dialog.accept());
    return page;
  }
  async function calls(page) { return page.evaluate(()=>window.__db.calls); }
  async function save(page) {
    await page.getByRole('button',{name:'แก้ไขเรียบร้อย',exact:true}).click();
    await page.getByText('ปิดงาน — แก้ไขเรียบร้อย',{exact:true}).waitFor();
    return (await calls(page)).find(c=>c.table==='breakdowns' && c.payload.status==='closed');
  }
  let scenarios=0;
  let page=await open();
  const initial=await page.locator('#closed_at').inputValue();
  assert.match(initial,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal((await save(page)).payload.closed_at, new Date(`${initial}+07:00`).toISOString()); scenarios++;

  page=await open();
  await page.locator('#closed_at').fill('2026-10-22T14:00');
  await page.getByText('คำนวณอัตโนมัติ: 3,240 นาที',{exact:false}).waitFor();
  await page.locator('#closed_at').fill('2026-10-22T15:30');
  await page.getByText('คำนวณอัตโนมัติ: 3,330 นาที',{exact:false}).waitFor();
  await page.locator('#closed_at').fill('2026-10-22T14:00');
  await page.getByRole('button',{name:'บันทึกความคืบหน้า',exact:true}).click();
  await page.getByText('บันทึกความคืบหน้าเรียบร้อยแล้ว',{exact:true}).waitFor();
  assert.equal(await page.locator('#closed_at').inputValue(),'2026-10-22T14:00');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= 375),true);
  const inputBox=await page.locator('#closed_at').boundingBox();
  assert.ok(inputBox.x>=0 && inputBox.x+inputBox.width<=375);
  await page.getByRole('button',{name:'เพิ่มอะไหล่',exact:false}).click();
  await page.locator('select').selectOption('part');
  const saved=await save(page);
  assert.equal(saved.payload.closed_at,'2026-10-22T07:00:00.000Z');
  assert.equal(saved.payload.downtime_minutes,null);
  assert.equal(saved.payload.closure_outcome,'repaired');
  assert.deepEqual(saved.filters,[['id',id],['status','in_progress']]);
  assert.equal(await page.evaluate(()=>window.__db.inserts[0].replaced_at),'2026-10-22'); scenarios++;

  page=await open();
  for(const [value,error] of [['','กรุณาระบุวันเวลาปิดงานจริง'],['2026-10-20T07:59','วันเวลาปิดงานต้องไม่น้อยกว่าวันเวลาที่แจ้งเสีย'],['2099-01-01T12:00','ไม่สามารถเลือกวันเวลาปิดงานในอนาคตได้']]) {
    await page.locator('#closed_at').fill(value);
    assert.equal(await page.locator('#closed_at_error').textContent(),error);
    assert.equal(await page.getByRole('button',{name:'แก้ไขเรียบร้อย',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'ไม่ซ่อม',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'ยืนยันไม่ซ่อม',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();
    assert.equal((await calls(page)).length,0); scenarios++;
  }
  await page.getByRole('button',{name:'ใช้เวลาปัจจุบัน',exact:true}).click();
  assert.notEqual(await page.locator('#closed_at').inputValue(),'2099-01-01T12:00');

  for(const impact of ['stopped','running','limited']) {
    page=await open({operating_impact:impact});
    await page.locator('#closed_at').fill('2026-10-22T14:00');
    await page.locator('#downtime_minutes').fill('17');
    assert.equal((await save(page)).payload.downtime_minutes,17); scenarios++;
  }
  for (const impact of ['running','limited']) {
    page=await open({operating_impact:impact});
    await page.locator('#closed_at').fill('2026-10-22T14:00');
    assert.equal(await page.getByText('คำนวณอัตโนมัติ:',{exact:false}).count(),0);
    assert.equal((await save(page)).payload.downtime_minutes,null); scenarios++;
  }
  page=await open();
  await page.locator('#closed_at').fill('2026-10-22T14:00');
  await page.locator('#downtime_minutes').fill('0');
  assert.equal((await save(page)).payload.downtime_minutes,0); scenarios++;
  page=await open();
  await page.locator('#closed_at').fill('2026-10-22T14:00');
  await page.getByRole('button',{name:'ไม่ซ่อม',exact:true}).click();
  assert.equal(await page.getByText('คำนวณอัตโนมัติ:',{exact:false}).count(),0);
  await page.getByRole('button',{name:'ยืนยันไม่ซ่อม',exact:true}).click();
  assert.equal((await calls(page)).length,0);
  await page.locator('#no_repair_reason').fill('Cannot repair');
  await page.getByRole('button',{name:'ยืนยันไม่ซ่อม',exact:true}).click();
  await page.getByText('ปิดงาน — ไม่ซ่อม',{exact:true}).waitFor();
  const noRepair=(await calls(page))[0].payload;
  assert.equal(noRepair.closed_at,'2026-10-22T07:00:00.000Z');
  assert.equal(noRepair.closure_outcome,'not_repaired');
  assert.equal(noRepair.downtime_minutes,null);
  assert.equal(noRepair.impact_cleared_at,null);
  assert.equal(await page.evaluate(()=>window.__db.inserts.length),0);
  await page.getByText('ผลกระทบต่อเครื่องจักรยังคงทำงานอยู่',{exact:true}).waitFor(); scenarios++;

  const oldPart={id:'old-row',part_id:'part',qty_used:1,unit_cost:10,replaced_at:'2026-10-21',spare_parts:part};
  page=await open({},[oldPart]);
  await page.locator('#closed_at').fill('2026-10-22T14:00');
  // Change an existing part quantity, exercising delete + reinsert with original date.
  const quantity=page.locator('input[type="number"][min="1"]');
  await quantity.fill('2');
  await save(page);
  assert.equal(await page.evaluate(()=>window.__db.inserts[0].replaced_at),'2026-10-21'); scenarios++;

  const closed={status:'closed',closure_outcome:'repaired',closed_at:'2026-10-22T07:00:42.123Z'};
  page=await open(closed,[oldPart]);
  await page.getByRole('button',{name:'แก้ไขประวัติ',exact:true}).click();
  await page.locator('#history_closed_at').fill('2026-10-23T12:00');
  await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();
  assert.equal((await calls(page)).length,0);
  await page.getByRole('button',{name:'แก้ไขประวัติ',exact:true}).click();
  assert.equal(await page.locator('#history_closed_at').inputValue(),'2026-10-22T14:00');
  await page.locator('#history_cause').fill('Corrected cause');
  await page.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click();
  await page.getByRole('button',{name:'แก้ไขประวัติ',exact:true}).waitFor();
  assert.equal((await calls(page))[0].payload.closed_at,closed.closed_at);
  assert.equal((await calls(page)).filter(c=>c.table==='part_replacements').length,0);
  await page.getByRole('button',{name:'แก้ไขประวัติ',exact:true}).click();
  await page.locator('#history_closed_at').fill('2026-10-23T12:00');
  await page.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click();
  await page.getByRole('button',{name:'แก้ไขประวัติ',exact:true}).waitFor();
  assert.equal((await calls(page))[1].payload.closed_at,'2026-10-23T05:00:00.000Z'); scenarios++;

  page=await open({},[],true);
  await page.locator('#closed_at').fill('2026-10-22T14:00');
  await page.getByRole('button',{name:'แก้ไขเรียบร้อย',exact:true}).click();
  await page.getByText('เกิดข้อผิดพลาด กรุณาลองใหม่',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__db.inserts.length),0); scenarios++;

  page=await open(closed,[],true);
  await page.getByRole('button',{name:'แก้ไขประวัติ',exact:true}).click();
  await page.locator('#history_closed_at').fill('2026-10-23T12:00');
  await page.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click();
  await page.getByText('สถานะใบงานถูกเปลี่ยนโดยผู้ใช้อื่น ระบบแสดงข้อมูลล่าสุดแล้วและไม่ได้บันทึกการแก้ไข',{exact:true}).waitFor();
  assert.equal((await calls(page))[0].filters[1][1],'closed');
  assert.equal(await page.evaluate(()=>window.__db.inserts.length),0); scenarios++;

  page=await open({},[],false,'America/Los_Angeles');
  await page.locator('#closed_at').fill('2026-10-22T00:05');
  assert.equal((await save(page)).payload.closed_at,'2026-10-22T07:05:00.000Z'); scenarios++;
  console.log(`PASS: ${scenarios} browser scenarios, including 375px, both outcomes, parts, history, race and timezones.`);
} finally {
  await browser?.close();
  if(server) await new Promise(resolve=>server.close(resolve));
  await db.close();
  rmSync(temp,{recursive:true,force:true});
}
