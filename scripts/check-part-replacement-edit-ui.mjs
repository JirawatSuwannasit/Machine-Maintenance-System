// Actual React pages + real disposable PostgreSQL, never Production.
// Prerequisites outside checkout:
// npm install --prefix /tmp/mms037-tools --no-package-lock pg @embedded-postgres/linux-x64@17.10.0-beta.17
// npm install --prefix /tmp/mms033-tools --no-package-lock playwright esbuild
// Run: node scripts/check-part-replacement-edit-ui.mjs (requires PyMuPDF for PDF verification).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { startTestDatabase,actors } from './lib/part-replacement-test-db.mjs';
const requireBrowser=createRequire(resolve(process.env.MMS033_TEST_TOOLS||'/tmp/mms033-tools','package.json'));
const{build}=requireBrowser('esbuild');const{chromium}=requireBrowser('playwright');
const db=await startTestDatabase();const temp=mkdtempSync(join(tmpdir(),'mms037-ui-'));const repo=process.cwd();
const queries=[];const errors=[];let server;let browser;let cases=0;
const transport=`
async function send(q){const r=await fetch('/db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...q,actor:window.__actor,readyOverride:window.__readyOverride,delay:window.__delay})});return r.json();}
export const supabase={rpc:name=>send({rpc:name}),from(table){const q={table,op:'read',filters:[],orders:[]};const c={
select(columns){q.columns=columns;return c},eq(k,v){q.filters.push([k,'=',v]);return c},is(k,v){q.filters.push([k,'is',v]);return c},gt(k,v){q.filters.push([k,'>',v]);return c},gte(k,v){q.filters.push([k,'>=',v]);return c},lte(k,v){q.filters.push([k,'<=',v]);return c},lt(k,v){q.filters.push([k,'<',v]);return c},
not(k,op,v){q.filters.push([k,'notnull',v]);return c},or(){q.ongoing=true;return c},order(k,o){q.orders.push([k,o?.ascending!==false]);return c},limit(n){q.limit=n;return c},abortSignal(){return c},
update(payload){q.op='update';q.payload=payload;return c},insert(){throw Error('Unexpected INSERT')},delete(){throw Error('Unexpected DELETE')},maybeSingle(){q.single=true;return send(q)},then(a,b){return send(q).then(a,b)}
};return c;}};`;
async function handleDb(req,res){
 let raw='';for await(const chunk of req)raw+=chunk;const q=JSON.parse(raw);queries.push(q);let result;
 const c=await db.pool.connect();
 try{
  await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actors[q.actor]||actors.admin]);
  if(q.delay)await new Promise(r=>setTimeout(r,q.delay));
  if(q.rpc){
   assert.equal(q.rpc,'part_replacement_history_edit_ready');
   result=q.readyOverride==='missing'?{data:null,error:{code:'PGRST202',message:'Missing test function'}}:q.readyOverride==='false'?{data:false,error:null}:{data:(await c.query('select part_replacement_history_edit_ready() as ready')).rows[0].ready,error:null};
  }else{
   assert.ok(['part_replacements','machine_parts','machines','spare_parts','breakdowns','pm_plans','pm_records'].includes(q.table));
   const params=[];const bind=v=>{params.push(v);return '$'+params.length;};
   const conditions=(q.filters||[]).map(([k,op,v])=>{assert.match(k,/^[a-z_]+$/);if(op==='is')return `t.${k} is null`;if(op==='notnull')return `t.${k} is not null`;assert.ok(['=','>','>=','<=','<'].includes(op));return `t.${k} ${op} ${bind(v)}`;});
   if(q.ongoing)conditions.push("(t.status in ('open','in_progress') or (t.status='closed' and t.closure_outcome='not_repaired' and t.impact_cleared_at is null))");
   let sql;
   if(q.op==='update'){
    assert.equal(q.table,'part_replacements');assert.deepEqual(Object.keys(q.payload).sort(),['notes','qty_used','reason','replaced_at','replaced_by','unit_cost']);
    const sets=Object.entries(q.payload).map(([k,v])=>`${k}=${bind(v)}`);
    sql=`update part_replacements t set ${sets.join(',')} where ${conditions.join(' and ')} returning t.*`;
   }else{
    let joins='',extra='';
    if(q.table==='part_replacements'){joins=' left join machines m on m.id=t.machine_id left join spare_parts s on s.id=t.part_id';extra=',to_jsonb(m) as machines,to_jsonb(s) as spare_parts';}
    if(q.table==='machine_parts'){joins=' left join spare_parts s on s.id=t.part_id';extra=',to_jsonb(s) as spare_parts';}
    if(q.table==='pm_records'){joins=' left join pm_plans p on p.id=t.pm_plan_id';extra=',to_jsonb(p) as pm_plans';}
    sql=`select t.*${extra} from ${q.table} t${joins}${conditions.length?' where '+conditions.join(' and '):''}`;
    if(q.orders.length)sql+=' order by '+q.orders.map(([k,asc])=>{assert.match(k,/^[a-z_]+$/);return `t.${k} ${asc?'asc':'desc'}`;}).join(',');
    if(q.limit)sql+=' limit '+Math.min(q.limit,137);
   }
   const r=await c.query(sql,params);result={data:q.single?r.rows[0]??null:r.rows,error:null};
  }
  await c.query('commit');
 }catch(e){await c.query('rollback');result={data:null,error:{message:e.message,code:e.code}};console.error('Bridge query rejected:',e.message);}finally{c.release();}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
}
try{
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Edit from './app/parts/replacements/[id]/edit/page';import Machine from './app/machines/[id]/page';import Report from './app/machines/[id]/report/page';import{AccessProvider}from'./components/AccessContext';const access=window.__actor==='admin'?{role:'admin',section:null}:{role:'user',section:window.__actor.toUpperCase()};createRoot(document.getElementById('root')).render(<AccessProvider access={access}>{location.pathname.includes('/parts/replacements/')?<Edit/>:location.pathname.endsWith('/report')?<Report/>:<Machine/>}</AccessProvider>);`,resolveDir:repo,loader:'tsx'},bundle:true,outfile:join(temp,'app.js'),jsx:'automatic',plugins:[{name:'local-db',setup(b){
 b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'mock'}));b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'supabase',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='supabase'?transport:a.path==='next/navigation'?`export const useParams=()=>({id:location.pathname.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0]});export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push(url){location.assign(url)},refresh(){}});`:`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`,loader:'js',resolveDir:repo}));}}]});
 execFileSync(join(repo,'node_modules/.bin/tailwindcss'),['-i','app/globals.css','-o',join(temp,'app.css')],{stdio:'pipe'});
 server=createServer((req,res)=>{if(req.url==='/db'){void handleDb(req,res);return;}const file=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':null;res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');res.end(file?readFileSync(join(temp,file)):'<html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 async function open(path,actor='admin',readyOverride=null){const context=await browser.newContext({viewport:{width:375,height:812},timezoneId:'Asia/Bangkok'});await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});await page.clock.setFixedTime(new Date('2026-10-30T05:00:00Z'));await page.addInitScript(({actor,readyOverride})=>{window.__actor=actor;window.__readyOverride=readyOverride;},{actor,readyOverride});await page.goto(url+path);return page;}
 const editPath=f=>`/parts/replacements/${f.record}/edit`;
 const save=page=>page.getByRole('button',{name:'บันทึกการแก้ไข',exact:true});
 const mutationCount=()=>queries.filter(q=>q.op==='update').length;
 const f=await db.fixture();let page=await open(`/machines/${f.machine}?tab=parts&part=${f.part}`);
 await page.getByRole('link',{name:/^แก้ไขประวัติการเปลี่ยนอะไหล่วันที่/}).waitFor();await page.getByRole('link',{name:/^แก้ไขประวัติการเปลี่ยนอะไหล่วันที่/}).click();await save(page).waitFor().catch(async error=>{console.error(await page.locator('body').innerText());console.error(queries.slice(-3));throw error;});
 assert.equal(await page.getByLabel('จำนวนที่ใช้',{exact:true}).inputValue(),'40');assert.equal(Number(await page.getByLabel('ราคาต่อหน่วย (บาท)',{exact:true}).inputValue()),1650);assert.equal(await page.getByLabel('ผู้เปลี่ยน',{exact:true}).inputValue(),'ผู้เปลี่ยนเดิม');assert.equal(await page.getByLabel('หมายเหตุ',{exact:true}).inputValue(),'หมายเหตุเดิม');
 assert.ok((await page.locator('output').textContent()).includes('66,000.00'));cases++;
 const before=await db.pool.query('select * from part_replacements where id=$1',[f.record]);const mutations=mutationCount();
 await page.getByLabel('จำนวนที่ใช้',{exact:true}).fill('30');await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();await page.getByRole('link',{name:/^แก้ไขประวัติการเปลี่ยนอะไหล่วันที่/}).waitFor();
 assert.equal(mutationCount(),mutations);assert.deepEqual((await db.pool.query('select * from part_replacements where id=$1',[f.record])).rows,before.rows);cases++;
 await page.getByRole('link',{name:/^แก้ไขประวัติการเปลี่ยนอะไหล่วันที่/}).click();await save(page).waitFor();
 for(const [label,value]of [['จำนวนที่ใช้','0'],['จำนวนที่ใช้','1.5'],['ราคาต่อหน่วย (บาท)','-1'],['วันที่เปลี่ยนอะไหล่','2099-01-01']]){
  await page.getByLabel(label,{exact:true}).fill(value);await save(page).click();assert.ok(await page.getByRole('alert').count());assert.equal(mutationCount(),mutations);
  await page.getByLabel(label,{exact:true}).fill(label==='จำนวนที่ใช้'?'40':label==='ราคาต่อหน่วย (บาท)'?'1650':'2026-10-10');
 }cases++;
 await page.getByLabel('วันที่เปลี่ยนอะไหล่',{exact:true}).fill('2024-03-15');await page.getByLabel('จำนวนที่ใช้',{exact:true}).fill('1');await page.getByLabel('ผู้เปลี่ยน',{exact:true}).fill('ผู้เปลี่ยนใหม่');await page.getByLabel('สาเหตุการเปลี่ยน',{exact:true}).selectOption('planned');await page.getByLabel('หมายเหตุ',{exact:true}).fill('แก้ประวัติทดสอบ');
 assert.ok((await page.locator('output').textContent()).includes('1,650.00'));assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=375),true);
 await page.screenshot({path:'/tmp/mms037-edit-mobile.png',fullPage:true});
 await page.evaluate(()=>{window.__delay=100;const form=document.querySelector('form');form.requestSubmit();form.requestSubmit();});
 await page.getByText('แก้ไขประวัติการเปลี่ยนอะไหล่เรียบร้อยแล้ว',{exact:true}).waitFor();assert.equal(mutationCount(),mutations+1);
 const corrected=(await db.pool.query('select * from part_replacements where id=$1',[f.record])).rows[0];assert.equal(corrected.id,f.record);assert.equal(corrected.qty_used,1);assert.equal(corrected.total_cost,'1650.00');assert.equal(corrected.replaced_at,'2024-03-15');assert.equal(corrected.replaced_by,'ผู้เปลี่ยนใหม่');assert.equal(corrected.reason,'planned');assert.equal(corrected.notes,'แก้ประวัติทดสอบ');assert.equal(corrected.breakdown_id,f.breakdown);assert.equal(corrected.stock_deducted,true);
 await page.getByText('99 ชิ้น',{exact:true}).waitFor();await page.getByText('จำนวน: 1',{exact:true}).waitFor();await page.getByText('รวม: 1,650.00 บาท',{exact:true}).waitFor();await page.getByText('15/03/2024',{exact:true}).first().waitFor();cases++;
 await page.getByRole('button',{name:'ตารางเปลี่ยนอะไหล่',exact:true}).click();await page.getByRole('button',{name:/ปี 2024: 1 รายการ/}).waitFor();assert.equal(await page.getByRole('button',{name:/ปี 2026: 1 รายการ/}).count(),0);cases++;
 await page.goto(`${url}/machines/${f.machine}/report`);await page.waitForFunction(()=>document.getElementById('printable-report')?.dataset.printReady==='true');await page.getByRole('button',{name:'ทั้งหมด',exact:true}).click();await page.waitForFunction(()=>document.getElementById('printable-report')?.dataset.printReady==='true');
 assert.ok((await page.getByText('ต้นทุนบำรุงรักษารวม',{exact:true}).locator('..').textContent()).includes('1,750.00'));
 await page.pdf({path:'/tmp/mms037-edited-report.pdf',preferCSSPageSize:true,printBackground:true});
 const pdfText=execFileSync('python',['-c',"import fitz;d=fitz.open('/tmp/mms037-edited-report.pdf');print(''.join(p.get_text() for p in d))"],{encoding:'utf8'});
 assert.ok(pdfText.includes('1,750.00'));assert.ok(!pdfText.includes('66,000.00'));cases++;
 await page.context().close();
 // Same-section and other-section users can read history but cannot edit it.
 for(const actor of ['rel','gp']){page=await open(`/machines/${f.machine}?tab=parts&part=${f.part}`,actor);await page.getByText('รวม: 1,650.00 บาท',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:/^แก้ไขประวัติการเปลี่ยนอะไหล่วันที่/}).count(),0);await page.goto(url+editPath(f));await page.getByText('ไม่มีสิทธิ์ดำเนินการ',{exact:true}).waitFor();assert.equal(await save(page).count(),0);await page.context().close();cases++;}
 page=await open(editPath(f),'admin','missing');await page.getByText('ระบบยังไม่พร้อมสำหรับการแก้ไขประวัติ กรุณาติดต่อผู้ดูแลระบบ',{exact:false}).waitFor();assert.equal(await save(page).isDisabled(),true);assert.equal(mutationCount(),mutations+1);await page.context().close();cases++;
 // A gate that disappears after loading is rechecked before UPDATE.
 page=await open(editPath(f));await save(page).waitFor();await page.evaluate(()=>window.__readyOverride='false');await save(page).click();await page.getByText('ระบบยังไม่พร้อมสำหรับการแก้ไขประวัติ กรุณาติดต่อผู้ดูแลระบบ',{exact:false}).waitFor();assert.equal(mutationCount(),mutations+1);await page.context().close();cases++;
 page=await open(editPath(f));await save(page).waitFor();await db.pool.query("update part_replacements set notes='แก้พร้อมกัน' where id=$1",[f.record]);await page.getByLabel('จำนวนที่ใช้',{exact:true}).fill('2');await save(page).click();await page.getByText('ข้อมูลหรือสิทธิ์ถูกเปลี่ยนระหว่างแก้ไข กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง',{exact:true}).waitFor();assert.equal((await db.pool.query('select qty_used from part_replacements where id=$1',[f.record])).rows[0].qty_used,1);await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#replacement_notes')?.value==='แก้พร้อมกัน');assert.equal(await page.getByLabel('หมายเหตุ',{exact:true}).inputValue(),'แก้พร้อมกัน');cases++;await page.context().close();
 assert.deepEqual(errors,[]);console.log(`PASS: ${cases} real-database browser/PDF scenarios: admin edit, cancel/validation, single UPDATE, stock/schedule refresh, timeline/report totals, 375px, role access, readiness gate and stale forms.`);
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await db.stop();rmSync(temp,{recursive:true,force:true});}
