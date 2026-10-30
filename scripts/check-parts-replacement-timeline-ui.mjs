// Offline integration test of the actual machine page, all tabs and Tailwind.
// All database calls use fixtures; external requests and mutations are forbidden.
// npm install --prefix /tmp/mms033-tools --no-package-lock playwright esbuild
// MMS033_TEST_TOOLS=/tmp/mms033-tools node scripts/check-parts-replacement-timeline-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
const requireTools=createRequire(resolve(process.env.MMS033_TEST_TOOLS || '.', 'package.json'));
const {build}=requireTools('esbuild');
const {chromium}=requireTools('playwright');
const repo=process.cwd();
const temp=mkdtempSync(join(tmpdir(),'mms033-'));
const machineId='11111111-1111-4111-8111-111111111111';
const machine={id:machineId,machine_code:'TS-01',machine_name:'เครื่องทดสอบ',status:'active',location:'REL',install_date:'1998-04-30'};
const part={id:'p1',part_code:'P1',part_name:'อะไหล่ทดสอบ',default_lifespan_days:365,stock_tracking_enabled:false,stock_qty:0,min_stock:0,unit_cost:10};
const link={id:'l1',machine_id:machineId,part_id:'p1',lifespan_override_days:null,schedule_disabled:false,next_due_date:'2026-10-29',spare_parts:part};
const replacement={id:'r1',machine_id:machineId,part_id:'p1',replaced_at:'2024-01-01',replaced_by:'ช่างหนึ่ง',qty_used:2,unit_cost:'12.50',total_cost:'25.00',reason:'planned',spare_parts:part};
const fixtures={machine,links:[link,{...link,id:'l2',part_id:'p2',next_due_date:null,spare_parts:{...part,id:'p2',part_code:'P2',part_name:'อะไหล่ยังไม่เคยเปลี่ยน',default_lifespan_days:null}}],replacements:[replacement,{...replacement,id:'r2',replaced_at:'2024-12-31',replaced_by:'ช่างสอง',reason:'breakdown'}, {...replacement,id:'r3',part_id:'p3',replaced_at:'2025-01-01',spare_parts:{...part,id:'p3',part_code:'P3',part_name:'อะไหล่เลิกผูก'}}, {...replacement,id:'future',replaced_at:'2027-01-01'}]};
const transport=`
export const supabase={from(table){
 const q={table,columns:'',filters:[],notNull:[],cursor:null,limit:null,orders:[]};
 let signal;
 const chain={
   select(s){q.columns=s;return chain},eq(k,v){q.filters.push([k,v]);return chain},
   gt(k,v){q.cursor=[k,v];return chain},order(k,o){q.orders.push([k,o]);return chain},
   limit(n){q.limit=n;return chain},abortSignal(s){signal=s;return chain},
   not(k,op,v){if(op==='is'&&v===null)q.notNull.push(k);return chain},or(){return chain},
   maybeSingle(){return execute()},then(a,b){return execute().then(a,b)},
   insert(){window.__db.writes++;throw Error('Mutation forbidden')},
   update(){window.__db.writes++;throw Error('Mutation forbidden')},
   delete(){window.__db.writes++;throw Error('Mutation forbidden')}
 };
 async function execute(){
   const db=window.__db;db.queries.push(JSON.parse(JSON.stringify(q)));
   if(db.delay)await new Promise(r=>setTimeout(r,db.delay));
   if(signal?.aborted)throw Error('Aborted');
   if(db.fail && table==='part_replacements' && (db.fail!=='later'||q.cursor))return {data:null,error:{message:'secret database error'}};
   if(table==='machines')return {data:db.machine,error:null};
   let rows=table==='machine_parts'?db.links:table==='part_replacements'?db.replacements:[];
   rows=rows.filter(row=>q.filters.every(([k,v])=>row[k]===v)&&q.notNull.every(k=>row[k]!=null));
   if(q.limit){
     rows=[...rows].sort((a,b)=>a.id.localeCompare(b.id));
     if(q.cursor)rows=rows.filter(r=>r[q.cursor[0]]>q.cursor[1]);
     rows=rows.slice(0,Math.min(q.limit,db.cap));
   }
   return {data:JSON.parse(JSON.stringify(rows)),error:null};
 }
 return chain;
}};`;
let browser;
let server;
const pageErrors=[];
let scenarios=0;
try {
 await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
   import Page from './app/machines/[id]/page';import {AccessProvider} from './components/AccessContext';
   import Timeline from './components/machine/PartsReplacementTimeline';
   function Host(){const [,render]=React.useState(0);window.__rerender=()=>render(n=>n+1);
     return location.pathname==='/component'?<Timeline machineId={window.__db.machine.id} installDate={window.__db.machine.install_date}/>:<Page/>;}
   createRoot(document.getElementById('root')).render(<AccessProvider access={{role:'user',section:'GP'}}><Host/></AccessProvider>);`,resolveDir:repo,loader:'tsx'},
   bundle:true,outfile:join(temp,'app.js'),jsx:'automatic',plugins:[{name:'offline',setup(b){
     b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'mock'}));
     b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'supabase',namespace:'mock'}));
     b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='supabase'?transport:a.path==='next/navigation'
       ? `export const useParams=()=>({id:'${machineId}'});export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push(){},refresh(){}});`
       : `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`,loader:'js',resolveDir:repo}));
   }}]});
 execFileSync(join(repo,'node_modules/.bin/tailwindcss'),['-i','app/globals.css','-o',join(temp,'app.css')],{stdio:'pipe'});
 server=createServer((req,res)=>{
   const file=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':null;
   res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');
   res.end(file?readFileSync(join(temp,file)):'<html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 async function open(overrides={},query='?tab=replacement_matrix',timezone='Asia/Bangkok'){
   const context=await browser.newContext({viewport:{width:375,height:812},timezoneId:timezone});
   await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
   const page=await context.newPage();
   page.setDefaultTimeout(10000);
   page.on('pageerror',e=>{pageErrors.push(e.message);console.error('Browser error:',e.message);});
   await page.clock.setFixedTime(new Date('2026-10-30T05:00:00Z'));
   await page.addInitScript(db=>{window.__db=db;Storage.prototype.setItem=()=>{throw Error('View preferences must not use browser storage');};},{...structuredClone(fixtures),queries:[],writes:0,cap:137,...overrides});
   await page.goto(url+query);
   return page;
 }
 const region=page=>page.getByRole('region',{name:'ตารางประวัติการเปลี่ยนอะไหล่',exact:true});
 const cell= (page,code,year)=>page.getByRole('button',{name:`${code} ปี ${year}: 2 รายการ`,exact:true});
 let page=await open();await region(page).waitFor().catch(async error=>{console.error(await page.locator('body').innerText());console.error(await page.evaluate(()=>window.__db.queries));throw error;});
 const names=await page.getByRole('button').allTextContents();
 assert.ok(names.indexOf('ตารางเปลี่ยนอะไหล่')===names.indexOf('อะไหล่')+1);
 const headers=await page.locator('table thead th').allTextContents();
 assert.deepEqual(headers,['อะไหล่',...Array.from({length:11},(_,i)=>String(2017+i)),'คำแนะนำ']);
 const ages=await page.locator('table tbody tr').first().locator('td').allTextContents();
 assert.equal(ages[7],'26');assert.equal(ages[9],'28');assert.equal(ages[10],'29');
 assert.equal(await page.getByText('P2',{exact:true}).count(),1);
 assert.equal(await page.getByText('P3',{exact:true}).count(),1);
 assert.equal(await page.getByText('ไม่กำหนดรอบ',{exact:true}).count(),1);
 assert.equal(await page.getByText('ไม่ได้ผูกกับเครื่องแล้ว',{exact:true}).count(),1);
 assert.equal(await page.getByText('แนะนำเปลี่ยน',{exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:/ปี 2027:/}).count(),0);
 assert.equal(await page.getByRole('button',{name:/ปี 2023:/}).count(),0);scenarios++;
 await cell(page,'P1',2024).click();
 const details=page.getByRole('region',{name:'รายละเอียดการเปลี่ยนอะไหล่',exact:true});
 assert.equal(await details.locator('li').count(),2);
 for(const text of ['01/01/2024','31/12/2024','ช่างหนึ่ง','ช่างสอง','25.00 บาท','ตามรอบ','เครื่องเสีย'])assert.ok((await details.getByText(text,{exact:true}).count())>0);
 assert.equal(await cell(page,'P1',2024).getAttribute('aria-expanded'),'true');
 await page.getByRole('button',{name:'ปิดรายละเอียด',exact:true}).click();
 assert.equal(await details.isVisible(),false);scenarios++;
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=375),true);
 await region(page).evaluate(el=>el.scrollLeft=el.scrollWidth);
 const sticky=await page.getByText('P1',{exact:true}).boundingBox();
 assert.ok(sticky.x>=0 && sticky.x+sticky.width<=375);
 assert.ok(await region(page).evaluate(el=>el.scrollWidth>el.clientWidth));
 await region(page).evaluate(el=>el.scrollLeft=0);
 await region(page).scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/mms033-mobile.png'});scenarios++;
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'/tmp/mms033-desktop.png'});
 await page.getByRole('button',{name:'ช่วงปีก่อนหน้า',exact:true}).click();
 assert.equal(await page.locator('table thead th').nth(1).textContent(),'2006');
 await page.getByRole('button',{name:'ช่วงปีถัดไป',exact:true}).click();
 assert.equal(await page.locator('table thead th').nth(1).textContent(),'2017');
 await page.getByRole('button',{name:'ช่วงปีถัดไป',exact:true}).click();
 assert.equal(await page.locator('table thead th').nth(1).textContent(),'2028');
 assert.equal(await region(page).getByRole('button').count(),0);
 await page.getByRole('button',{name:'กลับช่วงปีปัจจุบัน',exact:true}).click();
 assert.equal(await page.locator('table thead th').nth(1).textContent(),'2017');scenarios++;
 // Existing tabs retain their real components and can still load.
 for(const [tab,text] of [['ประวัติเสีย','ยังไม่มีประวัติการเสีย'],['ประวัติ PM','ยังไม่มีประวัติการทำ PM'],['อะไหล่','P1']]){
   await page.getByRole('button',{name:tab,exact:true}).click();
   await page.getByText(text,{exact:true}).first().waitFor();
 }
 await page.getByRole('button',{name:'ตารางเปลี่ยนอะไหล่',exact:true}).click();await region(page).waitFor();scenarios++;
 assert.equal(await page.evaluate(()=>window.__db.writes),0);
 const queries=await page.evaluate(()=>window.__db.queries.filter(q=>q.limit));
 assert.ok(queries.every(q=>q.filters.some(([k,v])=>k==='machine_id'&&v===machineId)));
 assert.ok(queries.every(q=>q.orders[0][0]==='id'));scenarios++;
 await page.context().close();

 page=await open({machine:{...machine,install_date:null}});await region(page).waitFor();
 await page.getByText('ยังไม่ได้ระบุวันที่ติดตั้งเครื่องจักร',{exact:false}).waitFor();
 assert.ok((await page.locator('table tbody tr').first().locator('td').allTextContents()).slice(0,11).every(t=>t==='-'));
 assert.equal(await cell(page,'P1',2024).count(),1);scenarios++;
 await page.context().close();
 page=await open({machine:{...machine,install_date:'2020-12-31'}});await region(page).waitFor();
 const newer=await page.locator('table tbody tr').first().locator('td').allTextContents();
 assert.equal(newer[0],'-');assert.equal(newer[3],'0');assert.equal(newer[9],'6');scenarios++;
 await page.context().close();
 page=await open({links:[],replacements:[]});await page.getByText('เครื่องนี้ยังไม่มีอะไหล่ที่ผูกไว้หรือประวัติการเปลี่ยนอะไหล่',{exact:true}).waitFor();scenarios++;
 await page.context().close();
 page=await open({replacements:[]});await region(page).waitFor();
 await page.getByText('ยังไม่มีประวัติการเปลี่ยนอะไหล่ที่เกิดขึ้นแล้ว',{exact:true}).waitFor();
 assert.equal(await region(page).getByRole('button').count(),0);scenarios++;
 await page.context().close();
 page=await open({machine:null});await page.getByText('ไม่พบเครื่องจักรนี้',{exact:true}).waitFor();
 assert.equal(await region(page).count(),0);scenarios++;
 await page.context().close();
 page=await open({fail:true});await page.getByText('ไม่สามารถโหลดตารางเปลี่ยนอะไหล่ได้ กรุณาลองใหม่อีกครั้ง',{exact:true}).waitFor();
 assert.equal(await page.getByText('secret database error',{exact:true}).count(),0);
 await page.evaluate(()=>window.__db.fail=false);
 await page.getByRole('button',{name:'ลองใหม่',exact:true}).click();await region(page).waitFor();scenarios++;
 await page.context().close();
 page=await open({delay:100});await page.getByText('กำลังโหลดตารางเปลี่ยนอะไหล่...',{exact:true}).waitFor();await region(page).waitFor();scenarios++;
 await page.context().close();
 // More than the usual 1000-row cap, with a smaller server cap than requested.
 const longHistory=Array.from({length:1205},(_,i)=>({...replacement,id:`r${String(i).padStart(6,'0')}`}));
 page=await open({links:[link],replacements:[...longHistory,{...replacement,id:'other-machine',machine_id:'another-machine'}],cap:137});
 await region(page).waitFor();
 await page.getByRole('button',{name:'P1 ปี 2024: 1205 รายการ',exact:true}).click();
 assert.equal(await page.getByRole('region',{name:'รายละเอียดการเปลี่ยนอะไหล่',exact:true}).locator('li').count(),1205);
 const pages=await page.evaluate(()=>window.__db.queries.filter(q=>q.table==='part_replacements'));
 assert.equal(pages.length,10);assert.equal(await page.evaluate(()=>window.__db.writes),0);scenarios++;
 await page.context().close();
 page=await open({links:[link],replacements:longHistory,cap:137,fail:'later'});
 await page.getByText('ไม่สามารถโหลดตารางเปลี่ยนอะไหล่ได้ กรุณาลองใหม่อีกครั้ง',{exact:true}).waitFor();
 assert.equal(await region(page).count(),0);scenarios++;
 await page.context().close();
 page=await open({},'?tab=replacement_matrix','America/Los_Angeles');await region(page).waitFor();
 assert.equal(await cell(page,'P1',2024).count(),1);assert.equal(await page.getByRole('button',{name:/P1 ปี 2023/}).count(),0);scenarios++;
 await page.context().close();
 page=await open({},'?tab=pm');await page.getByText('ยังไม่มีประวัติการทำ PM',{exact:true}).waitFor();scenarios++;
 await page.context().close();

 // MMS-034: custom ranges and frontend-only part visibility.
 page=await open();await region(page).waitFor();
 const queryCount=await page.evaluate(()=>window.__db.queries.length);
 const start=page.getByRole('spinbutton',{name:'ปีเริ่มต้น',exact:true});
 const end=page.getByRole('spinbutton',{name:'ปีสิ้นสุด',exact:true});
 const picker=page.getByRole('group',{name:'อะไหล่ที่แสดงในตาราง',exact:true});
 const search=page.getByRole('searchbox',{name:'ค้นหารหัสหรือชื่ออะไหล่',exact:true});
 const tableRows=page.locator('table tbody tr');
 const rowFor=code=>tableRows.filter({has:page.getByText(code,{exact:true})});
 const option=code=>picker.getByRole('checkbox',{name:new RegExp('^'+code+' —')});
 assert.equal(await start.inputValue(),'2017');assert.equal(await end.inputValue(),'2027');
 await page.getByText('เลือกแล้ว 3 / 3 รายการ',{exact:true}).waitFor();
 await page.getByRole('button',{name:'เลือกอะไหล่ที่แสดง',exact:true}).click();
 assert.equal(await picker.getByRole('checkbox').count(),3);
 for(const checkbox of await picker.getByRole('checkbox').all())assert.equal(await checkbox.isChecked(),true);
 await option('P2').uncheck();
 assert.equal(await rowFor('P2').count(),0);assert.equal(await rowFor('P1').count(),1);assert.equal(await rowFor('P3').count(),1);
 await page.getByText('เลือกแล้ว 2 / 3 รายการ',{exact:true}).waitFor();scenarios++;
 await search.fill('p3');assert.equal(await picker.getByRole('checkbox').count(),1);
 assert.equal(await option('P3').isChecked(),true);
 await option('P3').uncheck();
 await search.fill('ยังไม่เคย');assert.equal(await picker.getByRole('checkbox').count(),1);
 assert.equal(await option('P2').isChecked(),false);await option('P2').check();
 await search.fill('not-a-part');await page.getByText('ไม่พบอะไหล่ที่ตรงกับคำค้น',{exact:true}).waitFor();
 assert.equal(await tableRows.count(),3); // System Years + P1 + P2, unaffected by search.
 await search.fill('');assert.equal(await option('P3').isChecked(),false);scenarios++;
 await start.fill('2010');await end.fill('2026');
 assert.equal(await page.locator('table thead th').count(),19);
 assert.equal(await page.locator('table thead th').nth(1).textContent(),'2010');
 assert.equal(await page.locator('table thead th').nth(17).textContent(),'2026');
 let customAges=await tableRows.first().locator('td').allTextContents();
 assert.equal(customAges[0],'12');assert.equal(customAges[16],'28');
 assert.equal(await option('P3').isChecked(),false);assert.equal(await rowFor('P3').count(),0);
 assert.equal(await page.getByText('แนะนำเปลี่ยน',{exact:true}).count(),1);scenarios++;
 await start.fill('2024');
 assert.equal(await page.locator('table thead th').count(),5);
 assert.equal(await page.locator('table').evaluate(el=>el.style.minWidth),'528px');
 assert.deepEqual((await tableRows.first().locator('td').allTextContents()).slice(0,3),['26','27','28']);
 await cell(page,'P1',2024).click();
 assert.equal(await page.getByRole('region',{name:'รายละเอียดการเปลี่ยนอะไหล่',exact:true}).isVisible(),true);
 await start.fill('2025');
 assert.equal(await page.getByRole('region',{name:'รายละเอียดการเปลี่ยนอะไหล่',exact:true}).isVisible(),false);
 await start.fill('2024');
 assert.equal(await page.getByRole('region',{name:'รายละเอียดการเปลี่ยนอะไหล่',exact:true}).isVisible(),false);scenarios++;
 await cell(page,'P1',2024).click();await option('P1').uncheck();
 assert.equal(await page.getByRole('region',{name:'รายละเอียดการเปลี่ยนอะไหล่',exact:true}).isVisible(),false);
 assert.equal(await rowFor('P1').count(),0);await option('P1').check();
 assert.equal(await page.getByRole('region',{name:'รายละเอียดการเปลี่ยนอะไหล่',exact:true}).isVisible(),false);scenarios++;
 for(const [field,value,text] of [[start,'','กรุณาระบุปี ค.ศ.'],[start,'2024.5','กรุณาระบุปี ค.ศ.'],[end,'2023','ปีสิ้นสุดต้องไม่น้อยกว่าปีเริ่มต้น'],[start,'1996','เลือกช่วงปีได้ไม่เกิน 30 ปี']]){
   await field.fill(value);await page.getByRole('alert').filter({hasText:text}).waitFor();
   assert.equal(await page.locator('table thead th').nth(1).textContent(),'2024');
   assert.equal(await page.locator('table thead th').count(),5);
   assert.equal(await page.getByRole('button',{name:'ช่วงปีถัดไป',exact:true}).isDisabled(),true);
   assert.equal(await option('P3').isChecked(),false);
   await field.fill(field===start?'2024':'2026');
 }
 assert.equal(await page.getByRole('alert').count(),0);scenarios++;
 await page.getByRole('button',{name:'ช่วงปีก่อนหน้า',exact:true}).click();
 assert.equal(await start.inputValue(),'2021');assert.equal(await end.inputValue(),'2023');
 await page.getByRole('button',{name:'ช่วงปีถัดไป',exact:true}).click();
 assert.equal(await start.inputValue(),'2024');assert.equal(await end.inputValue(),'2026');
 await page.getByRole('button',{name:'ช่วงปีถัดไป',exact:true}).click();
 assert.equal(await start.inputValue(),'2027');assert.equal(await end.inputValue(),'2029');
 assert.equal(await region(page).getByRole('button').count(),0);
 await page.getByRole('button',{name:'กลับช่วงปีปัจจุบัน',exact:true}).click();
 assert.equal(await start.inputValue(),'2017');assert.equal(await end.inputValue(),'2027');
 assert.equal(await option('P3').isChecked(),false);scenarios++;
 await end.fill('2029');await start.fill('2000');
 assert.equal(await page.locator('table thead th').count(),32);
 assert.equal(await page.locator('table').evaluate(el=>el.style.minWidth),'2256px');
 const inputBox=await start.boundingBox();const endBox=await end.boundingBox();const searchBox=await search.boundingBox();
 for(const box of [inputBox,endBox,searchBox])assert.ok(box.x>=0&&box.x+box.width<=375&&box.height>=44);
 for(const checkbox of await picker.getByRole('checkbox').all())assert.ok((await checkbox.locator('..').boundingBox()).height>=44);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=375),true);
 await region(page).evaluate(el=>el.scrollLeft=el.scrollWidth);
 const fixedName=await region(page).getByText('P1',{exact:true}).boundingBox();assert.ok(fixedName.x>=0&&fixedName.x+fixedName.width<=375);
 await region(page).evaluate(el=>el.scrollLeft=0);
 await page.getByRole('button',{name:'เลือกอะไหล่ที่แสดง',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/mms034-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'/tmp/mms034-desktop.png',fullPage:true});scenarios++;
 await page.getByRole('button',{name:'ล้างการเลือก',exact:true}).click();
 assert.equal(await tableRows.count(),1);
 await page.getByText('ยังไม่ได้เลือกอะไหล่ กรุณาเลือกอะไหล่ที่ต้องการแสดง',{exact:true}).waitFor();
 assert.equal(await page.getByText('เครื่องนี้ยังไม่มีอะไหล่ที่ผูกไว้หรือประวัติการเปลี่ยนอะไหล่',{exact:true}).count(),0);
 await page.getByText('เลือกแล้ว 0 / 3 รายการ',{exact:true}).waitFor();
 await page.getByRole('button',{name:'กลับช่วงปีปัจจุบัน',exact:true}).click();assert.equal(await tableRows.count(),1);scenarios++;
 await search.fill('P3');await page.getByRole('button',{name:'เลือกทั้งหมด',exact:true}).click();
 assert.equal(await tableRows.count(),4);await page.getByText('เลือกแล้ว 3 / 3 รายการ',{exact:true}).waitFor();
 assert.equal(await search.inputValue(),'P3');await search.fill('');
 await page.getByRole('button',{name:'ล้างการเลือก',exact:true}).click();await option('P3').check();
 assert.equal(await tableRows.count(),2);assert.equal(await rowFor('P3').count(),1);
 assert.equal(await page.getByText('ไม่ได้ผูกกับเครื่องแล้ว',{exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'P3 ปี 2025: 1 รายการ',exact:true}).count(),1);
 assert.equal(await page.evaluate(()=>window.__db.queries.length),queryCount);
 assert.equal(await page.evaluate(()=>window.__db.writes),0);scenarios++;
 await page.reload();await region(page).waitFor();await page.getByText('เลือกแล้ว 3 / 3 รายการ',{exact:true}).waitFor();scenarios++;
 await page.context().close();
 // Exercise prop changes on the actual component without the machine page's remount key.
 page=await open({},'/component');await region(page).waitFor();
 await page.getByRole('button',{name:'เลือกอะไหล่ที่แสดง',exact:true}).click();
 await page.getByRole('button',{name:'ล้างการเลือก',exact:true}).click();
 await page.getByRole('searchbox',{name:'ค้นหารหัสหรือชื่ออะไหล่',exact:true}).fill('P3');
 const nextId='22222222-2222-4222-8222-222222222222';
 await page.evaluate(({nextId,link,part})=>{
   window.__db.machine.id=nextId;
   window.__db.links=[{...link,machine_id:nextId,spare_parts:{...part,part_name:'เครื่องใหม่'}}];
   window.__db.replacements=[];window.__rerender();
 },{nextId,link,part});
 await page.getByText('เลือกแล้ว 1 / 1 รายการ',{exact:true}).waitFor();
 assert.equal(await region(page).getByText('เครื่องใหม่',{exact:true}).count(),1);
 await page.getByRole('button',{name:'เลือกอะไหล่ที่แสดง',exact:true}).click();
 assert.equal(await page.getByRole('searchbox',{name:'ค้นหารหัสหรือชื่ออะไหล่',exact:true}).inputValue(),'');
 assert.equal(await page.getByRole('checkbox').isChecked(),true);assert.equal(await page.evaluate(()=>window.__db.writes),0);scenarios++;
 await page.context().close();
 assert.deepEqual(pageErrors,[]);
 console.log(`PASS: ${scenarios} browser scenarios including MMS-033 regressions, custom ranges, part visibility, machine changes and 375px layout.`);
} finally {
 await browser?.close();
 if(server)await new Promise(r=>server.close(r));
 rmSync(temp,{recursive:true,force:true});
}
