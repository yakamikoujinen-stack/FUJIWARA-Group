import {bindLogin,ref,onValue,update} from './firebase.mjs';
import {ROOT,packImport,voucherChanges} from './store.mjs';
import {bindReceipts} from './receipt-controller.mjs';

const FORMAT='FUJIWARA_CEO_VOUCHER_OFFLINE_V1', $=id=>document.getElementById(id);
const te=new TextEncoder(),td=new TextDecoder();let entries=[], opened=false, photoData=null, saving=false, photoTask=null;
const encoder=x=>Array.from(new Uint8Array(x));const b64=x=>{const a=new Uint8Array(x);let v='';for(let i=0;i<a.length;i+=16384)v+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(v)};const unb64=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
const scopeLabel=x=>({'プライベートA':'本家','プライベートB':'分家'}[x]||x);
 const nameDoc={receipt:'領収書・レシート',received_invoice:'受取請求書',issued_invoice:'発行請求書',delivery:'納品書・仕入伝票',other:'その他伝票'};
const money=x=>'¥'+Number(x||0).toLocaleString('ja-JP');const today=()=>new Date().toLocaleDateString('sv-SE');const id=()=>crypto.randomUUID?crypto.randomUUID():'v-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const fmtErr=e=>String(e&&e.message||e);const msg=(s)=>$('message').textContent=s;
async function derive(secret,salt){const material=await crypto.subtle.importKey('raw',te.encode(secret),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encrypt(obj,secret,baseSalt){const salt=baseSalt||crypto.getRandomValues(new Uint8Array(16));const iv=crypto.getRandomValues(new Uint8Array(12));const key=await derive(secret,salt);const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,te.encode(JSON.stringify(obj)));return {format:FORMAT,version:1,kdf:'PBKDF2-SHA256',iterations:250000,salt:b64(salt),iv:b64(iv),payload:b64(cipher)};}
async function decrypt(enc,secret){if(!enc||enc.format!==FORMAT||enc.version!==1||enc.kdf!=='PBKDF2-SHA256'||enc.iterations!==250000||typeof enc.payload!=='string'||enc.payload.length>22000000)throw Error('対応していないバックアップ形式または容量です');const salt=unb64(enc.salt),iv=unb64(enc.iv);if(salt.length!==16||iv.length!==12)throw Error('暗号化ファイルの形式が不正です');const key=await derive(secret,salt);const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,unb64(enc.payload));const o=JSON.parse(td.decode(plaintext));if(!o||o.version!==1||!Array.isArray(o.entries)||o.entries.length>4000)throw Error('帳簿データの形式が不正です');for(const e of o.entries){if(!e||typeof e.id!=='string'||typeof e.date!=='string'||typeof e.scope!=='string'||!Number.isSafeInteger(e.amount)||e.amount<=0||typeof e.partner!=='string')throw Error('伝票の形式が不正です');}return o;}
function clearForm(){receiptDraft=undefined;editRevision=undefined;$('entryForm').removeAttribute('data-dirty');$('entryMessage').textContent='';$('entryForm').reset();$('editId').value='';$('entryDate').value=today();photoData=null;$('saveBtn').textContent='✅ 伝票を仮保存';}
function formValue(){const d={id:$('editId').value||receiptDraft||id(),date:$('entryDate').value,docType:$('docType').value,scope:$('scope').value,event:$('event').value.trim(),category:$('category').value,partner:$('partner').value.trim(),amount:Number($('amount').value),payment:$('payment').value,status:$('entryStatus').value,prior:$('prior').value,number:$('number').value.trim(),details:$('details').value.trim(),fileName:$('fileName').value.trim(),photo:photoData||null,updatedAt:new Date().toISOString()};if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date))throw Error('日付を確認してください');if(!d.partner||d.partner.length>120)throw Error('取引先を入力してください');if(!Number.isSafeInteger(d.amount)||d.amount<1||d.amount>999999999)throw Error('金額は1〜999,999,999円で入力してください');if(!d.scope)throw Error('所属先を選択してください');if(d.scope==='イベント経費'&&!d.event)throw Error('イベント経費にはイベント名を入力してください');return d;}
function duplicate(d){return entries.find(x=>x.id!==d.id&&x.scope===d.scope&&((d.number&&x.number&&d.number===x.number)||(x.date===d.date&&x.partner===d.partner&&x.amount===d.amount&&x.docType===d.docType)));}
async function imageRead(file){if(!file)return null;if(!file.type.startsWith('image/'))throw Error('写真ファイルのみ対応しています');if(file.size>15*1024*1024)throw Error('写真は15MB以下にしてください');const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1300/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();let quality=.75,result=canvas.toDataURL('image/jpeg',quality);while(result.length>600000&&quality>.3){quality-=.1;result=canvas.toDataURL('image/jpeg',quality)}if(result.length>600000)throw Error('写真が大きすぎます。原本は別保存して、ファイル名だけ入力してください');return result;}
function entryMessage(message){
  $('entryMessage').textContent=message;
  msg(message);
}
async function saveEntry(event){
  event.preventDefault();
  if(!opened||saving||photoTask)return;
  saving=true;
  $('saveBtn').disabled=true;
  $('resetForm').disabled=true;
  $('receiptFile').disabled=true;
  entryMessage('保存しています…');
  try{
    const record=formValue();
    const duplicateRecord=duplicate(record);
    if(duplicateRecord&&!confirm('同じ伝票の可能性があります。'+duplicateRecord.date+' '+duplicateRecord.partner+' '+money(duplicateRecord.amount)+'\n別の伝票として保存しますか？')){
      entryMessage('保存を取り消しました。入力内容を確認してください。');
      return;
    }
    const index = entries.findIndex(entry => entry.id === record.id);
    const previous = entries[index];
    if (receiptDraft && records[receiptDraft]) throw Error('この申請はすでに帳簿に登録されています。');
    if ($('editId').value && (!previous || records[record.id].revision !== editRevision)) {
      throw Error('別の端末でこの伝票が更新されました。一覧から最新の内容を開いてください。');
    }
    record.createdAt = previous?.createdAt ?? new Date().toISOString();
    record.receiptSource = previous?.receiptSource ?? receiptDraft;
    if (record.receiptSource == null) delete record.receiptSource;
    if (previous) {
      if (previous.reviewedOn) record.reviewedOn = previous.reviewedOn;
      if (record.event === previous.event && record.scope === previous.scope) {
        if (previous.eventStart) record.eventStart = previous.eventStart;
        if (previous.eventEnd) record.eventEnd = previous.eventEnd;
      }
    }
    const next = entries.slice();
    if (previous) next[index] = record;
    else next.push(record);
    await persist(next);
    clearForm();
    entryMessage('保存しました。' + record.partner + ' ／ ' + money(record.amount));
  }catch(error){
    entryMessage('❌ 保存できません：'+fmtErr(error));
  }finally{
    saving=false;
    $('saveBtn').disabled=false;
    $('resetForm').disabled=false;
    $('receiptFile').disabled=false;
  }
}
function safe(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));}
function filtered(){const month=$('filterMonth').value,scope=$('filterScope').value,q=$('search').value.toLowerCase();return entries.filter(e=>(!month||e.date.startsWith(month))&&(!scope||e.scope===scope)&&(!q||[e.partner,e.event,e.number,e.details,e.category].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));}
function render(){if(!opened)return;const all=entries,rows=filtered(),unresolved=all.filter(e=>e.status!=='照合済み').length,unpaid=all.filter(e=>['未払い・買掛','売掛・入金待ち'].includes(e.payment)).length;$('metrics').innerHTML=`<div class="metric">伝票件数<b>${all.length}件</b></div><div class="metric">未照合・照合待ち<b>${unresolved}件</b></div><div class="metric">未払・入金待ち<b>${unpaid}件</b></div>`;groupTotals(rows);const amount=rows.reduce((x,e)=>x+e.amount,0);$('summary').textContent=`表示 ${rows.length}件 ／ 伝票金額の合算 ${money(amount)}（請求・納品を含む参考値。売上・経費の確定値ではありません）`;$('rows').innerHTML=rows.map(e=>`<tr><td>${safe(e.date)}</td><td>${safe(scopeLabel(e.scope))}<div class="muted">${safe(e.event)}</div></td><td>${safe(nameDoc[e.docType]||e.docType)}<div><b>${safe(e.partner)}</b></div><div class="muted">${safe(e.category)} ／ ${safe(e.number)}</div></td><td class="num">${money(e.amount)}</td><td>${safe(e.payment)}<div class="tag">${safe(e.status)}</div><div class="muted">${safe(e.prior)}</div></td><td class="actions"><button class="secondary" data-action="edit" data-id="${safe(e.id)}">編集</button><button class="secondary" data-action="detail" data-id="${safe(e.id)}">詳細</button><button class="danger" data-action="delete" data-id="${safe(e.id)}">削除</button></td></tr>`).join('')||'<tr><td colspan="6">まだ該当する伝票はありません。</td></tr>';}
function edit(e){receiptDraft=undefined;editRevision=records[e.id].revision;$('entryForm').setAttribute('data-dirty','');const map={entryDate:'date',docType:'docType',scope:'scope',event:'event',category:'category',partner:'partner',amount:'amount',payment:'payment',entryStatus:'status',prior:'prior',number:'number',details:'details',fileName:'fileName'};Object.keys(map).forEach(k=>{$(k).value=e[map[k]]??''});$('editId').value=e.id;photoData=e.photo||null;$('receiptFile').value='';$('saveBtn').textContent='✅ 変更を仮保存';$('entryForm').scrollIntoView({behavior:'smooth',block:'start'});msg('✏️ 編集中：'+e.partner+' / '+money(e.amount)+'。編集して保存すると同じIDが更新されます。')}
function detail(e){const s=[`日付：${e.date}`,`種類：${nameDoc[e.docType]||e.docType}`,`所属：${scopeLabel(e.scope)}`,`イベント・案件：${e.event||'なし'}`,`開催期間：${[e.eventStart,e.eventEnd].filter(Boolean).join('〜')||'未入力'}`,`整理日：${e.reviewedOn||'未入力'}`,`取引先：${e.partner}`,`金額：${money(e.amount)}`,`支払：${e.payment}`,`照合：${e.status}`,`既存計上：${e.prior}`,`伝票番号：${e.number||'なし'}`,`内容：${e.details||'なし'}`,`原本ファイル名：${e.fileName||'なし'}`,`写真：${e.photo?'共有帳簿に縮小写真あり':'なし'}`,`ID：${e.id}`];alert(s.join('\n'));if(e.photo&&confirm('登録した縮小写真を別タブで表示しますか？')){const w=window.open('about:blank','_blank');if(w){const img=w.document.createElement('img');img.src=e.photo;img.style.maxWidth='100%';w.document.body.appendChild(img)}}}
function dl(filename,content,mime){const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
async function readFile(file){if(!file)throw Error('ファイルを選択してください');if(file.size>16*1024*1024)throw Error('バックアップが16MBを超えています');return JSON.parse(await file.text());}
function csvCell(x){return '"'+String(x??'').replace(/^([=+@\-\t\r\n])/,"'$1").replace(/"/g,'""')+'"'}
function csv(){const cols=[['date','日付'],['scope','所属先'],['event','イベント・案件'],['eventStart','開催日（自）'],['eventEnd','開催日（至）'],['reviewedOn','整理日'],['docType','書類種別'],['category','科目'],['partner','取引先'],['amount','金額'],['payment','支払状況'],['status','照合'],['prior','既存計上'],['number','伝票番号'],['details','内容'],['fileName','原本ファイル名'],['id','ID']];let body=[cols.map(x=>csvCell(x[1])).join(',')];for(const e of filtered())body.push(cols.map(x=>csvCell(x[0]==='docType'?nameDoc[e.docType]:x[0]==='scope'?scopeLabel(e.scope):e[x[0]])).join(','));dl('FUJIWARA_社長伝票一覧_'+today()+'.csv','\ufeff'+body.join('\r\n'),'text/csv;charset=utf-8');}

const paperScopes=[
  ['事務所（FUJIWARA Group）','事務所経費'],
  ['現場','現場経費'],
  ['リコー工業','リコー工業経費'],
  ['（株）ミライソ','（株）ミライソ'],
  ['私物','私物'],
  ['本家','プライベートA'],
  ['分家','プライベートB'],
  ['イベント','イベント経費']
];
function paperField(name,label,control){
  return '<label>'+label+control.replace('>', ' data-field="'+name+'">')+'</label>';
}
function paperSelect(name,label,id,defaultValue){
  const source=$(id);
  const options=Array.from(source.options,option=>
    '<option value="'+safe(option.value)+'"'+(option.value===defaultValue?' selected':'')+'>'+safe(option.textContent)+'</option>'
  ).join('');
  return paperField(name,label,'<select>'+options+'</select>');
}
function addPaperRow(label,scope){
  const row=$('paperRows').insertRow();
  row.dataset.scope=scope;
  const heading=document.createElement('th');
  heading.scope='row';
  heading.textContent=label;
  row.append(heading);
  if(scope==='イベント経費'){
    heading.insertAdjacentHTML('beforeend',
      paperField('event','イベント名','<input maxlength="120">')+
      paperField('eventStart','開催日（自）','<input type="date">')+
      paperField('eventEnd','開催日（至）','<input type="date">'));
  }
  for(let column=1;column<=5;column++){
    const cell=row.insertCell();
    cell.dataset.column=column;
    cell.innerHTML=paperField('date','伝票日付','<input type="date">')+
      paperField('partner','取引先','<input maxlength="120">')+
      paperField('amount','金額（円）','<input type="number" min="1" max="999999999" step="1" inputmode="numeric">')+
      '<details><summary>科目・支払など</summary>'+
      paperSelect('category','科目','category','その他')+
      paperSelect('payment','支払','payment','未確認')+
      paperSelect('docType','種類','docType','receipt')+
      paperSelect('prior','既存アプリ計上','prior',$('prior').options[0].value)+
      paperField('number','伝票番号','<input maxlength="80">')+
      paperField('details','内容','<input maxlength="800">')+
      '</details>';
  }
  row.insertCell().dataset.total='';
}
function refreshPaperTotals(){
  let count=0;
  let total=0;
  for(const row of $('paperRows').rows){
    let subtotal=0;
    for(const input of row.querySelectorAll('[data-field="amount"]')){
      if(input.value&&input.validity.valid){
        subtotal+=Number(input.value);
        count++;
      }
    }
    row.querySelector('[data-total]').textContent=money(subtotal);
    total+=subtotal;
  }
  $('paperTotal').textContent='入力中 '+count+'件 ／ 合計 '+money(total);
}
function resetPaper(){
  $('paperRows').replaceChildren();
  paperScopes.forEach(([label,scope])=>addPaperRow(label,scope));
  refreshPaperTotals();
}
function paperError(field,message){
  field.setAttribute('aria-invalid','true');
  field.focus();
  throw Error(message);
}
function paperEntries(existing){
  const pending=[];
  const now=new Date().toISOString();
  const reviewedOn=today();
  for(const row of $('paperRows').rows){
    const scope=row.dataset.scope;
    const eventField=row.querySelector('[data-field="event"]');
    const event=eventField?.value.trim()||'';
    const eventStart=row.querySelector('[data-field="eventStart"]')?.value||'';
    const eventEndField=row.querySelector('[data-field="eventEnd"]');
    const eventEnd=eventEndField?.value||'';
    for(const cell of row.querySelectorAll('[data-column]')){
      const field=name=>cell.querySelector('[data-field="'+name+'"]');
      const value=name=>field(name).value.trim();
      const date=value('date'),partner=value('partner'),amount=value('amount');
      const number=value('number'),details=value('details');
      if(!date&&!partner&&!amount&&!number&&!details&&!field('amount').validity.badInput)continue;
      const label=(event||row.cells[0].firstChild.textContent)+'の'+cell.dataset.column+'枠目';
      if(eventField&&!event)paperError(eventField,label+'にイベント名を入力してください。');
      if(eventEnd&&(!eventStart||eventEnd<eventStart))paperError(eventEndField,label+'の開催期間を確認してください。');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))paperError(field('date'),label+'に伝票日付を入力してください。');
      if(!partner)paperError(field('partner'),label+'に取引先を入力してください。');
      if(!amount||!field('amount').validity.valid)paperError(field('amount'),label+'の金額は1〜999,999,999円の整数で入力してください。');
      const entry={
        id:id(), date, docType:value('docType'), scope, event, eventStart, eventEnd, reviewedOn,
        category:value('category'), partner, amount:Number(amount), payment:value('payment'),
        status:'未照合', prior:value('prior'), number, details, fileName:'', photo:null,
        createdAt:now, updatedAt:now
      };
      const repeated=[...existing,...pending].some(other=>other.scope===scope&&(
        number&&other.number===number ||
        other.date===date&&other.partner===partner&&other.amount===entry.amount&&other.docType===entry.docType
      ));
      if(repeated)paperError(field('partner'),label+'（'+partner+'・'+money(entry.amount)+'）に重複候補があります。先に伝票一覧を確認してください。');
      pending.push(entry);
    }
  }
  return pending;
}
async function savePaper(event){
  event.preventDefault();
  if(!opened||saving||photoTask)return;
  const message=$('paperMessage');
  $('paperRows').querySelectorAll('[aria-invalid]').forEach(field=>field.removeAttribute('aria-invalid'));
  let pending;
  try{
    pending=paperEntries(entries);
    if(!pending.length)throw Error('保存する伝票を入力してください。');
  }catch(error){
    message.textContent=fmtErr(error);
    return;
  }
  saving=true;
  const controls=[...$('paperForm').querySelectorAll('input, select, button')];
  controls.forEach(control=>control.disabled=true);
  message.textContent='保存しています…';
  try{
    await persist([...entries,...pending]);
    resetPaper();
    message.textContent='✅ '+pending.length+'件を保存しました。下の「伝票一覧・分類別確認」で絞り込めます。';
  }catch(error){
    message.textContent='❌ 入力した伝票を保存できません。'+fmtErr(error);
  }finally{
    saving=false;
    controls.forEach(control=>control.disabled=false);
  }
}
$('paperAddEvent').onclick=()=>{
  addPaperRow('イベント','イベント経費');
  $('paperRows').lastElementChild.querySelector('input').focus();
  refreshPaperTotals();
};
$('paperForm').onsubmit=savePaper;
$('paperForm').addEventListener('input',refreshPaperTotals);

$('entryForm').onsubmit=saveEntry;
$('resetForm').onclick=()=>{clearForm();$('entryMessage').textContent='';};
$('receiptFile').onchange=async()=>{
  photoData=null;
  const file=$('receiptFile').files[0];
  if(!file)return;
  $('saveBtn').disabled=true;
  entryMessage('写真を読み込んでいます…');
  const active=session;
  const task=imageRead(file);
  photoTask=task;
  try{
    const photo=await task;
    if($('receiptFile').files[0]!==file||session!==active)return;
    photoData=photo;
    entryMessage('写真を読み込みました。「伝票を仮保存」で一緒に保存できます。');
  }catch(error){
    if($('receiptFile').files[0]!==file||session!==active)return;
    $('receiptFile').value='';
    entryMessage('⚠️ '+fmtErr(error));
  }finally{
    if(photoTask===task){
      photoTask=null;
      $('saveBtn').disabled=saving;
    }
  }
};
let session, ledgerStop, connectionStop, records = {}, online = false, editRevision;
let receiptDraft;
const revisions = () => new Map(Object.entries(records).map(([id,row]) => [id,row.revision]));

function openLedger(account) {
  ledgerStop?.();
  connectionStop?.();
  session = account?.role === 'ceo' ? account : null;
  opened = false;
  online = false;
  records = {};
  entries = [];
  $('work').classList.add('hidden');
  $('connection').textContent = '';
  clearForm();
  resetPaper();
  $('rows').replaceChildren();
  $('backupResult').textContent = '';
  $('backupPassphrase').value = '';
  if (!session) return;
  const active = session;
  $('connection').textContent = '共有帳簿を読み込んでいます。';
  connectionStop = onValue(ref(active.db,'.info/connected'), snap => {
    if (session !== active) return;
    online = snap.val() === true;
    if (opened) $('connection').textContent = online ? '共有帳簿に接続中' : '接続が切れました。再接続を待っています。';
  });
  ledgerStop = onValue(ref(active.db, ROOT + '/vouchers'), snap => {
    if (session !== active) return;
    records = snap.val() ?? {};
    entries = Object.values(records).filter(row => row.voucher).map(row => row.voucher);
    opened = true;
    $('work').classList.remove('hidden');
    $('connection').textContent = online ? '共有帳簿に接続中' : '接続を確認しています。';
    render();
    refreshReceiptLinks();
  }, () => {
    if (session !== active) return;
    opened = false;
    entries = [];
    records = {};
    $('work').classList.add('hidden');
    $('connection').textContent = '共有帳簿へのアクセスが拒否されました。';
  });
}

async function persist(next) {
  const active = session;
  if (!opened || !online || !active) throw Error('共有帳簿に接続してから保存してください。');
  const changes = voucherChanges(entries, next, revisions());
  if (!Object.keys(changes).length) return;
  $('logout').disabled = true;
  try {
    await update(ref(active.db, ROOT + '/vouchers'), changes);
  } catch (error) {
    if (error.code === 'PERMISSION_DENIED') {
      throw Error('別の端末で更新されたか、保存権限が変更されました。最新の伝票を確認してください。');
    }
    throw error;
  } finally {
    $('logout').disabled = false;
  }
}

async function backup() {
  if (!opened || saving) return;
  const active = session;
  const secret = $('backupPassphrase').value;
  if (secret.length < 12) throw Error('バックアップ用の合言葉を12文字以上で入力してください。');
  const snapshot = entries.slice();
  if (snapshot.length > 4000) throw Error('旧形式の上限（4,000件）を超えています。');
  const envelope = await encrypt({version:1,updatedAt:new Date().toISOString(),entries:snapshot},secret);
  if (session !== active || !opened) return;
  const output = JSON.stringify(envelope);
  if (output.length > 16 * 1024 * 1024) throw Error('旧形式の上限（16MB）を超えています。');
  dl('FUJIWARA_共有伝票_' + new Date().toISOString().replace(/[:.]/g,'-') + '.json',output,'application/json');
  $('backupResult').textContent = snapshot.length + '件のバックアップをダウンロードしました。';
}

let importCheck;
let importPreviewVersion = 0;
function resetImport() {
  importPreviewVersion++;
  importCheck = null;
  $('importConfirm').disabled = true;
}

async function previewImport() {
  resetImport();
  const version = importPreviewVersion;
  const active = session;
  const file = $('importFile').files[0];
  const secret = $('backupPassphrase').value;
  const result = $('backupResult');
  result.textContent = 'バックアップを読み込んでいます。';
  try {
    if (secret.length < 12) throw Error('元の仮帳簿で使った合言葉を入力してください。');
    const {entries: rows} = await decrypt(await readFile(file), secret);
    if (session !== active || !opened || version !== importPreviewVersion) return;
    const additions = packImport(rows, entries);
    if (additions.some(row => records[row.id])) throw Error('削除済みの伝票IDが含まれています。');
    importCheck = {active, rows, additions};
    $('importConfirm').disabled = !additions.length;
    const total = rows.reduce((sum,row) => sum + row.amount,0);
    result.textContent = 'バックアップ ' + rows.length + '件（' + money(total) + '）／ 新規 ' + additions.length + '件 ／ 登録済み ' + (rows.length-additions.length) + '件';
  } catch (error) {
    if (session === active && version === importPreviewVersion) {
      result.textContent = '検証できません。合言葉またはファイルをご確認ください。 ' + fmtErr(error);
    }
  }
}

async function importChecked() {
  if (!importCheck || saving) return;
  const checked = importCheck;
  const result = $('backupResult');
  if (session !== checked.active) return;
  saving = true;
  $('importConfirm').disabled = true;
  try {
    const additions = packImport(checked.rows, entries);
    if (additions.length !== checked.additions.length) throw Error('共有帳簿が変わりました。もう一度検証してください。');
    result.textContent = '共有帳簿に取り込んでいます。';
    await persist([...entries,...additions]);
    result.textContent = additions.length + '件を共有帳簿に取り込みました。';
  } catch (error) { result.textContent = fmtErr(error); }
  finally { resetImport(); saving = false; }
}

function refreshReceiptLinks() {
  for (const button of $('requests').querySelectorAll('[data-voucher-id]')) {
    const registered = records[button.dataset.voucherId];
    button.disabled = !!registered || !opened;
    button.textContent = registered?.deleted ? '帳簿から削除済み' : registered ? '帳簿に登録済み' : '振り分けて帳簿へ';
  }
}

function prepareReceipt(record) {
  if (!opened || saving || photoTask) return;
  const id = 'receipt-' + record.uid + '-' + record.id;
  if (records[id]) return;
  if ($('entryForm').hasAttribute('data-dirty') &&
      !confirm('伝票入力欄の内容をこのレシートで置き換えますか？')) return;
  clearForm();
  const item = record.submission;
  receiptDraft = id;
  $('entryDate').value = item.date;
  $('partner').value = item.supplier;
  $('amount').value = item.amount;
  $('event').value = item.event ?? '';
  $('scope').value = item.event ? 'イベント経費' : '';
  $('category').value = 'その他';
  $('payment').value = item.payment === 'スタッフ立替' ? 'スタッフ立替' : '未確認';
  $('details').value = [item.note, '申請者 ' + item.name, '申請時の支払区分 ' + item.payment].filter(Boolean).join('\n');
  photoData = item.photo;
  entryMessage('所属先・科目・支払状況を確認して保存してください。');
  $('entryForm').scrollIntoView({block:'start'});
  $('scope').focus({preventScroll:true});
}

function groupTotals(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const label = row.date.slice(0,7) + ' ／ ' + scopeLabel(row.scope);
    const item = grouped.get(label) ?? {count:0,sum:0};
    item.count++;
    item.sum += row.amount;
    grouped.set(label,item);
  }
  $('groupTotals').replaceChildren(...[...grouped].map(([label,item]) => {
    const li = document.createElement('li');
    li.textContent = label + ' ／ ' + item.count + '件 ／ ' + money(item.sum);
    return li;
  }));
}

