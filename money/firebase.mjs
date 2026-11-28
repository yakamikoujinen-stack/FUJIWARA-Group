import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getDatabase, ref, get, onValue, update, runTransaction, serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import {ROOT} from './store.mjs';

export {ref, get, onValue, update, runTransaction, serverTimestamp, signOut};

export function validateConfig(config) {
  const project = config?.projectId;
  if (typeof project !== 'string' || !/^fujiwara-money(?:-[a-z0-9]+)*$/.test(project)
      || config.authDomain !== project + '.firebaseapp.com'
      || typeof config.apiKey !== 'string' || !config.apiKey
      || typeof config.appId !== 'string' || !config.appId) {
    throw Error('お金管理専用のFirebase設定を選んでください。');
  }
  const url = new URL(config.databaseURL);
  const regional = new RegExp('^' + project + '-default-rtdb\\.[a-z0-9-]+\\.firebasedatabase\\.app$');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.hostname !== project + '-default-rtdb.firebaseio.com' && !regional.test(url.hostname))) {
    throw Error('お金管理専用のデータベースURLを確認してください。');
  }
  return config;
}

export function bindLogin({onAccount, tell}) {
  const el = id => document.getElementById(id);
  let auth;
  let loading = false;

  async function connect(config) {
    const app = initializeApp(validateConfig(config));
    auth = getAuth(app);
    const db = getDatabase(app);
    await setPersistence(auth, browserSessionPersistence);
    el('config').disabled = true;
    el('login').querySelector('button').disabled = false;
    tell('社長またはスタッフのアカウントでログインしてください。');
    onAuthStateChanged(auth, async user => {
      onAccount(null);
      el('login').hidden = !!user;
      el('logout').hidden = !user;
      if (!user) return;
      try {
        const role = (await get(ref(db, ROOT + '/roles/' + user.uid))).val();
        if (auth.currentUser !== user) return;
        if (role !== 'ceo' && role !== 'staff') throw Error('アカウントに社長またはスタッフの権限を設定してください。');
        onAccount({db,user,role});
      } catch (error) {
        if (auth.currentUser === user) tell(error.message);
      }
    });
  }

  el('config').onchange = async event => {
    if (loading || auth || !event.target.files.length) return;
    loading = true;
    try { await connect(JSON.parse(await event.target.files[0].text())); }
    catch (error) { tell(error.message); }
    finally { loading = false; }
  };
  el('login').onsubmit = async event => {
    event.preventDefault();
    if (!auth || loading) return tell('先にFirebase設定を読み込んでください。');
    const button = event.submitter;
    button.disabled = true;
    const fields = event.target.elements;
    try { await signInWithEmailAndPassword(auth, fields.email.value.trim(), fields.password.value); }
    catch { tell('ログインできませんでした。メールアドレスとパスワードを確認してください。'); }
    finally { button.disabled = false; fields.password.value = ''; }
  };
  el('logout').onclick = async () => {
    try { await signOut(auth); }
    catch { tell('ログアウトできませんでした。'); }
  };
  // 公開設定は社長とスタッフが同じURLを再訪したときに使う。
  loading = true;
  fetch('./money/firebase-config.json', {cache:'no-store'})
    .then(async response => { if (response.ok) await connect(await response.json()); else tell('初回のFirebase接続設定から設定JSONを選んでください。'); })
    .catch(error => tell('Firebase設定を読み込めません。' + error.message))
    .finally(() => { loading = false; });
}
