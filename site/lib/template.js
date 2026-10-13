/* Шаблоны чек-листов (версия 3).
   В текстах метки {skit}, {kso}, {ncr} и т.п. — сайт подставляет количества ТТ.
   Пункт: {id, tk: ключ шаблона, g: группа, text, req, ph: нужно фото, d: за сколько дней до работ (подготовка),
           who: у кого уточнять, link: инструкция, sub: [{id, tk, text, link}]}
   tk — исходный текст пункта в шаблоне. По нему сайт узнаёт пункт при пересчёте количеств,
   поэтому отметки, комментарии и фото не теряются, даже если текст пункта поправили вручную. */
const WIKI="https://wiki.example.com/pages/viewpage.action?pageId=";
const WIKI_ROOT="https://wiki.example.com/spaces/KB/pages/100000/CSI-K+V3";
const W={img:100003,first:100009,kkt:100011,pay:100004,common:100012,pgadmin:100013,kvp:100005,
  loyalty:100006,vision:100014,adv:100007,sound:100008,soundV3:100001,volume:100015,badge:100002,check2:100010};
const L=k=>WIKI+W[k];
const TEMPLATE_VERSION=3;

/* Тексты версии 2 → версии 3 (для переноса отметок со старых чек-листов) */
const RENAMES={
  "Проверить наличие настроенных ККТ (Кварц 2Ф): нужно {kso} шт. ({rKkt} с демонтажа + {oKkt} новых)":"Проверить наличие настроенных ККТ: нужно {kso} шт. — Кварц 2Ф с демонтажа {rKkt} шт. + новые Нова Принт {oKkt} шт.",
  "Проверить ФН в новых ККТ — {oFn} шт.":"Проверить ФН в новых ККТ Нова Принт — {oFn} шт.",
  "Снять ККТ для дальнейшего использования — {rKkt} шт.":"Снять ККТ Кварц 2Ф для дальнейшего использования — {rKkt} шт.",
  "Снять колонки с NCR — {rCol} шт.":"Снять колонки с NCR и звуковые карты — {rCol} шт.",
  "Установить ККТ Кварц 2Ф с ФН, подключить":"Установить ККТ с ФН и подключить: Кварц 2Ф с демонтажа — {rKkt} шт., новые Нова Принт — {oKkt} шт."
};

