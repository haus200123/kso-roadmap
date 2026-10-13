/* Общие функции для сервера и браузера */
(function(root){
"use strict";
const pad=n=>String(n).padStart(2,"0");
const isoD=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const fd=s=>{if(!s)return"";const [y,m,d]=s.split("-");return d+"."+m+"."+y};
const addD=(s,n)=>{const [y,m,d]=s.split("-").map(Number);return isoD(new Date(y,m-1,d-n))};
const stamp=(dt)=>{const d=dt||new Date();return fd(isoD(d))+" "+pad(d.getHours())+":"+pad(d.getMinutes())};
const plural=(n,a,b,c)=>{n=Math.abs(n)%100;const k=n%10;if(n>10&&n<20)return c;if(k>1&&k<5)return b;if(k===1)return a;return c};
function demText(t){return [t.ncr?t.ncr+" NCR":"",t.demCsik?t.demCsik+" CSIK":"",t.lin?t.lin+" лин. "+plural(t.lin,"касса","кассы","касс"):""].filter(Boolean).join(", ")||"нет"}
function tok(text,t){
  const v=Object.assign({},t,{kso:(+t.skit||0)+(+t.csik||0),dem:demText(t),csikFrom:t.csikFrom||"—"});
  return String(text).replace(/\{(\w+)\}/g,(m,k)=>v[k]!==undefined&&v[k]!==null&&v[k]!==""&&typeof v[k]!=="object"?v[k]:m);
}
/* ККТ: Кварц 2Ф снимаем с демонтируемых касс и ставим на новые, остальные — новые Нова Принт */
const DERIVED=["rKkt","rTerm","rCol","oTerm","oKkt","oFn","oCol"];
function autoCalc(t){
  const skit=+t.skit||0,kso=skit+(+t.csik||0),dem=(+t.ncr||0)+(+t.demCsik||0)+(+t.lin||0),ncr=+t.ncr||0;
  const rKkt=Math.min(dem,kso),rTerm=Math.min(dem,kso),rCol=Math.min(ncr,skit);
  return {rKkt,rTerm,rCol,oKkt:kso-rKkt,oTerm:kso-rTerm,oFn:kso-rKkt,oCol:Math.max(0,skit-rCol)};
}
function qtyLine(t){
  const a=[];const kso=(+t.skit||0)+(+t.csik||0);
  if(t.skit)a.push(`Установка: ${t.skit} S.kit (${t.bag} пакетн.)`+(t.skitFrom?` — ${t.skitFrom}`:""));
  if(t.csik)a.push(`Перенос: ${t.csik} CSIK с ${t.csikFrom||"—"}`);
  const d=demText(t);if(d!=="нет")a.push("Демонтаж: "+d+(t.demCsik&&t.demCsikTo?` (CSIK → ${t.demCsikTo})`:""));
  if(t.outSkit)a.push(`Отправка: ${t.outSkit} S.kit → ${t.outSkitTo||"—"}`);
  if(kso)a.push(`ККТ: Кварц 2Ф ${+t.rKkt||0} (с демонтажа) + Нова Принт ${+t.oKkt||0} (новые)`);
  const o=[t.oTerm?`терминалы ${t.oTerm}`:"",t.oFn?`ФН ${t.oFn}`:"",t.oCol?`колонки ${t.oCol}`:"",t.oGaz?`метки ДемоБанка ${t.oGaz}`:"",t.buyTables?`жел. столы ${t.buyTables}`:"",t.buyKvp?`КВП ${t.buyKvp}`:""].filter(Boolean);
  if(o.length)a.push("Заказ: "+o.join(", "));
  return a;
}
function groups(L){const g=[];L.forEach(i=>{let x=g.find(y=>y.name===(i.g||"Без группы"));if(!x){x={name:i.g||"Без группы",items:[]};g.push(x)}x.items.push(i)});return g}
function orderRows(TT){
  const by={};
  Object.values(TT).forEach(t=>{const k=t.ul||"—";const r=by[k]||(by[k]={ul:k,tt:0,sk:0,sk1:0,sk2:0,cs:0,ncr:0,term:0,kkt:0,fn:0,col:0,gaz:0,leg:0,tbl:0,kvp:0});
    r.tt++;r.sk+=+t.skit||0;if(+t.bag===1)r.sk1+=+t.skit||0;else r.sk2+=+t.skit||0;r.cs+=+t.csik||0;r.ncr+=(+t.ncr||0)+(+t.lin||0);
    r.term+=+t.oTerm||0;r.kkt+=+t.oKkt||0;r.fn+=+t.oFn||0;r.col+=+t.oCol||0;r.gaz+=+t.oGaz||0;if(t.leg)r.leg+=(+t.skit||0)+(+t.csik||0);r.tbl+=+t.buyTables||0;r.kvp+=+t.buyKvp||0});
  return Object.values(by).sort((a,b)=>b.sk-a.sk||a.ul.localeCompare(b.ul));
}
const ORDER_COLS=[["ul","Юрлицо"],["tt","ТТ"],["sk","S.kit"],["sk1","S.kit 1 пакетн."],["sk2","S.kit 2 пакетн."],["cs","CSIK перенос"],["term","Терминалы Сбер"],["kkt","ККТ Нова Принт"],["fn","ФН"],["col","Колонки"],["gaz","Метки ДемоБанка"],["leg","Нога столо-ящика"],["tbl","Жел. столы"],["kvp","КВП"],["ncr","Снимаем на склад (NCR+лин.)"]];
const SEC={onsite:"Отработка по ТТ",prep:"Подготовительные действия по ТТ"};
const SECX={onsite:"Отработка на ТТ",prep:"Подготовительные действия"};
const ROLE={admin:"Администратор",lead:"Старший",engineer:"Инженер"};
/* ФИО инженера: только буквы (рус/лат), дефис, апостроф; не меньше двух слов по 2+ буквы */
function checkFio(raw){
  const s=String(raw||"").replace(/\s+/g," ").trim();
  if(!s)return {error:"Впишите фамилию и имя"};
  if(/\d/.test(s))return {error:"Цифры в ФИО вводить нельзя"};
  if(/[^A-Za-zА-Яа-яЁё\s'\-]/.test(s))return {error:"В ФИО допустимы только буквы, пробел и дефис"};
  const w=s.split(" ");
  if(w.length<2)return {error:"Нужно минимум два слова: фамилия и имя"};
  if(w.some(x=>x.replace(/['\-]/g,"").length<2||/^['\-]|['\-]$/.test(x)))return {error:"Каждое слово ФИО — не короче двух букв"};
  if(s.length>60)return {error:"Слишком длинное ФИО"};
  const name=w.map(x=>x.split("-").map(y=>y.charAt(0).toUpperCase()+y.slice(1).toLowerCase()).join("-")).join(" ");
  return {name};
}
const api={autoCalc,DERIVED,checkFio,pad,isoD,fd,addD,stamp,plural,demText,tok,qtyLine,groups,orderRows,ORDER_COLS,SEC,SECX,ROLE};
if(typeof module!=="undefined")module.exports=api;else root.KSO=api;
})(this);
