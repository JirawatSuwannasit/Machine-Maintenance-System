// Local-only PostgreSQL harness. Never accepts a connection URL or Production credentials.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
const requireTools=createRequire(resolve(process.env.MMS037_TEST_TOOLS||'/tmp/mms037-tools','package.json'));
const {Client,Pool,types}=requireTools('pg');
types.setTypeParser(1082,value=>value);
export const actors={admin:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',rel:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gp:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
export async function startTestDatabase(){
 const bin=process.env.MMS037_PG_BIN||resolve(process.env.MMS037_TEST_TOOLS||'/tmp/mms037-tools','node_modules/@embedded-postgres/linux-x64/native/bin');
 const dir=mkdtempSync(join(tmpdir(),'mms037-postgres-'));const log=openSync(join(dir,'postgres.log'),'a');
 const portProbe=createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
 execFileSync(join(bin,'initdb'),['-D',join(dir,'data'),'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C'],{stdio:'pipe'});
 const processHandle=spawn(join(bin,'postgres'),['-D',join(dir,'data'),'-h','127.0.0.1','-p',String(port),'-k',dir,'-F'],{stdio:['ignore',log,log]});
 const config={host:'127.0.0.1',port,user:'postgres',database:'postgres',connectionTimeoutMillis:1000};
 let ready=false;
 for(let i=0;i<100;i++){const probe=new Client(config);try{await probe.connect();await probe.end();ready=true;break;}catch{await probe.end().catch(()=>{});await new Promise(r=>setTimeout(r,50));}}
 if(!ready){processHandle.kill('SIGTERM');throw Error('Local PostgreSQL did not start: '+readFileSync(join(dir,'postgres.log'),'utf8'));}
 const pool=new Pool({...config,max:8});
 async function stop(){await pool.end();await new Promise(r=>{if(processHandle.exitCode!==null)return r();processHandle.once('exit',r);processHandle.kill('SIGTERM');});closeSync(log);rmSync(dir,{recursive:true,force:true});}
 async function actorQuery(actor,sql,values=[]){const c=await pool.connect();try{await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actors[actor]]);const result=await c.query(sql,values);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
 try{
  await pool.query(`create role anon nologin;create role authenticated nologin;create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  for(const file of readdirSync('supabase/migrations').sort()){
   let sql=readFileSync(join('supabase/migrations',file),'utf8');
   if(file.startsWith('001_'))sql=sql.split('-- SAMPLE DATA')[0]+'commit;';
   await pool.query(sql);
  }
  await pool.query('grant usage on schema public to authenticated;grant select,insert,update,delete on all tables in schema public to authenticated');
  for(const [actor,id]of Object.entries(actors)){
   await pool.query('insert into auth.users(id,email) values($1,$2)',[id,`${actor}@local.test`]);
   await pool.query('update public.user_access set role=$2,section=$3 where user_id=$1',[id,actor==='admin'?'admin':'user',actor==='admin'?null:actor.toUpperCase()]);
  }
 }catch(e){await stop();throw e;}
 async function fixture({qty=40,price=1650,stockMode=true,days=365,override=null,disabled=false,date='2026-10-10',section='REL',linked=true}={}){
  const machine=randomUUID(),part=randomUUID(),breakdown=randomUUID(),record=randomUUID();
  await pool.query("insert into machines(id,machine_code,machine_name,location,install_date) values($1,$2,'เครื่องทดสอบ',$3,'1998-04-30')",[machine,`M-${machine}`,section]);
  await pool.query("insert into spare_parts(id,part_code,part_name,stock_qty,default_lifespan_days,stock_tracking_enabled) values($1,$2,'อะไหล่ทดสอบ',100,$3,$4)",[part,`P-${part}`,days,stockMode]);
  if(linked)await pool.query('insert into machine_parts(machine_id,part_id,lifespan_override_days,schedule_disabled) values($1,$2,$3,$4)',[machine,part,override,disabled]);
  await pool.query("insert into breakdowns(id,machine_id,symptom,status,closure_outcome,closed_at,repair_cost,reported_at) values($1,$2,'อาการทดสอบ','closed','repaired','2026-10-11T03:00:00Z',100,'2026-10-01T03:00:00Z')",[breakdown,machine]);
  await pool.query("insert into part_replacements(id,machine_id,part_id,breakdown_id,replaced_at,replaced_by,reason,qty_used,unit_cost,notes) values($1,$2,$3,$4,$5,'ผู้เปลี่ยนเดิม','breakdown',$6,$7,'หมายเหตุเดิม')",[record,machine,part,breakdown,date,qty,price]);
  return{machine,part,breakdown,record};
 }
 return{pool,actorQuery,fixture,stop,Client,config};
}
