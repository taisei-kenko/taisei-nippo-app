(function () {
  'use strict';
  const cfg=window.TAISEI_GOOGLE_DRIVE_CONFIG||{};
  const scope='https://www.googleapis.com/auth/drive.file';
  const status=document.getElementById('confirmError'), original=document.getElementById('save'), dialog=document.getElementById('dialog');
  const pendingKey='taisei-google-drive-pending-v1', stateKey='taisei-google-drive-oauth-state-v2', tokenKey='taisei-google-drive-token-v2';
  let sending=false, releaseTimer=0, pendingPayload=null, resumed=false;
  const show=t=>{if(status)status.textContent=t;};
  const showGlobal=t=>{const el=document.getElementById('draftStatus');if(el)el.textContent=t;};
  const configured=()=>cfg.clientId&&!cfg.clientId.includes('PASTE-');
  const redirectUri=()=>cfg.redirectUri||`${location.origin}${location.pathname}`;
  const esc=t=>String(t).replace(/'/g,"\\'");
  const filename=()=>`daily-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID?crypto.randomUUID():Date.now()}.json`;
  const button=original.cloneNode(true); button.textContent='日報を送信'; original.replaceWith(button);
  function finish(message){clearTimeout(releaseTimer);releaseTimer=0;sending=false;button.disabled=false;if(message){show(message);showGlobal(message);}}
  function savePending(payload){const text=JSON.stringify(payload);sessionStorage.setItem(pendingKey,text);localStorage.setItem(pendingKey,text);}
  function clearPending(){sessionStorage.removeItem(pendingKey);localStorage.removeItem(pendingKey);}
  function getPending(){return sessionStorage.getItem(pendingKey)||localStorage.getItem(pendingKey);}
  function randomState(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return [...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');}
  function getToken(){try{const raw=sessionStorage.getItem(tokenKey)||localStorage.getItem(tokenKey);const token=raw&&JSON.parse(raw);return token&&token.accessToken&&token.expiresAt>Date.now()+30000?token:null;}catch{return null;}}
  function saveToken(accessToken,expiresIn){const token={accessToken,expiresAt:Date.now()+(Number(expiresIn||3600)*1000)};sessionStorage.setItem(tokenKey,JSON.stringify(token));localStorage.setItem(tokenKey,JSON.stringify(token));return token;}
  function clearToken(){sessionStorage.removeItem(tokenKey);localStorage.removeItem(tokenKey);}
  function beginRedirect(prompt){
    const state=randomState();sessionStorage.setItem(stateKey,state);localStorage.setItem(stateKey,state);
    const p=new URLSearchParams({client_id:cfg.clientId,redirect_uri:redirectUri(),response_type:'token',scope,include_granted_scopes:'true',state,prompt});
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  }
  function parseOAuthReturn(){
    const fragment=new URLSearchParams(location.hash.startsWith('#')?location.hash.slice(1):'');
    if(!fragment.has('access_token')&&!fragment.has('error'))return false;
    const actual=fragment.get('state'), expected=sessionStorage.getItem(stateKey)||localStorage.getItem(stateKey);
    sessionStorage.removeItem(stateKey);localStorage.removeItem(stateKey);
    history.replaceState(null,document.title,`${location.pathname}${location.search}`);
    if(!expected||actual!==expected){finish('Google認証の確認に失敗しました（状態が一致しません）。入力内容は残っています。');return true;}
    if(fragment.has('error')){finish(`Google認証に失敗しました（${fragment.get('error')}）。入力内容は残っています。`);return true;}
    saveToken(fragment.get('access_token'),fragment.get('expires_in'));return true;
  }
  async function api(path,options={}){const token=getToken();if(!token)throw new Error('Google認証の有効期限が切れました。認証を再開します。');const r=await fetch(`https://www.googleapis.com/drive/v3/${path}`,{headers:{Authorization:`Bearer ${token.accessToken}`,...(options.headers||{})},...options});if(r.status===401){clearToken();throw new Error('Google認証の有効期限が切れました。認証を再開します。');}if(!r.ok)throw new Error(`Google Driveへの送信に失敗しました（${r.status}）。`);return r.status===204?null:r.json();}
  async function folder(name,parent){const q=[`name='${esc(name)}'`,"mimeType='application/vnd.google-apps.folder'",'trashed=false'];if(parent)q.push(`'${parent}' in parents`);const found=await api(`files?q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name)&pageSize=10`);if(found.files?.length)return found.files[0].id;const token=getToken();const body={name,mimeType:'application/vnd.google-apps.folder'};if(parent)body.parents=[parent];const r=await fetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{Authorization:`Bearer ${token.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`日報フォルダーを作成できませんでした（${r.status}）。`);return (await r.json()).id;}
  async function upload(payload){const root=await folder(cfg.rootFolderName),incoming=await folder(cfg.incomingFolderName,root),form=new FormData(),token=getToken();form.append('metadata',new Blob([JSON.stringify({name:filename(),parents:[incoming],mimeType:'application/json'})],{type:'application/json'}));form.append('file',new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}));const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',{method:'POST',headers:{Authorization:`Bearer ${token.accessToken}`},body:form});if(r.status===401){clearToken();throw new Error('Google認証の有効期限が切れました。認証を再開します。');}if(!r.ok)throw new Error(`JSONを送信できませんでした（${r.status}）。`);clearPending();const message='送信完了：WindowsのGoogle Drive同期後に日報へ反映されます。';finish(message);if(dialog?.open)dialog.close();}
  async function resumePending(){
    if(resumed)return;const raw=getPending();if(!raw)return;
    try{pendingPayload=JSON.parse(raw);}catch{clearPending();return;}
    resumed=true;sending=true;button.disabled=true;const json=document.getElementById('json');if(json)json.textContent=JSON.stringify(pendingPayload,null,2);if(dialog&&!dialog.open)dialog.showModal();
    const token=getToken();
    if(!token){show('Google認証へ移動しています…');showGlobal('Google認証後にDrive送信を自動再開します。');setTimeout(()=>beginRedirect('select_account'),0);return;}
    show('Google Driveへ送信しています…');showGlobal('Google Driveへ送信しています…');
    try{await upload(pendingPayload);}catch(e){if(String(e.message).includes('有効期限')){show('Google認証を更新しています…');showGlobal('Google認証を更新しています…');beginRedirect('none');return;}finish(`${e.message||'送信に失敗しました。'} 入力内容は残っています。`);}
  }
  const returned=parseOAuthReturn();
  if(returned||getPending())setTimeout(resumePending,0);
  button.addEventListener('click',()=>{if(sending)return;let payload;try{payload=JSON.parse(document.getElementById('json').textContent);}catch{show('送信する日報を確認できません。');return;}if(!configured()){show('Google連携の設定が未完了です。管理者へ連絡してください。');return;}savePending(payload);pendingPayload=payload;resumed=false;resumePending();});
}());