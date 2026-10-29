export function tokyoDate(now = new Date()) {
  return new Date(now.getTime()+9*60*60*1000).toISOString().slice(0,10);
}
export function nextDate(date, offset) {
  return new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
}
export function slotISO(date, time) {
  const match=String(time).trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!match || +match[1]>47 || +match[2]>59)throw new Error('INVALID_TIME');
  const ms=Date.parse(date+'T00:00:00+09:00')+(+match[1]*60 + +match[2])*60000;
  if(!Number.isFinite(ms))throw new Error('INVALID_DATE');
  return new Date(ms+9*3600000).toISOString().slice(0,19)+'+09:00';
}
export function readDay({times=[], noTimeMessage='', ready=false}, date, now=Date.now()) {
  if(!ready)throw new Error('RESULT_NOT_LOADED');
  const slots=[...new Set(times.map(t=>slotISO(date,t)))].filter(t=>Date.parse(t)>=Math.floor(now/60000)*60000).sort();
  if(slots.length)return {status:'available',slots};
  // Explicit completed empty-state is required. Empty DOM and all-expired lists are unknown.
  if(!times.length && /予約受付\s*できません|満席のため受付できません|空き.*ありません|予約可能.*ありません/.test(noTimeMessage))return {status:'none',slots:[]};
  throw new Error('NO_CONFIRMED_RESULT');
}
export function errorSnapshot(config, now=new Date()) {
  return {schemaVersion:1,visitorType:'repeat',status:'error',refreshIntervalMinutes:10,generatedAt:now.toISOString(),staff:config.staff,records:config.staff.flatMap(s=>config.courses.map(c=>({staffId:s.id,duration:c.duration,status:'error',checkedAt:now.toISOString(),slots:[]})))};
}
export function validateSnapshot(data,config){
  if(data.visitorType!=='repeat'||!Array.isArray(data.records)||data.records.length!==config.staff.length*config.courses.length)throw new Error('INVALID_SNAPSHOT');
  const keys=new Set();
  for(const record of data.records){
    const key=record.staffId+':'+record.duration;
    if(keys.has(key)||!config.staff.some(s=>s.id===record.staffId)||!config.courses.some(c=>c.duration===record.duration))throw new Error('INVALID_SELECTION');
    keys.add(key);
    if(!['available','none','error'].includes(record.status)||!Number.isFinite(Date.parse(record.checkedAt)))throw new Error('INVALID_RECORD');
    if(record.status==='available'&&(!Array.isArray(record.slots)||!record.slots.length||record.slots.some(s=>!s.endsWith('+09:00')||!Number.isFinite(Date.parse(s)))))throw new Error('INVALID_SLOT');
    if(record.status==='none'&&!/^\d{4}-\d{2}-\d{2}$/.test(record.searchThrough||''))throw new Error('INVALID_RANGE');
  }
  return data;
}
