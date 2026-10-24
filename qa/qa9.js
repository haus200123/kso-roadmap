/* QA версии 4: перенос данных, волны, календарь, быстрые правки, ККТ, наблюдатель. */
const {chromium}=require('playwright');const {spawn}=require('child_process');const fs=require('fs');const path=require('path');
/* Запуск: node qa/qa9.js <копия проекта без папки data> [хост]
   Тест сам кладёт в <копия>/data демо-базу версии 3.5 (qa/fixtures) и проверяет, что обновление до версии 4 ничего не теряет. */
const ROOT=process.argv[2],FIX=path.join(__dirname,'fixtures');const B='http://'+(process.argv[3]||'localhost')+':8080';
if(fs.existsSync(path.join(ROOT,'data','db.json'))){console.log('В '+ROOT+'/data уже есть база — укажите чистую копию проекта, тест её перезапишет.');process.exit(3)}
fs.mkdirSync(path.join(ROOT,'data','photos'),{recursive:true});fs.copyFileSync(path.join(FIX,'db-v3.5.json'),path.join(ROOT,'data','db.json'));
fs.readdirSync(path.join(FIX,'photos')).forEach(f=>fs.copyFileSync(path.join(FIX,'photos',f),path.join(ROOT,'data','photos',f)));
const ORIG=JSON.parse(fs.readFileSync(path.join(FIX,'db-v3.5.json'),'utf8'));
const OUT=path.join(__dirname,'out9');fs.mkdirSync(OUT,{recursive:true});
let srv=null,srvLog='';const results=[];let cur='';
function start(){return new Promise(r=>{srvLog='';srv=spawn('node',['site/server.js'],{cwd:ROOT,env:{...process.env,KSO_NO_BROWSER:'1'}});srv.stdout.on('data',d=>{srvLog+=d;if(String(d).includes('запущена'))r()});srv.stderr.on('data',d=>console.log('SRV ERR',String(d)))})}
function stop(){return new Promise(r=>{if(!srv)return r();srv.on('exit',()=>r());srv.kill('SIGINT')})}
const ok=(cond,name,extra)=>{results.push({sec:cur,name,ok:!!cond,extra:extra===undefined?'':String(extra).slice(0,300)});if(!cond)console.log('  ✗',cur,'|',name,'|',extra??'')};
const section=n=>{cur=n;console.log('▶',n)};
async function apiAs(tok,method,p,body){const r=await fetch(B+p,{method,headers:{...(tok?{'X-KSO-Token':tok}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let j=null;const ct=r.headers.get('content-type')||'';if(ct.includes('json'))j=await r.json();else j=Buffer.from(await r.arrayBuffer());return {s:r.status,j}}
async function tokenFor(login,pw){return (await apiAs(null,'POST','/api/login',{login,password:pw})).j.token}
const dbNow=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'data','db.json'),'utf8'));
const tickKeys=(L,id,sec)=>{const s=new Set();((L[id]||{})[sec]||[]).forEach(i=>{s.add(i.id);(i.sub||[]).forEach(x=>s.add(i.id+'~'+x.id))});return s};

(async()=>{
await start();
/* ===== A. Данные пользователя сохранены ===== */
section('A. Данные пользователя после обновления');
{ const D=dbNow();
  ok(srvLog.includes('Копия базы перед обновлением')&&fs.readdirSync(path.join(ROOT,'data','backups')).some(n=>n.startsWith('before-v4-')),'перед обновлением сделана копия базы');
  ok(Object.keys(ORIG.users).every(k=>D.users[k]&&D.users[k].hash===ORIG.users[k].hash&&D.users[k].role===ORIG.users[k].role&&D.users[k].name===ORIG.users[k].name),'все пользователи на месте, пароли и роли не менялись');
  ok(Object.keys(ORIG.users).every(k=>!Array.isArray(ORIG.users[k].tts)||ORIG.users[k].tts.every(id=>D.users[k].tts.includes(id))),'назначенные старшим ТТ сохранены');
  ok(Object.keys(ORIG.tt).every(id=>D.tt[id]),'ни одна прежняя ТТ не удалена',Object.keys(ORIG.tt).filter(id=>!D.tt[id]));
  let lost=[];for(const id of Object.keys(ORIG.checks))for(const sec of ['prep','onsite'])for(const [k,c] of Object.entries(ORIG.checks[id][sec]||{})){if(c.st==='none')continue;const a=(D.checks[id][sec]||{})[k];if(!a||a.st!==c.st||a.by!==c.by||a.at!==c.at||!tickKeys(D.lists,id,sec).has(k))lost.push(id+' '+sec+' '+k)}
  ok(lost.length===0,'все галочки на месте и привязаны к своим пунктам ('+Object.values(ORIG.checks).reduce((a,x)=>a+Object.keys(x.prep||{}).length+Object.keys(x.onsite||{}).length,0)+')',lost.join(', '));
  lost=[];for(const [id,L] of Object.entries(ORIG.comments))L.forEach(c=>{const a=(D.comments[id]||[]).find(x=>x.id===c.id);if(!a||a.text!==c.text||!tickKeys(D.lists,id,c.sec).has(a.key))lost.push(c.id)});
  ok(lost.length===0,'все комментарии на месте',lost.join());
  lost=Object.entries(ORIG.photos).filter(([pid,p])=>!D.photos[pid]||!fs.existsSync(path.join(ROOT,'data','photos',p.file))||!D.lists[p.tt][p.sec].some(i=>i.id===p.item)).map(x=>x[0]);
  ok(lost.length===0,'все фото на месте (файл и привязка)',lost.join());
  ok(Object.keys(ORIG.tt).every(id=>D.tt[id].date===ORIG.tt[id].date&&JSON.stringify(D.tt[id].owner)===JSON.stringify(ORIG.tt[id].owner)&&JSON.stringify(D.tt[id].exec)===JSON.stringify(ORIG.tt[id].exec)),'даты, ответственные и исполнители не тронуты');
  const mk=Object.entries(D.tt).find(([id,t])=>/Пихтовая/.test(t.name));ok(mk&&mk[1].city==='Демоград'&&mk[1].name==='Пихтовая, 45','Пихтовая 45: город и адрес поменяны местами',mk&&mk[1].city+' | '+mk[1].name);
  ok(mk&&mk[1].skit===ORIG.tt[mk[0]].skit&&mk[1].lin===ORIG.tt[mk[0]].lin&&mk[1].ul===ORIG.tt[mk[0]].ul,'Пихтовая 45: ваши цифры и юрлицо сохранены');
  const untouched=['t01','t02','t03','t04','t06','t07','t08','t11','t23','t25','t26'];
  ok(untouched.every(id=>!D.tt[id].wave&&!D.tt[id].code&&['skit','ncr','csik','demCsik','lin','rKkt','oKkt'].every(k=>D.tt[id][k]===ORIG.tt[id][k])),'11 ТТ не из плана остались как были');
  ok(D.waves.length===2&&D.waves[0].name==='1 волна'&&D.waves[1].name==='2 волна','созданы вкладки «1 волна» и «2 волна»');
  const cnt=w=>Object.values(D.tt).filter(t=>t.wave===w).length;ok(cnt('w1')===27&&cnt('w2')===82,'карточек: 1 волна — 27, 2 волна — 82',cnt('w1')+'/'+cnt('w2'));
  const codes=new Set(Object.values(D.tt).filter(t=>t.code).map(t=>t.code));ok(codes.size===95,'все 95 ТТ с работами из плана есть на сайте',codes.size);
  ok(!['1150','1498','1410','1201','1333','1412','1115','1207'].some(c=>codes.has(c)),'ТТ «Без изменений» не добавлены');
  ok(D.tt.t24.wave==='w1'&&D.tt.t24.skit===8&&D.tt.t24.demCsik===4&&D.tt.t24.outSkit===2,'Ясеневая 74а: 1 волна, 8 S.kit, снимаем 4 CSIK, 2 S.kit уезжают');
  ok(D.tt.t05.wave==='w2'&&D.tt['pl-1308-w1']&&D.tt['pl-1308-w1'].outSkit===4,'Берёзовая 117: работа 2 волны в прежней карточке + новая карточка 1 волны (отдаёт 4 S.kit)');
  const t24=D.lists.t24.onsite.map(i=>i.text).join('\n');ok(/POSCore и УчётПлюс/.test(JSON.stringify(D.lists.t24.onsite))&&/2ЛТП/.test(t24)&&/МАХ/.test(t24),'в старые чек-листы добавлены новые пункты (POSCore и УчётПлюс, 2ЛТП, МАХ)');
  ok(/Снять колонки с NCR и звуковые карты/.test(JSON.stringify(D.lists.t05.onsite)),'«Снять колонки с NCR и звуковые карты» в существующей ТТ');
  ok(/Нова Принт/.test(JSON.stringify(D.lists.t24.prep)),'ККТ Кварц 2Ф + Нова Принт в подготовке');
  // повторный запуск ничего не дублирует
  const v0=D.v,n0=Object.keys(D.tt).length;await stop();await start();const D2=dbNow();
  ok(!srvLog.includes('План «')&&Object.keys(D2.tt).length===n0&&D2.v===v0,'повторный запуск не импортирует план второй раз',srvLog.slice(0,200));
}
const b=await chromium.launch();const errs=[];
const watch=(p,l)=>{p.on('pageerror',e=>errs.push(l+': '+e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource.*(401|403|409)/.test(m.text()))errs.push(l+' console: '+m.text())})};
const login=async(p,l,pw)=>{await p.goto(B);await p.waitForSelector('#lg-login');await p.fill('#lg-login',l);await p.fill('#lg-pass',pw);await p.click('button[type=submit]');await p.waitForSelector('main .waves',{timeout:8000})};
const toastT=async p=>(await p.textContent('#toast-root'))||'';
const adm=await tokenFor('Admin','admin');
/* ===== B. Вкладки волн ===== */
section('B. Вкладки волн');
{ const c=await b.newContext({viewport:{width:1300,height:900}});const A=await c.newPage();watch(A,'waves');await login(A,'Admin','admin');
  const wl=await A.$$eval('[data-wave]',x=>x.map(e=>e.getAttribute('data-wave')+'='+e.textContent.trim()).join(' | '));
  ok(/^all=Все ТТ 121 \| w1=1 волна 27 \| w2=2 волна 82 \| =Без волны 12$/.test(wl),'вкладки: Все, 1 волна, 2 волна, Без волны — со счётчиками',wl);
  await A.click('[data-wave="w2"]');await A.waitForTimeout(200);let n=await A.$$eval('.tt',x=>x.length);ok(n===82,'во вкладке «2 волна» 82 карточки',n);
  await A.click('[data-wave="w1"]');await A.waitForTimeout(200);n=await A.$$eval('.tt',x=>x.length);ok(n===27,'во вкладке «1 волна» 27 карточек',n);
  await A.reload();await A.waitForSelector('.tt');ok(await A.getAttribute('[data-wave="w1"]','aria-selected')==='true','выбранная волна запоминается в окне');
  await A.click('[data-act="wave-new"]');await A.fill('#wave-new','3 волна');await A.press('#wave-new','Enter');await A.waitForTimeout(700);
  let st=(await apiAs(adm,'GET','/api/state')).j;const w3=st.waves.find(w=>w.name==='3 волна');ok(w3,'админ создал вкладку «3 волна»');
  ok(await A.getAttribute(`[data-wave="${w3&&w3.id}"]`,'aria-selected')==='true','новая вкладка сразу открыта');
  ok((await A.$$eval('.tt',x=>x.length))===0&&(await A.textContent('main')).includes('Ничего не найдено'),'новая вкладка пустая');
  await A.click('[data-act="new-tt"]');await A.fill('#n-city','Пилотск');await A.fill('#n-name','Тестовая, 3');await A.fill('#n-skit','2');
  ok(await A.inputValue('#n-wave')===w3.id,'новая ТТ по умолчанию попадает в открытую волну');await A.click('[data-act="create-tt"]');await A.waitForTimeout(800);
  st=(await apiAs(adm,'GET','/api/state')).j;const nid=Object.keys(st.tt).find(id=>st.tt[id].name==='Тестовая, 3');ok(nid&&st.tt[nid].wave===w3.id,'ТТ создана в «3 волна»');
  await A.click('[data-act="wave-ren"]');await A.fill('#wave-ren','3 волна (резерв)');await A.click('[data-act="wave-ren-ok"]');await A.waitForTimeout(600);
  ok((await A.textContent(`[data-wave="${w3.id}"]`)).includes('3 волна (резерв)'),'вкладка переименована');
  // перенос ТТ между волнами в параметрах
  await A.click('[data-wave="w1"]');await A.click('[data-toggle="t14"]');await A.waitForTimeout(200);await A.click('#tt-t14 [data-params] summary');
  await A.selectOption('#tt-t14 [data-f="t14|wave"]',w3.id);await A.waitForTimeout(700);st=(await apiAs(adm,'GET','/api/state')).j;ok(st.tt.t14.wave===w3.id,'ТТ перенесена в другую волну из параметров');
  await apiAs(adm,'POST','/api/check',{tt:'t14',sec:'prep',item:st.lists.t14.prep.find(i=>!i.sub.length).id,action:'tick'});
  await A.click(`[data-wave="${w3.id}"]`);await A.click('[data-act="wave-del"]');ok((await A.textContent('.waves')).includes('перейдут в «Без волны»'),'перед удалением вкладки — предупреждение');
  await A.click('[data-act="wave-del-ok"]');await A.waitForTimeout(800);st=(await apiAs(adm,'GET','/api/state')).j;
  ok(!st.waves.some(w=>w.id===w3.id)&&st.tt.t14&&st.tt.t14.wave===''&&st.tt[nid].wave==='','вкладка удалена, её ТТ перенесены в «Без волны», не удалены');
  ok(Object.values(st.checks.t14.prep).some(c=>c.st==='done'),'отметки ТТ из удалённой волны сохранились');
  await apiAs(adm,'PATCH','/api/tt/t14',{wave:'w1'});await apiAs(adm,'DELETE','/api/tt/'+nid);
  await apiAs(adm,'POST','/api/users',{login:'qa_w',name:'Волнов Старший',password:'1111',role:'lead',tts:['t24','pl-1308-w1','t05']});const lt=await tokenFor('qa_w','1111');
  ok((await apiAs(lt,'POST','/api/waves',{name:'X'})).s===403&&(await apiAs(lt,'DELETE','/api/waves/w1')).s===403,'старший не создаёт и не удаляет волны');
  ok((await apiAs(lt,'PATCH','/api/tt/t24',{wave:'w2'})).s===403,'старший не переносит ТТ между волнами');
  const L=await c.newPage();watch(L,'lead');await login(L,'qa_w','1111');
  ok(!(await L.$('[data-act="wave-new"]'))&&(await L.textContent('[data-wave="w1"]')).includes('2')&&(await L.textContent('[data-wave="w2"]')).includes('1'),'старший видит вкладки волн со счётчиками только своих ТТ',await L.textContent('.waves'));
  await c.close();
}
/* ===== C. Календарь ===== */
section('C. Календарь');
{ await apiAs(adm,'PATCH','/api/tt/t24',{date:'2026-10-16'});await apiAs(adm,'PATCH','/api/tt/pl-1187-w1',{date:'2026-10-16'});await apiAs(adm,'PATCH','/api/tt/t13',{date:'2026-11-05'});
  const c=await b.newContext({viewport:{width:1300,height:900}});const A=await c.newPage();watch(A,'cal');await login(A,'Admin','admin');
  await A.click('[data-wave="all"]');await A.click('[data-view="calendar"]');await A.waitForSelector('.cal');
  ok((await A.textContent('.cal-h h1')).includes('Октябрь 2026'),'открывается текущий месяц');
  const ev=await A.$$eval('.cal .ev',x=>x.map(e=>e.textContent));ok(ev.includes('Ясеневая, 74а')&&ev.includes('Тополиная, 132')&&ev.includes('Пихтовая, 45'),'в календаре названия ТТ по датам',ev.join(' | '));
  await A.click('[data-cal="1"]');await A.waitForTimeout(200);ok((await A.textContent('.cal-h h1')).includes('Ноябрь')&&(await A.$$eval('.cal .ev',x=>x.map(e=>e.textContent))).includes('Сосновая, 112а'),'листание на следующий месяц');
  await A.click('[data-wave="w1"]');await A.click('[data-cal="0"]');await A.waitForTimeout(200);const ev1=await A.$$eval('.cal .ev',x=>x.map(e=>e.textContent));
  ok(ev1.includes('Ясеневая, 74а')&&!ev1.includes('Пихтовая, 45'),'календарь фильтруется по волне');
  await A.click('.cal .ev[data-goto="t24"]');await A.waitForTimeout(400);ok(await A.$('#tt-t24.open')&&(await A.getAttribute('[data-view="onsite"]','aria-selected'))==='true','клик по ТТ в календаре открывает её карточку');
  const L=await c.newPage();watch(L,'cal-lead');await login(L,'qa_w','1111');await L.click('[data-view="calendar"]');await L.waitForSelector('.cal');
  const evl=await L.$$eval('.cal .ev',x=>x.map(e=>e.textContent));ok(evl.includes('Ясеневая, 74а')&&!evl.includes('Тополиная, 132'),'старший видит в календаре только свои ТТ',evl.join('|'));
  const E=await (await b.newContext()).newPage();await E.goto(B);await E.fill('#lg-fio','Календарев Инженер');await E.click('#lg-eng');await E.waitForSelector('#eng-tt');
  ok(!(await E.$('[data-view="calendar"]')),'у инженера вкладки календаря нет');
  ok((await E.$$eval('#eng-tt optgroup',x=>x.map(o=>o.label))).join()==='1 волна,2 волна,Без волны','инженер выбирает ТТ по волнам');
  const M=await (await b.newContext({viewport:{width:390,height:800},isMobile:true})).newPage();watch(M,'cal-mobile');await login(M,'Admin','admin');await M.click('[data-wave="all"]');await M.click('[data-view="calendar"]');await M.waitForTimeout(300);
  ok(await M.isVisible('.agenda')&&!(await M.isVisible('.cal'))&&(await M.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)),'на телефоне календарь — списком по дням, без прокрутки вбок');
  await M.screenshot({path:OUT+'/cal-mobile.png'});await A.click('[data-view="calendar"]');await A.screenshot({path:OUT+'/cal.png'});
  await c.close();
}
/* ===== D. Быстрые правки пунктов ===== */
section('D. Быстрые правки пунктов');
{ const c=await b.newContext({viewport:{width:1300,height:900}});const A=await c.newPage();watch(A,'items');await login(A,'Admin','admin');
  await A.click('[data-wave="w2"]');await A.click('[data-toggle="t27"]');await A.waitForTimeout(200);
  let st=(await apiAs(adm,'GET','/api/state')).j;const it=st.lists.t27.onsite.find(i=>!i.sub.length);const key=`t27|onsite|${it.id}|`;
  await apiAs(adm,'POST','/api/check',{tt:'t27',sec:'onsite',item:it.id,action:'tick'});await A.waitForTimeout(500);
  await A.click(`[data-item-edit="${key}"]`);await A.fill(`[data-item-input="${key}"]`,'Исправленный текст пункта');await A.press(`[data-item-input="${key}"]`,'Enter');
  let x;for(let k=0;k<30;k++){st=(await apiAs(adm,'GET','/api/state')).j;x=st.lists.t27.onsite.find(i=>i.id===it.id);if(x.text==='Исправленный текст пункта')break;await A.waitForTimeout(100)}
  ok(x.text==='Исправленный текст пункта','✎ у пункта: текст исправлен в обычном режиме');ok(st.checks.t27.onsite[it.id].st==='done','отметка пункта после правки текста на месте');
  const grpCount=await A.$$eval('#tt-t27 [data-item-addg]',x=>x.length);ok(grpCount>3,'у каждой группы есть «＋ пункт»',grpCount);
  const gk=await A.getAttribute('#tt-t27 [data-item-addg]','data-item-addg');await A.click(`[data-item-addg="${gk}"]`);await A.fill(`[data-item-new="${gk}"]`,'Свой пункт админа');await A.press(`[data-item-new="${gk}"]`,'Enter');await A.waitForTimeout(700);
  st=(await apiAs(adm,'GET','/api/state')).j;const L=st.lists.t27.onsite;const ni=L.findIndex(i=>i.text==='Свой пункт админа');const g0=L[0].g;
  ok(ni>=0&&L[ni].g===g0&&(ni===L.length-1||L[ni+1].g!==g0),'«＋ пункт» добавляет в конец своей группы');
  const delKey=`t27|onsite|${L[ni].id}|`;await A.click(`[data-item-delask="${delKey}"]`);await A.click(`[data-item-del="${delKey}"]`);await A.waitForTimeout(700);
  st=(await apiAs(adm,'GET','/api/state')).j;ok(!st.lists.t27.onsite.some(i=>i.text==='Свой пункт админа'),'✕ удаляет пункт');
  const tpl=st.lists.t27.onsite.find(i=>i.tk&&/Фото установленных КСО/.test(i.text));const tk2=`t27|onsite|${tpl.id}|`;await A.click(`[data-item-delask="${tk2}"]`);await A.click(`[data-item-del="${tk2}"]`);await A.waitForTimeout(600);
  await apiAs(adm,'PATCH','/api/tt/t27',{skit:5});st=(await apiAs(adm,'GET','/api/state')).j;
  ok(!st.lists.t27.onsite.some(i=>/Фото установленных КСО/.test(i.text)),'удалённый пункт шаблона не возвращается при пересчёте количеств');
  ok(st.lists.t27.onsite.find(i=>i.id===it.id).text==='Исправленный текст пункта','исправленный текст не затирается при пересчёте');
  await A.click('[data-reset="t27"]');await A.click('[data-reset-ok="t27"]');await A.waitForTimeout(700);st=(await apiAs(adm,'GET','/api/state')).j;
  ok(st.lists.t27.onsite.some(i=>/Фото установленных КСО/.test(i.text))&&st.checks.t27.onsite[it.id].st==='done','«Вернуть пункты шаблона» возвращает удалённое и сохраняет отметки');
  const lt=await tokenFor('qa_w','1111');ok((await apiAs(lt,'PATCH','/api/item',{tt:'t24',sec:'onsite',item:'o26',text:'x'})).s===403,'старший не правит пункты (только подпункты)');
  await A.screenshot({path:OUT+'/items.png'});await c.close();
}
/* ===== E. Количество касс и ККТ ===== */
section('E. Количество касс и ККТ');
{ const c=await b.newContext({viewport:{width:1300,height:900}});const A=await c.newPage();watch(A,'qty');await login(A,'Admin','admin');
  const id='pl-1209-w2';let st=(await apiAs(adm,'GET','/api/state')).j;const t0=st.tt[id]||st.tt.t27;const tid=st.tt[id]?id:'t27';
  const anyIt=st.lists[tid].onsite.find(i=>!i.sub.length&&!((st.checks[tid].onsite||{})[i.id]||{}).st);await apiAs(adm,'POST','/api/check',{tt:tid,sec:'onsite',item:anyIt.id,action:'tick'});
  await A.click('[data-wave="w2"]');await A.fill('#q',t0.name);await A.waitForTimeout(200);await A.click(`[data-toggle="${tid}"]`);await A.waitForTimeout(200);
  await A.click(`#tt-${tid} [data-qp] summary`);await A.waitForTimeout(100);
  const skit0=(await apiAs(adm,'GET','/api/state')).j.tt[tid].skit;
  await A.click(`[data-qs="${tid}|ncr|1"]`);await A.waitForTimeout(500);await A.click(`[data-qs="${tid}|ncr|1"]`);await A.waitForTimeout(700);
  st=(await apiAs(adm,'GET','/api/state')).j;let t=st.tt[tid];
  ok(t.ncr===2&&t.rKkt===2&&t.oKkt===skit0-2&&t.rCol===2,'+ у демонтажа NCR: Кварц 2Ф с демонтажа и Нова Принт пересчитаны сами',JSON.stringify({ncr:t.ncr,rKkt:t.rKkt,oKkt:t.oKkt,rCol:t.rCol}));
  const txt=JSON.stringify(st.lists[tid].onsite);ok(/Закрыть смены/.test(txt)&&/POSCore и УчётПлюс/.test(txt)&&/звуковые карты/.test(txt)&&/закрытии смен и демонтаже/.test(txt),'в чек-листе появились пункты демонтажа (Z-отчёты, POSCore и УчётПлюс, 2ЛТП, колонки и звуковые карты)');
  ok(st.checks[tid].onsite[anyIt.id]&&st.checks[tid].onsite[anyIt.id].st==='done','отметки после пересчёта на месте');
  ok(await A.isVisible(`#tt-${tid} [data-qp][open]`),'панель количеств остаётся открытой после изменения');
  await A.fill(`[data-q="${tid}|oKkt"]`,'1');await A.press(`[data-q="${tid}|oKkt"]`,'Tab');await A.waitForTimeout(700);st=(await apiAs(adm,'GET','/api/state')).j;t=st.tt[tid];
  ok(t.oKkt===1&&t.auto===false&&!(await A.isChecked(`[data-qauto="${tid}"]`)),'ручная правка ККТ выключает авто-расчёт');
  ok((await A.textContent(`#tt-${tid} .qp summary`)).includes('ККТ не сходятся'),'предупреждение, если ККТ не сходятся с числом КСО');
  await A.check(`[data-qauto="${tid}"]`);await A.waitForTimeout(700);st=(await apiAs(adm,'GET','/api/state')).j;t=st.tt[tid];
  ok(t.auto===true&&t.oKkt===skit0-2&&t.rKkt===2,'включение авто — пересчёт обратно');
  await A.click(`[data-qs="${tid}|ncr|-1"]`);await A.waitForTimeout(500);await A.click(`[data-qs="${tid}|ncr|-1"]`);await A.waitForTimeout(700);st=(await apiAs(adm,'GET','/api/state')).j;
  ok(!/Закрыть смены/.test(JSON.stringify(st.lists[tid].onsite))&&st.tt[tid].rKkt===0,'демонтаж убран — его пункты без отметок ушли, ККТ снова все Нова Принт');
  ok((await A.textContent(`#tt-${tid} .qline`)).includes('ККТ: Кварц 2Ф 0 (с демонтажа) + Нова Принт'),'строка количеств показывает ККТ по типам');
  await A.screenshot({path:OUT+'/qty.png'});
  // новая ТТ по шаблону: все пункты из замечаний
  const r=await apiAs(adm,'POST','/api/tt',{name:'Шаблонная, 1',city:'Примерск',skit:'4',ncr:'4'});st=(await apiAs(adm,'GET','/api/state')).j;const nt=st.tt[r.j.id],on=JSON.stringify(st.lists[r.j.id].onsite),pr=JSON.stringify(st.lists[r.j.id].prep);
  ok(nt.rKkt===4&&nt.oKkt===0&&nt.rCol===4,'новая ТТ: 4 NCR снимаем → 4 Кварц 2Ф, новых Нова Принт 0');
  ok(/Снять колонки с NCR и звуковые карты/.test(on)&&/Убедиться, что все чеки есть в POSCore и УчётПлюс/.test(on)&&/Подтверждение возраста через МАХ/.test(on)&&/Подтверждение возраста покупателя через МАХ/.test(on),'шаблон: звуковые карты, POSCore и УчётПлюс, проверка и показ МАХ');
  ok(/Сообщить во 2ЛТП о закрытии смен и демонтаже/.test(on)&&/Сообщить во 2ЛТП о создании новых касс/.test(pr)&&/лицензий/.test(pr)&&/Нова Принт/.test(on+pr),'шаблон: 2ЛТП о новых и снятых кассах, лицензии, ККТ Нова Принт');
  await apiAs(adm,'DELETE','/api/tt/'+r.j.id);
  // форма новой ТТ: город и адрес перепутаны
  await A.fill('#q','');await A.click('[data-act="new-tt"]');await A.fill('#n-city','Тестовая 999');await A.fill('#n-name','Демоград');await A.waitForTimeout(100);
  ok((await A.textContent('#n-preview')).includes('перепутаны'),'форма предупреждает, что город и адрес перепутаны');
  await A.click('[data-act="create-tt"]');await A.waitForTimeout(800);st=(await apiAs(adm,'GET','/api/state')).j;const sw=Object.entries(st.tt).find(([,x])=>/Тестовая 999/.test(x.name));
  ok(sw&&sw[1].city==='Демоград','при создании город и адрес поставлены на место',sw&&sw[1].city+'|'+sw[1].name);if(sw)await apiAs(adm,'DELETE','/api/tt/'+sw[0]);
  ok((await apiAs(adm,'POST','/api/tt',{name:'Демоград',city:'Пробная 5'})).j.id&&Object.values((await apiAs(adm,'GET','/api/state')).j.tt).some(x=>x.name==='Пробная, 5'&&x.city==='Демоград'),'сервер тоже исправляет перепутанные поля');
  { const st2=(await apiAs(adm,'GET','/api/state')).j;const e=Object.entries(st2.tt).find(([,x])=>x.name==='Пробная, 5');if(e)await apiAs(adm,'DELETE','/api/tt/'+e[0]) }
  await c.close();
}
/* ===== F. Сводка заказа, Excel, инженер ===== */
section('F. Сводка, Excel, инженер');
{ const c=await b.newContext({viewport:{width:1300,height:900}});const A=await c.newPage();watch(A,'orders');await login(A,'Admin','admin');
  await A.click('[data-wave="w2"]');await A.click('[data-view="orders"]');await A.waitForSelector('table');const st=(await apiAs(adm,'GET','/api/state')).j;
  const sk=Object.values(st.tt).filter(t=>t.wave==='w2').reduce((a,t)=>a+(+t.skit||0),0),tb=Object.values(st.tt).filter(t=>t.wave==='w2').reduce((a,t)=>a+(+t.buyTables||0),0);
  const tot=await A.$$eval('tr.tot td',x=>x.map(e=>e.textContent));const heads=await A.$$eval('thead th',x=>x.map(e=>e.textContent));
  ok(+tot[heads.indexOf('S.kit')]===sk&&+tot[heads.indexOf('Жел. столы')]===tb,'сводка заказа считает только выбранную волну (S.kit '+sk+', столы '+tb+')',tot.join(','));
  ok(heads.includes('ККТ Нова Принт')&&heads.includes('КВП'),'в сводке колонки ККТ Нова Принт, жел. столы и КВП');
  const x=await apiAs(adm,'GET','/api/orders.xlsx?wave=w2');ok(x.s===200&&x.j.slice(0,2).toString()==='PK','Excel сводки по волне выгружается');
  const e1=await apiAs(adm,'GET','/api/export/pl-z2-w1/onsite');ok(e1.s===200&&e1.j.slice(0,2).toString()==='PK','Excel чек-листа новой карточки выгружается');
  const E=await (await b.newContext()).newPage();watch(E,'eng');await E.goto(B);await E.fill('#lg-fio','Волновой Инженер');await E.click('#lg-eng');await E.waitForSelector('#eng-tt');
  await E.selectOption('#eng-tt','pl-1187-w1');await E.waitForSelector('#tt-pl-1187-w1');const tk=await E.getAttribute('#tt-pl-1187-w1 [data-tick]','data-tick');await E.click(`[data-tick="${tk}"]`);await E.waitForTimeout(600);
  const s2=(await apiAs(adm,'GET','/api/state')).j;const [,sec,item,sub]=tk.split('|');ok(s2.checks['pl-1187-w1'][sec][sub?item+'~'+sub:item].st==='pending','инженер отмечает пункт на новой карточке (уходит старшему)');
  ok(!(await E.$('[data-item-edit]'))&&!(await E.$('[data-qp]'))&&!(await E.$('.waves')),'инженер не видит правки пунктов, количеств и волн');
  await A.click('[data-view="onsite"]');await A.click('[data-wave="all"]');await A.screenshot({path:OUT+'/all.png'});
  await c.close();
}
/* ===== G. Наблюдатель (только просмотр) ===== */
section('G. Наблюдатель');
{ const vt=await tokenFor('Viewer','viewer');ok(!!vt,'вход Viewer / viewer');
  const st=(await apiAs(vt,'GET','/api/state')).j;ok(Object.keys(st.tt).length>100&&!st.limited,'наблюдатель видит все ТТ');
  const it=st.lists.t24.onsite.find(i=>!i.sub.length);
  ok((await apiAs(vt,'POST','/api/check',{tt:'t24',sec:'onsite',item:it.id,action:'tick'})).s===403,'отметить пункт нельзя');
  ok((await apiAs(vt,'POST','/api/comments',{tt:'t24',sec:'onsite',item:it.id,text:'x'})).s===403,'комментировать нельзя');
  ok((await apiAs(vt,'PATCH','/api/tt/t24',{exec:{onsite:'Кто-то'}})).s===403&&(await apiAs(vt,'POST','/api/waves',{name:'X'})).s===403,'менять ТТ и волны нельзя');
  ok((await apiAs(vt,'GET','/api/users')).s===403&&(await apiAs(vt,'GET','/api/journal')).s===403,'пользователи и журнал закрыты');
  const x=await apiAs(vt,'GET','/api/export/t24/onsite');ok(x.s===200&&x.j.slice(0,2).toString()==='PK','Excel выгружается');
  const c=await b.newContext({viewport:{width:1300,height:900}});const V=await c.newPage();watch(V,'viewer');await login(V,'Viewer','viewer');
  ok((await V.$$eval('.tab',x=>x.map(e=>e.dataset.view))).join()==='onsite,prep,calendar,orders','вкладки: отработка, подготовка, календарь, сводка');
  ok((await V.textContent('main')).includes('Режим просмотра'),'плашка «Режим просмотра»');
  await V.click('[data-wave="w1"]');await V.click('[data-toggle="t24"]');await V.waitForTimeout(300);
  ok(await V.$$eval('#tt-t24 [data-tick]',x=>x.length>0&&x.every(e=>e.disabled)),'галочки неактивны');
  ok(!(await V.$('#tt-t24 [data-exec]'))&&!(await V.$('#tt-t24 [data-upload]'))&&!(await V.$('#tt-t24 [data-item-edit]'))&&!(await V.$('#tt-t24 [data-sub-add]'))&&!(await V.$('#tt-t24 [data-qp]')),'нет полей и кнопок правки');
  await V.screenshot({path:OUT+'/viewer.png'});await c.close();
}
ok(errs.length===0,'ошибок в консоли браузера нет',errs.join(' | '));
await b.close();await stop();
const fail=results.filter(r=>!r.ok);console.log(`\nИТОГО: ${results.length} проверок, пройдено ${results.length-fail.length}, ошибок ${fail.length}`);fail.forEach(f=>console.log(' ✗',f.sec,'|',f.name,'|',f.extra));
fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,1));process.exit(fail.length?1:0);
})().catch(async e=>{console.log('FATAL',e);try{await stop()}catch(_){}process.exit(2)});
