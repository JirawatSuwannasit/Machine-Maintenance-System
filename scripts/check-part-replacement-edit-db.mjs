// Prerequisites outside checkout:
// npm install --prefix /tmp/mms037-tools --no-package-lock pg @embedded-postgres/linux-x64@17.10.0-beta.17
// Run: node scripts/check-part-replacement-edit-db.mjs
// Initializes a NEW local PostgreSQL cluster and applies migrations only there.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startTestDatabase,actors } from './lib/part-replacement-test-db.mjs';
const db=await startTestDatabase();let cases=0;
const q=(s,v=[])=>db.pool.query(s,v);
const one=async(s,v=[])=>(await q(s,v)).rows[0];
const stock=async f=>(await one('select stock_qty from spare_parts where id=$1',[f.part])).stock_qty;
const row=async f=>one('select * from part_replacements where id=$1',[f.record]);
const schedule=async f=>one('select last_replaced_at,next_due_date from machine_parts where machine_id=$1 and part_id=$2',[f.machine,f.part]);
try{
 // Idempotent DDL and no migration backfill.
 const first=await db.fixture();const original=await row(first);const originalStock=await stock(first);
 await q(readFileSync('supabase/migrations/015_mms_037_part_replacement_history_update.sql','utf8'));
 assert.deepEqual(await row(first),original);assert.equal(await stock(first),originalStock);cases++;
 let f=first;await db.actorQuery('admin','update part_replacements set qty_used=30 where id=$1',[f.record]);assert.equal(await stock(f),70);assert.equal((await row(f)).id,f.record);cases++;
 f=await db.fixture({qty:10});await q('update part_replacements set qty_used=15 where id=$1',[f.record]);assert.equal(await stock(f),85);cases++;
 f=await db.fixture({stockMode:false});await q('update part_replacements set qty_used=30 where id=$1',[f.record]);assert.equal(await stock(f),100);assert.equal((await row(f)).stock_deducted,false);
 await q('update spare_parts set stock_tracking_enabled=true where id=$1',[f.part]);await q('update part_replacements set qty_used=50 where id=$1',[f.record]);assert.equal(await stock(f),100);cases++;
 f=await db.fixture();await q('update spare_parts set stock_tracking_enabled=false where id=$1',[f.part]);await q('update part_replacements set qty_used=30 where id=$1',[f.record]);assert.equal(await stock(f),70);assert.equal((await row(f)).stock_deducted,true);
 await q('delete from part_replacements where id=$1',[f.record]);assert.equal(await stock(f),100);cases++;
 f=await db.fixture({qty:10});await q('update part_replacements set qty_used=150 where id=$1',[f.record]);assert.equal(await stock(f),-50);await q('delete from part_replacements where id=$1',[f.record]);assert.equal(await stock(f),100);cases++;
 f=await db.fixture();const breakdownBefore=await one('select * from breakdowns where id=$1',[f.breakdown]);
 await q("update part_replacements set qty_used=1,unit_cost=1650,replaced_by='ผู้เปลี่ยนใหม่',reason='planned',notes='แก้หมายเหตุ' where id=$1",[f.record]);
 const corrected=await row(f);assert.equal(corrected.total_cost,'1650.00');assert.equal(await stock(f),99);assert.equal(corrected.replaced_by,'ผู้เปลี่ยนใหม่');assert.equal(corrected.notes,'แก้หมายเหตุ');assert.equal(corrected.reason,'planned');assert.equal(corrected.breakdown_id,f.breakdown);assert.deepEqual(await one('select * from breakdowns where id=$1',[f.breakdown]),breakdownBefore);
 assert.equal((await one('select (select sum(total_cost) from part_replacements where machine_id=$1)+(select sum(repair_cost) from breakdowns where machine_id=$1) as cost',[f.machine])).cost,'1750.00');cases++;
 await q('update part_replacements set unit_cost=2000 where id=$1',[f.record]);assert.equal((await row(f)).total_cost,'2000.00');assert.equal(await stock(f),99);cases++;
 f=await db.fixture({qty:1,date:'2022-05-01'});
 await q("insert into part_replacements(machine_id,part_id,replaced_at,qty_used) values($1,$2,'2023-03-27',1),($1,$2,'2025-02-04',1)",[f.machine,f.part]);
 await q("update part_replacements set replaced_at='2022-06-01' where id=$1",[f.record]);assert.equal((await schedule(f)).last_replaced_at,'2025-02-04');cases++;
 const latest=(await one("select id from part_replacements where machine_id=$1 and replaced_at='2025-02-04'",[f.machine])).id;
 await q("update part_replacements set replaced_at='2026-03-01' where id=$1",[latest]);assert.equal((await schedule(f)).last_replaced_at,'2026-03-01');cases++;
 await q("update part_replacements set replaced_at='2020-01-01' where id=$1",[latest]);assert.equal((await schedule(f)).last_replaced_at,'2023-03-27');assert.equal((await schedule(f)).next_due_date,'2024-03-26');cases++;
 for(const settings of [{days:null},{disabled:true},{override:10}]){
  f=await db.fixture(settings);await q("update part_replacements set replaced_at='2025-02-04' where id=$1",[f.record]);assert.equal((await schedule(f)).last_replaced_at,'2025-02-04');assert.equal((await schedule(f)).next_due_date,settings.override?'2025-02-14':null);cases++;
 }
 f=await db.fixture({linked:false});await q("update part_replacements set replaced_at='2024-01-01',qty_used=30 where id=$1",[f.record]);assert.equal(await stock(f),70);cases++;
 for(const change of ["id=gen_random_uuid()","machine_id=gen_random_uuid()","part_id=gen_random_uuid()","stock_deducted=false","created_at=now()","breakdown_id=null","unit_cost=-1","qty_used=0"]){
  const before=await row(f);const s=await stock(f);await assert.rejects(q(`update part_replacements set ${change} where id=$1`,[f.record]));assert.deepEqual(await row(f),before);assert.equal(await stock(f),s);
 }cases++;
 // Preserve the existing FK ON DELETE SET NULL, not arbitrary reassignment.
 await q('delete from breakdowns where id=$1',[f.breakdown]);assert.equal((await row(f)).breakdown_id,null);cases++;
 f=await db.fixture();
 for(const actor of ['rel','gp']){
  assert.equal((await db.actorQuery(actor,'select id from part_replacements where id=$1',[f.record])).rowCount,1);
  assert.equal((await db.actorQuery(actor,'update part_replacements set qty_used=30 where id=$1',[f.record])).rowCount,0);
  assert.equal((await db.actorQuery(actor,'select part_replacement_history_edit_ready() as ready')).rows[0].ready,false);
 }assert.equal(await stock(f),60);assert.equal((await db.actorQuery('admin','select part_replacement_history_edit_ready() as ready')).rows[0].ready,true);cases++;
 await q('alter table part_replacements disable trigger trg_part_replacements_after_update');assert.equal((await db.actorQuery('admin','select part_replacement_history_edit_ready() as ready')).rows[0].ready,false);await q('alter table part_replacements enable trigger trg_part_replacements_after_update');cases++;
 // Concurrent updates use separate real connections, not simulated sequencing.
 async function overlap(firstSql,firstParams,secondSql,secondParams){
  const a=await db.pool.connect(),b=await db.pool.connect();try{
   await a.query('begin');await a.query(firstSql,firstParams);
   const second=b.query(secondSql,secondParams);
   await new Promise(r=>setTimeout(r,80));await a.query('commit');return await second;
  }finally{await a.query('rollback');a.release();b.release();}
 }
 f=await db.fixture({qty:40});const other=(await one("insert into part_replacements(machine_id,part_id,replaced_at,qty_used) values($1,$2,'2025-01-01',10) returning id",[f.machine,f.part])).id;
 await overlap('update part_replacements set qty_used=30 where id=$1',[f.record],'update part_replacements set qty_used=15 where id=$1',[other]);assert.equal(await stock(f),55);cases++;
 f=await db.fixture();await overlap('update part_replacements set qty_used=30 where id=$1',[f.record],'update part_replacements set qty_used=15 where id=$1',[f.record]);assert.equal(await stock(f),85);cases++;
 f=await db.fixture();const stale=await overlap('update part_replacements set qty_used=30 where id=$1',[f.record],'update part_replacements set qty_used=15 where id=$1 and qty_used=40 returning id',[f.record]);assert.equal(stale.rowCount,0);assert.equal(await stock(f),70);cases++;
 f=await db.fixture({qty:1,date:'2022-01-01'});const d2=(await one("insert into part_replacements(machine_id,part_id,replaced_at,qty_used) values($1,$2,'2023-01-01',1) returning id",[f.machine,f.part])).id;
 await overlap("update part_replacements set replaced_at='2025-01-01' where id=$1",[f.record],"update part_replacements set replaced_at='2024-01-01' where id=$1",[d2]);assert.equal((await schedule(f)).last_replaced_at,'2025-01-01');cases++;
 // MMS-029/030 still use DELETE+INSERT for changed breakdown part lines.
 f=await db.fixture();const legacy=await db.pool.connect();try{await legacy.query('begin');await legacy.query('delete from part_replacements where id=$1',[f.record]);await legacy.query("insert into part_replacements(machine_id,part_id,breakdown_id,replaced_at,qty_used,unit_cost) values($1,$2,$3,'2026-10-10',30,1650)",[f.machine,f.part,f.breakdown]);await legacy.query('commit');}finally{legacy.release();}assert.equal(await stock(f),70);assert.equal((await schedule(f)).last_replaced_at,'2026-10-10');cases++;
 console.log(`PASS: ${cases} PostgreSQL 17 scenarios, including all migrations, RLS, stock snapshots, schedules, immutable IDs, rollback and real concurrent transactions.`);
}finally{await db.stop();}
