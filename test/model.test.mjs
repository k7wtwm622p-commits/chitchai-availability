import test from 'node:test';
import assert from 'node:assert/strict';
import {tokyoDate,nextDate,slotISO,readDay,errorSnapshot,validateSnapshot,preserveLastKnown} from '../collector/model.mjs';
const now=Date.parse('2026-10-29T19:00:20+09:00');
test('Tokyo date, month rollover, midnight and 24+ hour labels',()=>{
 assert.equal(tokyoDate(new Date('2026-10-29T16:00:00Z')),'2026-10-30');
 assert.equal(nextDate('2026-10-31',1),'2026-11-01');
 assert.equal(slotISO('2026-10-31','24:10'),'2026-11-01T00:10:00+09:00');
 assert.throws(()=>slotISO('2026-10-29','19:75'));
});
test('unloaded/ambiguous results and expired starts never become bookable',()=>{
 assert.throws(()=>readDay({ready:false,times:['20:00']},'2026-10-29',now));
 assert.throws(()=>readDay({ready:true,times:[]},'2026-10-29',now));
 assert.throws(()=>readDay({ready:true,times:['18:00']},'2026-10-29',now));
 assert.equal(readDay({ready:true,times:[],noTimeMessage:'予約受付\nできません'},'2026-10-29',now).status,'none');
 assert.deepEqual(readDay({ready:true,times:['20:00','18:00','20:00']},'2026-10-29',now).slots,['2026-10-29T20:00:00+09:00']);
});
test('snapshot rejects visitor/selection mixups and incomplete empty ranges',()=>{
 const config={staff:[{id:'any',name:'指名なし'},{id:'mishima',name:'三嶋'}],courses:[{duration:65}]};
 const good=errorSnapshot(config,new Date(now));assert.equal(validateSnapshot(good,config),good);
 const unsupported=structuredClone(good);unsupported.records[1].status='unsupported';assert.equal(validateSnapshot(unsupported,config),unsupported);
 assert.throws(()=>validateSnapshot({...good,visitorType:'new'},config));
 const duplicate=structuredClone(good);duplicate.records[1]=duplicate.records[0];assert.throws(()=>validateSnapshot(duplicate,config));
 const bad=structuredClone(good);bad.records[0].status='none';assert.throws(()=>validateSnapshot(bad,config));
});
test('failed collection keeps the prior confirmed result and its old check time',()=>{
 const config={staff:[{id:'any',name:'指名なし'}],courses:[{duration:65}]};
 const previous=errorSnapshot(config,new Date('2026-10-29T18:00:00+09:00'));
 previous.records[0]={staffId:'any',duration:65,status:'available',checkedAt:'2026-10-29T18:00:00+09:00',slots:['2026-10-29T18:10:00+09:00']};
 const failed=errorSnapshot(config,new Date('2026-10-29T19:00:00+09:00'));
 preserveLastKnown(failed,previous,config);
 assert.equal(failed.status,'error');
 assert.deepEqual(failed.records[0],previous.records[0]);
 assert.equal(validateSnapshot(failed,config),failed);
});
