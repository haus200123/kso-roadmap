"use strict";
/* Дорожная карта КСО — локальный сервер. Без внешних зависимостей: только Node.js 18+. */
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto"),os=require("os"),url=require("url");
const {genLists,WIKI_ROOT,TEMPLATE_VERSION}=require("./lib/template.js");
const MIG=require("./lib/migrate.js");
const {buildXlsx}=require("./lib/xlsx.js");
const K=require("./lib/common.js");

const major=+process.versions.node.split(".")[0];
if(major<18){console.log("Нужен Node.js 18 или новее. Удалите папку site\\runtime и запустите Start.bat снова.");process.exit(3)}

const SITE=__dirname, ROOT=path.resolve(SITE,".."), DATA=path.join(ROOT,"data");
const PHOTOS=path.join(DATA,"photos"), BACKUPS=path.join(DATA,"backups");
const F={db:path.join(DATA,"db.json"),sessions:path.join(DATA,"sessions.json"),journal:path.join(DATA,"journal.log"),config:path.join(DATA,"config.json")};
[DATA,PHOTOS,BACKUPS].forEach(d=>fs.mkdirSync(d,{recursive:true}));

/* ---------- настройки ---------- */
const DEFAULT_CFG={port:8080,backupKeepDays:14,openBrowser:true};
let CFG=DEFAULT_CFG;
try{CFG={...DEFAULT_CFG,...JSON.parse(fs.readFileSync(F.config,"utf8"))}}catch(e){fs.writeFileSync(F.config,JSON.stringify(DEFAULT_CFG,null,2))}

/* ---------- хранилище ---------- */
function hashPass(p,salt){salt=salt||crypto.randomBytes(16).toString("hex");return {salt,hash:crypto.scryptSync(String(p),salt,32).toString("hex")}}
function checkPass(p,u){const h=crypto.scryptSync(String(p),u.salt,32);return crypto.timingSafeEqual(h,Buffer.from(u.hash,"hex"))}
function atomicWrite(file,text){
  const tmp=file+".tmp";fs.writeFileSync(tmp,text);
  for(let i=0;i<5;i++){try{fs.renameSync(tmp,file);return}catch(e){if(i===4){fs.copyFileSync(tmp,file);try{fs.unlinkSync(tmp)}catch(_){}}}}
}
let DB;
function loadDB(){
  if(fs.existsSync(F.db)){DB=JSON.parse(fs.readFileSync(F.db,"utf8"));}
  else{
    const seed=JSON.parse(fs.readFileSync(path.join(SITE,"seed.json"),"utf8"));
    DB={v:1,tt:seed.tt,lists:seed.lists,checks:seed.checks,photos:{},users:{}};
    const mk=(login,name,role,p)=>{DB.users[login.toLowerCase()]={login,name,role,active:true,...hashPass(p)}};
    mk("Admin","Администратор","admin","admin");mk("ITlead","Старший сотрудник","lead","lead");
    saveDB();console.log("Создана новая база данных: data\\db.json");
  }
  DB.photos=DB.photos||{};DB.users=DB.users||{};DB.comments=DB.comments||{};DB.checks=DB.checks||{};DB.lists=DB.lists||{};DB.removed=DB.removed||{};DB.waves=DB.waves||[];
  if(DB.tplVersion!==TEMPLATE_VERSION||!DB.planImport){
    /* перед переносом базы на новую версию — копия как есть */
    if(fs.existsSync(F.db)){const d=path.join(BACKUPS,"before-v4-"+K.isoD(new Date())+"-"+Date.now().toString(36));fs.mkdirSync(d,{recursive:true});fs.copyFileSync(F.db,path.join(d,"db.json"));console.log("Копия базы перед обновлением: "+d)}
  }
  const msgs=[];
  if(MIG.migrate(DB,{site:SITE,newId,log:m=>{msgs.push(m);console.log("  "+m)}})){saveDB();if(msgs.length)journal(null,{name:"Сайт"},"Обновление сайта",{details:msgs.join("; ")})}
}
let saveTimer=null;
function saveDB(){atomicWrite(F.db,JSON.stringify(DB))}
function commit(){DB.v=(DB.v||0)+1;clearTimeout(saveTimer);saveDB();broadcast()}

let SESS={};
try{SESS=JSON.parse(fs.readFileSync(F.sessions,"utf8"))}catch(e){SESS={}}
function saveSess(){const now=Date.now();Object.keys(SESS).forEach(k=>{if(SESS[k].exp<now)delete SESS[k]});atomicWrite(F.sessions,JSON.stringify(SESS))}

function journal(req,who,action,details){
  const line=JSON.stringify({at:new Date().toISOString(),t:K.stamp(),who:who?who.name:"",login:who?who.login||"":"",role:who?who.role:"",ip:ipOf(req),action,...(details||{})});
  fs.appendFile(F.journal,line+"\n",()=>{});
}
function readJournal(limit,q){
  if(!fs.existsSync(F.journal))return [];
  const st=fs.statSync(F.journal),len=Math.min(st.size,4*1024*1024);
  const fd=fs.openSync(F.journal,"r"),buf=Buffer.alloc(len);fs.readSync(fd,buf,0,len,st.size-len);fs.closeSync(fd);
  let lines=buf.toString("utf8").split("\n").filter(Boolean);if(len<st.size)lines.shift();
  let rows=lines.map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean).reverse();
  if(q){q=q.toLowerCase();rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q))}
  return rows.slice(0,limit);
}

/* ---------- бэкап ---------- */
function backup(){
  try{
    const day=K.isoD(new Date()),dir=path.join(BACKUPS,day);
    if(!fs.existsSync(dir)){
      fs.mkdirSync(dir,{recursive:true});
      fs.copyFileSync(F.db,path.join(dir,"db.json"));
      if(fs.existsSync(F.journal))fs.copyFileSync(F.journal,path.join(dir,"journal.log"));
      const keep=Math.max(1,+CFG.backupKeepDays||14);
      const days=fs.readdirSync(BACKUPS).filter(n=>/^\d{4}-\d\d-\d\d$/.test(n)).sort();
      days.slice(0,Math.max(0,days.length-keep)).forEach(n=>fs.rmSync(path.join(BACKUPS,n),{recursive:true,force:true}));
      console.log("Резервная копия базы: data\\backups\\"+day);
    }
    const arch=path.join(BACKUPS,"photos");fs.mkdirSync(arch,{recursive:true});
    fs.readdirSync(PHOTOS).forEach(f=>{const d=path.join(arch,f);if(!fs.existsSync(d))fs.copyFileSync(path.join(PHOTOS,f),d)});
  }catch(e){console.log("Ошибка резервного копирования:",e.message)}
}

