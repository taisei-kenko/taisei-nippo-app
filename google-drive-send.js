/* global google */
(function () {
  'use strict';
  const cfg = window.TAISEI_GOOGLE_DRIVE_CONFIG || {};
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const status = document.getElementById('confirmError');
  const original = document.getElementById('save');
  const dialog = document.getElementById('dialog');
  const pendingKey = 'taisei-google-drive-pending-v1';
  const approvedKey = 'taisei-google-drive-approved-v1';
  let sending = false, tokenClient;
  const ready = () => cfg.clientId && !cfg.clientId.includes('PASTE-') && window.google?.accounts?.oauth2;
  const show = text => { status.textContent = text; };
  const escapeQuery = text => String(text).replace(/'/g,"\\'");
  const fileName = () => `daily-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.json`;
  async function api(path, options={}) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {headers:{Authorization:`Bearer ${window.__taiseiGoogleToken}`,...(options.headers||{})},...options});
    if (!response.ok) throw new Error(`Google Driveへの送信に失敗しました（${response.status}）。`);
    return response.status===204 ? null : response.json();
  }
  async function findOrCreateFolder(name, parent) {
    const q=[`name='${escapeQuery(name)}'`,`mimeType='application/vnd.google-apps.folder'`,`trashed=false`]; if(parent) q.push(`'${parent}' in parents`);
    const found=await api(`files?q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name)&pageSize=10`);
    if(found.files?.length) return found.files[0].id;
    const body={name,mimeType:'application/vnd.google-apps.folder'}; if(parent) body.parents=[parent];
    const response=await fetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{Authorization:`Bearer ${window.__taiseiGoogleToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok) throw new Error(`日報フォルダーを作成できませんでした（${response.status}）。`); return (await response.json()).id;
  }
  async function upload(payload) {
    const root=await findOrCreateFolder(cfg.rootFolderName); const incoming=await findOrCreateFolder(cfg.incomingFolderName,root);
    const metadata=new Blob([JSON.stringify({name:fileName(),parents:[incoming],mimeType:'application/json'})],{type:'application/json'});
    const content=new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'});
    const form=new FormData(); form.append('metadata',metadata); form.append('file',content);
    const response=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',{method:'POST',headers:{Authorization:`Bearer ${window.__taiseiGoogleToken}`},body:form});
    if(!response.ok) throw new Error(`JSONを送信できませんでした（${response.status}）。`);
    sessionStorage.removeItem(pendingKey); show('送信完了：WindowsのGoogle Drive同期後に日報へ反映されます。'); dialog.close();
  }
  function requestToken(payload) {
    tokenClient=google.accounts.oauth2.initTokenClient({client_id:cfg.clientId,scope,callback:async response=>{
      if(response.error) { show('Google認証に失敗しました。入力内容は残っています。再送できます。'); sending=false; button.disabled=false; return; }
      window.__taiseiGoogleToken=response.access_token;
      localStorage.setItem(approvedKey, '1');
      try { await upload(payload); } catch(e) { show(`${e.message} 入力内容は残っています。再送できます。`); }
      finally { sending=false; button.disabled=false; }
    }});
    tokenClient.requestAccessToken({prompt: (window.__taiseiGoogleToken || localStorage.getItem(approvedKey)) ? '' : 'consent'});
  }
  const button=original.cloneNode(true); original.replaceWith(button);
  button.addEventListener('click',()=>{
    let payload; try { payload=JSON.parse(document.getElementById('json').textContent); } catch { show('送信する日報を確認できません。'); return; }
    sessionStorage.setItem(pendingKey,JSON.stringify(payload));
    if(!ready()) { show('Google連携の設定または通信が未完了です。app-config.jsを確認して再送してください。'); return; }
    if(sending) return; sending=true; button.disabled=true; show('Googleに接続しています…'); requestToken(payload);
  });
}());
