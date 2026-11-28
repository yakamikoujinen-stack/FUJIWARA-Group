import {ref,onValue,runTransaction,serverTimestamp} from './firebase.mjs';
import {ROOT} from './store.mjs';

const el = id => document.getElementById(id);
const tell = message => { el('receiptStatus').textContent = message; };

async function compress(file) {
  if (!file?.type.startsWith('image/') || file.size > 15 * 1024 * 1024) throw Error('15MB以下の写真を選んでください。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve,reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error('写真を開けませんでした。JPEGまたはPNGをお試しください。'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 1300 / Math.max(image.naturalWidth,image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [.78,.62,.46,.32]) {
      const photo = canvas.toDataURL('image/jpeg',quality);
      if (photo.length <= 600000) return photo;
    }
    throw Error('写真を小さくしてから再度お試しください。');
  } finally { URL.revokeObjectURL(url); }
}

export function bindReceipts({prepareReceipt,refreshReceiptLinks}) {
  let account, stop, pending, busy;
  const form = el('application');
  const applicationPath = (uid,id) => ROOT + '/applications/' + uid + '/' + id;
  function connect(next) {
    stop?.();
    account = next;
    pending = null;
    busy = false;
    form.reset();
    for (const control of form.elements) control.disabled = false;
    for (const id of ['staff','ceo']) el(id).hidden = true;
    for (const id of ['mine','requests']) el(id).replaceChildren();
    tell('');
    if (!account) return;
    const ceo = account.role === 'ceo';
    el(account.role).hidden = false;
    stop = onValue(ref(account.db, ROOT + '/applications' + (ceo ? '' : '/' + account.user.uid)),
      snapshot => {
        if (account !== next) return;
        const data = snapshot.val() ?? {};
        const groups = ceo ? Object.entries(data) : [[next.user.uid,data]];
        const entries = groups.flatMap(([uid,items]) =>
          Object.entries(items).map(([id,record]) => ({uid,id,...record})))
          .filter(record => record.submission);
        render(entries, next);
      }, () => {
        if (account !== next) return;
        el(ceo ? 'requests' : 'mine').replaceChildren();
        tell('申請一覧にアクセスできません。権限を確認してください。');
      });
  }

  form.onsubmit = async event => {
    event.preventDefault();
    const active = account;
    if (active?.role !== 'staff' || busy) return;
    const controls = [...form.elements];
    const fields = new FormData(form);
    const value = name => String(fields.get(name)).trim();
    busy = true;
    controls.forEach(control => control.disabled = true);
    el('logout').disabled = true;
    try {
      if (!pending) {
        const name = value('staffName'), supplier = value('supplier');
        if (!name || !supplier) throw Error('申請者と取引先を入力してください。');
        const photo = await compress(fields.get('photo'));
        pending = {id:crypto.randomUUID(), entry:{name,supplier,photo,date:value('date'),amount:Number(value('amount')),
          payment:value('payment'),event:value('event'),note:value('note'),createdAt:serverTimestamp()}};
      }
      if (active !== account) return;
      tell('サーバーへの保存を確認しています。');
      const result = await runTransaction(ref(active.db,applicationPath(active.user.uid,pending.id) + '/submission'),
        record => record === null ? pending.entry : undefined, {applyLocally:false});
      if (!result.committed && !result.snapshot.exists()) throw Error('保存結果を確認できません。');
      pending = null;
      form.reset();
      tell('レシートを送信しました。');
    } catch (error) {
      tell((pending ? '入力内容を保持しています。同じ申請を再送できます。 ' : '') + error.message);
    } finally {
      busy = false;
      el('logout').disabled = false;
      controls.forEach(control => control.disabled = !!pending && control !== event.submitter);
    }
  };

  function render(entries,active) {
    const ceo = active.role === 'ceo';
    const list = el(ceo ? 'requests' : 'mine');
    const drafts = new Map([...list.querySelectorAll('textarea[data-request]')].map(field => [field.dataset.request,field.value]));
    list.replaceChildren();
    if (!entries.length) add(list,'p','申請はありません。');
    for (const record of entries.sort((a,b) => b.submission.createdAt - a.submission.createdAt)) {
      const item = record.submission, decision = record.decision;
      const requestKey = record.uid + '/' + record.id;
      const card = add(list,'article','');
      add(card,'h3',item.supplier + ' ・ ¥' + item.amount.toLocaleString('ja-JP'));
      add(card,'p',[item.date,item.name,item.payment,item.event,item.note].filter(Boolean).join(' ／ '));
      add(card,'strong',decision?.status ?? '確認待ち');
      if (decision?.reason) add(card,'p',decision.reason);
      const details = add(card,'details','');
      add(details,'summary','レシート写真を表示');
      const image = add(details,'img','');
      image.alt = '添付レシート';
      image.loading = 'lazy';
      if (/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(item.photo)) image.src = item.photo;
      if (!ceo) continue;
      if (decision?.status === '確認済み') {
        const button = add(card,'button','振り分けて帳簿へ');
        button.dataset.voucherId = 'receipt-' + record.uid + '-' + record.id;
        button.onclick = () => prepareReceipt(record);
        continue;
      }
      const memo = add(add(card,'label','確認メモ'),'textarea','');
      memo.maxLength = 500;
      memo.dataset.request = requestKey;
      memo.value = drafts.get(requestKey) ?? decision?.reason ?? '';
      const controls = add(card,'div','');
      for (const status of ['確認済み','保留']) {
        const button = add(controls,'button',status);
        button.onclick = async () => {
          const reason = memo.value.trim();
          if (account !== active) return;
          if (status === '保留' && !reason) return tell('保留の理由を入力してください。');
          for (const control of controls.children) control.disabled = true;
          try {
            const result = await runTransaction(ref(active.db,applicationPath(record.uid,record.id) + '/decision'),
              current => (current?.revision ?? 0) !== (decision?.revision ?? 0) ? undefined :
                {status,reason,revision:(current?.revision ?? 0)+1}, {applyLocally:false});
            tell(result.committed ? '判断を保存しました。' : '別の画面で更新されました。最新の状態を確認してください。');
          } catch { tell('判断を保存できませんでした。'); }
          finally { for (const control of controls.children) control.disabled = false; }
        };
      }
    }
    refreshReceiptLinks();
  }
  return connect;
}

function add(parent,tag,text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}