function genLists(t){
  t=t||{};
  const kso=(+t.skit||0)+(+t.csik||0), dem=(+t.ncr||0)+(+t.demCsik||0)+(+t.lin||0), out=+t.outSkit||0, tbl=+t.buyTables||0, kvp=+t.buyKvp||0;
  let n=0; const P=[], O=[];
  const subs=(arr)=>(arr||[]).filter(Boolean).map((s,i)=>typeof s==="string"?{id:"s"+(i+1),tk:s,text:s}:{id:"s"+(i+1),tk:s.text,...s});
  const p=(g,text,d,o={})=>{if(o.cond===false)return;P.push({id:"p"+(++n),tk:text,g,text,d,req:o.req!==false,ph:!!o.ph,who:o.who||"",link:o.link||"",sub:subs(o.sub)})};
  const q=(g,text,o={})=>{if(o.cond===false)return;O.push({id:"o"+(++n),tk:text,g,text,req:o.req!==false,ph:!!o.ph,link:o.link||"",sub:subs(o.sub)})};
  const K=kso>0;

  /* ================= ПОДГОТОВКА ================= */
  const G1="1. Согласование с ТТ",G2="2. Оборудование",G3="3. Сервер и сеть",G4="4. Подготовка инженера",G5="5. Демонтаж и логистика";
  p(G1,"Согласовать дату и время работ с управляющим ТТ",14,{who:"Управляющий ТТ",sub:[
    "Выбрать время с минимальным потоком покупателей","Предупредить, на сколько касс снизится пропускная способность во время работ","Сообщить ФИО инженера и время приезда"]});
  p(G1,"Уточнить у управляющего ТТ о запросе в АХО для установки касс",14,{cond:K,who:"Управляющий ТТ"});
  p(G1,"Проверить планировку ТТ с расстановкой касс",14,{cond:K,sub:[
    t.skit>0?"Места под {skit} S.kit"+(t.csik?" и {csik} CSIK":""):"Места под {csik} CSIK","Проходы для покупателей и тележек не перекрыты","Зона для консультанта и обзор всех КСО"]});
  p(G1,"Уточнить наличие касс на ТТ: какие стоят сейчас, какие снимаем ({dem})",10,{who:"Управляющий ТТ"});
  p(G1,"Получить фото места установки до начала работ",10,{cond:K,who:"Управляющий ТТ",ph:true});
  p(G1,"Проверить электрику и сеть на местах установки: на каждую из {kso} КСО",7,{cond:K,who:"Управляющий ТТ / АХО",sub:[
    "Розетка 220 В с заземлением","Сетевая розетка (LAN) или проложенный кабель","Кабель-каналы для прокладки кабелей"]});

  p(G2,"Подтвердить поставку {skit} КСО CSI S.kit и железных столов под них",14,{cond:t.skit>0&&!t.skitFrom,who:"Отдел снабжения",sub:[
    "Количество КСО и столов совпадает со спецификацией","Исполнение: {bag}-пакетная зона","Дата доставки на ТТ раньше даты работ"]});
  p(G2,"Согласовать перемещение {skit} S.kit: {skitFrom}",14,{cond:t.skit>0&&!!t.skitFrom,who:"Логистика",sub:[
    "Дата отправки с ТТ-источника раньше даты работ","Транспорт и погрузка","S.kit комплектные: стол и КВП едут вместе с кассой"]});
  p(G2,"Согласовать перенос {csik} CSIK с ТТ {csikFrom}",14,{cond:t.csik>0,sub:["Дата демонтажа на ТТ-источнике раньше даты работ","Транспорт для переноса"]});
  p(G2,"Согласовать отправку {outSkit} S.kit на другие ТТ: {outSkitTo}",10,{cond:out>0,who:"Логистика",sub:["Дата и транспорт","S.kit отправляются комплектными: стол и КВП вместе с кассой"]});
  p(G2,"Согласовать отправку снятых CSIK на другие ТТ: {demCsikTo}",10,{cond:t.demCsik>0&&!!t.demCsikTo,who:"Логистика"});
  p(G2,"Проверить наличие терминалов PayDemo: нужно {kso} шт. ({rTerm} снимаем с касс + {oTerm} новых)",10,{cond:K,who:"Отдел снабжения"});
  p(G2,"Проверить наличие настроенных ККТ: нужно {kso} шт. — Кварц 2Ф с демонтажа {rKkt} шт. + новые Нова Принт {oKkt} шт.",10,{cond:K,who:"Ответственный за ККТ"});
  p(G2,"Проверить ФН в новых ККТ Нова Принт — {oFn} шт.",10,{cond:t.oFn>0,who:"Ответственный за ККТ"});
  p(G2,"Проверить колонки для S.kit — {skit} шт.",10,{cond:t.skit>0});
  p(G2,"Заказать метки ДемоБанка — {oGaz} шт. (только для новых касс)",10,{cond:t.oGaz>0});
  p(G2,"Заказать ногу столо-ящика с РЦ — {kso} шт.",10,{cond:!!t.leg});
  p(G2,"Заказать железные столы для CSIK — {buyTables} шт. (Заказ 2)",14,{cond:tbl>0,who:"Отдел снабжения"});
  p(G2,"Заказать КВП для CSIK — {buyKvp} шт. (Заказ 2)",14,{cond:kvp>0,who:"Отдел снабжения"});
  p(G2,"Сверить поставку на ТТ с накладной",2,{cond:K||tbl>0||kvp>0,who:"Управляющий ТТ",sub:K?[
    "{skit} S.kit и столы, без повреждений упаковки","Колонки, кабели питания и сети, крепёж","Терминалы, ККТ с ФН — по количеству"]:["Железные столы и КВП — по количеству, без повреждений"]});

  p(G3,"Получить номер магазина, номера касс и IP-адреса для {kso} КСО",5,{cond:K,sub:["Номер магазина","Номера касс","IP-адреса или подтверждение DHCP"]});
  p(G3,"Проверить на сервере POSCore: кассы ТТ заведены, назначен шаблон «Касса самообслуживания SCO_3»",5,{cond:K});
  p(G3,"Сообщить во 2ЛТП о создании новых касс: номер магазина, номера касс, IP-адреса",5,{cond:K,who:"2ЛТП"});
  p(G3,"Сообщить во 2ЛТП, сколько лицензий нужно на кассы ТТ ({kso} шт.), чтобы они всегда были в запасе",10,{cond:K,who:"2ЛТП"});
  p(G3,"Проверить шаблон SCO_3: звуковое сопровождение, кнопка «Громкость звука» в меню консультанта, привилегия у роли «Консультант КСО»",5,{cond:K,req:false,link:L("soundV3")});
  p(G3,"Проверить бейджи консультантов ТТ для входа в меню консультанта",5,{cond:K,req:false,who:"Управляющий ТТ",link:L("badge")});

  p(G4,"Проверить наличие инструментов для установки касс",3,{sub:[
    "Шуруповёрт, набор бит и головок","Ключи, отвёртки, пассатижи, кусачки","Стяжки, кабель-каналы, изолента","Удлинитель и сетевой фильтр","Ноутбук с POSConsole, WinSCP, PGAdmin, патч-корд"]});
  p(G4,"Проверить наличие флеш-накопителя с последней версией ОС для касс",3,{cond:K,link:L("img"),sub:[
    "Образ 2.6.0: \\\\fileserver\\share\\images\\2.6.0","Записан через Win32DiskImager (кнопка Write)"]});
  p(G4,"Скачать файлы для настройки КСО на ноутбук",3,{cond:K,sub:[
    {text:"pay-libs.zip — библиотеки PayDemo",link:L("pay")},
    {text:"Весовые службы 1.2: install-scale-svc, install-scale-db, scaleweb_install_v1.0",link:L("kvp")},
    {text:"FwTool.exe и прошивка КВП kvp_firmware.hex",link:L("kvp")},
    {text:"LoyaltyHubPlugin-2.0.jar",link:L("loyalty")},
    {text:"Логотип формата «{fmt}» и рекламная картинка 1080×1830",link:L("adv")},
    {text:"Звуки формата «{fmt}»: \\\\fileserver\\share\\sounds",link:L("sound")}]});
  p(G4,"Проверить актуальные пароли pos, postgres, ScaleWeb в менеджере паролей",3,{cond:K});
  p(G4,"Назначить инженера, передать ему чек-лист и адрес",3);

  p(G5,"Согласовать с логистикой вывоз демонтированных касс: {dem}",5,{cond:dem>0,who:"Логистика"});
  p(G5,"Подготовить упаковку для снимаемых касс",3,{cond:dem>0});
  p(G5,"Подтвердить получение всего оборудования на ТТ",1,{cond:K||tbl>0||kvp>0,who:"Управляющий ТТ"});

  /* ================= ОТРАБОТКА НА ТТ ================= */
  const D="1. Демонтаж",OUT="1а. Отправка S.kit на другие ТТ",T="2. Установка железных столов",KS="3. Установка КСО CSI S.kit",C="3. Установка CSIK",S="4. Настройка КСО",V="5. Проверка каждой кассы",F="6. Сдача";
  q(D,"Закрыть смены и снять Z-отчёты на снимаемых кассах",{cond:dem>0,sub:["Закрыть смены и снять Z-отчёты","Убедиться, что все чеки есть в POSCore и УчётПлюс"]});
  q(D,"Сообщить во 2ЛТП о закрытии смен и демонтаже касс (номера касс)",{cond:dem>0});
  q(D,"Вывести из работы и отключить: {dem}",{cond:dem>0});
  q(D,"Снять ККТ Кварц 2Ф для дальнейшего использования — {rKkt} шт.",{cond:t.rKkt>0,sub:["Проверить, что ФН внутри","Подписать ККТ номером кассы"]});
  q(D,"Снять терминалы PayDemo для дальнейшего использования — {rTerm} шт.",{cond:t.rTerm>0});
  q(D,"Снять колонки с NCR и звуковые карты — {rCol} шт.",{cond:t.rCol>0});
  q(D,"Демонтировать кассы, фото освобождённого места",{cond:dem>0,ph:true});
  q(D,"Запаковать снятые кассы, сфотографировать упаковку",{cond:dem>0,ph:true});
  q(D,"Передать кассы логистам для отправки на склад, подписать акт",{cond:dem>0&&((+t.ncr||0)+(+t.lin||0)>0||!t.demCsikTo)});
  q(D,"Отправить снятые CSIK на другие ТТ: {demCsikTo}",{cond:t.demCsik>0&&!!t.demCsikTo,ph:true,sub:["Упаковать CSIK вместе с КВП (и столом, если он едет с кассой)","Передать логистам, подписать акт"]});
  q(OUT,"Передать {outSkit} S.kit на другие ТТ: {outSkitTo}",{cond:out>0,ph:true,sub:["Проверить комплектность и целостность упаковки","Передать логистам, подписать акт"]});

  q(T,"Распаковать железные столы, проверить комплектность и повреждения",{cond:t.skit>0,sub:["Столешницы, опоры, крепёж — по числу КСО ({skit})","Нет вмятин и сколов покрытия"]});
  q(T,"Разметить места установки по согласованной планировке",{cond:t.skit>0});
  q(T,"Собрать столы по схеме производителя",{cond:t.skit>0,sub:["Каркас и опоры","Столешница","Все болты затянуты"]});
  q(T,"Выставить столы по уровню регулируемыми опорами",{cond:t.skit>0});
  q(T,"Закрепить столы (к полу или между собой), если предусмотрено",{cond:t.skit>0});
  q(T,"Подвести к каждому столу питание и сеть, убрать кабели в кабель-каналы",{cond:t.skit>0});
  q(T,"Фото собранных столов",{cond:t.skit>0,ph:true});
  q(T,"Заменить деревянные столы CSIK на железные — {buyTables} шт.",{cond:tbl>0,ph:true,sub:["Отключить CSIK и снять с деревянного стола","Собрать железный стол, установить и подключить CSIK","Проверить работу кассы"]});
  q(T,"Установить КВП на CSIK — {buyKvp} шт.",{cond:kvp>0,link:L("kvp"),sub:["Подключить контроллер КВП по USB","Прошить и настроить КВП по инструкции"]});

  q(KS,"Распаковать КСО, проверить комплектность по накладной",{cond:t.skit>0,sub:["Моноблок с экраном и встроенным сканером","Контрольно-весовая платформа (КВП), {bag}-пакетная зона","Ручной сканер, фонарь, кабели"]});
  q(KS,"Установить КСО на стол и закрепить штатным крепежом",{cond:t.skit>0});
  q(KS,"Установить КВП (пакетную зону), подключить её контроллер по USB",{cond:t.skit>0});
  q(KS,"Установить ККТ с ФН и подключить: Кварц 2Ф с демонтажа — {rKkt} шт., новые Нова Принт — {oKkt} шт.",{cond:t.skit>0});
  q(KS,"Установить терминал PayDemo в держатель, подключить по USB",{cond:t.skit>0});
  q(KS,"Подключить ручной сканер, фонарь и колонки",{cond:t.skit>0,sub:["Колонки — в USB-звуковую карту или во встроенную","Фонарь — на корпус КСО"]});
  q(KS,"Подключить питание и сеть, включить КСО",{cond:t.skit>0});
  q(KS,"Фото установленных КСО",{cond:t.skit>0,ph:true});
  q(C,"Установить {csik} CSIK с ТТ {csikFrom}, подключить периферию, питание и сеть",{cond:t.csik>0});

  q(S,"Установить ОС с флешки (образ 2.6.0)",{cond:K,link:L("img")});
  q(S,"Первоначальная настройка: пароли, экран, сеть, сервер",{cond:K,link:L("first"),sub:[
    {text:"Подключиться по SSH (POSConsole) и сменить пароль pos: echo \"pos:ПАРОЛЬ\" | sudo chpasswd -m; sudo chmod 400 /etc/shadow (пароль — в менеджере паролей)"},
    {text:"Сменить пароль БД: psql -U postgres -c \"ALTER ROLE postgres WITH PASSWORD '...'\"; psql -U postgres -c \"select pg_reload_conf()\"; posctl restart"},
    {text:"Повернуть экран: posctl display rotate right (если вверх ногами — rotate left)"},
    {text:"Сеть: DHCP или «Указать вручную» → Далее"},
    {text:"Сервер: номер магазина, номер кассы, IP POSCore (10.0.0.10) → перезагрузить"}]});
  q(S,"Настройка оборудования в кассе",{cond:K,link:L("first"),sub:[
    {text:"Фонарь: порт ttyLAMP"},
    {text:"Встроенный сканер сканер модели A: Default, порт ttyUSB-A1, интервал 2000, сигналы 2/3, команда A1"},
    {text:"Или сканер модели B: Default, порт ttyUSB-B1, интервал 2000, сигналы 2/3, команда 01"},
    {text:"Ручной сканер: Handle, порт ttyUSB-H1 или ttyUSB-H2, интервал 2000, сигналы 2/3, команда 01"},
    {text:"Бейджи консультантов",link:L("badge")},
    {text:"Отключить печать второго чека",link:L("check2")}]});
  q(S,"ККТ и виды оплат",{cond:K,link:L("kkt"),sub:[
    {text:"ККТ: модель КВАРЦ 2Ф, порт ttyFR0, скорость 57600"},
    t.oKkt>0&&{text:"ККТ Нова Принт: в настройках ФР выбрать модель Нова Принт, проверить печать чека"},
    {text:"При ошибке ФР: проверить в /opt/pos/storage/pos-app/config/modules/fiscalPrinter-config.xml строки model = kvarts2f100"},
    {text:"Банки: отметить «PayDemo» и «ДемоБанк СБП» → Сохранить → перезагрузить"}]});
  q(S,"Процессинг PayDemo",{cond:K,link:L("pay"),sub:[
    {text:"WinSCP: очистить /opt/pos/storage/pos-app/banks/paydemo/, скопировать папку lib из pay-libs.zip"},
    {text:"Права 7777 (Properties → Octal) на папку lib и все файлы в ней"},
    {text:"terminal.conf: Port=auto, USB=off"},
    {text:"Если терминал не работает: lsusb (1a2b:0001), ls -la /dev/ttyS* — порт в конфиге = ttyS+1"},
    {text:"Проверка: cd /mnt/disk/storage/pos-app/banks/paydemo/lib; ./pay_cli 9 3 → результат 0"},
    {text:"Сверка итогов: ./pay_cli 11 → «Сверка итогов» на терминале, сделать 2 раза"}]});
  q(S,"Общие настройки в PGAdmin",{cond:K,link:L("common"),sub:[
    {text:"Подключиться к кассе через PGAdmin (IP кассы, пароль, Save password)",link:L("pgadmin")},
    {text:"Реклама: в БД pos_main ADVERTISEMENT_SLIDES_INTERVAL_SEC = 30"},
    {text:"КВП: в БД pos_sco SCALE_CONTROL_ENABLED = true"}]});
  q(S,"Контрольно-весовая платформа (КВП)",{cond:K,link:L("kvp"),sub:[
    {text:"Версия кассы не ниже 2.3.1 / 2.4.0; с 2.5.0 — только весовые службы 1.2"},
    {text:"Прошить контроллер КВП (lsusb: 1a2b:0002) через FwTool.exe на Windows: Файл → Загрузить → Прошить"},
    {text:"Загрузить в /opt/pos/storage и дать права 7777: scaleweb_install, install-scale-svc — на каждую КСО, install-scale-db — на одну (мастер)"},
    {text:"Установить: sh scaleweb_install_v1.0.sh; sh install-scale-svc-1.2.sh; на мастере sh install-scale-db-1.2.sh → posctl restart sco"},
    {text:"Включить КВП: psql -U postgres -d pos_sco -c \"update property set value='true' where module='SCALE_CONTROL' and key='SCALE_CONTROL_ENABLED'\""},
    {text:"main.properties (services/scaleguard/conf): USE_WEB_SOCKET=true → перезагрузить"},
    {text:"scaleweb/scale.conf: DB_PASS и MASTER_PASS — актуальные пароли из менеджера паролей"},
    {text:"ScaleWeb (IP кассы:8081, логин pos): ScaleMaster — HOST = IP мастер-кассы, CASHES = IP всех КСО с :7101 через ;"},
    {text:"ScaleWeb: ScaleGuard — MASTER_IP = IP мастер-кассы:7102; красные поля поправить в main.properties"}]});
  q(S,"Лояльность LoyaltyHub",{cond:K,link:L("loyalty"),sub:[
    {text:"LoyaltyHubPlugin-2.0.jar (не распаковывать) → /opt/pos/storage/pos-app/plugins, права 7777"},
    {text:"posctl save; posctl restart (или sudo reboot)"},
    {text:"pos_main: BONUS_AS_DISCOUNT_TYPE = API_DISCOUNT (списание бонусов как скидки)"},
    {text:"pos_main: ENABLE_DC_MODE = true (экран запроса карты), проверить оба значения → перезагрузить"}]});
  q(S,"Распознавание товаров VisionScan AI (если есть камера)",{cond:K,req:false,link:L("vision"),sub:[
    {text:"ip a — интерфейс eth1 с адресом 10.20.0.2; прописать его в /etc/pos/network.local"},
    {text:"ping 10.20.0.1 (если не проходит — sudo dhclient eth1)"},
    {text:"Установить пакет: sudo dpkg -i visionscan-manager_..._amd64.deb"},
    {text:"Менеджер VisionScan AI: подключить камеру → Режим обучения «включено» → Отправить → Калибровка зоны"},
    {text:"Сервер: процессинг «Сервис распознавания VisionScan», порог 10%; пик-лист"},
    {text:"posctl restart sco; в pos_sco RECOGNITION_ENABLED = true"}]});
  q(S,"Реклама и логотип",{cond:K,link:L("adv"),sub:[
    {text:"Картинка 1080×1830 → /opt/pos/storage/pos-app/images/advertisement"},
    {text:"Нет кнопок «Поиск товара», «Позвать консультанта» на рекламе — проверить галочку в шаблоне кассы"},
    {text:"Логотип «{fmt}» в двух копиях: company_logo_common.svg и company_logo_horiz.svg → /opt/pos/storage/pos-app/images/client"},
    {text:"Перезагрузить кассу"}]});
  q(S,"Звуковое сопровождение и громкость",{cond:K,link:L("sound"),sub:[
    {text:"Проверить mplayer (обычно уже установлен)",link:L("soundV3")},
    {text:"Очистить /opt/pos/storage/pos-app/media/sound и залить звуки формата «{fmt}» из sounds"},
    {text:"Проверить: mplayer /opt/pos/storage/pos-app/media/sound/attendant.mp3"},
    {text:"Колонки в USB-звуковой карте: card=1 && echo \"defaults.ctl.card ${card}\" > /opt/pos/.asoundrc && echo \"defaults.pcm.card ${card}\" >> /opt/pos/.asoundrc"},
    {text:"Меню консультанта → Громкость звука → выставить → Сохранить",link:L("volume")}]});

  q(V,"Тестовая продажа и возврат, печать чека",{cond:K});
  q(V,"Оплата картой (PayDemo) и по СБП",{cond:K});
  q(V,"Продажа маркированного товара",{cond:K});
  q(V,"Продажа ЕГАИС-товара",{cond:K});
  q(V,"Подтверждение возраста через МАХ при продаже товара 18+",{cond:K});
  q(V,"КВП: товар на платформе принимается, чужой вес даёт ошибку",{cond:K});
  q(V,"Сканеры: считывание товаров и бейджей",{cond:K});
  q(V,"Списание бонусов и экран запроса карты (LoyaltyHub)",{cond:K});
  q(V,"Звук и воспроизведение рекламы на кассе",{cond:K});
  q(V,"Фонарь загорается при вызове консультанта",{cond:K,req:false});

  q(F,"Показать персоналу ТТ, как работает КСО",{cond:K,req:false,sub:["Вход в меню консультанта по бейджу","Громкость, аннулирование, изменение веса товара","Подтверждение возраста покупателя через МАХ"]});
  q(F,"Сообщить во 2ЛТП о запуске новых касс в работу (номера касс)",{cond:K});
  q(F,"Фото установленных и работающих касс",{cond:K,ph:true});
  q(F,"Подписать акт выполненных работ с директором ТТ, фото акта",{ph:true});
  if(K)q(F,"Все {kso} КСО установлены, настроены и прошли тестирование"+(dem>0?"; демонтировано: {dem}":""));
  else q(F,"Работы на ТТ выполнены"+(dem>0?"; демонтировано: {dem}":"")+(out>0?"; отправлено S.kit: {outSkit}":"")+(tbl>0?"; заменено столов: {buyTables}":""));
  return {prep:P,onsite:O};
}

