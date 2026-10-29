import {chromium} from 'playwright';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {tokyoDate,nextDate,readDay,errorSnapshot,validateSnapshot} from './model.mjs';

const root=new URL('../',import.meta.url);
const config=JSON.parse(await readFile(new URL('config.json',import.meta.url),'utf8'));
const snapshot=errorSnapshot(config);
const deadline=Date.now()+8*60000;
let browser;
let stop=false;
const fatalCodes=/SOURCE_BLOCKED|SOURCE_SIGNIN|UNEXPECTED_ORIGIN/;
async function guard(page){
  if(Date.now()>deadline)throw new Error('COLLECTION_DEADLINE');
  if(new URL(page.url()).hostname!=='1cs.jp')throw new Error('UNEXPECTED_ORIGIN');
  const text=await page.locator('body').innerText({timeout:10000});
  if(/verify (you are|you're) human|checking your browser|unusual traffic|automated queries|access denied|captcha|ロボットではない|人間であることを確認/i.test(text))throw new Error('SOURCE_BLOCKED');
  if(/sign in to continue|ログインが必要/.test(text))throw new Error('SOURCE_SIGNIN');
}
async function selectStaffAndCourse(page, staff, course){
  await page.goto(config.entryUrl,{waitUntil:'domcontentloaded',timeout:35000});
  await guard(page);
  await page.getByRole('button',{name:'ある',exact:true}).click({timeout:30000});
  await page.locator('.staffPlate:visible .staffName').first().waitFor({timeout:25000});
  await guard(page);
  if(staff.id==='any'){
    await page.locator('.rankSelectReserveButtonContainer .reserveButton:visible').click();
    await page.getByRole('button',{name:'はい',exact:true}).click();
  }else{
    const name=page.locator('.staffName').filter({hasText:new RegExp('^\\s*'+staff.name+'\\s*$')});
    const card=page.locator('.staffPlate:visible').filter({has:name});
    if(await card.count()!==1)throw new Error('STAFF_NOT_FOUND');
    await card.getByRole('button').first().click();
  }
  const menu=page.locator('#'+course.menuId+':visible');
  await menu.waitFor({timeout:25000});
  const label=(await menu.locator('.menu-name').innerText()).replace(/\s+/g,'');
  const required=(await menu.locator('.time').innerText()).replace(/\s+/g,'');
  if(label!=='タイ古式マッサージ'+course.duration+'分'||required!=='所要時間'+course.requiredMinutes+'分')throw new Error('MENU_CHANGED');
  await menu.locator('.menu-base').click();
  await page.getByRole('button',{name:'次へ',exact:true}).filter({visible:true}).first().click();
  await page.locator('.clndr-grid:visible').waitFor({timeout:25000});
  // Verify the selected menu and staff summary before accepting a result.
  const summary=await page.locator('body').innerText();
  if(!summary.includes('タイ古式マッサージ')||!summary.includes(course.duration+'分'))throw new Error('SELECTION_UNCONFIRMED');
  await guard(page);
}
async function readDate(page,date,staff){
  const target=page.locator('button[day-for="'+date+'"]:visible');
  for(let turn=0;turn<3;turn++){
    if(await target.count() && await target.isEnabled())break;
    const month=await page.locator('.clndr-controls .month:visible, .calendar .month:visible, .month:visible').first().innerText();
    const wanted=date.slice(0,7).replace('-','/');
    if(month.trim()===wanted && await target.count())throw new Error('DATE_DISABLED');
    await page.locator('.clndr-next-button:visible').click();
    await page.waitForFunction(({value})=>Array.from(document.querySelectorAll('.month')).some(el=>el.getClientRects().length&&el.textContent.trim()===value),{value:wanted},{timeout:10000});
  }
  if(!await target.count()||!await target.isEnabled())throw new Error('DATE_UNREACHABLE');
  await target.click();
  const [,month,day]=date.split('-');
  const label=new RegExp('^\\s*'+Number(month)+'/'+Number(day)+'[（(]');
  const unit=page.locator('.timeSelectorUnit:visible').filter({has:page.locator('button.date').filter({hasText:label})});
  await unit.locator('.candidateTime:visible, .noTime:visible').first().waitFor({timeout:30000});
  await guard(page);
  const observedStaff=(await unit.locator('.staffNameContainer .staffName').innerText()).trim();
  if(observedStaff!==staff.name)throw new Error('STAFF_CHANGED');
  const times=await unit.locator('button.candidateTime:visible:not([disabled]):not(.unavailable)').allTextContents();
  const empty=unit.locator('.noTime:visible');
  const noTimeMessage=await empty.count()?await empty.innerText():'';
  return readDay({ready:true,times:times.map(t=>t.trim()),noTimeMessage},date);
}
try{
  browser=await chromium.launch({headless:true});
  for(const staff of config.staff){
    for(const course of config.courses){
      const record=snapshot.records.find(r=>r.staffId===staff.id&&r.duration===course.duration);
      if(stop||Date.now()>deadline){record.errorCode='NOT_CHECKED';continue;}
      const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
      const page=await context.newPage();page.setDefaultTimeout(20000);
      try{
        await selectStaffAndCourse(page,staff,course);
        const today=tokyoDate();
        for(let offset=0;offset<config.maxSearchDays;offset++){
          if(Date.now()>deadline)throw new Error('COLLECTION_DEADLINE');
          const date=nextDate(today,offset);
          const result=await readDate(page,date,staff);
          if(offset===0)record.checkedAt=new Date().toISOString();
          if(result.status==='available'){
            Object.assign(record,{status:'available',slots:result.slots});break;
          }
          if(offset===config.maxSearchDays-1)Object.assign(record,{status:'none',slots:[],searchThrough:date});
        }
        console.log(staff.id,course.duration,record.status);
      }catch(error){
        const code=/^[A-Z_]+$/.test(error.message)?error.message:'SOURCE_READ_FAILED';
        Object.assign(record,{status:'error',checkedAt:new Date().toISOString(),slots:[],errorCode:code});
        console.log(staff.id,course.duration,code);
        if(fatalCodes.test(code))stop=true;
      }finally{await context.close();}
    }
  }
}catch{
  snapshot.records.forEach(record=>{record.status='error';record.slots=[];record.errorCode='BROWSER_START_FAILED';});
}finally{
  if(browser)await browser.close();
  snapshot.generatedAt=new Date().toISOString();
  const good=snapshot.records.filter(r=>r.status!=='error').length;
  snapshot.status=good===snapshot.records.length?'ok':good?'partial':'error';
  validateSnapshot(snapshot,config);
  const directory=new URL('data/',root);await mkdir(directory,{recursive:true});
  const target=new URL('availability.json',directory);
  await writeFile(new URL('availability.tmp',directory),JSON.stringify(snapshot,null,2)+'\n');
  await rename(new URL('availability.tmp',directory),target);
  console.log('Published local result:',snapshot.status,good+'/'+snapshot.records.length);
}
