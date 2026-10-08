/* Полный QA-прогон сайта «Дорожная карта КСО». Запуск: node qa.js <папка сайта> */
const {chromium}=require('playwright');const {spawn,execFileSync}=require('child_process');const fs=require('fs');const path=require('path');
const ROOT=process.argv[2];const B='http://'+(process.argv[3]||'localhost')+':8080';const OUT=path.join(__dirname,'out');fs.mkdirSync(OUT,{recursive:true});
let srv=null;const results=[];let cur='';
function start(){return new Promise(r=>{srv=spawn('node',['site/server.js'],{cwd:ROOT,env:{...process.env,KSO_NO_BROWSER:'1'}});srv.stdout.on('data',d=>{if(String(d).includes('запущена'))r()});srv.stderr.on('data',d=>console.log('SRV ERR',String(d)))})}
function stop(){return new Promise(r=>{if(!srv)return r();srv.on('exit',()=>r());srv.kill('SIGINT')})}
const ok=(cond,name,extra)=>{results.push({sec:cur,name,ok:!!cond,extra:extra===undefined?'':String(extra).slice(0,200)});if(!cond)console.log('  ✗',cur,'|',name,'|',extra??'')};
const section=n=>{cur=n;console.log('▶',n)};
async function apiAs(tok,method,p,body){const r=await fetch(B+p,{method,headers:{...(tok?{'X-KSO-Token':tok}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let j=null;const ct=r.headers.get('content-type')||'';if(ct.includes('json'))j=await r.json();else j=Buffer.from(await r.arrayBuffer());return {s:r.status,j}}
async function tokenFor(login,pw){const r=await apiAs(null,'POST','/api/login',{login,password:pw});return r.j.token}
async function engToken(name){const r=await apiAs(null,'POST','/api/login-engineer',{name});return r.j.token}

(async()=>{
await start();const b=await chromium.launch();const consoleErrs=[];
const newCtx=async(opts={})=>{const c=await b.newContext({viewport:{width:1300,height:900},...opts});return c};
const watch=(p,label)=>{p.on('pageerror',e=>consoleErrs.push(label+': '+e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource.*(401|403|ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_CONNECTION_REFUSED)/.test(m.text()))consoleErrs.push(label+' console: '+m.text())})};
const loginUI=async(p,l,pw,rem)=>{await p.goto(B);await p.waitForSelector('#lg-login');await p.fill('#lg-login',l);await p.fill('#lg-pass',pw);if(rem)await p.check('#lg-rem');await p.click('button[type=submit]');await p.waitForSelector('.tt',{timeout:8000})};
const toast=async p=>(await p.textContent('#toast-root'))||'';
const val=(p,s)=>p.inputValue(s).catch(()=>'<нет поля>');

/* ===== 1. Вход и сессии ===== */
section('1. Вход и сессии');
{ const c=await newCtx();const p=await c.newPage();watch(p,'login');await p.goto(B);
  await p.fill('#lg-login','Admin');await p.fill('#lg-pass','bad');await p.click('button[type=submit]');await p.waitForTimeout(300);
  ok((await p.textContent('#lg-err')).includes('Неверный'),'неверный пароль — сообщение');
  await p.fill('#lg-pass','admin');await p.click('button[type=submit]');await p.waitForSelector('.tt');ok(true,'вход админа');
  ok((await c.cookies()).some(x=>x.name==='kso_sid'&&x.httpOnly),'резервная cookie входа выдана (HttpOnly)');
  await p.reload();await p.waitForSelector('.tt');ok(true,'после F5 окно остаётся в системе');
  await p.click('[data-act=logout]');await p.waitForSelector('#lg-login');ok(true,'выход');
  await p.reload();await p.waitForSelector('#lg-login');ok(true,'после выхода и F5 — форма входа');
  // запомнить меня
  await loginUI(p,'ITlead','lead',true);const rem=await p.evaluate(()=>JSON.parse(localStorage.getItem('kso-remember')||'null'));
  ok(rem&&Math.abs(rem.exp-Date.now()-72*3600e3)<60e3,'«запомнить» = 72 часа',rem&&((rem.exp-Date.now())/3600e3).toFixed(1));
  const p2=await c.newPage();await p2.goto(B);await p2.waitForSelector('.tt');ok((await p2.textContent('.who b'))==='Старший сотрудник','новое окно входит запомненным пользователем');
  await c.close();
  // ограничение попыток
  for(let i=0;i<5;i++)await apiAs(null,'POST','/api/login',{login:'Admin',password:'x'});
  ok((await apiAs(null,'POST','/api/login',{login:'Admin',password:'admin'})).s===429,'после 5 ошибок — пауза');
  await new Promise(r=>setTimeout(r,61000));ok((await apiAs(null,'POST','/api/login',{login:'Admin',password:'admin'})).s===200,'через минуту вход снова работает');
}
/* ===== 2. Несколько окон в одном браузере ===== */
section('2. Несколько окон, разные пользователи');
{ const c=await newCtx();const A=await c.newPage(),W=await c.newPage(),E=await c.newPage();watch(A,'A');watch(W,'W');watch(E,'E');
  await loginUI(A,'Admin','admin');
  await A.click('[data-view=users]');await A.waitForSelector('#nu-login');await A.fill('#nu-login','qa_multi');await A.fill('#nu-name','Мульти Окно');await A.fill('#nu-pass','4321');
  await A.uncheck('[data-tp-all="nu"]');await A.check('[data-tp-city="nu|Примерск"]');
  await W.goto(B);await W.waitForSelector('#lg-login');ok(true,'новое окно без «запомнить» просит вход (своя сессия)');
  await loginUI(W,'ITlead','lead');
  await E.goto(B);await E.waitForSelector('#lg-fio');await E.fill('#lg-fio','Окнов Инженер');await E.click('#lg-eng');await E.waitForSelector('#eng-tt');
  await A.waitForTimeout(1500);
  ok((await A.textContent('.who b'))==='Администратор','окно A осталось под админом после входа других в соседних окнах');
  ok((await A.evaluate(async()=>{const t=sessionStorage.getItem('kso-tok');return (await (await fetch('/api/me',{headers:{'X-KSO-Token':t}})).json()).role}))==='admin','сервер видит в окне A админа');
  ok(await val(A,'#nu-login')==='qa_multi'&&await val(A,'#nu-pass')==='4321','заполненные поля в окне A на месте',await val(A,'#nu-login'));
  await A.click('[data-act=user-add]');await A.waitForTimeout(700);ok((await toast(A)).includes('добавлен'),'пользователь создан из окна A',await toast(A));
  ok((await W.textContent('.who b'))==='Старший сотрудник','окно W — старший');ok((await E.textContent('.who b'))==='Окнов Инженер','окно E — инженер');
  // изменение магазинов только что созданному пользователю, пока в других окнах идёт работа
  await A.click('[data-user-edit="qa_multi"]');await A.waitForSelector('#ue-name');await A.fill('#ue-name','Мульти Окно 2');await A.check('[data-tp-city="ue|Образцовск"]');
  await W.click('[data-toggle="t01"]');await W.click('[data-tick="t01|onsite|o4|"]').catch(()=>{});await W.waitForTimeout(800);
  await E.selectOption('#eng-tt','t02');await E.waitForTimeout(300);const sub=await E.$('.si [data-tick]');if(sub)await sub.click();await A.waitForTimeout(1200);
  ok(await val(A,'#ue-name')==='Мульти Окно 2','правка имени не сбросилась от действий в других окнах',await val(A,'#ue-name'));
  ok((await A.textContent('[data-tp-count="ue"]'))==='Выбрано: 9','выбор магазинов не сбросился (5 Примерск + 4 Образцовск)',await A.textContent('[data-tp-count="ue"]'));
  await A.click('[data-user-save="qa_multi"]');await A.waitForTimeout(700);
  const u=(await A.evaluate(async()=>{const t=sessionStorage.getItem('kso-tok');return (await (await fetch('/api/users',{headers:{'X-KSO-Token':t}})).json()).users})).find(x=>x.login==='qa_multi');
  ok(u&&u.name==='Мульти Окно 2'&&u.tts.length===9,'изменения пользователя сохранены',JSON.stringify(u));
  // второе окно админа видит нового пользователя без перезагрузки
  const A2=await c.newPage();watch(A2,'A2');await loginUI(A2,'Admin','admin');await A2.click('[data-view=users]');await A2.waitForSelector('#nu-login');
  await A.click('[data-user-edit="qa_multi"]');await A.waitForSelector('#ue-name');await A.fill('#ue-name','Мульти Окно 3');await A.click('[data-user-save="qa_multi"]');await A2.waitForTimeout(1500);
  ok((await A2.textContent('main')).includes('Мульти Окно 3'),'список пользователей обновился во втором окне админа');
  await c.close();
}
/* ===== 3. Формы не теряют данные при обновлениях ===== */
section('3. Формы и обновления страницы');
{ const c=await newCtx();const A=await c.newPage();watch(A,'forms');await loginUI(A,'Admin','admin');
  const tok=await tokenFor('ITlead','lead');let n=0;const poke=async()=>{n++;await apiAs(tok,'PATCH','/api/tt/t03',{exec:{onsite:'Обновление '+n}})};
  // новая ТТ
  await A.click('[data-act=new-tt]');await A.fill('#n-name','QA, 1');await A.fill('#n-city','Пилотск');await A.fill('#n-fmt','Реми');await A.fill('#n-skit','5');await A.fill('#n-lin','3');await A.fill('#n-date','2026-12-01');await A.click('#n-date');
  await poke();await A.waitForTimeout(800);await A.click('body',{position:{x:5,y:5}});await poke();await A.waitForTimeout(800);
  ok(await val(A,'#n-name')==='QA, 1'&&await val(A,'#n-lin')==='3'&&await val(A,'#n-date')==='2026-12-01','форма новой ТТ после 2 обновлений',[await val(A,'#n-name'),await val(A,'#n-lin'),await val(A,'#n-date')].join('|'));
  // комментарий, подзадача, ответственный, отклонение
  await A.click('[data-act=cancel-new]');await A.click('[data-toggle="t05"]');await A.waitForTimeout(200);
  const k=await A.evaluate(()=>{const b=[...document.querySelectorAll('#tt-t05 .it > div > .tools [data-cmt]')].find(x=>document.querySelector(`[data-sub-add="${x.dataset.cmt}"]`));return b.dataset.cmt});await A.click(`[data-cmt="${k}"]`);await A.fill(`[data-cmt-input="${k}"]`,'Черновик комментария');
  await A.click(`[data-sub-add="${k}"]`);await A.fill(`[data-sub-new="${k}"]`,'Черновик подзадачи');await A.click('body',{position:{x:5,y:5}});
  await poke();await A.waitForTimeout(800);
  ok(await val(A,`[data-cmt-input="${k}"]`)==='Черновик комментария','текст комментария сохранился');
  ok(await val(A,`[data-sub-new="${k}"]`)==='Черновик подзадачи','текст новой подзадачи сохранился');
  // фокус в поле во время обновления — каретка и текст на месте
  await A.click(`[data-cmt-input="${k}"]`);await A.keyboard.type(' дописываю');await poke();await A.waitForTimeout(800);await A.keyboard.type('!');
  ok(await val(A,`[data-cmt-input="${k}"]`)==='Черновик комментария дописываю!','набор текста не прерывается обновлением',await val(A,`[data-cmt-input="${k}"]`));
  await A.click(`[data-cmt-send="${k}"]`);await A.waitForTimeout(600);ok((await A.textContent(`#tt-t05`)).includes('Черновик комментария дописываю!'),'комментарий отправлен');
  ok(await val(A,`[data-cmt-input="${k}"]`)==='','после отправки поле очищено');
  // подготовка: доп. ответственный
  await A.click('[data-view=prep]');await A.click('[data-toggle="t05"]').catch(()=>{});await A.waitForTimeout(200);
  if(!(await A.$('#tt-t05 .ttb')))await A.click('[data-toggle="t05"]');
  const rk=await A.evaluate(()=>document.querySelector('#tt-t05 [data-resp-edit]').dataset.respEdit);await A.click(`[data-resp-edit="${rk}"]`);await A.fill(`[data-resp-input="${rk}"]`,'Черновик ответственного');await A.click('body',{position:{x:5,y:5}});
  await poke();await A.waitForTimeout(800);ok(await val(A,`[data-resp-input="${rk}"]`)==='Черновик ответственного','поле доп. ответственного сохранилось');
  // журнал: поиск
  await A.click('[data-view=journal]');await A.waitForSelector('#jq');await A.fill('#jq','Вход');await A.click('body',{position:{x:5,y:5}});await poke();await A.waitForTimeout(800);
  ok(await val(A,'#jq')==='Вход','строка поиска журнала сохранилась');
  // 30-секундный опрос не перерисовывает без изменений
  await A.click('[data-view=users]');await A.waitForSelector('#nu-login');await A.fill('#nu-login','qa_poll');await A.selectOption('#nu-role','admin');await A.focus('#nu-role');
  const before=await A.evaluate(()=>{window.__mark=document.querySelector('#nu-login');return 1});await A.waitForTimeout(31500);
  ok(await A.evaluate(()=>window.__mark===document.querySelector('#nu-login')),'опрос раз в 30 с без изменений не перерисовывает страницу');
  ok(await val(A,'#nu-login')==='qa_poll','логин на месте после 30 с');
  await c.close();
}
/* ===== 4. Права доступа (API) ===== */
section('4. Права доступа');
{ const adm=await tokenFor('Admin','admin'),lead=await tokenFor('ITlead','lead'),eng=await engToken('Правов Инженер');
  await apiAs(adm,'POST','/api/users',{login:'qa_lim',name:'Огранич Старший',password:'1111',role:'lead',tts:['t07','t08']});const lim=await tokenFor('qa_lim','1111');
  const st=await apiAs(lim,'GET','/api/state');ok(Object.keys(st.j.tt).sort().join()==='t07,t08','ограниченный старший видит только свои ТТ',Object.keys(st.j.tt).join());
  ok((await apiAs(lim,'POST','/api/check',{tt:'t01',sec:'prep',item:'p2',action:'tick'})).s===403,'чужая ТТ: отметка запрещена');
  ok((await apiAs(lim,'GET','/api/export/t01/prep')).s===403,'чужая ТТ: Excel запрещён');
  ok((await apiAs(lim,'GET','/api/export/t07/prep')).s===200,'своя ТТ: Excel разрешён');
  ok((await apiAs(lead,'POST','/api/users',{login:'x_x',name:'x',password:'1111',role:'lead'})).s===403,'старший не создаёт пользователей');
  ok((await apiAs(lead,'POST','/api/tt',{name:'x'})).s===403,'старший не создаёт ТТ');
  ok((await apiAs(lead,'PATCH','/api/tt/t01',{date:'2026-01-01'})).s===403,'старший не меняет дату');
  ok((await apiAs(lead,'POST','/api/item-resp',{tt:'t01',sec:'prep',item:'p2',resp:'x'})).s===403,'старший не назначает доп. ответственного');
  ok((await apiAs(eng,'POST','/api/check',{tt:'t01',sec:'prep',item:'p2',action:'tick'})).s===403,'инженер не отмечает подготовку');
  ok((await apiAs(eng,'POST','/api/sub',{tt:'t01',sec:'onsite',item:'o4',text:'x'})).s===403,'инженер не создаёт подзадачи');
  ok((await apiAs(eng,'GET','/api/export/t01/onsite')).s===403,'инженер не выгружает Excel');
  ok((await apiAs(eng,'GET','/api/users')).s===403,'инженер не видит пользователей');
  ok((await apiAs(null,'GET','/api/state')).s===401,'без входа данных нет');
  ok((await apiAs(adm,'PATCH','/api/users/Admin',{active:false})).s===409,'админ не может отключить себя');
  ok((await apiAs(adm,'PATCH','/api/users/Admin',{role:'lead'})).s===409,'нельзя убрать последнего админа');
  // смена пароля выкидывает старые сессии
  const old=await tokenFor('qa_lim','1111');await apiAs(adm,'PATCH','/api/users/qa_lim',{password:'2222'});ok((await apiAs(old,'GET','/api/state')).s===401,'после смены пароля старая сессия закрыта');
  await apiAs(adm,'PATCH','/api/users/qa_lim',{active:false});ok((await apiAs(null,'POST','/api/login',{login:'qa_lim',password:'2222'})).s===401,'отключённый не входит');
  for(const bad of ['','Иван','Иван 2','И Петров','Иван@ Петров'])ok((await apiAs(null,'POST','/api/login-engineer',{name:bad})).s===400,'ФИО инженера отклонено: «'+bad+'»');
  ok((await apiAs(null,'POST','/api/login-engineer',{name:'  сидоров   пётр '})).j.name==='Сидоров Пётр','ФИО нормализуется');
}
/* ===== 5. Рабочие сценарии ===== */
section('5. Рабочие сценарии');
{ const adm=await tokenFor('Admin','admin'),lead=await tokenFor('ITlead','lead'),eng=await engToken('Сценариев Инженер');
  const cr=await apiAs(adm,'POST','/api/tt',{name:'QA Сценарий, 5',city:'Демоград',fmt:'Реми Сити',ul:'ООО «Тест»',skit:'6',ncr:'2',lin:'2',demCsik:'1',date:'2026-12-10'});const id=cr.j.id;
  let st=(await apiAs(adm,'GET','/api/state')).j;const t=st.tt[id],L=st.lists[id];
  ok(t&&t.lin===2&&t.demCsik===1&&t.rKkt===5&&t.oKkt===1&&t.bag===2,'новая ТТ: количества и автоподсчёт',JSON.stringify({rKkt:t.rKkt,oKkt:t.oKkt,bag:t.bag}));
  ok(L.prep.length>=20&&L.onsite.length>=40&&L.onsite.some(i=>i.g.startsWith('1. Демонтаж')),'новая ТТ: чек-листы по шаблону с демонтажом',L.prep.length+'/'+L.onsite.length);
  const ref=st.lists.t01;ok(JSON.stringify(ref.onsite.filter(i=>i.g.startsWith('4.')).map(i=>i.text))===JSON.stringify(L.onsite.filter(i=>i.g.startsWith('4.')).map(i=>i.text)),'настройка КСО совпадает с остальными ТТ');
  // отметка инженера → проверка
  const it=L.onsite.find(i=>i.sub&&i.sub.length);const s1=it.sub[0].id;
  ok((await apiAs(eng,'POST','/api/check',{tt:id,sec:'onsite',item:it.id,action:'tick'})).s===409,'пункт с подзадачами нельзя отметить напрямую');
  for(const x of it.sub)await apiAs(eng,'POST','/api/check',{tt:id,sec:'onsite',item:it.id,sub:x.id,action:'tick'});
  st=(await apiAs(lead,'GET','/api/state')).j;ok(Object.values(st.checks[id].onsite).filter(c=>c.st==='pending').length===it.sub.length,'отметки инженера ушли на проверку');
  await apiAs(lead,'POST','/api/check',{tt:id,sec:'onsite',item:it.id,sub:s1,action:'reject',note:'Переделать'});
  for(const x of it.sub.slice(1))await apiAs(lead,'POST','/api/check',{tt:id,sec:'onsite',item:it.id,sub:x.id,action:'confirm'});
  st=(await apiAs(lead,'GET','/api/state')).j;ok(st.checks[id].onsite[it.id+'~'+s1].st==='rejected','отклонение с причиной');
  await apiAs(eng,'POST','/api/check',{tt:id,sec:'onsite',item:it.id,sub:s1,action:'tick'});await apiAs(lead,'POST','/api/check',{tt:id,sec:'onsite',item:it.id,sub:s1,action:'confirm'});
  st=(await apiAs(lead,'GET','/api/state')).j;ok(it.sub.every(x=>st.checks[id].onsite[it.id+'~'+x.id].st==='done'),'все подзадачи подтверждены → пункт закрыт');
  ok((await apiAs(eng,'POST','/api/check',{tt:id,sec:'onsite',item:it.id,sub:s1,action:'tick'})).s===409,'инженер не снимает подтверждённое');
  // подзадачи старшим, комментарии, фото
  ok((await apiAs(lead,'POST','/api/sub',{tt:id,sec:'onsite',item:it.id,text:'Новая от старшего'})).s===200,'старший добавил подзадачу');
  ok((await apiAs(eng,'POST','/api/comments',{tt:id,sec:'onsite',item:it.id,text:'Комментарий инженера'})).s===200,'инженер комментирует');
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const ph=await apiAs(eng,'POST','/api/photos',{tt:id,sec:'onsite',item:it.id,data:png});ok(ph.s===200,'фото загружено');
  ok((await apiAs(lead,'GET','/photos/'+ph.j.id)).s===200&&(await apiAs(null,'GET','/photos/'+ph.j.id)).s===401,'фото видно только вошедшим');
  ok((await apiAs(lead,'DELETE','/api/photos/'+ph.j.id)).s===403,'чужое фото старший не удаляет');ok((await apiAs(eng,'DELETE','/api/photos/'+ph.j.id)).s===200,'автор удаляет своё фото');
  // параметры, дата, пересоздание, удаление
  ok((await apiAs(adm,'PATCH','/api/tt/'+id,{lin:4,date:'2026-12-20'})).s===200,'админ меняет количества и дату');
  ok((await apiAs(adm,'POST',`/api/lists/${id}/onsite/reset`,{})).s===200,'пересоздание из шаблона');
  st=(await apiAs(adm,'GET','/api/state')).j;ok(st.lists[id].onsite.some(i=>i.text.includes('{dem}'))&&st.tt[id].lin===4,'пункты демонтажа с новыми цифрами');
  // Excel
  for(const [p,label] of [[`/api/export/${id}/prep`,'подготовка'],[`/api/export/${id}/onsite`,'отработка'],['/api/orders.xlsx','сводка']]){const r=await apiAs(adm,'GET',p);const f=path.join(OUT,label+'.xlsx');fs.writeFileSync(f,r.j);
    let okx=false,info='';try{info=execFileSync('python3',['-I','-c','import openpyxl,sys;ws=openpyxl.load_workbook(sys.argv[1]).active;print(ws.max_row,ws["A1"].value)',f]).toString().trim();okx=r.s===200}catch(e){info=String(e)}ok(okx,'Excel «'+label+'» открывается',info)}
  ok((await apiAs(adm,'DELETE','/api/tt/'+id)).s===200,'удаление ТТ');st=(await apiAs(adm,'GET','/api/state')).j;ok(!st.tt[id]&&!st.lists[id],'ТТ удалена полностью');
  const jr=(await apiAs(adm,'GET','/api/journal?limit=50')).j.rows;ok(jr.some(r=>r.action==='Удалена ТТ')&&jr.some(r=>r.action==='Подтверждено'),'журнал пишет действия');
}
/* ===== 6. Перезапуск сервера ===== */
section('6. Перезапуск сервера');
{ const c=await newCtx();const A=await c.newPage();watch(A,'restart');await loginUI(A,'Admin','admin');await A.click('[data-view=users]');await A.waitForSelector('#nu-login');await A.fill('#nu-login','qa_restart');
  const before=(await apiAs(await tokenFor('Admin','admin'),'GET','/api/state')).j.v;
  await stop();await A.waitForTimeout(2500);ok(!!(await A.$('#net-root .offline')),'при остановке сервера — предупреждение');
  await start();await A.waitForTimeout(5000);
  ok(!(await A.$('#net-root .offline')),'после запуска связь восстановилась сама');
  ok(await val(A,'#nu-login')==='qa_restart','введённое в форме пережило перезапуск');
  ok((await A.textContent('.who b'))==='Администратор','сессия пережила перезапуск');
  ok((await apiAs(await tokenFor('Admin','admin'),'GET','/api/state')).j.v>=before,'данные на месте');
  await c.close();
}
/* ===== 8. Удаление и редактирование (админ) ===== */
section('8. Удаление и редактирование');
{ const adm=await tokenFor('Admin','admin');const strip=L=>JSON.stringify(L.map(i=>[i.g,i.text,i.req,(i.sub||[]).map(x=>x.text)]));
  const params={city:'Пилотск',fmt:'Реми',ul:'ООО «Тест»',skit:'4',ncr:'2',lin:'1'};
  const before=(await apiAs(adm,'POST','/api/tt',{name:'Шаблон до правок',...params})).j.id;
  const c=await newCtx();const A=await c.newPage();watch(A,'delete');await loginUI(A,'Admin','admin');
  // удаление пункта в обычном режиме
  await A.click('[data-toggle="t06"]');await A.waitForTimeout(300);
  const key=await A.evaluate(()=>document.querySelector('#tt-t06 [data-item-delask]').dataset.itemDelask);const iid=key.split('|')[2];
  const eng=await engToken('Удалов Инженер');await apiAs(eng,'POST','/api/comments',{tt:'t06',sec:'onsite',item:iid,text:'к удалению'});
  await A.click(`[data-item-delask="${key}"]`);await A.click(`[data-item-del="${key}"]`);await A.waitForTimeout(800);
  let st=(await apiAs(adm,'GET','/api/state')).j;ok(!st.lists.t06.onsite.some(i=>i.id===iid),'пункт удалён кнопкой ✕ с подтверждением');
  ok(!(st.comments.t06||[]).some(x=>x.key===iid),'комментарии удалённого пункта убраны из базы');
  // редактирование подпунктов в режиме правки
  await A.click('[data-edit="t06"]');await A.waitForTimeout(300);
  const subIn=await A.$('[data-eds$="|0|text"]');const sk=await subIn.getAttribute('data-eds');const [,k]=sk.split('|');
  await subIn.fill('Переименованный подпункт');await subIn.press('Tab');await A.waitForTimeout(700);
  await A.fill(`[data-esnew="t06|${k}"]`,'Новый подпункт админа');await A.click(`[data-esadd="t06|${k}"]`);await A.waitForTimeout(700);
  st=(await apiAs(adm,'GET','/api/state')).j;let it=st.lists.t06.onsite[+k];
  ok(it.sub[0].text==='Переименованный подпункт','подпункт переименован в режиме правки',it.sub[0].text);
  ok(it.sub[it.sub.length-1].text==='Новый подпункт админа'&&it.sub[it.sub.length-1].id,'подпункт добавлен в режиме правки');
  const n0=it.sub.length;await A.click(`[data-esmv="t06|${k}|0|1"]`);await A.waitForTimeout(700);st=(await apiAs(adm,'GET','/api/state')).j;it=st.lists.t06.onsite[+k];
  ok(it.sub[1].text==='Переименованный подпункт','подпункт перемещён вниз');
  await A.click(`[data-esrm="t06|${k}|1"]`);await A.waitForTimeout(700);st=(await apiAs(adm,'GET','/api/state')).j;it=st.lists.t06.onsite[+k];
  ok(it.sub.length===n0-1&&!it.sub.some(x=>x.text==='Переименованный подпункт'),'подпункт удалён в режиме правки');
  // шаблон для новых ТТ не меняется
  const after=(await apiAs(adm,'POST','/api/tt',{name:'Шаблон после правок',...params})).j.id;st=(await apiAs(adm,'GET','/api/state')).j;
  ok(strip(st.lists[before].onsite)===strip(st.lists[after].onsite)&&strip(st.lists[before].prep)===strip(st.lists[after].prep),'новая ТТ после правок получила тот же исходный шаблон');
  ok(!strip(st.lists[after].onsite).includes('Новый подпункт админа'),'правки одной ТТ не попали в новые ТТ');
  // удаление ТТ целиком кнопкой сверху карточки
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const ph=await apiAs(adm,'POST','/api/photos',{tt:after,sec:'onsite',item:st.lists[after].onsite[0].id,data:png});const pfile=fs.readdirSync(path.join(ROOT,'data','photos')).find(f=>f.startsWith(ph.j.id));
  await A.click('[data-edit="t06"]');await A.reload();await A.waitForSelector('.tt');
  await A.fill('#q','Шаблон после правок');await A.waitForTimeout(300);await A.click(`[data-toggle="${after}"]`);await A.waitForTimeout(300);
  const top=await A.evaluate(id=>{const r=document.querySelector(`#tt-${id} .adm-row`);const c=document.querySelector(`#tt-${id} .grp`);return !!r&&!!c&&r.getBoundingClientRect().top<c.getBoundingClientRect().top},after);ok(top,'кнопки админа вверху карточки');
  await A.click(`[data-del-tt="${after}"]`);await A.click(`[data-del-ok="${after}"]`);await A.waitForTimeout(800);
  st=(await apiAs(adm,'GET','/api/state')).j;ok(!st.tt[after]&&!st.lists[after]&&!st.checks[after],'ТТ удалена целиком');
  ok(!fs.existsSync(path.join(ROOT,'data','photos',pfile)),'фото удалённой ТТ стёрты с диска');
  await apiAs(adm,'DELETE','/api/tt/'+before);
  // удаление пользователя
  await apiAs(adm,'POST','/api/users',{login:'qa_del',name:'Удаляемый Старший',password:'1111',role:'lead',tts:'all'});const delTok=await tokenFor('qa_del','1111');
  await A.fill('#q','');await A.click('[data-view=users]');await A.waitForSelector('[data-user-delask="qa_del"]');
  await A.click('[data-user-delask="qa_del"]');await A.click('[data-user-del="qa_del"]');await A.waitForTimeout(800);
  const us=(await apiAs(adm,'GET','/api/users')).j.users;ok(!us.some(u=>u.login==='qa_del'),'пользователь удалён');
  ok((await apiAs(delTok,'GET','/api/state')).s===401,'его открытые сессии закрыты');
  ok((await apiAs(null,'POST','/api/login',{login:'qa_del',password:'1111'})).s===401,'удалённый не может войти');
  ok(!(await A.$('[data-user-delask="Admin"]')),'кнопки удаления себя нет');ok((await apiAs(adm,'DELETE','/api/users/Admin')).s===409,'API не даёт удалить себя');
  const lead=await tokenFor('ITlead','lead');ok((await apiAs(lead,'DELETE','/api/users/qa_multi')).s===403,'старший не удаляет пользователей');
  const jr=(await apiAs(adm,'GET','/api/journal?limit=40')).j.rows;ok(jr.some(r=>r.action==='Удалён пользователь')&&jr.some(r=>r.action==='Удалена ТТ'),'удаления записаны в журнал');
  await c.close();
}
/* ===== 7. Все экраны всех ролей без ошибок ===== */
section('7. Экраны, телефон, тёмная тема');
for(const [w,h,cs] of [[1300,900,'light'],[390,844,'dark']]){
  for(const [l,pw] of [['Admin','admin'],['ITlead','lead'],[null,null]]){
    const c=await newCtx({viewport:{width:w,height:h},colorScheme:cs});const p=await c.newPage();const label=(l||'инженер')+' '+w;watch(p,label);
    if(l)await loginUI(p,l,pw);else{await p.goto(B);await p.fill('#lg-fio','Экранов Инженер');await p.click('#lg-eng');await p.waitForSelector('#eng-tt');await p.selectOption('#eng-tt','t01');await p.waitForTimeout(300)}
    const tabs=await p.$$eval('[data-view]',x=>x.map(e=>e.dataset.view));
    for(const v of tabs){await p.click(`[data-view="${v}"]`);await p.waitForTimeout(400);if(v==='onsite'||v==='prep'){if(l){await p.click('[data-act=expand]');await p.waitForTimeout(400)}}
      const ov=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);ok(ov<=1,`${label}: «${v}» без горизонтальной прокрутки`,ov);
      await p.screenshot({path:path.join(OUT,`${label.replace(/\s/g,'_')}_${v}.png`)});}
    await c.close();}
}
ok(consoleErrs.length===0,'нет ошибок JavaScript ни на одном экране',consoleErrs.join(' || '));
await b.close();await stop();
const fail=results.filter(r=>!r.ok);fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,1));
console.log(`\nИТОГО: ${results.length} проверок, пройдено ${results.length-fail.length}, ошибок ${fail.length}`);fail.forEach(f=>console.log(' ✗',f.sec,'|',f.name,'|',f.extra));
process.exit(0)})().catch(async e=>{console.log('СБОЙ ТЕСТА:',e);await stop();process.exit(1)});
