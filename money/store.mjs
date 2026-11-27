export const ROOT = 'moneyV1';

export const sameValue = (a, b) => {
  const canonical = value => value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] != null)
        .map(key => [key, canonical(value[key])]))
    : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
};

export function voucherChanges(current, next, revisions) {
  const previous = new Map(current.map(voucher => [voucher.id, voucher]));
  const updated = new Map(next.map(voucher => [voucher.id, voucher]));
  const changes = {};
  for (const [id, voucher] of updated) {
    validateVoucher(voucher);
    if (sameValue(voucher, previous.get(id))) continue;
    if (!previous.has(id) && revisions.has(id)) {
      throw Error('削除済みの伝票IDが含まれています。伝票を確認してください。');
    }
    changes[id] = {revision:(revisions.get(id) ?? 0) + 1, voucher};
  }
  for (const id of previous.keys()) {
    if (!updated.has(id)) changes[id] = {revision:revisions.get(id) + 1, deleted:true};
  }
  return changes;
}

const required = ['id','date','docType','scope','category','partner','payment','status','prior','createdAt','updatedAt'];
const optional = ['event','eventStart','eventEnd','reviewedOn','number','details','fileName','photo','receiptSource'];
const fields = new Set([...required,...optional,'amount']);
const photoPattern = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export function validateVoucher(voucher) {
  if (!voucher || !required.every(key => typeof voucher[key] === 'string' && voucher[key].length)
      || Object.keys(voucher).some(key => !fields.has(key))
      || optional.some(key => voucher[key] != null && typeof voucher[key] !== 'string')
      || !/^[A-Za-z0-9_-]{1,220}$/.test(voucher.id)
      || !/^\d{4}-\d{2}-\d{2}$/.test(voucher.date)
      || !Number.isSafeInteger(voucher.amount) || voucher.amount < 1 || voucher.amount > 999999999
      || (voucher.photo && (voucher.photo.length > 600000 || !photoPattern.test(voucher.photo)))) {
    throw Error('伝票の形式を確認してください。' + (voucher?.id ?? ''));
  }
  return voucher;
}

export function packImport(rows, existing) {
  const seen = new Set();
  const byId = new Map(existing.map(voucher => [voucher.id, voucher]));
  const additions = [];
  for (const row of rows) {
    validateVoucher(row);
    if (seen.has(row.id)) throw Error('バックアップ内で伝票IDが重複しています。');
    seen.add(row.id);
    if (!byId.has(row.id)) additions.push(row);
    else if (!sameValue(row, byId.get(row.id))) {
      throw Error('同じIDの内容が共有帳簿と異なります。共に照合してから取り込んでください。');
    }
  }
  return additions;
}