/* ---------- пересчёт чек-листа без потери отметок ----------
   old — текущие пункты ТТ, fresh — пункты шаблона для новых количеств.
   o.removed — ключи пунктов шаблона, которые администратор удалил у этой ТТ (не возвращаем);
   o.hasData(key) — есть ли у пункта/подпункта отметка, комментарий или фото (такие пункты не удаляем);
   o.newId(prefix) — новый уникальный id.
   Возвращает {items, moves:[[старый ключ отметки, новый]], added, dropped}. */
function syncList(old,fresh,o){
  const removed=o.removed||new Set(),hasData=o.hasData||(()=>false),newId=o.newId;
  const used=new Set(),out=[],moves=[];let added=0,dropped=0;
  const keyOf=i=>i.tk||null;
  const ck=(iid,sid)=>sid?iid+"~"+sid:iid;
  const findOld=f=>old.find(x=>!used.has(x)&&((x.tk&&x.tk===f.tk)||(!x.tk&&x.text===f.text)));
  const mergeSubs=(oi,fi)=>{
    const os=oi.sub||[],fs=fi.sub||[],u=new Set(),res=[];
    fs.forEach(fsub=>{const m=os.find(x=>!u.has(x)&&((x.tk&&x.tk===fsub.tk)||(!x.tk&&x.text===fsub.text)));
      if(m){u.add(m);res.push({...m,tk:fsub.tk,link:m.link||fsub.link||""})}
      else if(!removed.has(fi.tk+" >> "+fsub.tk)){let id=fsub.id;while(!id||os.some(x=>x.id===id)||res.some(x=>x.id===id))id=newId("s");res.push({id,tk:fsub.tk,text:fsub.text,link:fsub.link||""});added++}});
    os.forEach((x,k)=>{if(u.has(x))return;
      if(!x.tk||hasData(ck(oi.id,x.id))){let pos=-1;for(let j=k-1;j>=0;j--){const pi=res.findIndex(y=>y.id===os[j].id);if(pi>=0){pos=pi;break}}res.splice(pos+1,0,x)}else dropped++});
    return res;
  };
  fresh.forEach(f=>{
    const m=findOld(f);
    if(m){used.add(m);
      const it={...f,...m,tk:f.tk,sub:mergeSubs(m,f)};
      ["link","who"].forEach(k=>{if(!m[k]&&f[k])it[k]=f[k]});
      if(!(m.sub||[]).length&&it.sub.length&&hasData(m.id))moves.push([m.id,ck(m.id,it.sub[0].id)]);
      out.push(it);
    }else if(!removed.has(f.tk)){let id=f.id;while(!id||old.some(x=>x.id===id)||out.some(x=>x.id===id))id=newId(o.prefix||"x");out.push({...f,id,sub:(f.sub||[]).map(s=>({...s}))});added++}
  });
  /* Пункты, которых нет в шаблоне для новых количеств: свои (без ключа шаблона) и пункты с отметками/фото/комментариями оставляем на месте */
  old.forEach((x,k)=>{if(used.has(x))return;
    const keep=!x.tk||x.resp||hasData(x.id)||(x.sub||[]).some(s=>hasData(ck(x.id,s.id)));
    if(!keep){dropped++;return}
    let pos=-1;for(let j=k-1;j>=0;j--){const pi=out.findIndex(y=>y.id===old[j].id);if(pi>=0){pos=pi;break}}
    out.splice(pos+1,0,x)});
  return {items:out,moves,added,dropped};
}

