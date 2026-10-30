// Real Chromium PDFs of the actual machine report, with fixture-only Supabase.
// Prerequisites (outside checkout): npm install --prefix /tmp/mms033-tools --no-package-lock playwright esbuild
// Also requires Python PyMuPDF (fitz), pdftoppm and Thai system fonts.
// MMS033_TEST_TOOLS=/tmp/mms033-tools node scripts/check-machine-report-pdf.mjs
// PDF/PNG artifacts are retained in /tmp/mms036-pdfs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
const requireTools=createRequire(resolve(process.env.MMS033_TEST_TOOLS||'.','package.json'));
const {build}=requireTools('esbuild');
const {chromium}=requireTools('playwright');
const repo=process.cwd();
const temp=mkdtempSync(join(tmpdir(),'mms036-'));
const artifacts='/tmp/mms036-pdfs';mkdirSync(artifacts,{recursive:true});
const id='11111111-1111-4111-8111-111111111111';
const machine={id,machine_code:'TS-01',machine_name:'เครื่องทดสอบระบบซ่อมบำรุง',status:'active',location:'REL',install_date:'1998-04-30'};
const part={id:'p1',part_code:'P0001',part_name:'ชุดลูกปืนทดสอบ',default_lifespan_days:365,stock_tracking_enabled:false};
const replacement={id:'r1',machine_id:id,part_id:'p1',replaced_at:'2020-03-15',replaced_by:'ช่างทดสอบ',qty_used:2,unit_cost:'12.50',total_cost:'25.00',reason:'planned',spare_parts:part};
function fixture(count=12,installDate='1998-04-30') {
 const links=Array.from({length:count},(_,i)=>({id:`l${String(i).padStart(4,'0')}`,machine_id:id,part_id:`p${i+1}`,lifespan_override_days:null,schedule_disabled:false,next_due_date:i===0?'2026-10-29':null,
   spare_parts:{...part,id:`p${i+1}`,part_code:`P${String(i+1).padStart(4,'0')}`,part_name:i%4===3?'ชุดอะไหล่สำหรับเครื่องจักรทดสอบการทำงานต่อเนื่องพร้อมอุปกรณ์ควบคุมและสายส่งสัญญาณระยะยาว':`อะไหล่ทดสอบลำดับ ${i+1}`,default_lifespan_days:i===1?null:365}}));
 return {machine:{...machine,install_date:installDate},links,
 replacements:[replacement,{...replacement,id:'r2',replaced_at:'2020-06-30',reason:'breakdown'},replacement,
 {...replacement,id:'r3',replaced_at:'2026-10-20'},
 {...replacement,id:'r4',part_id:'unlinked',replaced_at:'2024-01-01',spare_parts:{...part,part_code:'Z-HISTORY',part_name:'อะไหล่ที่เลิกผูกกับเครื่องแล้ว'}},
 {...replacement,id:'future',replaced_at:'2030-01-01'}],
 breakdowns:[{id:'b1',machine_id:id,reported_at:'2026-10-01T08:00:00Z',symptom:'อาการทดสอบ',cause:'สาเหตุทดสอบ',action_taken:'ซ่อมทดสอบ',downtime_minutes:60,repair_cost:'100.00',technician:'ช่างหนึ่ง',operating_impact:'stopped',status:'closed',closure_outcome:'repaired'}],
 pmRecords:[{id:'pm1',machine_id:id,done_date:'2026-10-02',done_by:'ช่างสอง',pm_cost:'50.00',notes:'บันทึก PM ทดสอบ',checklist_result:[{ok:true}],pm_plans:{pm_name:'แผนทดสอบ'}}],
 pmPlans:[],queries:[],writes:0,cap:137};
}
const transport=`export const supabase={from(table){
 const q={table,columns:'',filters:[],dateFilters:[],notNull:[],cursor:null,limit:null,active:false};let signal;
 const c={select(s){q.columns=s;return c},eq(k,v){q.filters.push([k,v]);return c},
   gte(k,v){q.dateFilters.push([k,'gte',v]);return c},lte(k,v){q.dateFilters.push([k,'lte',v]);return c},lt(k,v){q.dateFilters.push([k,'lt',v]);return c},
   gt(k,v){q.cursor=[k,v];return c},order(){return c},limit(n){q.limit=n;return c},abortSignal(s){signal=s;return c},
   not(k,op,v){if(op==='is'&&v===null)q.notNull.push(k);return c},or(){q.active=true;return c},
   maybeSingle(){return execute()},then(a,b){return execute().then(a,b)},
   insert(){window.__db.writes++;throw Error('Mutation forbidden')},update(){window.__db.writes++;throw Error('Mutation forbidden')},delete(){window.__db.writes++;throw Error('Mutation forbidden')}
 };
 async function execute(){
  const db=window.__db;db.queries.push(JSON.parse(JSON.stringify(q)));
  if(q.limit&&db.timelineDelay)await new Promise(r=>setTimeout(r,db.timelineDelay));
  if(signal?.aborted)throw Error('Cancelled');
  if(q.limit&&db.timelineFailure)return {data:null,error:{message:'internal database details'}};
  if(table==='machines')return {data:db.machine,error:null};
  let rows=table==='machine_parts'?db.links:table==='part_replacements'?db.replacements:table==='breakdowns'?db.breakdowns:table==='pm_records'?db.pmRecords:db.pmPlans;
  rows=rows.filter(row=>q.filters.every(([k,v])=>row[k]===v)&&q.notNull.every(k=>row[k]!=null)&&q.dateFilters.every(([k,op,v])=>op==='gte'?row[k]>=v:op==='lte'?row[k]<=v:row[k]<v));
  if(q.active)rows=rows.filter(row=>['open','in_progress'].includes(row.status)||(row.closure_outcome==='not_repaired'&&!row.impact_cleared_at));
  if(q.limit){rows=[...rows].sort((a,b)=>a.id.localeCompare(b.id));if(q.cursor)rows=rows.filter(row=>row[q.cursor[0]]>q.cursor[1]);rows=rows.slice(0,Math.min(q.limit,db.cap));}
  return {data:JSON.parse(JSON.stringify(rows)),error:null};
 }
 return c;
}};`;
const inspectPdf=(path)=>JSON.parse(execFileSync('python',['-c',String.raw`
import fitz,json,sys
p=fitz.open(sys.argv[1]);out=[]
for page in p:
 words=page.get_text('words')
 out.append({'text':page.get_text(),'width':page.rect.width,'height':page.rect.height,
 'bad_bounds':[w[:4] for w in words if w[0]<30 or w[1]<30 or w[2]>page.rect.width-30 or w[3]>page.rect.height-30]})
print(json.dumps(out,ensure_ascii=False))`,path],{encoding:'utf8'}));
let browser;let server;const errors=[];let cases=0;
try {
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Page from './app/machines/[id]/report/page';createRoot(document.getElementById('root')).render(<Page/>);`,resolveDir:repo,loader:'tsx'},bundle:true,outfile:join(temp,'app.js'),jsx:'automatic',plugins:[{name:'fixture-only',setup(b){
   b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'mock'}));
   b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'supabase',namespace:'mock'}));
   b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='supabase'?transport:a.path==='next/navigation'?`export const useParams=()=>({id:'${id}'});`:`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`,resolveDir:repo,loader:'js'}));
 }}]});
 execFileSync(join(repo,'node_modules/.bin/tailwindcss'),['-i','app/globals.css','-o',join(temp,'app.css')],{stdio:'pipe'});
 server=createServer((req,res)=>{const file=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':null;res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');res.end(file?readFileSync(join(temp,file)):'<html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body class="bg-surface text-primary"><div id="root"></div><script src="/app.js"></script></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 async function open(db){const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'Asia/Bangkok'});await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.clock.setFixedTime(new Date('2026-10-30T05:00:00Z'));await page.addInitScript(db=>{window.__db=db;window.__printCalls=0;window.print=()=>window.__printCalls++;},db);await page.goto(url);return page;}
 const printButton=page=>page.getByRole('button',{name:'🖨 พิมพ์ / บันทึก PDF',exact:true});
 const ready=page=>page.waitForFunction(()=>document.getElementById('printable-report')?.dataset.printReady==='true');
 async function pdf(page,name){await page.evaluate(()=>document.fonts.ready);const file=join(artifacts,`${name}.pdf`);await page.pdf({path:file,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});return inspectPdf(file);}
 async function verifyOnePage(page,name,expectedYears){
  const hidden=await page.addStyleTag({content:'.parts-timeline-print-page { display:none !important; }'});
  const before=await pdf(page,`${name}-baseline`);await hidden.evaluate(el=>el.remove());
  const after=await pdf(page,name);
  assert.equal(after.length,before.length+1,`${name}: exactly one additional physical page`);
  assert.deepEqual(after.slice(0,-1).map(p=>p.text),before.map(p=>p.text),`${name}: original report pagination and text unchanged`);
  const last=after.at(-1);const compact=last.text.replace(/\s/g,'');
  assert.ok(compact.includes('ตารางเปลี่ยนอะไหล่ย้อนหลัง10ปี'),`${name}: Thai title on final page`);
  for(const year of expectedYears)assert.ok(last.text.includes(String(year)));
  assert.ok(last.text.includes('System Years'));
  for(const p of after){assert.ok(Math.abs(p.width-841.89)<1&&Math.abs(p.height-595.28)<1);assert.deepEqual(p.bad_bounds,[],`${name}: no clipped text`);}
  const path=join(artifacts,name);
  execFileSync('pdftoppm',['-f',String(after.length),'-singlefile','-scale-to','1800','-png',`${path}.pdf`,`${path}-last`],{stdio:'pipe'});
  console.log(`PASS ${name}: baseline ${before.length} pages → ${after.length}; final matrix 1 A4 landscape page; no clipped text.`);cases++;return last;
 }
 let page=await open(fixture());await ready(page);
 assert.equal(await printButton(page).isEnabled(),true);
 // Filter the main report to 2026; its matrix must still include 2020/2024.
 const timelineQueries=await page.evaluate(()=>window.__db.queries.filter(q=>q.limit).length);
 await page.locator('input[type="date"]').nth(0).fill('2026-01-01');await ready(page);
 assert.equal(await page.evaluate(()=>window.__db.queries.filter(q=>q.limit).length),timelineQueries);
 assert.equal(await page.locator('.parts-timeline-print-page').isVisible(),false);
 const appendix=page.locator('.parts-timeline-print-page');
 assert.equal(await appendix.locator('thead th').count(),12);
 const p1=appendix.locator('tbody tr').filter({hasText:'P0001'});
 assert.equal(await p1.locator('td').nth(3).textContent(),'○2'); // 2020, unique IDs despite duplicate fixture row.
 assert.equal(await p1.locator('td').nth(9).textContent(),'○'); // 2026.
 assert.equal(await appendix.getByText('Z-HISTORY',{exact:true}).count(),1);
 assert.equal(await appendix.getByText('ไม่กำหนดรอบ',{exact:true}).count(),1);
 const totalRow=page.getByText('ต้นทุนบำรุงรักษารวม',{exact:true}).locator('..');assert.ok((await totalRow.textContent()).includes('175.00'));
 const last=await verifyOnePage(page,'representative-12',Array.from({length:10},(_,i)=>2017+i));
 assert.ok(last.text.includes('○'));assert.ok(last.text.includes('P0012'));assert.ok(last.text.includes('Z-HISTORY'));
 await printButton(page).click();assert.equal(await page.evaluate(()=>window.__printCalls),1);
 assert.equal(await page.evaluate(()=>window.__db.writes),0);await page.context().close();
 for(const [name,count,installed,years] of [
   ['compact-24',24,'1998-04-30',Array.from({length:10},(_,i)=>2017+i)],
   ['installed-2022',8,'2022-01-01',[2022,2023,2024,2025,2026]],
   ['installed-2026',6,'2026-01-01',[2026]],
   ['missing-install',8,null,Array.from({length:10},(_,i)=>2017+i)],
   ['future-install',6,'2028-01-01',[]],
 ]){
   page=await open(fixture(count,installed));await ready(page);
   assert.equal(await page.locator('.parts-timeline-print-page thead th').count(),years.length+2);
   if(installed===null)assert.equal(await page.locator('.parts-timeline-print-page').getByText('ไม่ได้ระบุวันที่ติดตั้งเครื่องจักร',{exact:true}).count(),1);
   await verifyOnePage(page,name,years);assert.equal(await page.evaluate(()=>window.__db.writes),0);await page.context().close();
 }
 // Oversized datasets are explicit, readable and never clipped/truncated.
 page=await open(fixture(90));await ready(page);
 await page.getByRole('alert').filter({hasText:'ตารางเปลี่ยนอะไหล่มีข้อมูลมากเกินหนึ่งหน้า A4'}).waitFor();
 const big=await pdf(page,'oversized-90');assert.ok(big.at(-1).text.includes('Z-HISTORY'));assert.ok(big.length>3);
 const allText=big.map(p=>p.text).join('\n');
 for(let i=1;i<=90;i++)assert.ok(allText.includes(`P${String(i).padStart(4,'0')}`));
 for(const p of big){assert.deepEqual(p.bad_bounds,[]);assert.ok(p.text.trim().length>0);}
 assert.ok(big.some(p=>p.text.includes('ตารางเปลี่ยนอะไหล่ย้อนหลัง')));
 console.log(`PASS oversized-90: ${big.length} pages with visible overflow warning and final part retained.`);cases++;await page.context().close();
 // Timeline availability gates button AND native print/Ctrl+P output.
 page=await open({...fixture(),timelineDelay:700});
 await page.getByText('กำลังโหลดตารางเปลี่ยนอะไหล่สำหรับ PDF...',{exact:true}).waitFor();
 assert.equal(await printButton(page).isDisabled(),true);await ready(page);await page.context().close();cases++;
 page=await open({...fixture(),timelineFailure:true});
 await page.getByText('ไม่สามารถโหลดตารางเปลี่ยนอะไหล่สำหรับ PDF ได้ กรุณาลองใหม่ก่อนพิมพ์รายงาน',{exact:true}).waitFor();
 assert.equal(await printButton(page).isDisabled(),true);
 const blocked=await pdf(page,'blocked-error');assert.equal(blocked.length,1);assert.ok(blocked[0].text.replace(/\s/g,'').includes('ไม่สามารถพิมพ์รายงานได้'));
 assert.ok(!blocked[0].text.includes('P0001'));
 await page.evaluate(()=>window.__db.timelineFailure=false);await page.getByRole('button',{name:'ลองใหม่',exact:true}).click();await ready(page);
 assert.equal(await printButton(page).isEnabled(),true);await page.context().close();cases++;
 assert.deepEqual(errors,[]);console.log(`PASS: ${cases} PDF/readiness scenarios. Artifacts: ${artifacts}`);
} finally {await browser?.close();if(server)await new Promise(r=>server.close(r));rmSync(temp,{recursive:true,force:true});}
