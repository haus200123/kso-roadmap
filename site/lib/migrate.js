/* Перенос базы на версию 4 сайта: чек-листы версии 3 и «План установки КСО» с волнами.
   Ничего не удаляет: пользователи, отметки, комментарии, фото и даты остаются.
   Пункты чек-листов узнаются по ключу шаблона, поэтому отметки переезжают вместе с пунктами. */
"use strict";
const fs=require("fs"),path=require("path");
const T3=require("./template.js"),T2=require("./template-v2.js"),K=require("./common.js");

const NEWF={wave:"",code:"",region:"",skitFrom:"",outSkit:0,outSkitTo:"",demCsikTo:"",buyTables:0,buyKvp:0};
const PLAN_FIELDS=["skit","bag","skitFrom","csik","csikFrom","ncr","demCsik","demCsikTo","lin","outSkit","outSkitTo","buyTables","buyKvp"];

/* «Пихтовая 45» в поле «Город», «Демоград» в поле «Адрес» → меняем местами */
function fixCityName(t){
  const name=String(t.name||"").trim(),city=String(t.city||"").trim();
  if(name&&city&&!/\d/.test(name)&&/\d/.test(city)){
    t.city=name.charAt(0).toUpperCase()+name.slice(1);
    t.name=/,/.test(city)?city:city.replace(/\s+(\d[\w\/-]*)$/u,", $1");
    return true;
  }
  return false;
}
function normKey(city,name){
  const c=String(city||"").toLowerCase().replace(/ё/g,"е").replace(/[^а-яa-z]/g,"").slice(0,5);
  const n=String(name||"").toLowerCase().replace(/ё/g,"е").replace(/\b(ул|пр-т|пр-кт|проспект|шоссе|пер|бульвар)\.?/g," ");
  const words=(n.match(/[а-яa-z]{4,}/g)||[]).sort((a,b)=>b.length-a.length);
  const house=(n.match(/\d+(\/\d+)?/)||[""])[0];
  return c+"|"+(words[0]||"")+"|"+house;
}
const sameAuto=t=>{const a=K.autoCalc(t);return K.DERIVED.every(k=>(+t[k]||0)===a[k])};

function hasDataFn(DB,id,sec){
  const C=((DB.checks[id]||{})[sec])||{};
  const cm=new Set((DB.comments[id]||[]).filter(c=>c.sec===sec).map(c=>c.key));
  const ph=new Set(Object.values(DB.photos).filter(p=>p.tt===id&&p.sec===sec).map(p=>p.item));
  return key=>{const c=C[key];return !!(c&&c.st&&c.st!=="none")||cm.has(key)||ph.has(key)};
}
/* Пересчитать чек-листы ТТ по шаблону, сохранив отметки/комментарии/фото, свои пункты и удалённые администратором */
function syncTT(DB,id,newId){
  const t=DB.tt[id];const fresh=T3.genLists(t);DB.lists[id]=DB.lists[id]||{prep:[],onsite:[]};DB.removed=DB.removed||{};
  const R=DB.removed[id]||(DB.removed[id]={prep:[],onsite:[]});let added=0,dropped=0;
  ["prep","onsite"].forEach(sec=>{
    const r=T3.syncList(DB.lists[id][sec]||[],fresh[sec],{removed:new Set(R[sec]||[]),hasData:hasDataFn(DB,id,sec),newId,prefix:sec==="prep"?"p":"o"});
    DB.lists[id][sec]=r.items;added+=r.added;dropped+=r.dropped;
    const C=(DB.checks[id]=DB.checks[id]||{prep:{},onsite:{}})[sec]=(DB.checks[id][sec]||{});
    r.moves.forEach(([a,b])=>{if(C[a]&&!C[b]){C[b]=C[a];delete C[a]}});
  });
  return {added,dropped};
}