/* Перенос старого (версии 2) чек-листа: восстанавливает ключи шаблона и находит пункты, удалённые администратором.
   Сначала совпадение по тексту, затем по id (если текст пункта правили вручную). */
function pairUp(old,v2){
  const used=new Set(),pair=new Map(),oldTexts=new Set(old.map(x=>x.text));
  old.forEach(o=>{const v=v2.find(x=>!used.has(x)&&x.text===o.text);if(v){used.add(v);pair.set(o,v)}});
  old.forEach(o=>{if(pair.has(o))return;const v=v2.find(x=>!used.has(x)&&x.id===o.id&&!oldTexts.has(x.text));if(v){used.add(v);pair.set(o,v)}});
  return {pair,unused:v2.filter(x=>!used.has(x))};
}
function tagFromV2(old,v2){
  const removed=[];const RN=x=>RENAMES[x]||x;
  const top=pairUp(old,v2);top.unused.forEach(i=>removed.push(RN(i.text)));
  const items=old.map(i=>{
    const v=top.pair.get(i);if(!v||i.tk)return i;
    const tk=RN(v.text);const it={...i,tk};if(i.text===v.text)it.text=tk;
    const sp=pairUp(i.sub||[],v.sub||[]);sp.unused.forEach(s=>removed.push(tk+" >> "+RN(s.text)));
    it.sub=(i.sub||[]).map(s=>{const w=sp.pair.get(s);if(!w||s.tk)return s;const stk=RN(w.text);return {...s,tk:stk,text:s.text===w.text?stk:s.text}});
    return it});
  return {items,removed};
}
if(typeof module!=="undefined")module.exports={genLists,syncList,tagFromV2,RENAMES,WIKI_ROOT,TEMPLATE_VERSION};
