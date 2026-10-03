/* global google */
(function () {
  'use strict';
  const cfg=window.TAISEI_GOOGLE_DRIVE_CONFIG||{}, scope='https://www.googleapis.com/auth/drive.file';
  const status=document.getElementById('confirmError'), original=document.getElementById('save'), dialog=document.getElementById('dialog');
  const pendingKey='taisei-google-drive-pending-v1', approvedKey='taisei-google-drive-approved-v1';
  let sending=false, releaseTimer=0, tokenClient=null, pendingPayload=null, gisTimer=0, resumed=false;
  const show=t=>{status.textContent=t;}; const showGlobal=t=>{const el=document.getElementById('draftStatus');if(el)el.textContent=t;}; const configured=()=>cfg.clientId&&!cfg.clientId.includes('PASTE-');
  const esc=t=>String(t).replace(/'/g,"\\'"); const filename=()=>`daily-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID?crypto.randomUUID():Date.now()}.json`;
  const button=original.cloneNode(true); button.textContent='日報を送信'; original.replaceWith(button);
  function finish(message){clearTimeout(releaseTimer);releaseTimer=0;sending=false;button.disabled=false;if(message)show(message);}
  // Safari requires the authorization request itself to run in the tap event.
  // Prepare the GIS client before the user reaches the send button.
  function prepareTokenClient(){
    if(tokenClient||!configured()||!window.google?.accounts?.oauth2)return !!tokenClient;
    tokenClient=google.accounts.oauth2.initTokenClient({client_id:cfg.clientId,scope,callback:async r=>{if(r.error){finish('Google認証に失敗しました。入力内容は残っています。再送できます。');return;}window.__taiseiGoogleToken=r.access_token;localStorage.setItem(approvedKey,'1');try{await upload(pendingPayload);}catch(e){finish(`${e.message||'送信に失敗しました。'} 入力内容は残っています。再送できます。`);}},error_callback:()=>finish('Google認証画面を開けませんでした。ポップアップを許可して再送してください。')});
    clearInterval(gisTimer);gisTimer=0;resumePendingAfterRedirect();return true;
  }
  gisTimer=setInterval(prepareTokenClient,100);
  prepareTokenClient();
  async function api(path,options={}){const r=await fetch(`https://www.googleapis.com/drive/v3/${path}`,{headers:{Authorization:`Bearer ${window.__taiseiGoogleToken}`,...(options.headers||{})},...options});if(!r.ok)throw new Error(`Google Driveへの送信に失敗しました（${r.status}）。`);return r.status===204?null:r.json();}
  async function folder(name,parent){const q=[`name='${esc(name)}'`,"mimeType='application/vnd.google-apps.folder'",'trashed=false'];if(parent)q.push(`'${parent}' in parents`);const found=await api(`files?q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name)&pageSize=10`);if(found.files?.length)return found.files[0].id;const body={name,mimeType:'application/vnd.google-apps.folder'};if(parent)body.parents=[parent];const r=await fetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{Authorization:`Bearer ${window.__taiseiGoogleToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`日報フォルダーを作成できませんでした（${r.status}）。`);return (await r.json()).id;}
  async function upload(payload){const root=await folder(cfg.rootFolderName), incoming=await folder(cfg.incomingFolderName,root), form=new FormData();form.append('metadata',new Blob([JSON.stringify({name:filename(),parents:[incoming],mimeType:'application/json'})],{type:'application/json'}));form.append('file',new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}));const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',{method:'POST',headers:{Authorization:`Bearer ${window.__taiseiGoogleToken}`},body:form});if(!r.ok)throw new Error(`JSONを送信できませんでした（${r.status}）。`);sessionStorage.removeItem(pendingKey);const message='送信完了：WindowsのGoogle Drive同期後に日報へ反映されます。';finish(message);showGlobal(message);if(dialog.open)dialog.close();}
  // On iPhone Safari the Google account window may temporarily replace this page.
  // Resume the saved JSON after returning and silently obtain the just-approved token.
  function resumePendingAfterRedirect(){
    if(resumed||!tokenClient)return;const raw=sessionStorage.getItem(pendingKey);if(!raw)return;
    try{pendingPayload=JSON.parse(raw);}catch{sessionStorage.removeItem(pendingKey);return;}
    resumed=true;sending=true;button.disabled=true;document.getElementById('json').textContent=JSON.stringify(pendingPayload,null,2);
    if(!dialog.open)dialog.showModal();show('認証完了を確認して、Google Driveへ送信しています…');showGlobal('Google認証後の送信を再開しています…');
    releaseTimer=setTimeout(()=>finish('Google認証後の応答がありません。入力内容は残っています。再送できます。'),30000);
    try{tokenClient.requestAccessToken({prompt:''});}catch(e){finish(`${e.message||'Google認証の再開に失敗しました。'} 入力内容は残っています。再送できます。`);}
  }
  button.addEventListener('click',()=>{if(sending)return;let payload;try{payload=JSON.parse(document.getElementById('json').textContent);}catch{show('送信する日報を確認できません。');return;}if(!configured()){show('Google連携の設定が未完了です。管理者へ連絡してください。');return;}if(!prepareTokenClient()){show('Google認証を準備中です。数秒後にもう一度押してください。');return;}sessionStorage.setItem(pendingKey,JSON.stringify(payload));pendingPayload=payload;sending=true;button.disabled=true;show('Google認証を開始しています…');releaseTimer=setTimeout(()=>finish('Google認証の応答がありません。通信とポップアップ設定を確認して再送してください。'),30000);try{tokenClient.requestAccessToken({prompt:(window.__taiseiGoogleToken||localStorage.getItem(approvedKey))?'':'select_account'});}catch(e){finish(`${e.message||'Google認証を開始できません。'} 入力内容は残っています。再送できます。`);}});
}());
