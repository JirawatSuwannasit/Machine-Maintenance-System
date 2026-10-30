// Run: node scripts/check-part-replacement-edit.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const cache=new Map();
function load(path){const file=resolve(path);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const{outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}});vm.runInNewContext(outputText,{exports,Date,require:name=>load((name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(file),name))+'.ts')});return exports;}
const{validateReplacementEdit,replacementEditValues,replacementEditPayload}=load('lib/partReplacementEdit.ts');
const original={replaced_at:'2024-02-29',replaced_by:null,qty_used:40,unit_cost:'1650.00',reason:'breakdown',notes:'  historical spacing  '};
const valid=replacementEditValues(original);const now=new Date(2026,9,30,12);let cases=0;
assert.equal(Object.keys(validateReplacementEdit(valid,now)).length,0);cases++;
for(const [field,values]of Object.entries({replaced_at:['','2024-02-30','2023-02-29','2099-01-01'],qty_used:['','0','-1','1.2','Infinity','2147483648'],unit_cost:['','-1','1.234','Infinity','10000000000','1e3'],reason:['other']}))for(const value of values){assert.ok(validateReplacementEdit({...valid,[field]:value},now)[field]);cases++;}
assert.ok(validateReplacementEdit({...valid,qty_used:'2147483647',unit_cost:'9999999999.99'},now).unit_cost);cases++;
const payload=replacementEditPayload({...valid,qty_used:'1'},original);
assert.deepEqual(Object.keys(payload).sort(),['notes','qty_used','reason','replaced_at','replaced_by','unit_cost']);assert.equal(payload.replaced_by,null);assert.equal(payload.notes,original.notes);assert.equal(payload.qty_used,1);assert.equal(payload.unit_cost,'1650.00');cases++;
for(const timezone of ['UTC','Asia/Bangkok','America/Los_Angeles']){const saved=process.env.TZ;process.env.TZ=timezone;assert.equal(Object.keys(validateReplacementEdit(valid,new Date(2026,9,30,12))).length,0);if(saved===undefined)delete process.env.TZ;else process.env.TZ=saved;cases++;}
console.log(`PASS: ${cases} edit validation/payload cases, including dates, integer quantities, exact money limits and immutable-field exclusion.`);