/* ---------- HTTP-утилиты ---------- */
function ipOf(req){return req?(req.socket.remoteAddress||"").replace(/^::ffff:/,""):""}
function send(res,code,obj,headers){const b=Buffer.from(JSON.stringify(obj));res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Content-Length":b.length,"Cache-Control":"no-store",...(headers||{})});res.end(b)}
const err=(res,code,msg)=>send(res,code,{error:msg});
function body(req,limit){return new Promise((ok,no)=>{let n=0;const ch=[];req.on("data",c=>{n+=c.length;if(n>limit){no(new Error("big"));req.destroy();return}ch.push(c)});req.on("end",()=>{try{ok(ch.length?JSON.parse(Buffer.concat(ch).toString("utf8")):{})}catch(e){no(e)}});req.on("error",no)})}
function cookies(req){const o={};(req.headers.cookie||"").split(";").forEach(p=>{const i=p.indexOf("=");if(i>0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())});return o}
/* Сессия передаётся токеном отдельно для каждого окна браузера (заголовок X-KSO-Token или ?s= для картинок, файлов и потока событий) */
/* Порядок: заголовок окна → параметр ?s= (если прокси вырезает заголовки) → cookie kso_sid (если браузеру запрещено хранилище сайта) */
function tokOf(req){const h=req.headers["x-kso-token"];if(h)return String(h);const q=url.parse(req.url,true).query.s;if(q)return String(q);return cookies(req).kso_sid||""}
const CLEAR_COOKIE={"Set-Cookie":["sid=; Path=/; Max-Age=0","kso_sid=; Path=/; Max-Age=0"]};
const sessCookie=(tok,rem)=>({"Set-Cookie":["sid=; Path=/; Max-Age=0",`kso_sid=${tok}; Path=/; HttpOnly; SameSite=Lax`+(rem?`; Max-Age=${72*3600}`:"")]});
function who(req){const t=tokOf(req);const s=t&&SESS[t];if(!s||s.exp<Date.now())return null;if(s.role!=="engineer"){const u=DB.users[(s.login||"").toLowerCase()];if(!u||!u.active)return null;s.name=u.name;s.role=u.role;s.tts=u.role==="lead"&&Array.isArray(u.tts)?u.tts:null}return s}
const MIME={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".jpg":"image/jpeg",".png":"image/png",".svg":"image/svg+xml",".ico":"image/x-icon"};
function serveFile(res,file,extra){fs.readFile(file,(e,b)=>{if(e)return err(res,404,"Не найдено");res.writeHead(200,{"Content-Type":MIME[path.extname(file)]||"application/octet-stream","Content-Length":b.length,...(extra||{})});res.end(b)})}

/* ---------- живые обновления ---------- */
const clients=new Set();
function broadcast(){const m=`data: {"v":${DB.v}}\n\n`;clients.forEach(c=>{try{c.write(m)}catch(e){}})}
setInterval(()=>clients.forEach(c=>{try{c.write(": ping\n\n")}catch(e){}}),25000);

/* ---------- правила ---------- */
const NUMF=["skit","bag","csik","ncr","demCsik","lin","rKkt","rTerm","rCol","oTerm","oKkt","oFn","oCol","oGaz","outSkit","buyTables","buyKvp"];
const BASEF=["skit","csik","ncr","demCsik","lin"];
const TXTF=["name","city","fmt","ul","csikFrom","note","date","skitFrom","outSkitTo","demCsikTo","code","region"];
const NUM_LABEL={skit:"S.kit",bag:"пакетн. зона",csik:"перенос CSIK",ncr:"демонтаж NCR",demCsik:"демонтаж CSIK",lin:"демонтаж лин. касс",rKkt:"ККТ Кварц 2Ф с демонтажа",rTerm:"терминалы с демонтажа",rCol:"колонки с NCR",oTerm:"терминалы новые",oKkt:"ККТ Нова Принт новые",oFn:"ФН",oCol:"колонки новые",oGaz:"метки ДемоБанка",outSkit:"отправка S.kit",buyTables:"жел. столы",buyKvp:"КВП"};
const waveOk=w=>w===""||(DB.waves||[]).some(x=>x.id===w);
const waveName=w=>((DB.waves||[]).find(x=>x.id===w)||{name:"без волны"}).name;
/* пересчёт чек-листов ТТ по новым количествам: отметки, комментарии, фото и свои пункты остаются */
function resync(id){return MIG.syncTT(DB,id,newId)}
function remember(id,sec,keys){DB.removed[id]=DB.removed[id]||{prep:[],onsite:[]};const R=DB.removed[id][sec]=DB.removed[id][sec]||[];keys.filter(Boolean).forEach(k=>{if(!R.includes(k))R.push(k)})}
const SECS=["prep","onsite"];
function chk(id,sec,iid){return ((DB.checks[id]||{})[sec]||{})[iid]||{st:"none"}}
function setChk(id,sec,iid,o){DB.checks[id]=DB.checks[id]||{prep:{},onsite:{}};DB.checks[id][sec]=DB.checks[id][sec]||{};DB.checks[id][sec][iid]={st:"none",by:"",role:"",at:"",cby:"",cat:"",note:"",...o}}
function itemOf(id,sec,iid){return ((DB.lists[id]||{})[sec]||[]).find(i=>i.id===iid)}
const ckey=(iid,sid)=>sid?iid+"~"+sid:iid;
/* Удаляет отметки, комментарии и фото пунктов и подпунктов, которых больше нет в чек-листе */
function cleanupOrphans(id,sec){
  const keys=new Set();((DB.lists[id]||{})[sec]||[]).forEach(i=>{keys.add(i.id);(i.sub||[]).forEach(x=>keys.add(ckey(i.id,x.id)))});
  const items=new Set(((DB.lists[id]||{})[sec]||[]).map(i=>i.id));let n=0;
  const C=(DB.checks[id]||{})[sec]||{};Object.keys(C).forEach(k=>{if(!keys.has(k)){delete C[k];n++}});
  if(DB.comments[id]){const before=DB.comments[id].length;DB.comments[id]=DB.comments[id].filter(c=>c.sec!==sec||keys.has(c.key));n+=before-DB.comments[id].length}
  Object.entries(DB.photos).forEach(([pid,ph])=>{if(ph.tt===id&&ph.sec===sec&&!items.has(ph.item)){try{fs.unlinkSync(path.join(PHOTOS,ph.file))}catch(e){}delete DB.photos[pid];n++}});
  return n;
}
function isDone(id,sec,it){if(it.sub&&it.sub.length)return it.sub.every(x=>chk(id,sec,ckey(it.id,x.id)).st==="done");return chk(id,sec,it.id).st==="done"}
function cleanSub(arr){return (Array.isArray(arr)?arr:[]).slice(0,60).map(x=>({id:String(x.id||newId("s")).slice(0,40),...(x.tk?{tk:String(x.tk).slice(0,500)}:{}),text:String(x.text||"").slice(0,500),link:safeLink(x.link)})).filter(x=>x.text)}
function safeLink(u){u=String(u||"").trim().slice(0,600);return /^https?:\/\//i.test(u)?u:""}
function newId(p){return p+Date.now().toString(36)+crypto.randomBytes(3).toString("hex")}
const loginFails={};

/* ---------- Excel ---------- */
function checklistXlsx(id,sec,s){
  const t=DB.tt[id],L=(DB.lists[id]||{})[sec]||[],P=sec==="prep";
  const owner=(t.owner||{})[sec]||"",ex=(t.exec||{})[sec]||"";
  const NC=P?6:4,last=P?"F":"D";
  const rows=[],merges=[];let r=0;
  const push=(cells,h)=>{rows.push({cells,h});return ++r};
  const m=(a,b)=>merges.push(a+r+":"+b+r);
  const fill=(v,st)=>{const c=[{v,s:st}];for(let i=1;i<NC;i++)c.push({s:st});return c};
  const hl=(txt,st,h)=>{push(fill(txt,st),h);m("A",last)};
  const H=(text,w)=>Math.max(30,Math.ceil(text.length/w)*15+8);
  hl("Чек-лист: "+K.SECX[sec],1,26);
  hl("ТТ: "+t.city+", "+t.name+(t.code?"  (№"+t.code+")":"")+(t.wave?"   ·   "+waveName(t.wave):""),2,20);
  hl("Формат: "+t.fmt+"   ·   Юрлицо: "+t.ul,9);
  hl("Дата работ: "+(t.date?K.fd(t.date):"не назначена"),9);
  hl("Ответственный: "+(owner||"—")+"   ·   Исполнитель: "+(ex||"—"),9);
  const ql=K.qtyLine(t).join("; ");hl("Кассы: "+(ql||"—"),9,ql.length>90?32:18);
  push([]);
  push(P?[{v:"№",s:8},{v:"Пункт",s:8},{v:"✓",s:8},{v:"Доп. ответственный",s:8},{v:"Уточнять у",s:8},{v:"Примечание",s:8}]:[{v:"№",s:8},{v:"Пункт",s:8},{v:"✓",s:8},{v:"Примечание",s:8}],20);
  let n=0;
  K.groups(L).forEach(g=>{
    push(fill(g.name,4),20);m("A",last);
    g.items.forEach(i=>{n++;let text=(i.req?"* ":"")+K.tok(i.text,t);if(P&&t.date)text+="  (срок "+K.fd(K.addD(t.date,+i.d||0))+")";if(i.ph)text+="  [фото]";
      const hasSub=i.sub&&i.sub.length;
      const row=[{v:n,s:6},{v:text,s:hasSub?10:3},{v:hasSub?"":"☐",s:5}];if(P)row.push({v:i.resp||"",s:3},{v:i.who||"",s:3});row.push({v:"",s:3});
      push(row,H(text,P?44:62));
      (i.sub||[]).forEach((x,k)=>{const tx="    • "+K.tok(x.text,t);const sr=[{v:n+"."+(k+1),s:6},{v:tx,s:3},{v:"☐",s:5}];if(P)sr.push({v:"",s:3},{v:"",s:3});sr.push({v:"",s:3});push(sr,H(tx,P?50:62))});
    });
  });
  push([]);hl("* — обязательный пункт; [фото] — приложить фото на сайте; пункт с подзадачами закрыт, когда выполнены все подзадачи",7,28);push([]);
  hl("Инженер (ФИО): ________________________   Подпись: ____________   Дата: ____________",9,24);
  hl("Проверил (старший): ____________________   Подпись: ____________   Дата: ____________",9,24);
  hl("Выгружено "+K.stamp()+" · "+s.name,7);
  return Buffer.from(buildXlsx({name:K.SECX[sec],cols:P?[6,48,7,17,16,14]:[6,64,7,22],rows,merges}));
}
function ordersXlsx(only,wave){
  let src=only?Object.fromEntries(only.filter(id=>DB.tt[id]).map(id=>[id,DB.tt[id]])):DB.tt;
  if(wave!==undefined&&wave!==null&&wave!=="all")src=Object.fromEntries(Object.entries(src).filter(([,t])=>(t.wave||"")===wave));
  const R=K.orderRows(src),C=K.ORDER_COLS;const rows=[],merges=["A1:"+String.fromCharCode(64+C.length)+"1"];
  rows.push({h:26,cells:[{v:"Сводка заказа по юрлицам"+(wave&&wave!=="all"?" · "+waveName(wave):"")+" · "+K.stamp(),s:1}]});rows.push({cells:[]});
  rows.push({h:34,cells:C.map(c=>({v:c[1],s:8}))});
  R.forEach(r=>rows.push({h:20,cells:C.map(([k])=>({v:k==="ul"?r[k]:r[k],s:k==="ul"?3:6}))}));
  const tot={ul:"Итого"};C.slice(1).forEach(([k])=>tot[k]=R.reduce((a,x)=>a+x[k],0));
  rows.push({h:20,cells:C.map(([k])=>({v:tot[k],s:k==="ul"?4:8}))});
  return Buffer.from(buildXlsx({name:"Заказ по ЮЛ",cols:[26,6,8,10,10,10,11,10,8,9,10,11,9,8,14],rows,merges}));
}
function xlsxHeaders(name,len){return {"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Length":len,"Content-Disposition":`attachment; filename="checklist.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`}}

/* ---------- маршруты ---------- */
async function handle(req,res){
  const u=url.parse(req.url,true),p=decodeURIComponent(u.pathname),M=req.method;
  // статика
  if(M==="GET"&&(p==="/"||p==="/index.html"))return serveFile(res,path.join(SITE,"public","index.html"),{"Cache-Control":"no-store"});
  if(M==="GET"&&p==="/lib/common.js")return serveFile(res,path.join(SITE,"lib","common.js"));
  if(M==="GET"&&p.startsWith("/static/")){const f=path.normalize(path.join(SITE,"public",p.slice(8)));if(!f.startsWith(path.join(SITE,"public")))return err(res,403,"Нет доступа");return serveFile(res,f)}

  // вход
  if(M==="POST"&&p==="/api/login"){
    const ip=ipOf(req),lf=loginFails[ip];if(lf&&lf.until>Date.now())return err(res,429,"Слишком много попыток. Подождите минуту.");
    const b=await body(req,1e4);const usr=DB.users[String(b.login||"").trim().toLowerCase()];
    if(!usr||!usr.active||!checkPass(b.password||"",usr)){const x=loginFails[ip]||(loginFails[ip]={n:0,until:0});x.n++;if(x.n>=5){x.until=Date.now()+60000;x.n=0}journal(req,{name:String(b.login||"").slice(0,40)},"Неудачный вход");return err(res,401,"Неверный логин или пароль")}
    delete loginFails[ip];
    const tok=crypto.randomBytes(24).toString("hex"),rem=!!b.remember,ttl=rem?72*3600e3:12*3600e3;
    SESS[tok]={role:usr.role,name:usr.name,login:usr.login,exp:Date.now()+ttl};saveSess();journal(req,SESS[tok],"Вход"+(rem?" (запомнить на 72 ч)":""));
    return send(res,200,{ok:true,token:tok,ttl},sessCookie(tok,rem));
  }
  if(M==="POST"&&p==="/api/login-engineer"){
    const b=await body(req,1e4);const v=K.checkFio(b.name);if(v.error)return err(res,400,v.error);const name=v.name;
    const tok=crypto.randomBytes(24).toString("hex");SESS[tok]={role:"engineer",name,exp:Date.now()+16*3600e3};saveSess();journal(req,SESS[tok],"Вход инженера");
    return send(res,200,{ok:true,token:tok,name},sessCookie(tok,false));
  }
  const s=who(req);
  if(M==="POST"&&p==="/api/logout"){const t=tokOf(req);if(s)journal(req,s,"Выход");if(t&&SESS[t]){delete SESS[t];saveSess()}return send(res,200,{ok:true},cookies(req).kso_sid===t?CLEAR_COOKIE:{})}
  if(M==="GET"&&p==="/api/me")return send(res,200,s?{role:s.role,name:s.name,login:s.login||""}:{role:null});
  if(!s)return err(res,401,"Войдите заново");
  const isA=s.role==="admin",isL=s.role==="lead",isE=s.role==="engineer";
  const canTT=id=>!isL||!s.tts||s.tts.includes(id);
  const noTT=()=>err(res,403,"Эта ТТ вам не назначена");

  if(M==="GET"&&p==="/api/events"){
    res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-store","Connection":"keep-alive"});res.write(`data: {"v":${DB.v}}\n\n`);
    clients.add(res);req.on("close",()=>clients.delete(res));return;
  }
  if(M==="GET"&&p==="/api/state"){
    const pick=o=>{if(!isL||!s.tts)return o;const r={};s.tts.forEach(id=>{if(o[id]!==undefined)r[id]=o[id]});return r};
    const photos={};Object.entries(DB.photos).forEach(([k,v])=>{if(canTT(v.tt))photos[k]={tt:v.tt,sec:v.sec,item:v.item,by:v.by,role:v.role,at:v.at}});
    const extra=isA?{people:[...new Set(Object.values(DB.users).filter(x=>x.active).map(x=>x.name))]}:{};
    return send(res,200,{v:DB.v,waves:DB.waves,tt:pick(DB.tt),lists:pick(DB.lists),checks:pick(DB.checks),photos,comments:pick(DB.comments),wikiRoot:WIKI_ROOT,today:K.isoD(new Date()),limited:!!(isL&&s.tts),...extra});
  }
  // ТТ
  let mm;
  if(M==="PATCH"&&(mm=p.match(/^\/api\/tt\/([\w-]+)$/))){
    const id=mm[1],t=DB.tt[id];if(!t)return err(res,404,"ТТ не найдена");if(isE)return err(res,403,"Нет прав");if(!canTT(id))return noTT();
    const b=await body(req,1e5),ch=[];
    if(b.exec&&typeof b.exec==="object")SECS.forEach(sec=>{if(typeof b.exec[sec]==="string"){t.exec=t.exec||{};const v=b.exec[sec].trim().slice(0,80);if(t.exec[sec]!==v){ch.push(`исполнитель (${K.SECX[sec]}): ${v||"—"}`);t.exec[sec]=v}}});
    if(isA){
      if(b.owner&&typeof b.owner==="object")SECS.forEach(sec=>{if(typeof b.owner[sec]==="string"){t.owner=t.owner||{};const v=b.owner[sec].trim().slice(0,80);if(t.owner[sec]!==v){ch.push(`ответственный (${K.SECX[sec]}): ${v||"—"}`);t.owner[sec]=v}}});
      let qty=false;
      NUMF.forEach(k=>{if(b[k]!==undefined&&b[k]!==null&&b[k]!==""){let v=Math.max(0,Math.min(999,Math.round(+b[k]||0)));if(k==="bag")v=v>=2?2:1;if((+t[k]||0)!==v||t[k]===undefined){ch.push(`${NUM_LABEL[k]||k}: ${+t[k]||0} → ${v}`);t[k]=v;qty=true;if(K.DERIVED.includes(k)&&b.auto!==true)t.auto=false}}});
      if(b.auto===true&&t.auto!==true){t.auto=true;ch.push("ККТ, терминалы, ФН и колонки — считаются автоматически")}
      if(b.auto===false&&t.auto!==false){t.auto=false;ch.push("авто-расчёт ККТ выключен")}
      if(t.auto!==false&&(qty||b.auto===true)){const a=K.autoCalc(t);K.DERIVED.forEach(k=>{if((+t[k]||0)!==a[k]){ch.push(`${NUM_LABEL[k]}: ${+t[k]||0} → ${a[k]} (авто)`);t[k]=a[k]}})}
      TXTF.forEach(k=>{if(typeof b[k]==="string"){let v=b[k].trim().slice(0,k==="note"?2000:300);if(k==="date"&&v&&!/^\d{4}-\d\d-\d\d$/.test(v))return;if((t[k]||"")!==v){ch.push(k==="date"?`дата: ${K.fd(t[k])||"—"} → ${K.fd(v)||"—"}`:`${k}: ${v}`);if(["skitFrom","demCsikTo","outSkitTo"].includes(k))qty=true;t[k]=v}}});
      if(typeof b.wave==="string"&&b.wave!==(t.wave||"")){if(!waveOk(b.wave))return err(res,400,"Нет такой волны");ch.push(`волна: ${waveName(t.wave||"")} → ${waveName(b.wave)}`);t.wave=b.wave}
      if(typeof b.leg==="boolean"&&b.leg!==!!t.leg){t.leg=b.leg;qty=true;ch.push("нога столо-ящика: "+(b.leg?"да":"нет"))}
      if(qty){const r=resync(id);if(r.added||r.dropped)ch.push(`чек-листы: +${r.added} / −${r.dropped} пунктов`)}
    }else if(Object.keys(b).some(k=>k!=="exec"))return err(res,403,"Менять эти поля может только администратор");
    if(ch.length){commit();journal(req,s,"Изменена ТТ",{tt:t.name,details:ch.join("; ")})}
    return send(res,200,{ok:true,v:DB.v,t});
  }
  if(M==="POST"&&p==="/api/tt"){
    if(!isA)return err(res,403,"Нет прав");const b=await body(req,1e5);let name=String(b.name||"").trim().slice(0,200),city=String(b.city||"").trim().slice(0,100);if(!name)return err(res,400,"Укажите адрес ТТ");
    {const x={name,city};MIG.fixCityName(x);name=x.name;city=x.city}
    const has=k=>b[k]!==undefined&&b[k]!==null&&String(b[k]).trim()!=="";
    const n=(k,def)=>has(k)?Math.max(0,Math.min(999,Math.round(+b[k]||0))):def;
    const fmt=String(b.fmt||"").trim().slice(0,60)||"Реми";
    const skit=n("skit",0),csik=n("csik",0),ncr=n("ncr",0),lin=n("lin",0),demCsik=n("demCsik",0),kso=skit+csik,dem=ncr+lin+demCsik;
    const A=K.autoCalc({skit,csik,ncr,lin,demCsik});
    const rKkt=n("rKkt",A.rKkt),rTerm=n("rTerm",A.rTerm),rCol=n("rCol",A.rCol);
    const wave=waveOk(String(b.wave||""))?String(b.wave||""):"";
    const t={name,city,fmt,ul:String(b.ul||"").trim().slice(0,100),date:/^\d{4}-\d\d-\d\d$/.test(b.date||"")?b.date:"",
      skit,bag:has("bag")?(+b.bag>=2?2:1):((ncr>0||fmt==="Реми Сити")?2:1),csik,csikFrom:String(b.csikFrom||"").trim().slice(0,200),ncr,demCsik,lin,
      rTerm,rKkt,rCol,oTerm:n("oTerm",Math.max(0,kso-rTerm)),oKkt:n("oKkt",Math.max(0,kso-rKkt)),oFn:n("oFn",Math.max(0,kso-rKkt)),oCol:n("oCol",Math.max(0,skit-rCol)),oGaz:n("oGaz",0),leg:false,note:"",
      wave,code:String(b.code||"").trim().slice(0,20),region:"",skitFrom:String(b.skitFrom||"").trim().slice(0,300),outSkit:n("outSkit",0),outSkitTo:String(b.outSkitTo||"").trim().slice(0,300),demCsikTo:String(b.demCsikTo||"").trim().slice(0,300),buyTables:n("buyTables",0),buyKvp:n("buyKvp",0),
      auto:!K.DERIVED.some(k=>has(k)),
      order:Math.max(0,...Object.values(DB.tt).map(x=>x.order||0))+1,owner:{prep:"",onsite:""},exec:{prep:"",onsite:""}};
    const id=newId("t");DB.tt[id]=t;DB.lists[id]=genLists(t);DB.checks[id]={prep:{},onsite:{}};commit();journal(req,s,"Создана ТТ",{tt:city+", "+name,details:waveName(wave)});
    return send(res,200,{ok:true,id});
  }
  if(M==="DELETE"&&(mm=p.match(/^\/api\/tt\/([\w-]+)$/))){
    if(!isA)return err(res,403,"Нет прав");const id=mm[1],t=DB.tt[id];if(!t)return err(res,404,"ТТ не найдена");
    Object.entries(DB.photos).forEach(([k,v])=>{if(v.tt===id){try{fs.unlinkSync(path.join(PHOTOS,v.file))}catch(e){}delete DB.photos[k]}});
    delete DB.tt[id];delete DB.lists[id];delete DB.checks[id];delete DB.comments[id];delete DB.removed[id];commit();journal(req,s,"Удалена ТТ",{tt:t.name});return send(res,200,{ok:true});
  }
  // чек-листы
  if(M==="PUT"&&(mm=p.match(/^\/api\/lists\/([\w-]+)\/(prep|onsite)$/))){
    if(!isA)return err(res,403,"Нет прав");const [,id,sec]=mm;if(!DB.tt[id])return err(res,404,"ТТ не найдена");
    const b=await body(req,1e6);if(!Array.isArray(b.items))return err(res,400,"Нет пунктов");
    const before=(DB.lists[id]||{})[sec]||[];
    const L=b.items.slice(0,300).map(i=>({id:String(i.id||newId(sec==="prep"?"p":"o")).slice(0,40),...(i.tk?{tk:String(i.tk).slice(0,500)}:{}),g:String(i.g||"Прочее").slice(0,80),text:String(i.text||"").slice(0,500),req:!!i.req,ph:!!i.ph,link:safeLink(i.link),sub:cleanSub(i.sub),...(sec==="prep"?{d:Math.max(0,Math.min(365,+i.d||0)),who:String(i.who||"").slice(0,120)}:{}),resp:String(i.resp||"").slice(0,120)})).filter(i=>i.text);
    {const aIt=new Set(L.map(i=>i.tk).filter(Boolean)),aSub=new Set();L.forEach(i=>(i.sub||[]).forEach(x=>{if(i.tk&&x.tk)aSub.add(i.tk+" >> "+x.tk)}));
     remember(id,sec,before.flatMap(i=>[i.tk&&!aIt.has(i.tk)?i.tk:null,...(i.tk&&aIt.has(i.tk)?(i.sub||[]).map(x=>x.tk&&!aSub.has(i.tk+" >> "+x.tk)?i.tk+" >> "+x.tk:null):[])]))}
    DB.lists[id]=DB.lists[id]||{};DB.lists[id][sec]=L;const gone=cleanupOrphans(id,sec);commit();
    journal(req,s,"Изменён чек-лист",{tt:DB.tt[id].name,sec:K.SECX[sec],details:`пунктов: ${before.length} → ${L.length}`+(gone?`; удалено отметок/комментариев/фото: ${gone}`:"")});return send(res,200,{ok:true});
  }
  if(M==="POST"&&(mm=p.match(/^\/api\/lists\/([\w-]+)\/(prep|onsite)\/reset$/))){
    if(!isA)return err(res,403,"Нет прав");const [,id,sec]=mm;if(!DB.tt[id])return err(res,404,"ТТ не найдена");
    DB.removed[id]=DB.removed[id]||{prep:[],onsite:[]};const was=DB.removed[id][sec]||[];DB.removed[id][sec]=[];const r=resync(id);
    commit();journal(req,s,"Чек-лист сверен с шаблоном",{tt:DB.tt[id].name,sec:K.SECX[sec],details:`возвращено пунктов: ${r.added}`+(was.length?` (ранее удалённых: ${was.length})`:"")});return send(res,200,{ok:true,added:r.added});
  }
  if(M==="POST"&&p==="/api/check"){
    const b=await body(req,1e4),{tt:id,sec,action}=b;
    if(!DB.tt[id]||!SECS.includes(sec))return err(res,404,"Не найдено");if(!canTT(id))return noTT();const it0=itemOf(id,sec,b.item);if(!it0)return err(res,404,"Пункт не найден");
    let it=it0,iid=it0.id;
    if(b.sub){const sb=(it0.sub||[]).find(x=>x.id===b.sub);if(!sb)return err(res,404,"Подзадача не найдена");it={text:it0.text+" → "+sb.text};iid=ckey(it0.id,sb.id)}
    else if(it0.sub&&it0.sub.length)return err(res,409,"У пункта есть подзадачи — отметьте их, пункт закроется сам");
    if(isE&&sec!=="onsite")return err(res,403,"Инженер отмечает только отработку на ТТ");
    const c=chk(id,sec,iid),now=K.stamp(),me=isE?s.name:s.name+" ("+s.login+")";let msg="";
    if(action==="tick"){
      if(isE){
        if(c.st==="done")return err(res,409,"Пункт уже подтверждён старшим");
        if(c.st==="pending"){if(c.by!==s.name)return err(res,409,"Пункт отметил другой инженер");setChk(id,sec,iid,{st:"none"});msg="Снята отметка"}
        else{setChk(id,sec,iid,{st:"pending",by:s.name,role:"engineer",at:now});msg="Отмечено (на проверку)"}
      }else{
        if(c.st==="done"){setChk(id,sec,iid,{st:"none"});msg="Снята отметка"}
        else if(c.st==="pending"){setChk(id,sec,iid,{...c,st:"done",cby:me,cat:now});msg="Подтверждено"}
        else{setChk(id,sec,iid,{st:"done",by:me,role:s.role,at:now});msg="Отмечено"}
      }
    }else if(action==="confirm"||action==="reject"){
      if(isE)return err(res,403,"Нет прав");if(c.st!=="pending")return err(res,409,"Пункт уже не на проверке");
      if(action==="confirm"){setChk(id,sec,iid,{...c,st:"done",cby:me,cat:now});msg="Подтверждено"}
      else{setChk(id,sec,iid,{...c,st:"rejected",cby:me,cat:now,note:String(b.note||"").slice(0,300)});msg="Отклонено"+(b.note?": "+b.note:"")}
    }else return err(res,400,"Неизвестное действие");
    commit();journal(req,s,msg,{tt:DB.tt[id].name,sec:K.SECX[sec],item:K.tok(it.text,DB.tt[id])});return send(res,200,{ok:true});
  }
  // доп. ответственный у пункта (только админ)
  if(M==="POST"&&p==="/api/item-resp"){
    if(!isA)return err(res,403,"Назначает только администратор");
    const b=await body(req,1e4),{tt:id,sec}=b;if(!DB.tt[id]||!SECS.includes(sec))return err(res,404,"Не найдено");
    const it=itemOf(id,sec,b.item);if(!it)return err(res,404,"Пункт не найден");
    const v=String(b.resp||"").replace(/\s+/g," ").trim().slice(0,120);if(it.resp===v)return send(res,200,{ok:true});
    it.resp=v;commit();journal(req,s,v?"Назначен доп. ответственный: "+v:"Снят доп. ответственный",{tt:DB.tt[id].name,sec:K.SECX[sec],item:K.tok(it.text,DB.tt[id])});return send(res,200,{ok:true});
  }
  // подзадачи (админ и старший)
  if(p==="/api/sub"&&["POST","PATCH","DELETE"].includes(M)){
    if(!isA&&!isL)return err(res,403,"Подзадачи меняют администратор и старший");
    const b=await body(req,1e4),{tt:id,sec}=b;if(!DB.tt[id]||!SECS.includes(sec))return err(res,404,"Не найдено");if(!canTT(id))return noTT();
    const it=itemOf(id,sec,b.item);if(!it)return err(res,404,"Пункт не найден");it.sub=it.sub||[];
    let msg="";
    if(M==="POST"){const text=String(b.text||"").trim().slice(0,500);if(!text)return err(res,400,"Пустой текст");it.sub.push({id:newId("s"),text,link:safeLink(b.link)});msg="Добавлена подзадача: "+text}
    else{const i=it.sub.findIndex(x=>x.id===b.sub);if(i<0)return err(res,404,"Подзадача не найдена");
      if(M==="PATCH"){const text=String(b.text||"").trim().slice(0,500);if(!text)return err(res,400,"Пустой текст");msg="Подзадача переименована: "+it.sub[i].text+" → "+text;it.sub[i].text=text;if(b.link!==undefined)it.sub[i].link=safeLink(b.link)}
      else{msg="Удалена подзадача: "+it.sub[i].text;if(it.tk&&it.sub[i].tk)remember(id,sec,[it.tk+" >> "+it.sub[i].tk]);it.sub.splice(i,1);cleanupOrphans(id,sec)}}
    commit();journal(req,s,msg,{tt:DB.tt[id].name,sec:K.SECX[sec],item:K.tok(it.text,DB.tt[id])});return send(res,200,{ok:true});
  }
  // пункты: быстрое добавление, правка и удаление (только админ)
  if(p==="/api/item"&&["POST","PATCH","DELETE"].includes(M)){
    if(!isA)return err(res,403,"Пункты меняет только администратор");
    const b=await body(req,1e4),{tt:id,sec}=b;if(!DB.tt[id]||!SECS.includes(sec))return err(res,404,"Не найдено");
    const L=(DB.lists[id]=DB.lists[id]||{prep:[],onsite:[]})[sec]=DB.lists[id][sec]||[];let msg="",it;
    if(M==="POST"){
      const text=String(b.text||"").replace(/\s+/g," ").trim().slice(0,500);if(!text)return err(res,400,"Впишите текст пункта");
      const after=L.findIndex(x=>x.id===b.after);const g=String(b.g||(after>=0?L[after].g:"")||"Прочее").trim().slice(0,80);
      let pos=after;if(pos<0)L.forEach((x,j)=>{if(x.g===g)pos=j});
      const ref=pos>=0?L[pos]:null;
      it={id:newId(sec==="prep"?"p":"o"),g,text,req:b.req!==false,ph:!!b.ph,link:"",sub:[],resp:"",...(sec==="prep"?{d:Math.max(0,Math.min(365,b.d!==undefined?+b.d||0:(ref?+ref.d||0:3))),who:""}:{})};
      if(pos>=0)L.splice(pos+1,0,it);else L.push(it);msg="Добавлен пункт: "+text;
    }else{
      const i=L.findIndex(x=>x.id===b.item);if(i<0)return err(res,404,"Пункт не найден");it=L[i];
      if(M==="PATCH"){const ch=[];
        if(typeof b.text==="string"){const v=b.text.replace(/\s+/g," ").trim().slice(0,500);if(!v)return err(res,400,"Пустой текст");if(v!==it.text){ch.push("«"+it.text+"» → «"+v+"»");it.text=v}}
        if(typeof b.g==="string"&&b.g.trim()&&b.g.trim()!==it.g){it.g=b.g.trim().slice(0,80);ch.push("группа: "+it.g)}
        if(typeof b.req==="boolean"&&b.req!==!!it.req){it.req=b.req;ch.push(b.req?"обязательный":"необязательный")}
        if(typeof b.ph==="boolean"&&b.ph!==!!it.ph){it.ph=b.ph;ch.push(b.ph?"нужно фото":"фото не обязательно")}
        if(sec==="prep"&&b.d!==undefined){const v=Math.max(0,Math.min(365,+b.d||0));if(v!==+it.d){it.d=v;ch.push("за "+v+" дн.")}}
        if(!ch.length)return send(res,200,{ok:true});msg="Изменён пункт: "+ch.join(", ");
      }else{L.splice(i,1);if(it.tk)remember(id,sec,[it.tk]);const gone=cleanupOrphans(id,sec);msg="Удалён пункт: "+it.text+(gone?` (с отметками/комментариями/фото: ${gone})`:"")}
    }
    commit();journal(req,s,msg,{tt:DB.tt[id].name,sec:K.SECX[sec]});return send(res,200,{ok:true,id:it.id});
  }
  // волны (вкладки): создаёт, переименовывает и удаляет администратор
  if(p.startsWith("/api/waves")){
    if(!isA)return err(res,403,"Волны меняет только администратор");
    const b=M==="DELETE"?{}:await body(req,1e4);const nm=String(b.name||"").replace(/\s+/g," ").trim().slice(0,40);
    if(M==="POST"&&p==="/api/waves"){if(!nm)return err(res,400,"Впишите название волны");if(DB.waves.some(w=>w.name.toLowerCase()===nm.toLowerCase()))return err(res,409,"Такая волна уже есть");
      const id="w"+Date.now().toString(36);DB.waves.push({id,name:nm});commit();journal(req,s,"Создана волна",{details:nm});return send(res,200,{ok:true,id})}
    if((mm=p.match(/^\/api\/waves\/([\w-]+)$/))){const w=DB.waves.find(x=>x.id===mm[1]);if(!w)return err(res,404,"Нет такой волны");
      if(M==="PATCH"){if(!nm)return err(res,400,"Впишите название волны");if(DB.waves.some(x=>x!==w&&x.name.toLowerCase()===nm.toLowerCase()))return err(res,409,"Такая волна уже есть");const old=w.name;w.name=nm;commit();journal(req,s,"Волна переименована",{details:old+" → "+nm});return send(res,200,{ok:true})}
      if(M==="DELETE"){let n=0;Object.values(DB.tt).forEach(t=>{if(t.wave===w.id){t.wave="";n++}});DB.waves=DB.waves.filter(x=>x!==w);commit();journal(req,s,"Удалена волна",{details:w.name+(n?` · ТТ перенесены в «без волны»: ${n}`:"")});return send(res,200,{ok:true,moved:n})}}
    return err(res,404,"Не найдено");
  }
  // комментарии (все)
  if(M==="POST"&&p==="/api/comments"){
    const b=await body(req,1e5),{tt:id,sec}=b;if(!DB.tt[id]||!SECS.includes(sec))return err(res,404,"Не найдено");if(!canTT(id))return noTT();
    const it=itemOf(id,sec,b.item);if(!it)return err(res,404,"Пункт не найден");
    if(b.sub&&!(it.sub||[]).some(x=>x.id===b.sub))return err(res,404,"Подзадача не найдена");
    const text=String(b.text||"").trim().slice(0,2000);if(!text)return err(res,400,"Пустой комментарий");
    (DB.comments[id]=DB.comments[id]||[]).push({id:newId("c"),sec,key:ckey(it.id,b.sub),by:s.name,role:s.role,at:K.stamp(),text});
    commit();journal(req,s,"Комментарий",{tt:DB.tt[id].name,sec:K.SECX[sec],item:K.tok(it.text,DB.tt[id]),details:text.slice(0,200)});return send(res,200,{ok:true});
  }
  if(M==="DELETE"&&(mm=p.match(/^\/api\/comments\/([\w-]+)\/(c[\w]+)$/))){
    if(!canTT(mm[1]))return noTT();const L=DB.comments[mm[1]]||[],i=L.findIndex(c=>c.id===mm[2]);if(i<0)return err(res,404,"Нет комментария");
    if(!isA&&!(L[i].by===s.name&&L[i].role===s.role))return err(res,403,"Удалить может автор или администратор");
    L.splice(i,1);commit();journal(req,s,"Удалён комментарий",{tt:(DB.tt[mm[1]]||{}).name});return send(res,200,{ok:true});
  }
  // фото
  if(M==="POST"&&p==="/api/photos"){
    const b=await body(req,25e6);const {tt:id,sec,item:iid}=b;if(!DB.tt[id]||!itemOf(id,sec,iid))return err(res,404,"Пункт не найден");if(!canTT(id))return noTT();
    const m=/^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(b.data||""));if(!m)return err(res,400,"Нужна картинка");
    const pid=newId("f"),file=pid+"."+(m[1]==="jpeg"?"jpg":m[1]);fs.writeFileSync(path.join(PHOTOS,file),Buffer.from(m[2],"base64"));
    DB.photos[pid]={tt:id,sec,item:iid,by:s.name,role:s.role,at:K.stamp(),file};commit();
    journal(req,s,"Добавлено фото",{tt:DB.tt[id].name,sec:K.SECX[sec],item:K.tok(itemOf(id,sec,iid).text,DB.tt[id])});return send(res,200,{ok:true,id:pid});
  }
  if(M==="GET"&&(mm=p.match(/^\/photos\/(f[\w]+)$/))){const ph=DB.photos[mm[1]];if(!ph)return err(res,404,"Нет фото");if(!canTT(ph.tt))return noTT();return serveFile(res,path.join(PHOTOS,ph.file),{"Cache-Control":"private, max-age=86400"})}
  if(M==="DELETE"&&(mm=p.match(/^\/api\/photos\/(f[\w]+)$/))){
    const ph=DB.photos[mm[1]];if(!ph)return err(res,404,"Нет фото");if(!canTT(ph.tt))return noTT();if(!isA&&!(ph.by===s.name&&ph.role===s.role))return err(res,403,"Удалить может автор или администратор");
    try{fs.unlinkSync(path.join(PHOTOS,ph.file))}catch(e){}delete DB.photos[mm[1]];commit();journal(req,s,"Удалено фото",{tt:(DB.tt[ph.tt]||{}).name});return send(res,200,{ok:true});
  }
  // Excel
  if(M==="GET"&&(mm=p.match(/^\/api\/export\/([\w-]+)\/(prep|onsite)$/))){
    if(isE)return err(res,403,"Нет прав");const [,id,sec]=mm,t=DB.tt[id];if(!t)return err(res,404,"ТТ не найдена");if(!canTT(id))return noTT();
    const buf=checklistXlsx(id,sec,s);const name=("Чек-лист "+(sec==="prep"?"подготовка":"отработка")+" - "+t.city+", "+t.name).replace(/[\\/:*?"<>|]/g," ").replace(/\s+/g," ").slice(0,150)+".xlsx";
    journal(req,s,"Выгружен чек-лист в Excel",{tt:t.name,sec:K.SECX[sec]});res.writeHead(200,xlsxHeaders(name,buf.length));return res.end(buf);
  }
  if(M==="GET"&&p==="/api/orders.xlsx"){if(isE)return err(res,403,"Нет прав");const wq=u.query.wave===undefined?"all":String(u.query.wave);const buf=ordersXlsx(isL&&s.tts?s.tts:null,wq);res.writeHead(200,xlsxHeaders("Сводка заказа по юрлицам "+K.isoD(new Date())+".xlsx",buf.length));return res.end(buf)}
  // пользователи
  if(p.startsWith("/api/users")){
    if(!isA)return err(res,403,"Нет прав");
    const pub=x=>({login:x.login,name:x.name,role:x.role,active:x.active,tts:Array.isArray(x.tts)?x.tts:null});
    const cleanTts=v=>v===null||v===undefined||v==="all"?null:(Array.isArray(v)?[...new Set(v.map(String).filter(id=>DB.tt[id]))]:null);
    if(M==="GET")return send(res,200,{users:Object.values(DB.users).map(pub)});
    const b=await body(req,1e4);
    if(M==="POST"){const login=String(b.login||"").trim();if(!/^[\w.-]{3,32}$/.test(login))return err(res,400,"Логин: 3–32 латинских буквы или цифры");if(DB.users[login.toLowerCase()])return err(res,409,"Такой логин уже есть");
      if(String(b.password||"").length<4)return err(res,400,"Пароль не короче 4 символов");if(!["admin","lead"].includes(b.role))return err(res,400,"Неверная роль");
      DB.users[login.toLowerCase()]={login,name:String(b.name||login).trim().slice(0,80),role:b.role,active:true,tts:b.role==="lead"?cleanTts(b.tts):null,...hashPass(b.password)};commit();journal(req,s,"Создан пользователь",{details:login+" · "+K.ROLE[b.role]+(b.role==="lead"&&Array.isArray(b.tts)?" · ТТ: "+cleanTts(b.tts).length:"")});return send(res,200,{ok:true})}
    if(M==="PATCH"&&(mm=p.match(/^\/api\/users\/([\w.-]+)$/))){const x=DB.users[mm[1].toLowerCase()];if(!x)return err(res,404,"Нет пользователя");
      const admins=Object.values(DB.users).filter(y=>y.role==="admin"&&y.active);const self=x.login===s.login;const ch=[];
      if(b.role&&b.role!==x.role){if(!["admin","lead"].includes(b.role))return err(res,400,"Неверная роль");if(x.role==="admin"&&admins.length<2)return err(res,409,"Нельзя убрать последнего администратора");x.role=b.role;ch.push("роль: "+K.ROLE[b.role])}
      if(typeof b.active==="boolean"&&b.active!==x.active){if(self)return err(res,409,"Нельзя отключить себя");if(!b.active&&x.role==="admin"&&admins.length<2)return err(res,409,"Нельзя отключить последнего администратора");x.active=b.active;ch.push(b.active?"включён":"отключён");
        if(!b.active)Object.keys(SESS).forEach(k=>{if(SESS[k].login===x.login)delete SESS[k]})}
      if(typeof b.name==="string"&&b.name.trim()&&b.name.trim()!==x.name){x.name=b.name.trim().slice(0,80);ch.push("имя: "+x.name)}
      if(b.tts!==undefined){const nt=x.role==="lead"?cleanTts(b.tts):null;if(JSON.stringify(nt)!==JSON.stringify(x.tts||null)){x.tts=nt;ch.push(nt?"ТТ: "+nt.length:"ТТ: все")}}
      if(b.password){if(String(b.password).length<4)return err(res,400,"Пароль не короче 4 символов");Object.assign(x,hashPass(b.password));ch.push("сменён пароль");Object.keys(SESS).forEach(k=>{if(SESS[k].login===x.login&&k!==tokOf(req))delete SESS[k]})}
      if(ch.length)commit();saveSess();journal(req,s,"Изменён пользователь",{details:x.login+": "+ch.join(", ")});return send(res,200,{ok:true})}
    if(M==="DELETE"&&(mm=p.match(/^\/api\/users\/([\w.-]+)$/))){const key=mm[1].toLowerCase(),x=DB.users[key];if(!x)return err(res,404,"Нет пользователя");
      if(x.login===s.login)return err(res,409,"Нельзя удалить самого себя");
      if(x.role==="admin"&&Object.values(DB.users).filter(y=>y.role==="admin"&&y.active&&y!==x).length<1)return err(res,409,"Нельзя удалить последнего администратора");
      delete DB.users[key];Object.keys(SESS).forEach(k=>{if((SESS[k].login||"").toLowerCase()===key)delete SESS[k]});saveSess();commit();
      journal(req,s,"Удалён пользователь",{details:x.login+" · "+x.name+" · "+K.ROLE[x.role]});return send(res,200,{ok:true})}
    return err(res,404,"Не найдено");
  }
  if(M==="GET"&&p==="/api/journal"){if(!isA)return err(res,403,"Нет прав");return send(res,200,{rows:readJournal(Math.min(2000,+u.query.limit||500),String(u.query.q||""))})}
  return err(res,404,"Не найдено");
}

/* ---------- запуск ---------- */
loadDB();backup();setInterval(backup,30*60*1000);setInterval(saveSess,10*60*1000);
const server=http.createServer((req,res)=>{handle(req,res).catch(e=>{console.log("Ошибка:",e.message);if(!res.headersSent)err(res,e.message==="big"?413:400,e.message==="big"?"Файл слишком большой":"Некорректный запрос")})});
let port=+CFG.port||8080,tries=0;
server.on("error",e=>{if(e.code==="EADDRINUSE"&&tries<10){tries++;port++;setTimeout(()=>server.listen(port,"0.0.0.0"),100)}else{console.log("Не удалось запустить сервер:",e.message);process.exit(1)}});
server.listen(port,"0.0.0.0",()=>{
  const ips=[];Object.values(os.networkInterfaces()).forEach(a=>(a||[]).forEach(i=>{if(i.family==="IPv4"||i.family===4){if(!i.internal)ips.push(i.address)}}));
  const line="=".repeat(60);
  console.log("\n"+line+"\n  Дорожная карта КСО запущена\n"+line);
  console.log("\n  Откройте в браузере на других компьютерах и телефонах сети:");
  if(ips.length)ips.forEach(ip=>console.log("     http://"+ip+":"+port));else console.log("     (сетевой адрес не найден — проверьте подключение)");
  console.log("\n  На этом компьютере:  http://localhost:"+port);
  console.log("\n  Данные: "+DATA);
  console.log("  Чтобы остановить сайт, закройте это окно.\n"+line+"\n");
  if(CFG.openBrowser&&process.platform==="win32"&&!process.env.KSO_NO_BROWSER)require("child_process").exec(`start "" "http://localhost:${port}"`);
});
process.on("SIGINT",()=>{try{saveDB();saveSess()}catch(e){}process.exit(0)});
