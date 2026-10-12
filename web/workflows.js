import { DEVICES } from './devices.js';
import { resizeProject } from './model.js';
import { encodeShareCode, inspectShareCode } from './sharing.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = selector => document.querySelector(selector);
const localKey = 'instinctual-face-templates-v1';
const option = (action, symbol, title, description) => `<button class="export-option" ${action}><span class="export-symbol">${symbol}</span><span><strong>${title}</strong><small>${description}</small></span><span class="arrow">↗</span></button>`;

/** Sharing and installation are design-data workflows; imported content is never executed. */
export function createWorkflows({ getProject, setProject, dialog, closeDialog, toast, faceMarkup }) {
  let incoming, currentCode, templates = [], exportToken = 0, setupPoll, pollGeneration = 0, compilerBusy = false;
  const localTemplates = () => {
    try {
      const records = JSON.parse(localStorage.getItem(localKey) || '[]');
      return Array.isArray(records) ? records.filter(t=>t && typeof t.name==='string' && typeof t.code==='string' && Object.hasOwn(DEVICES,t.device) && /^[a-f0-9]{64}$/.test(t.hash)) : [];
    } catch { return []; }
  };
  async function request(url, body, timeout = 10000) {
    const response = await fetch(url, { ...(body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }), signal:AbortSignal.timeout(timeout) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The server could not complete this step.');
    return data;
  }
  async function remember(code) {
    const info = await inspectShareCode(code);
    const record = {hash:info.hash,name:info.name,device:info.device,elementCount:info.elementCount,code,createdAt:new Date().toISOString()};
    let browserSaved=false, serverSaved=false;
    try { localStorage.setItem(localKey, JSON.stringify([record,...localTemplates().filter(t=>t.hash!==record.hash)].slice(0,100)));browserSaved=true; } catch {}
    try { await request('/api/templates', {code});serverSaved=true; } catch {}
    await loadTemplates();
    return {browserSaved,serverSaved};
  }
  async function loadTemplates() {
    const combined = new Map();
    try { const data = await request('/api/templates'); for (const t of data.templates) combined.set(t.hash,t); } catch {}
    for (const t of localTemplates()) if (t && typeof t.code === 'string' && /^[a-f0-9]{64}$/.test(t.hash)) combined.set(t.hash,t);
    templates = [...combined.values()];
    const target = $('#shared-template-library');
    if (target) target.innerHTML = templates.length ? templates.map(t=>`<button class="shared-template-card" data-workflow="open-template" data-hash="${t.hash}"><strong>${esc(t.name)}</strong><small>${esc(DEVICES[t.device]?.name || 'Instinct')} · ${Number(t.elementCount)||0} elements</small><span>${t.hash.slice(0,12)}</span></button>`).join('') : '<p class="panel-hint">Paste a friend’s share code, or save one of your own.</p>';
  }
  async function showShare() {
    try {
      currentCode = await encodeShareCode(getProject());
      const info = await inspectShareCode(currentCode);
      dialog('Pass your face along.',`<p class="dialog-intro">Send this code to someone, or save it to this instance’s template library. Anyone with the code can preview and customize the design.</p><label class="field-label" for="share-code">PORTABLE SHARE CODE</label><textarea id="share-code" class="code-area" readonly spellcheck="false">${currentCode}</textarea><div class="dialog-actions"><button class="button primary" data-workflow="copy-code">Copy code</button><button class="button" data-workflow="save-template">Save to templates</button><button class="button" data-workflow="import-code">Use a share code</button></div><p class="share-fingerprint">SHA-256 · ${info.hash}</p><div class="notice">Templates contain layout data only. Unknown fields and malformed codes are rejected. The hash checks for corruption; it does not verify who created the design.</div>`,'SHARE A TEMPLATE');
    } catch(error) { toast(error.message); }
  }
  function showImport(code = '') {
    incoming = null;
    dialog('Find your next favorite.',`<p class="dialog-intro">Paste an Instinctual Face share code. You can inspect the design before adding it to your collection.</p><form id="share-import-form"><label class="field-label" for="import-code">SHARE CODE</label><textarea id="import-code" class="code-area" maxlength="65536" spellcheck="false" placeholder="IF1.…" required>${esc(code)}</textarea><div class="dialog-actions"><button class="button primary" type="submit">Preview template</button></div><p id="share-error" class="shared-error" role="alert"></p></form><div id="share-preview"></div>`,'USE A TEMPLATE');
    if (code) inspectIncoming(code);
  }
  async function inspectIncoming(code) {
    const input = $('#import-code');
    try {
      const info = await inspectShareCode(code);
      if (!input?.isConnected || input.value.trim() !== code.trim()) return;
      incoming = info;
      $('#share-error').textContent = '';
      const profile = DEVICES[info.device];
      $('#share-preview').innerHTML = `<div class="share-preview"><svg viewBox="0 0 ${profile.width} ${profile.height}" style="${profile.display==='amoled'?'border-radius:50%':''}" xmlns="http://www.w3.org/2000/svg" aria-label="Template preview">${faceMarkup(false,info.project)}</svg><div><h3>${esc(info.name)}</h3><p>${esc(profile.name)}<br>${info.elementCount} elements</p><p class="share-fingerprint">${info.hash.slice(0,16)}</p></div></div><label class="toggle-label">Adapt to my ${esc(DEVICES[getProject().device].name)} <input id="adapt-template" type="checkbox" ${info.device!==getProject().device?'checked':''}></label><div class="dialog-actions"><button class="button primary" data-workflow="use-template">Add to my faces</button></div>`;
    } catch(error) { if (input?.isConnected) { incoming=null;$('#share-error').textContent=error.message;$('#share-preview').innerHTML=''; } }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(currentCode); toast('Share code copied'); }
    catch { $('#share-code')?.select(); toast('Code selected. Copy it with Ctrl/Cmd C.'); }
  }
  const installGuide = () => `<ol class="install-steps"><li><strong>Connect the watch to a computer by USB.</strong> Use a data-capable cable. Choose file transfer / MTP mode if prompted.</li><li><strong>Copy the downloaded .prg file into GARMIN/APPS.</strong> Windows usually exposes the watch in Explorer. macOS and Linux may need an MTP file-transfer app. Keep the .prg filename.</li><li><strong>Eject and unplug.</strong> Open your watch-face selection menu and choose the new face. Test the layout and readings on the watch.</li></ol><div class="notice">The file is built for the selected watch profile. To use the design on another model, switch models and build again. Garmin’s simulator and a real watch remain the final checks for fonts, memory, and display masks.</div>`;
  function setupMarkup(status) {
    const p = DEVICES[getProject().device];
    const ready = status.available && status.devices?.includes(getProject().device);
    const container = status.environment?.container;
    const manager = status.sdkManager || {};
    const desktopSupported = status.desktopSetupSupported === true;
    const installNeeded = !status.available || desktopSupported && !manager.runtimeReady;
    const action = desktopSupported ? 'setup-desktop' : 'setup-sdk';
    const manualManager = `<p class="muted"><a href="https://developer.garmin.com/connect-iq/sdk/" target="_blank" rel="noopener noreferrer">Download Garmin SDK Manager for your desktop</a>, sign in, and download your watch profile.</p>`;
    return `<div class="compiler-status" role="status"><strong>${ready?'Ready for your watch':status.setupInProgress?'Setting up Garmin tools':'Let’s set up your compiler'}</strong><p>${esc(status.reason||'Check the server compiler configuration.')}</p>${status.sdkVersion?`<small>Connect IQ SDK ${esc(status.sdkVersion)}</small>`:''}<p class="setup-live-note">${esc(status.setupProgress||'This panel checks for downloaded profiles automatically.')}</p></div>
      ${ready?option('data-workflow="build"','↓','Build & download watch file','Signed .prg for your selected model'):''}
      <ol class="sdk-checklist">
        <li><span class="setup-dot ${status.available?'complete':''}">${status.available?'✓':'1'}</span><div><strong>Compiler & signing</strong><small>${status.available?'Compiler ready. Your private signing key is created automatically when you build.':desktopSupported?'Setup installs Java and Python if needed, then downloads Garmin’s compiler.':'The app downloads Garmin’s compiler after you accept its agreement. Docker includes Java and Python.'}</small></div></li>
        <li><span class="setup-dot ${manager.runtimeReady&&!container?'complete':''}">${manager.runtimeReady&&!container?'✓':'2'}</span><div><strong>Garmin SDK Manager</strong><small>${desktopSupported?'Setup downloads SDK Manager, prepares its libraries, and opens Garmin’s sign-in window. Approve any administrator prompt on your desktop.':esc(status.desktopSetupReason||manager.reason||'Install SDK Manager on your desktop computer.')}</small></div></li>
        <li><span class="setup-dot ${ready?'complete':''}">${ready?'✓':'3'}</span><div><strong>Sign in & download your watch</strong><small>${ready?'Your watch profile is installed.':'Sign in in Garmin’s window, open Devices, and download '+esc(p.id)+'. The app detects it automatically.'}</small></div></li>
      </ol>
      ${installNeeded?`<label class="license-label"><input id="accept-sdk-license" type="checkbox" ${status.setupInProgress?'disabled':''}> <span>I have read and accept the <a href="https://developer.garmin.com/connect-iq/sdk/" target="_blank" rel="noopener noreferrer">Garmin SDK agreement</a> for this installation.</span></label><div class="dialog-actions"><button class="button primary" data-workflow="${action}" ${status.setupInProgress?'disabled':''}>${desktopSupported?'Set up & open Garmin':'Install SDK on this server'}</button></div>`:''}
      ${desktopSupported&&manager.runtimeReady?`<div class="dialog-actions"><button class="button" data-workflow="open-manager" ${status.setupInProgress?'disabled':''}>Open SDK Manager</button></div>`:!desktopSupported?manualManager:''}
      ${desktopSupported?'<p class="muted">No terminal commands are needed. Garmin sign-in and administrator approval stay in their own desktop windows.</p>':''}
      ${p.id==='instinct3solar45mm'?'<p class="muted">Instinct 3 Solar 45 and 50 mm use the shared profile instinct3solar45mm.</p>':''}
      ${container?`<details open><summary>Connect desktop profiles to Docker once</summary><p class="muted">Docker cannot open a login window on the computer viewing this page. Connect the desktop’s Devices and Fonts folders through read-only mounts on the Docker host. Later profile downloads are detected automatically.</p><pre class="inline-command">export GARMIN_DEVICES_DIR="$HOME/.Garmin/ConnectIQ/Devices"
export GARMIN_FONTS_DIR="$HOME/.Garmin/ConnectIQ/Fonts"
docker compose -f compose.yaml -f compose.profiles.yaml up -d --build</pre><p class="muted">Use existing absolute paths. Windows: %APPDATA%\\Garmin\\ConnectIQ. macOS: ~/Library/Application Support/Garmin/ConnectIQ. If Docker runs on another computer, put these public asset folders on its host first.</p></details>`:''}
      ${status.profileWarnings?.length?`<p class="build-error">${esc(status.profileWarnings.join('\n'))}</p>`:''}
      ${status.setupError?`<p class="build-error">${esc(status.setupError)}</p>`:''}
      <div class="dialog-actions"><button class="button" data-workflow="refresh-profiles" ${status.setupInProgress?'disabled':''}>Check profiles now</button><button class="button" data-workflow="export">Back to export</button></div>
      <div class="notice">Sign-in stays in Garmin’s SDK Manager. The app imports public device and font assets only. Templates remain validated layout data.</div>`;
  }
  const stopSetupPoll = () => { ++pollGeneration;clearTimeout(setupPoll);setupPoll=undefined; };
  function renderSetup(panel, status) {
    const signature=`${compilerBusy}:${JSON.stringify(status)}`;
    if(panel.dataset.setupStatus===signature){const note=panel.querySelector('.setup-live-note');if(note)note.textContent=status.setupProgress||'This panel checks for downloaded profiles automatically.';return;}
    panel.dataset.setupStatus=signature;
    const accepted = panel.querySelector('#accept-sdk-license')?.checked;
    const expanded = [...panel.querySelectorAll('details')].map(detail=>detail.open);
    panel.innerHTML = setupMarkup(status);
    if (accepted && panel.querySelector('#accept-sdk-license')) panel.querySelector('#accept-sdk-license').checked = true;
    [...panel.querySelectorAll('details')].forEach((detail,i)=>{if(i<expanded.length)detail.open=expanded[i];});
    if (compilerBusy) panel.querySelectorAll('[data-workflow]').forEach(button=>button.disabled=true);
  }
  function pollSetup(panel, token) {
    stopSetupPoll();
    const generation=pollGeneration;
    setupPoll = setTimeout(async () => {
      if (generation!==pollGeneration || token!==exportToken || !panel.isConnected || !$('#app-dialog').open) return;
      try {
        const status=await request('/api/compiler');
        if(generation!==pollGeneration||token!==exportToken||!panel.isConnected||!$('#app-dialog').open)return;
        if(compilerBusy){const progress=panel.querySelector('.build-progress');if(progress&&status.setupInProgress)progress.textContent=status.setupProgress||'Setting up Garmin tools…';}
        else renderSetup(panel,status);
      } catch { if(generation===pollGeneration){const note=panel.querySelector('.setup-live-note');if(note)note.textContent='Could not reach the compiler. Checking again shortly…';} }
      if (generation===pollGeneration && token===exportToken && panel.isConnected && $('#app-dialog').open) pollSetup(panel,token);
    },4000);
  }
  async function showSdkSetup() {
    stopSetupPoll();
    const token=++exportToken;
    dialog('Set up your Garmin tools.',`<p class="dialog-intro">A one-time setup for your ${esc(DEVICES[getProject().device].name)}. Then every face builds with one click.</p><div id="compiler-panel"><p class="muted">Checking Garmin tools…</p></div>`,'SDK SETUP');
    const panel=$('#compiler-panel');
    try { const status=await request('/api/compiler');if(token!==exportToken||!panel.isConnected)return;renderSetup(panel,status);pollSetup(panel,token); }
    catch(error){if(panel.isConnected)panel.innerHTML=`<p class="build-error">${esc(error.message)}</p>`;}
  }
  $('#app-dialog').addEventListener('close',stopSetupPoll);
  async function showExport() {
    stopSetupPoll();
    const token = ++exportToken;
    dialog('From the studio to your wrist.',`<p class="dialog-intro">Build for ${esc(DEVICES[getProject().device].name)}, then transfer the watch file by USB.</p><div id="compiler-panel"><p class="muted">Checking compiler…</p></div>${option('data-download="garmin"','⌘','Connect IQ source project','Editable Monkey C project and build guide · ZIP')}${option('data-download="json"','{ }','Editable design backup','Your layout for this studio · JSON')}${option('data-download="svg"','▧','Preview image','Current simulated data · SVG')}`,'EXPORT & INSTALL');
    try {
      const status = await request('/api/compiler');
      if (token!==exportToken || !$('#compiler-panel')) return;
      const ready = status.available && status.devices?.includes(getProject().device);
      $('#compiler-panel').innerHTML = ready ? `${option('data-workflow="build"','↓','Build & download watch file','Signed .prg for your selected model')}<details><summary>How to install the watch file</summary>${installGuide()}</details><div class="dialog-actions"><button class="button" data-workflow="sdk-settings">SDK setup</button></div>` : `<div class="compiler-status"><strong>Compiler setup needed</strong><p>${esc(status.reason)}</p></div>${option('data-workflow="sdk-settings"','→','Set up Garmin tools','Guided downloads, sign-in, and automatic profile detection')}`;
    } catch(error) { if (token===exportToken && $('#compiler-panel')) $('#compiler-panel').innerHTML=`<p class="build-error">${esc(error.message)}</p><p class="muted">Start the Node or Docker server to compile. Source export is still available.</p>`; }
  }
  async function compilerAction(action, button) {
    if (compilerBusy) { toast('A compiler step is already running.');return; }
    const panel = $('#compiler-panel');
    const snapshot = structuredClone(getProject());
    const stillOpen=()=>panel.isConnected && $('#app-dialog').open;
    if (['setup-sdk','setup-desktop'].includes(action) && !$('#accept-sdk-license')?.checked) {
      let error=panel.querySelector('#sdk-license-error');
      if(!error){error=document.createElement('p');error.id='sdk-license-error';error.className='shared-error';error.setAttribute('role','alert');panel.querySelector('.license-label').after(error);}
      error.textContent='Read and accept Garmin’s SDK agreement before downloading.';
      $('#accept-sdk-license').focus();
      return;
    }
    compilerBusy=true;stopSetupPoll();
    const controls=[...panel.querySelectorAll('[data-workflow]')].map(control=>({control,disabled:control.disabled}));
    controls.forEach(({control})=>control.disabled=true);
    const progress = document.createElement('p');progress.className='build-progress';progress.setAttribute('role','status');progress.textContent=action==='build'?'Compiling your watch face… Builds wait their turn when the server is busy.':action==='setup-desktop'?'Setting up Garmin tools… Approve any administrator prompt on your desktop.':action==='setup-sdk'?'Downloading and setting up the official SDK…':action==='open-manager'?'Opening Garmin SDK Manager…':'Checking installed device profiles…';panel.append(progress);
    if(['setup-sdk','setup-desktop','open-manager'].includes(action))pollSetup(panel,exportToken);
    try {
      if (action==='build') {
        const response=await fetch('/api/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(400000)});
        if (!response.ok) { const detail=await response.json();const error=new Error(detail.error||'Compilation failed');error.diagnostics=detail.diagnostics;throw error; }
        const bytes=await response.blob();
        const name=/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')||'')?.[1]||'instinctual-face.prg';
        const url=URL.createObjectURL(bytes),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
        if (stillOpen()) { stopSetupPoll();panel.innerHTML=`<div class="compiler-status"><strong>Your watch file is ready.</strong><p>${esc(name)}</p></div>${installGuide()}<button class="button" data-workflow="export">Build another file</button>`; }
        toast('Watch file downloaded');
      } else {
        const route={'setup-sdk':'/api/compiler/setup','setup-desktop':'/api/compiler/desktop-setup','open-manager':'/api/compiler/open-manager','refresh-profiles':'/api/compiler/refresh'}[action];
        await request(route,['setup-sdk','setup-desktop'].includes(action)?{acceptedLicense:true}:{},900000);
        compilerBusy=false;
        if (stillOpen()) await showSdkSetup();
      }
    } catch(error) {
      stopSetupPoll();
      if (stillOpen()) { progress.remove();const box=document.createElement('div');box.className='build-error';box.textContent=error.message;panel.append(box);if(error.diagnostics){const log=document.createElement('pre');log.className='inline-command';log.textContent=error.diagnostics;panel.append(log);} }
    } finally {
      compilerBusy=false;
      controls.forEach(({control,disabled})=>{if(control.isConnected)control.disabled=disabled;});
    }
  }
  document.addEventListener('submit',event=>{if(event.target.id!=='share-import-form')return;event.preventDefault();inspectIncoming($('#import-code').value.trim());});
  document.addEventListener('input',event=>{if(event.target.id==='import-code'){incoming=null;$('#share-preview').innerHTML='';$('#share-error').textContent='';}});
  document.addEventListener('click',async event=>{
    const b=event.target.closest('[data-workflow]');if(!b)return;
    try {
      const action=b.dataset.workflow;
      if(action==='share')await showShare();
      if(action==='import-code')showImport();
      if(action==='copy-code')await copyCode();
      if(action==='save-template'){const result=await remember(currentCode);toast(result.serverSaved?'Saved to this instance’s templates':result.browserSaved?'Template saved in this browser':'Could not save the template. Copy its share code to keep it.');}
      if(action==='open-template'){const t=templates.find(t=>t.hash===b.dataset.hash);if(t)showImport(t.code);}
      if(action==='use-template'&&incoming){const code=incoming.project;let next=structuredClone(code);if($('#adapt-template').checked)next=resizeProject(next,getProject().device);setProject(next);const shareCode=await encodeShareCode(code);closeDialog();const result=await remember(shareCode);toast(result.serverSaved||result.browserSaved?'Template added to your faces':'Face added. Template library storage is unavailable; keep the share code.');}
      if(action==='export')await showExport();
      if(action==='sdk-settings')await showSdkSetup();
      if(['build','setup-sdk','setup-desktop','open-manager','refresh-profiles'].includes(action))await compilerAction(action,b);
    } catch(error){toast(error.message);}
  });
  async function initialize() {
    await loadTemplates();
    if (location.hash.startsWith('#share=')) {
      try { const code=decodeURIComponent(location.hash.slice(7));showImport(code);history.replaceState(null,'',location.pathname+location.search); } catch {toast('Invalid share link');}
    }
  }
  return {showShare,showImport,showExport,loadTemplates,initialize};
}