function importPlan(DB,plan,log){
  DB.waves=Array.isArray(DB.waves)&&DB.waves.length?DB.waves:[{id:"w1",name:"1 волна"},{id:"w2",name:"2 волна"}];
  const waveId=w=>DB.waves.some(x=>x.id===w)?w:(DB.waves.find(x=>x.name.startsWith(w.slice(1)+" "))||{id:""}).id;
  const byCode={};plan.cards.forEach(c=>(byCode[c.code]=byCode[c.code]||[]).push(c));
  /* существующие ТТ, совпавшие с планом по городу, улице и дому */
  const taken=new Set(),matched={};let updated=0,created=0;
  Object.entries(byCode).forEach(([code,cards])=>{
    const key=normKey(cards[0].city,cards[0].name);
    const ex=Object.keys(DB.tt).find(id=>!taken.has(id)&&!DB.tt[id].code&&normKey(DB.tt[id].city,DB.tt[id].name)===key);
    if(ex){taken.add(ex);matched[code]=ex}
  });
  const maxOrder=Math.max(0,...Object.values(DB.tt).map(x=>+x.order||0));
  const newIds={};
  Object.entries(byCode).forEach(([code,cards])=>{
    const order=[...cards].sort((a,b)=>(a.wave==="w2"?-1:1)-(b.wave==="w2"?-1:1));/* существующая карточка → 2 волна, если ТТ есть в обеих */
    order.forEach((c,k)=>{
      const fields={};PLAN_FIELDS.forEach(f=>fields[f]=c[f]);
      if(k===0&&matched[code]){
        const id=matched[code],t=DB.tt[id];
        Object.assign(t,fields,{code,region:c.region,wave:waveId(c.wave)});Object.assign(t,K.autoCalc(t));t.auto=true;
        t.note=c.note+(t.note&&!String(t.note).startsWith("План")?"\n\nИз прежнего ТЗ: "+t.note:"");
        updated++;(newIds[code]=newIds[code]||[]).push(id);
      }else{
        const id=("pl-"+code.replace(/З/g,"z")+"-"+c.wave).replace(/[^\w-]/g,"");if(DB.tt[id])return;
        const t={name:c.name,city:c.city,fmt:c.fmt,ul:"",date:"",...fields,oGaz:0,leg:false,note:c.note,code,region:c.region,wave:waveId(c.wave),
          order:maxOrder+c.rank+(c.wave==="w2"?200:0),owner:{prep:"",onsite:""},exec:{prep:"",onsite:""},auto:true};
        Object.assign(t,K.autoCalc(t));
        DB.tt[id]=t;DB.lists[id]={prep:[],onsite:[]};DB.checks[id]={prep:{},onsite:{}};created++;
        (newIds[code]=newIds[code]||[]).push(id);
      }
    });
  });
  /* старший, которому была назначена ТТ, видит и её карточку в другой волне */
  Object.values(DB.users).forEach(u=>{if(u.role!=="lead"||!Array.isArray(u.tts))return;
    Object.entries(matched).forEach(([code,id])=>{if(u.tts.includes(id))(newIds[code]||[]).forEach(nid=>{if(!u.tts.includes(nid))u.tts.push(nid)})})});
  DB.planImport={at:new Date().toISOString(),source:plan.source,version:plan.version,created,updated,matched:Object.keys(matched).length};
  log(`План «${plan.source}»: создано карточек ${created}, обновлено существующих ТТ ${updated}`);
}

function migrate(DB,{site,newId,log}){
  log=log||(()=>{});DB.removed=DB.removed||{};DB.waves=DB.waves||[];
  let changed=false;
  /* 1. новые поля и исправление «город ↔ адрес» */
  Object.values(DB.tt).forEach(t=>{
    Object.entries(NEWF).forEach(([k,v])=>{if(t[k]===undefined){t[k]=v;changed=true}});
    if(fixCityName(t)){changed=true;log("Исправлены город и адрес: "+t.city+", "+t.name)}
    if(t.auto===undefined){t.auto=sameAuto(t);changed=true}
  });
  /* 2. старые чек-листы версии 2: ключи шаблона по id пунктов */
  const v=DB.tplVersion;
  if(v===2){
    Object.keys(DB.tt).forEach(id=>{const v2=T2.genLists(DB.tt[id]);DB.lists[id]=DB.lists[id]||{prep:[],onsite:[]};
      const R=DB.removed[id]=DB.removed[id]||{prep:[],onsite:[]};
      ["prep","onsite"].forEach(sec=>{const r=T3.tagFromV2(DB.lists[id][sec]||[],v2[sec]);DB.lists[id][sec]=r.items;R[sec]=[...new Set([...(R[sec]||[]),...r.removed])]})});
  }else if(v!==T3.TEMPLATE_VERSION){
    /* совсем старая база: чек-листы просто строятся заново (отметок в ней быть не может) */
    Object.keys(DB.tt).forEach(id=>{DB.lists[id]={prep:[],onsite:[]}});
  }
  /* 3. план установки — один раз */
  if(!DB.planImport){
    const f=path.join(site,"lib","plan-2026-10.json");
    if(fs.existsSync(f)){importPlan(DB,JSON.parse(fs.readFileSync(f,"utf8")),log);changed=true}
  }
  /* 4. чек-листы по шаблону версии 3 с сохранением отметок */
  if(v!==T3.TEMPLATE_VERSION||changed){
    Object.keys(DB.tt).forEach(id=>syncTT(DB,id,newId));
    DB.tplVersion=T3.TEMPLATE_VERSION;changed=true;
    log(`Чек-листы приведены к шаблону версии ${T3.TEMPLATE_VERSION}: отметки, комментарии и фото сохранены`);
  }
  return changed;
}
module.exports={migrate,syncTT,fixCityName,normKey,hasDataFn};