$('rows').onclick = async event => {
  const button = event.target.closest('button');
  if (!button || saving) return;
  const row = entries.find(entry => entry.id === button.dataset.id);
  if (!row) return;
  if (button.dataset.action === 'edit') return edit(row);
  if (button.dataset.action === 'detail') return detail(row);
  if (!confirm('共有帳簿から削除しますか？\n' + row.partner + ' ／ ' + money(row.amount))) return;
  saving = true;
  try {
    await persist(entries.filter(entry => entry.id !== row.id));
    if ($('editId').value === row.id) clearForm();
    msg('削除しました。');
  } catch (error) { msg(fmtErr(error)); }
  finally { saving = false; }
};
for (const name of ['filterMonth','filterScope','search']) $(name).addEventListener('input',render);
$('entryForm').addEventListener('input',() => $('entryForm').setAttribute('data-dirty',''));
$('backup').onclick = () => backup().catch(error => { $('backupResult').textContent = fmtErr(error); });
$('csv').onclick = csv;
$('importFile').onchange = resetImport;
$('backupPassphrase').oninput = resetImport;
$('importPreview').onclick = previewImport;
$('importConfirm').onclick = importChecked;
const connectReceipts = bindReceipts({prepareReceipt,refreshReceiptLinks});
bindLogin({onAccount(account) {
  $('loginStatus').textContent = account ? (account.role === 'ceo' ? '社長としてログイン中' : 'スタッフとしてログイン中') : '';
  resetImport();
  $('importFile').value = '';
  openLedger(account);
  connectReceipts(account);
}, tell(message) { $('loginStatus').textContent = message; }});
