import { DEVICES, UNSUPPORTED_DEVICES, TEMPLATE_DEFINITIONS, createProject, createElement, normalizeProject, resizeProject, resizeElement } from './model.js';
import { createSourceZip } from './garmin-export.js';
import { createWorkflows } from './workflows.js';
import { constrainElement, analyzeElement, displayGeometry } from './display-safety.js';
import { renderFaceMarkup, effectiveElement } from './preview.js';
import { ELEMENT_DEFINITIONS, ELEMENT_GROUPS, isGraphicElement, elementCompatibility } from './elements.js';
import { captionStyle, fitCaption } from './pixel-font.js';
import { ICON_IDS, PROGRESS_SOURCES } from './graphics-elements.js';
import { UNIT_DEFINITIONS, METRIC_UNITS, IMPERIAL_UNITS, resolveUnits, normalizeUnits, unitCategory, unitCaption, formatUnitSample, canonicalUnitSample } from './units.js';
import { selectionRect, selectionIds as marqueeIds, selectionBounds, moveSelection, arrangeSelection } from './selection.js';

const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => structuredClone(value);
const LABELS = Object.fromEntries(Object.entries(ELEMENT_DEFINITIONS).map(([type, definition]) => [type, definition.name]));
const PATHS = {
  time:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h2v4H7m5-4h2v4h-2m5-4h1m-1 4h1"/>',
  date:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-12 4h2m4 0h2m-8 3h2"/>',
  steps:'<path d="M8 4c-3 1-3 7-1 8l3-1c1-3 0-8-2-7zm-1 11 4-1 1 4c-1 3-4 3-5 0zm9-8c-3 1-3 7-1 8l3-1c1-3 0-8-2-7zm-1 11 4-1 1 3c-1 2-4 2-5 0z"/>',
  heart:'<path d="M20 5c-3-3-7 0-8 2-1-2-5-5-8-2-4 4 1 10 8 15C19 15 24 9 20 5z"/>',
  battery:'<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4M7 10v4m4-4v4m4-4v4"/>',
  calories:'<path d="M13 2c3 5-1 6 1 9 2-1 3-3 3-3 7 9 1 14-5 14-7 0-11-6-7-12 0 4 2 3 3 2 2-3 1-7 5-10z"/>',
  floors:'<path d="M3 20h5v-5h5v-5h5V5h3M5 8V3m0 0L2 6m3-3 3 3"/>',
  distance:'<path d="M4 19 9 8l4 7 3-12 4 16H4zM3 22h18"/>',
  text:'<path d="M4 5h16M12 5v15m-5 0h10"/>',
  weather:'<path d="M8 17a5 5 0 1 1 8-6 4 4 0 0 1 1 8H7M12 2v2m8 1-2 2M4 5l2 2"/>',
  training:'<path d="M7 3h10v6a5 5 0 0 1-10 0V3zM7 5H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4m-4 2v5m-4 2h8"/>',
  design:'<rect x="4" y="4" width="16" height="16" rx="3"/>',
  line:'<path d="M3 12h18"/>',circle:'<circle cx="12" cy="12" r="8"/>',
  undo:'<path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12"/>',
  redo:'<path d="m16 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  grid:'<path d="M8 3v18m8-18v18M3 8h18M3 16h18"/>',
  snap:'<path d="M5 3v9a7 7 0 0 0 14 0V3h-5v9a2 2 0 0 1-4 0V3H5zm0 5h5m4 0h5"/>',
  left:'<path d="M3 5h18M3 10h12M3 15h18M3 20h12"/>',
  center:'<path d="M3 5h18M6 10h12M3 15h18M6 20h12"/>',
  right:'<path d="M3 5h18M9 10h12M3 15h18M9 20h12"/>',
};
const icon = type => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[type] || PATHS[({time:'time',activity:'steps',health:'heart',device:'battery',weather:'weather',training:'training',design:'design'})[ELEMENT_DEFINITIONS[type]?.group]] || PATHS.text}</svg>`;
let project = createProject();
let selectedId = project.elements.find(e=>e.type==='time')?.id;
let selectedIds = new Set(selectedId ? [selectedId] : []);
let selectionBox = null, textEdit = null;
let preview = false;
let history = [], future = [], savedProjects = [], autosaveTimer, toastTimer;
let serverOnline = true;
let initialized=false;
let samples = {};
let sampleBaseline = {};
let libraryDrag=null, suppressAdd=null;
let pendingSave = Promise.resolve();
const storageKey = 'instinctual-face-projects-v1';
const getLocal = () => {try{return JSON.parse(localStorage.getItem(storageKey)||'[]').map(p=>normalizeProject(p));}catch{return [];}};
const putLocal = p => {try{const existing=getLocal().filter(x=>x.id!==p.id);localStorage.setItem(storageKey,JSON.stringify([p,...existing]));localStorage.setItem('instinctual-face-active',p.id);}catch{toast('Browser storage is full. Download a JSON backup.');}};
const selectedElements = () => project.elements.filter(e=>selectedIds.has(e.id));
const selected = () => selectedIds.size === 1 ? project.elements.find(e=>selectedIds.has(e.id)) : undefined;
const bounds = () => DEVICES[project.device];
const displayedGoal = element => element.source === 'distance'
  ? Number(((element.goal ?? 0) / canonicalUnitSample('distance',1,project.settings.units)).toFixed(6)) : element.goal ?? 0;
const safetyOptions = () => ({ safetyMargin: project.settings.safetyMargin !== false });
const movementOptions = () => ({...safetyOptions(),wholePixels:safetyOptions().safetyMargin});
const effectiveSelected = () => selected() && effectiveElement(selected(), bounds(), safetyOptions().safetyMargin);
const fitElement = (element, options = {}) => Object.assign(element, constrainElement(element, bounds(), { ...safetyOptions(), ...options }));
const filename = () => project.name.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-|-$/g,'') || 'instinctual-face';
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4200);}
function saveStatus(message,error=false){$('#save-status').textContent=message;$('#save-status').classList.toggle('error',error);}
async function api(url,options={}){const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(7000)});let data;try{data=await response.json();}catch{throw new Error('The server returned an unexpected response.');}if(!response.ok)throw new Error(data.error||'Could not save the design.');return data;}
function scheduleSave(){clearTimeout(autosaveTimer);project.modifiedAt=new Date().toISOString();putLocal(clone(project));saveStatus('Saving…');const snapshot=clone(project);autosaveTimer=setTimeout(()=>saveProject(snapshot),500);}
function saveProject(snapshot){putLocal(snapshot);savedProjects=[snapshot,...savedProjects.filter(p=>p.id!==snapshot.id)];pendingSave=pendingSave.then(async()=>{try{await api(`/api/projects/${encodeURIComponent(snapshot.id)}`,{method:'PUT',body:JSON.stringify(snapshot)});serverOnline=true;if(snapshot.id===project.id)saveStatus('Saved');}catch(error){serverOnline=false;if(snapshot.id===project.id)saveStatus('Saved in browser',true);}});return pendingSave;}
function selectionState(){return {project:clone(project),selection:[...selectedIds],primary:selectedId};}
function setSelection(ids,primary){const valid=new Set(project.elements.map(e=>e.id));const next=new Set([...ids].filter(id=>valid.has(id)));const nextPrimary=next.has(primary)?primary:[...next].at(-1)||null;if(nextPrimary!==selectedId||next.size!==selectedIds.size||[...next].some(id=>!selectedIds.has(id)))textEdit=null;selectedIds=next;selectedId=nextPrimary;}
function defaultSelection(){const id=project.elements.find(e=>e.type==='time')?.id;setSelection(id?[id]:[]);}
function selectAll(){setSelection(project.elements.filter(e=>e.visible!==false).map(e=>e.id));render();}
function bulkSelection(key,value){const elements=selectedElements().filter(e=>e[key]!==value);if(elements.length)mutate(()=>elements.forEach(e=>e[key]=value));}
function arrangeSelected(action){finishDrag(null,true);const bases=selectedElements().map(e=>e.locked||e.visible===false?e:effectiveElement(e,bounds(),safetyOptions().safetyMargin)),result=arrangeSelection(bases,bounds(),action,movementOptions());if(result.reason){toast(result.reason);const note=$('#selection-layout-note');if(note)note.textContent=result.reason;return;}if(result.changed)mutate(()=>applyMovedElements(result.elements));else toast(action.startsWith('space')?'Already evenly spaced.':'Already aligned.');}
function pruneSelection(){setSelection(selectedIds,selectedId);}
function checkpoint(){history.push(selectionState());if(history.length>70)history.shift();future=[];}
function mutate(fn){checkpoint();fn();render();scheduleSave();}
function undo(){if(!history.length)return;future.push(selectionState());const state=history.pop();project=state.project;setSelection(state.selection,state.primary);render();scheduleSave();}
function redo(){if(!future.length)return;history.push(selectionState());const state=future.pop();project=state.project;setSelection(state.selection,state.primary);render();scheduleSave();}
function setProject(next){clearTimeout(autosaveTimer);saveProject(clone(project));project=normalizeProject(next);history=[];future=[];const id=project.elements.find(e=>e.type==='time')?.id;setSelection(id?[id]:[]);preview=false;selectionBox=null;render();scheduleSave();}
function addElement(type,position){if(project.elements.length>=100){toast('This design has reached the 100 element limit.');return;}mutate(()=>{const element=createElement(type,project.device,project.background,safetyOptions());if(position)fitElement(Object.assign(element,{x:position.x-element.width/2,y:position.y-element.height/2}),{snap:project.settings.snap});project.elements.push(element);setSelection([element.id]);preview=false;});toast(`${LABELS[type]} added`);}
function removeSelected(){const removable=new Set(selectedElements().filter(e=>!e.locked).map(e=>e.id));if(!removable.size)return;mutate(()=>{project.elements=project.elements.filter(e=>!removable.has(e.id));setSelection([...selectedIds].filter(id=>!removable.has(id)));});}
function duplicate(){const elements=selectedElements();if(!elements.length)return;if(project.elements.length+elements.length>100){toast('There is not enough room to duplicate this selection. The limit is 100 elements.');return;}mutate(()=>{const copies=elements.map(e=>({...clone(effectiveElement(e,bounds(),safetyOptions().safetyMargin)),id:createElement(e.type,project.device).id,locked:false}));const moved=moveSelection(copies,bounds(),4,4,movementOptions());project.elements.push(...moved.elements);setSelection(copies.map(e=>e.id));});}
function reorder(direction){if(selectedIds.size!==1)return;const i=project.elements.findIndex(e=>e.id===selectedId);const next=i+direction;if(i<0||next<0||next>=project.elements.length)return;mutate(()=>{[project.elements[i],project.elements[next]]=[project.elements[next],project.elements[i]];});}
function selectElement(id,{toggle=false,preserve=false}={}){if(!id)setSelection([]);else if(toggle){const ids=new Set(selectedIds);ids.has(id)?ids.delete(id):ids.add(id);setSelection(ids,id);}else if(preserve&&selectedIds.has(id))setSelection(selectedIds,id);else setSelection([id],id);renderFace();renderProperties();renderLayers();renderToolbar();}
function render(){pruneSelection();renderHeader();renderFace();renderProperties();renderLayers();renderToolbar();}
function renderHeader(){if(document.activeElement!==$('#project-name'))$('#project-name').value=project.name;$('#device-select').value=project.device;$('#resolution-label').textContent=`${bounds().width} × ${bounds().height} PX`;$('#element-count').textContent=`${project.elements.length} elements`;$('#watch-stage').classList.toggle('amoled',bounds().display==='amoled');$('#preview-description').textContent=bounds().display==='amoled'?'AMOLED COLOR DISPLAY':'MONOCHROME MIP DISPLAY';$('#device-select').title=bounds().subtitle;const units=resolveUnits(project.settings.units);$('#units-button').textContent=`Units · ${units.temperature.toUpperCase()} / ${units.elevation}`;$('#units-button').title='Choose temperature, distance, elevation, speed, pressure, weight, and height units';}
function renderToolbar(){$('#selection-count').textContent=preview?'':`${selectedIds.size} selected`;for(const [id,flag] of [['grid-button',project.settings.grid],['snap-button',project.settings.snap]])$(`#${id}`).setAttribute('aria-pressed',flag);$('#undo-button').disabled=!history.length;$('#redo-button').disabled=!future.length;$('#edit-view').classList.toggle('active',!preview);$('#preview-view').classList.toggle('active',preview);$('#canvas-area').classList.toggle('preview-mode',preview);$('#zoom-label').textContent=`${Math.round(project.settings.zoom*100)}%`;const base=innerWidth<540?.85:innerWidth<850?.8:innerWidth<1120?.9:1;$('#watch-stage').style.transform=`scale(${project.settings.zoom*base})`;$('#canvas-tip').textContent=preview?'Preview with simulated data. Your watch uses live readings.':'Drag empty space to select · Shift-click to add · Alt-drag anywhere';$('#safety-margin-toggle').checked=safetyOptions().safetyMargin;$('#safety-status').textContent=safetyOptions().safetyMargin?'Keeps layers inside visible pixels':'Free placement · edges may crop';$('#fit-face-button').disabled=!safetyOptions().safetyMargin;$('#geometry-note').textContent=displayGeometry(bounds()).subscreen?.approximate?'Window geometry is approximate for this model; verify in Garmin’s simulator.':safetyOptions().safetyMargin&&bounds().hasSubscreen?'Circle pixels match export. Main fonts vary by watch; verify in Garmin’s simulator.':'Main fonts vary by watch; verify in Garmin’s simulator.';}
const measuringContext = document.createElement('canvas').getContext('2d');
function measureText(text,height,element){measuringContext.font=`${element.type==='time'?700:600} ${height}px "Arial Narrow","Liberation Sans Narrow",Arial,sans-serif`;return measuringContext.measureText(text).width;}
function faceMarkup(includeEditor=true,face=project){return renderFaceMarkup(face,{editor:includeEditor,preview,selectedIds,selectionBox,samples,measure:measureText});}
function renderFace(){$('#face-canvas').setAttribute('viewBox',`0 0 ${bounds().width} ${bounds().height}`);$('#face-canvas').setAttribute('preserveAspectRatio','none');$('#face-canvas').innerHTML=faceMarkup();const hint=$('#caption-fit-hint');if(hint&&effectiveSelected())hint.textContent=captionHint(effectiveSelected());}
const field=(key,label,value,max=176,min=0)=>`<div class="field"><label class="field-label" for="property-${key}">${label}</label><div class="unit-input"><input id="property-${key}" data-property="${key}" type="number" min="${min}" max="${max}" step="${key==='labelFontSize'?5:1}" value="${Math.round(value*100)/100}"><span>px</span></div></div>`;
function backgroundControl(){return `<div class="background-control"><p class="section-title">DISPLAY BACKGROUND</p><div class="swatches">${bounds().colors.map(color=>`<button class="swatch ${project.background===color?'active':''}" data-background="${color}" style="background:${color}" aria-label="${color} display background" aria-pressed="${project.background===color}"></button>`).join('')}${bounds().display==='amoled'?`<label class="color-picker">Custom <input type="color" data-custom-background value="${project.background}" aria-label="Custom background color"></label>`:''}<span class="color-name">${bounds().display==='amoled'?'Full color':'2 color display'}</span></div></div>`;}
function alignmentControl(value, caption = false) {
  return `<div class="alignment-control" role="group" aria-label="${caption?'Caption':'Number'} alignment">${['left','center','right'].map(a=>`<button data-${caption?'label-align':'align'}="${a}" class="${value===a?'active':''}" aria-label="Align ${caption?'caption':'number'} ${a}" aria-pressed="${value===a}">${icon(a)}</button>`).join('')}</div>`;
}
function colorControl(value, caption = false) {
  const key = caption ? 'label-color' : 'color';
  return `<div class="swatches">${bounds().colors.map(color=>`<button class="swatch ${value===color?'active':''}" data-${key}="${color}" style="background:${color}" aria-label="${color} ${caption?'caption':'element'} color" aria-pressed="${value===color}"></button>`).join('')}${bounds().display==='amoled'?`<label class="color-picker">Custom <input type="color" data-custom-${key} value="${value}" aria-label="Custom ${caption?'caption':'element'} color"></label>`:''}<span class="color-name">${value.toUpperCase()}</span></div>`;
}
function selectProperty(key, label, value, options) {
  return `<div class="field"><label for="property-${key}" class="field-label">${label}</label><select id="property-${key}" data-property="${key}">${options.map(([v,t])=>`<option value="${v}" ${value===v?'selected':''}>${escapeHTML(t)}</option>`).join('')}</select></div>`;
}
function graphicProperties(e) {
  let controls = '';
  if (['rectangle','progressBar','progressRing'].includes(e.type)) controls += field('strokeWidth','Stroke width',e.strokeWidth??1,24,1);
  if (e.type==='rectangle') controls += `<label class="toggle-label">Filled shape <input type="checkbox" data-property="filled" ${e.filled?'checked':''}></label>${field('cornerRadius','Corner radius',e.cornerRadius??0,100)}`;
  if (e.type==='progressBar'||e.type==='progressRing') {
    const distance=e.source==='distance', units=resolveUnits(project.settings.units);
    const goal=displayedGoal(e);
    const max=distance&&units.distance==='mi'?1000000/1.609344:1000000;
    controls += selectProperty('source','LIVE DATA',e.source??'steps',PROGRESS_SOURCES.map(v=>[v,LABELS[v]]))+`<div class="field"><label for="property-goal" class="field-label">Goal${distance?` (${units.distance})`:''} · 0 = automatic</label><input id="property-goal" data-property="goal" type="number" min="0" max="${max}" step="any" value="${goal}"></div><p class="property-hint">Automatic uses the step or floor goal from your watch, 100% battery, 2,000 calories, or ${formatUnitSample('distance',10,units)} ${units.distance}.</p>`;
  }
  if (e.type==='icon') controls += selectProperty('icon','ICON',e.icon??'heart',ICON_IDS.map(v=>[v,v[0].toUpperCase()+v.slice(1)]));
  return controls;
}
function captionHint(e) {
  const style=captionStyle(e,bounds(),project.settings.units), layout=fitCaption(style.text,e,bounds(),project.settings.units);
  if(layout.fit?.truncated)return 'Caption is shortened to fit. Widen the box or shorten the words.';
  if(style.text&&!layout.fit)return 'Caption has no room here. Increase the box height or reduce the gap.';
  if(layout.fit&&layout.fit.height<style.fontSize)return `Caption fits at ${layout.fit.height}px here. Increase box height for larger lettering.`;
  return 'Caption uses crisp pixel lettering. Empty text hides it.';
}
const LAYOUT_ACTIONS = [
  ['left','Left','Align left edges','<path d="M4 3v18"/><rect x="7" y="5" width="12" height="5"/><rect x="7" y="14" width="8" height="5"/>'],
  ['centerX','Center','Align horizontal centers','<path d="M12 3v18"/><rect x="4" y="5" width="16" height="5"/><rect x="7" y="14" width="10" height="5"/>'],
  ['right','Right','Align right edges','<path d="M20 3v18"/><rect x="5" y="5" width="12" height="5"/><rect x="9" y="14" width="8" height="5"/>'],
  ['top','Top','Align top edges','<path d="M3 4h18"/><rect x="5" y="7" width="5" height="12"/><rect x="14" y="7" width="5" height="8"/>'],
  ['centerY','Middle','Align vertical centers','<path d="M3 12h18"/><rect x="5" y="4" width="5" height="16"/><rect x="14" y="7" width="5" height="10"/>'],
  ['bottom','Bottom','Align bottom edges','<path d="M3 20h18"/><rect x="5" y="5" width="5" height="12"/><rect x="14" y="9" width="5" height="8"/>'],
  ['spaceX','Horizontal','Space evenly horizontally','<path d="M3 4v16m18-16v16M5 12h3m8 0h3"/><rect x="10" y="6" width="4" height="12"/>'],
  ['spaceY','Vertical','Space evenly vertically','<path d="M4 3h16M4 21h16M12 5v3m0 8v3"/><rect x="6" y="10" width="12" height="4"/>'],
];
function selectionLayoutControls(movableCount){
  const button=([action,label,name,path])=>`<button class="button layout-button" data-layout-action="${action}" aria-label="${name}" title="${name}${action.startsWith('space')?' · at least 3 movable elements':' · within selection bounds'}" ${movableCount<(action.startsWith('space')?3:2)?'disabled':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${path}</svg><span>${label}</span></button>`;
  return `<section class="selection-layout" aria-label="Selection alignment and spacing"><div class="section-title">ALIGN ELEMENTS</div><div class="layout-alignment" role="group" aria-label="Align within selection bounds">${LAYOUT_ACTIONS.slice(0,6).map(button).join('')}</div><div class="section-title">EVEN SPACING</div><div class="layout-spacing" role="group" aria-label="Even gaps between elements">${LAYOUT_ACTIONS.slice(6).map(button).join('')}</div><p class="property-hint" id="selection-layout-note" role="status">${movableCount<2?'Select at least 2 visible, unlocked elements to align.':movableCount<3?'Align within selection bounds. Select 3 or more movable elements for even gaps.':'Align within selection bounds. Even gaps keep the outer elements fixed.'} Locked and hidden layers are excluded. ${safetyOptions().safetyMargin?'Positions round to whole pixels.':''}</p></section>`;
}
function renderProperties() {
  const raw=selected(), e=effectiveSelected(), p=$('#properties-content');
  if(selectedIds.size>1){const elements=selectedElements(), movable=elements.filter(e=>!e.locked&&e.visible!==false), box=selectionBounds(elements.map(e=>effectiveElement(e,bounds(),safetyOptions().safetyMargin)));p.innerHTML=`<div class="properties-title"><span class="properties-icon">${icon('design')}</span><div><h2>${elements.length} elements selected</h2><p>${movable.length} movable · ${elements.filter(e=>e.locked).length} locked</p></div></div><p class="property-hint">Drag any unlocked selected element to move the selection together. Shift-click to add or remove an element. Locked and hidden layers stay in place.</p>${selectionLayoutControls(movable.length)}<ul class="selection-members">${elements.map(e=>`<li>${escapeHTML(e.type==='text'?e.text||'Custom text':LABELS[e.type])}<small>${e.locked?'Locked':e.visible===false?'Hidden':'Selected'}</small></li>`).join('')}</ul>${box?`<div class="section-title">SELECTION BOUNDS <span>PX</span></div><dl class="selection-bounds">${Object.entries(box).map(([key,value])=>`<div><dt>${key==='width'?'Width':key==='height'?'Height':key.toUpperCase()}</dt><dd>${Math.round(value*100)/100}</dd></div>`).join('')}</dl>`:''}<div class="selection-actions"><button class="button" data-selection-action="duplicate">Duplicate selection</button><button class="button" data-selection-action="delete" ${elements.every(e=>e.locked)?'disabled':''}>Delete unlocked</button><button class="button" data-selection-action="lock">Lock all</button><button class="button" data-selection-action="unlock">Unlock all</button><button class="button" data-selection-action="hide">Hide all</button><button class="button" data-selection-action="show">Show all</button></div><button class="text-button" data-selection-action="clear">Clear selection</button>${backgroundControl()}`;return;}
  if(!e){p.innerHTML=`<div class="properties-empty"><div class="empty-art">⌖</div><h2>Make it your own.</h2><p>Select something on the watch to edit its size, position, and style. Or add a new element from the library.</p></div>${backgroundControl()}`;return;}
  const graphic=isGraphicElement(e.type), definition=ELEMENT_DEFINITIONS[e.type], analysis=analyzeElement(raw,bounds(),safetyOptions());
  const style=captionStyle(e,bounds(),project.settings.units);
  const unitType=UNIT_DEFINITIONS.find(item=>item.category===unitCategory(e.type));
  const unitName=unitType?.options.find(([value])=>value===resolveUnits(project.settings.units)[unitType.category])?.[1];
  const compatibility=elementCompatibility(e.type,bounds()).note;
  p.innerHTML=`<div class="properties-title"><span class="properties-icon">${icon(e.type)}</span><div><h2>${LABELS[e.type]}</h2><p>${graphic?'Graphic element':e.type==='text'?'Your own words':'Live watch data'}${e.locked?' · Locked':''}</p></div></div>
    ${compatibility?`<p class="property-hint compatibility-hint">${escapeHTML(compatibility)}</p>`:''}
    ${unitName?`<div class="unit-preference"><span>${escapeHTML(unitName)}</span><button class="text-button" data-units>Change units ↗</button></div>`:''}
    ${safetyOptions().safetyMargin?`<p class="property-hint safety-hint">${analysis.region==='subscreen'?'Circular window · compact pixel lettering':analysis.changed?'Safety margin fits this layer into the visible display.':'Inside the display safety margin'}</p>`:''}
    ${e.type==='text'?`<div class="field"><label for="property-text" class="field-label">YOUR TEXT</label><input id="property-text" data-property="text" maxlength="120" value="${escapeHTML(e.text||'')}"></div>`:''}
    ${e.type==='time'||e.type==='date'?selectProperty('format','FORMAT',e.format,e.type==='time'?[['24h','24 hour · 10:09'],['12h','12 hour · 10:09']]:[['short','Day, date & month'],['long','Month & date']]):''}
    <div class="section-title">POSITION <span>IN PIXELS</span></div><div class="field-row">${field('x','X',e.x,bounds().width-e.width)}${field('y','Y',e.y,bounds().height-e.height)}</div><div class="field-row">${field('width','Width',e.width,bounds().width,1)}${field('height','Height',e.height,bounds().height,1)}</div>
    ${graphic?graphicProperties(e):`<p class="property-hint">Resizing the box scales the number. Caption size stays independent. Both fit the available space.</p><div class="section-title">${e.type==='text'?'TEXT':'NUMBER / VALUE'}</div>${field('fontSize','Font size',e.fontSize,bounds().fontMax,4)}<label class="field-label">Alignment</label>${alignmentControl(e.align)}`}
    <div class="section-title">${graphic?'GRAPHIC':'VALUE'} COLOR</div>${colorControl(e.color)}
    ${!graphic?`<section class="caption-properties"><div class="section-title">CAPTION</div><label class="toggle-label">Show caption <input type="checkbox" data-property="label" ${e.label?'checked':''}></label>${e.label?`<div class="field"><label for="property-labelText" class="field-label">CAPTION TEXT</label><input id="property-labelText" data-property="labelText" maxlength="32" value="${escapeHTML(style.text)}" placeholder="${escapeHTML(unitCaption(e.type,project.settings.units))}" autocomplete="off"></div><div class="field-row">${field('labelFontSize','Caption size',style.fontSize,bounds().fontMax,5)}${field('labelGap','Gap',style.gap,32)}</div><p class="property-hint" id="caption-fit-hint">${escapeHTML(captionHint(e))}</p><label class="field-label">Caption alignment</label>${alignmentControl(style.align,true)}<div class="section-title">CAPTION COLOR</div>${colorControl(style.color,true)}<button class="text-button" data-reset-caption>Reset caption style</button>`:''}</section>`:''}
    <label class="toggle-label">Lock position & style <input type="checkbox" data-property="locked" ${e.locked?'checked':''}></label>${backgroundControl()}`;
  if(e.locked)p.querySelectorAll('input,select,button:not([data-background])').forEach(el=>{if(el.dataset.property!=='locked'&&!el.hasAttribute('data-custom-background'))el.disabled=true;});
}
function renderLayers(){$('#layers-count').textContent=project.elements.length;$('#layers-list').innerHTML=[...project.elements].reverse().map(e=>`<div class="layer-row ${selectedIds.has(e.id)?'active':''} ${e.visible?'':'hidden-layer'}" data-layer="${escapeHTML(e.id)}" tabindex="0" role="button" aria-pressed="${selectedIds.has(e.id)}" aria-label="Select ${LABELS[e.type]}">${icon(e.type)}<span>${e.type==='text'?escapeHTML((e.text||'Custom text').slice(0,16)):LABELS[e.type]}</span>${e.locked?'<span class="locked-mark" aria-label="Locked">▪</span>':''}<button data-toggle-visible="${escapeHTML(e.id)}" title="${e.visible?'Hide':'Show'} element" aria-label="${e.visible?'Hide':'Show'} ${LABELS[e.type]}">${e.visible?'◉':'○'}</button></div>`).join('');const e=selected();$('#duplicate-button').disabled=!selectedIds.size;$('#delete-button').disabled=!selectedElements().some(e=>!e.locked);$('#layer-up').disabled=!e||project.elements.indexOf(e)===project.elements.length-1;$('#layer-down').disabled=!e||project.elements.indexOf(e)===0;}
function renderElementLibrary() {
  const query=($('#element-search').value||'').trim().toLowerCase();
  const entries=Object.entries(ELEMENT_DEFINITIONS).filter(([type,d])=>`${d.name} ${d.label||''} ${d.group} ${d.note||''} ${type}`.toLowerCase().includes(query));
  $('#library-count').textContent=`${entries.length} elements · data availability varies by watch`;
  $('#element-library').innerHTML=ELEMENT_GROUPS.map(group=>{
    const members=entries.filter(([,d])=>d.group===group.id);if(!members.length)return '';
    return `<details class="library-group" open><summary class="group-label">${escapeHTML(group.name)} <span>${members.length}</span></summary><div class="element-grid">${members.map(([type,d])=>`<button class="element-card" draggable="true" data-add="${type}" aria-label="Add ${escapeHTML(d.name)}" title="${escapeHTML(elementCompatibility(type,bounds()).note||d.name)}"><span class="plus">+</span>${icon(type)}<span>${escapeHTML(d.name)}</span></button>`).join('')}</div></details>`;
  }).join('')||'<p class="panel-hint">No matching elements.</p>';
}
function setupLibrary(){renderElementLibrary();$('#template-library').innerHTML=TEMPLATE_DEFINITIONS.map(t=>`<button class="template-card" data-template="${t.id}"><div class="template-preview"><span class="template-mini"><small>${t.id==='trail'?'84% · 68 BPM':'SUN 11 OCT'}</small>10:09<small>${t.id==='minimal'?'':'8,462 STEPS'}</small></span></div><strong>${t.name}</strong><p>${t.description}</p></button>`).join('');$('#device-select').innerHTML=Object.entries(DEVICES).map(([key,d])=>`<option value="${key}">Garmin ${d.name}</option>`).join('')+UNSUPPORTED_DEVICES.map(d=>`<option disabled>${escapeHTML(d.name)} · unavailable</option>`).join('');for(const id of ['undo','redo','grid','snap'])$(`#${id}-button`).innerHTML=icon(id);}
function dialog(title,content,overline='INSTINCTUAL FACE'){$('#dialog-content').innerHTML=`<div class="dialog-body"><p class="dialog-overline">${overline}</p><div class="dialog-heading"><h2>${title}</h2><button class="dialog-close" data-close aria-label="Close dialog">×</button></div>${content}</div>`;if(!$('#app-dialog').open)$('#app-dialog').showModal();}
function closeDialog(){$('#app-dialog').close();}
function download(content,type,extension){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=`${filename()}.${extension}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const workflows=createWorkflows({getProject:()=>project,setProject,dialog,closeDialog,toast,faceMarkup});
const showExport=()=>workflows.showExport();
async function showProjects(){dialog('Your collection.',`<p class="dialog-intro">Designs save automatically ${serverOnline?'to this server, with a browser backup':'in this browser while the server is unavailable'}.</p><div class="dialog-actions"><button class="button primary" data-new>+ New face</button><button class="button" data-copy>Duplicate current</button><button class="button" data-import>Import JSON</button></div><div class="project-list" id="project-list"><p class="muted">Loading your faces…</p></div><input class="file-input" id="import-file" type="file" accept=".json,application/json">`,'MY FACES');try{const data=await api('/api/projects');savedProjects=mergeProjects(data.projects,getLocal());serverOnline=true;}catch{savedProjects=mergeProjects(savedProjects,getLocal());}renderProjectList();}
function mergeProjects(...lists){const map=new Map();for(const list of lists)for(const raw of list){try{const p=normalizeProject(raw);if(!map.has(p.id)||Date.parse(p.modifiedAt)>Date.parse(map.get(p.id).modifiedAt))map.set(p.id,p);}catch{}}return [...map.values()].sort((a,b)=>Date.parse(b.modifiedAt)-Date.parse(a.modifiedAt));}
function renderProjectList(){if(!$('#project-list'))return;const list=mergeProjects(savedProjects,getLocal(),[project]);$('#project-list').innerHTML=list.map(p=>`<div class="project-row ${p.id===project.id?'current':''}"><button class="project-open" data-open="${escapeHTML(p.id)}"><strong>${escapeHTML(p.name)}${p.id===project.id?' · current':''}</strong><small>${DEVICES[p.device].name} · ${p.elements.length} elements · ${new Date(p.modifiedAt).toLocaleDateString()}</small></button><button class="icon-button danger" data-delete-project="${escapeHTML(p.id)}" aria-label="Delete ${escapeHTML(p.name)}">×</button></div>`).join('')||'<p class="muted">Your first face starts here.</p>';}
function showHelp(){dialog('A face that feels like you.',`<p class="dialog-intro">A design studio for Connect IQ compatible Garmin Instinct watches, including Solar and AMOLED.</p><ol class="help-list"><li><strong>Start with a template.</strong> Summit, Minimal, and Trail give you a ready-made layout. Choose your watch model in the toolbar.</li><li><strong>Make it personal.</strong> Drag elements from the left onto the watch, or click to add. Search the element library, then select an element to adjust its position and style. Number and caption text, size, alignment, and color have separate controls. Resizing its box scales the number; the caption keeps its requested size.</li><li><strong>Dial it in.</strong> Drag empty canvas space to select several elements; Shift-click adds or removes one, and Alt-drag starts a selection anywhere. Drag an unlocked selected element to move the group. Ctrl/⌘ A selects all visible layers. With several selected, use Align elements for edges or centers, and Even spacing for equal gaps between three or more unlocked visible elements. Use arrow keys to nudge the selection, Shift for 10 pixels, Ctrl/⌘ Z to undo, and Ctrl/⌘ D to duplicate. Choose Units above the canvas for Celsius or Fahrenheit, metric or imperial measurements, or a mix. Toggle the pixel grid and snapping above the canvas. Safety margin keeps layers inside visible pixels, including the circular window; turn it off for free placement.</li><li><strong>Take it to your watch.</strong> Open Export face. Guided SDK setup helps you build a watch file, then copy it to GARMIN/APPS by USB. Source ZIP export is also available.</li></ol><div class="notice">The original Instinct has no Connect IQ watch-face support. Choose Instinct 2, 3 Solar, 3 AMOLED, E, or Crossover profiles. Templates resize between displays; colors become black and white on MIP. Sample health and activity values are simulated in the editor; exported source reads real data on the watch.</div>`,'A QUICK FIELD GUIDE');}
function showSamples() {
  const units=resolveUnits(project.settings.units);
  const numeric=[['hour','Hour',10,0,23],['minute','Minute',9,0,59],['steps','Steps',8462,0,999999],['heart','Heart rate (BPM)',68,0,250],['battery','Battery (%)',82,0,100],['calories','Calories',1248,0,99999],['floors','Floors',12,0,9999],['distance',`Distance (${units.distance})`,5.2,0,9999]];
  const extra=[...new Set(project.elements.filter(e=>e.visible&&!isGraphicElement(e.type)&&!['time','date','text',...numeric.map(f=>f[0])].includes(e.type)).map(e=>e.type))];
  sampleBaseline={};
  const displayedSample=(key,fallback,numeric=false)=>{
    const canonical=Object.hasOwn(samples,key)?samples[key]:fallback;
    const display=unitCategory(key)?formatUnitSample(key,numeric&&canonical===null?fallback:canonical,units):String(canonical??(numeric?fallback:'--'));
    sampleBaseline[key]={canonical,display};return display;
  };
  dialog('Try a different kind of day.',`<p class="dialog-intro">Enter readings in this face’s selected units. Toggle Unavailable for numeric fields, or enter -- for other readings.</p><form id="sample-form"><div class="sample-form sample-scroll">${numeric.map(([key,label,val,min,max])=>`<div class="field"><label class="field-label" for="sample-${key}">${label}</label><input id="sample-${key}" name="${key}" type="number" min="${min}" max="${key==='distance'?max/canonicalUnitSample('distance',1,units):max}" step="${key==='distance'?'any':'1'}" value="${escapeHTML(displayedSample(key,val,true))}" ${samples[key]===null?'disabled':''} required>${!['hour','minute'].includes(key)?`<label class="sample-unavailable"><input type="checkbox" data-unavailable="${key}" ${samples[key]===null?'checked':''}> Unavailable</label>`:''}</div>`).join('')}${extra.map(key=>`<div class="field"><label class="field-label" for="sample-${key}">${escapeHTML(LABELS[key])}${unitCategory(key)?` · ${escapeHTML(unitCaption(key,units))}`:''}</label><input id="sample-${key}" name="${key}" type="text" maxlength="120" value="${escapeHTML(displayedSample(key,ELEMENT_DEFINITIONS[key].sample))}"></div>`).join('')}</div><div class="dialog-actions"><button class="button primary" type="submit">Update preview</button><button class="button" type="button" data-reset-samples>Reset samples</button></div></form><p class="data-warning">Your exported face uses live watch readings. Preview values are never included in the Garmin face.</p>`,'PREVIEW DATA');
}
function showUnits() {
  const units=resolveUnits(project.settings.units);
  dialog('Your preferred units.',`<p class="dialog-intro">Choose units for this face. Default captions update automatically. Custom caption wording stays yours.</p><div class="unit-presets"><button class="button" data-unit-preset="metric">Metric preset</button><button class="button" data-unit-preset="imperial">US / imperial preset</button></div><form id="units-form"><div class="units-form">${UNIT_DEFINITIONS.map(({category,label,options})=>`<div class="field"><label class="field-label" for="unit-${category}">${escapeHTML(label)}</label><select id="unit-${category}" name="${category}">${options.map(([value,text])=>`<option value="${value}" ${units[category]===value?'selected':''}>${escapeHTML(text)}</option>`).join('')}</select></div>`).join('')}</div><p class="units-examples" id="units-examples" aria-live="polite"></p><div class="dialog-actions"><button type="submit" class="button primary">Apply units</button><button type="button" class="button" data-close>Cancel</button></div></form><p class="data-warning">Units are saved with the design and share code, and used when you build your watch face.</p>`,'FACE PREFERENCES');
  updateUnitExamples();
}
function updateUnitExamples() {
  const form=$('#units-form');if(!form)return;
  const units=resolveUnits(Object.fromEntries(new FormData(form)));
  $('#units-examples').textContent=`Example readings: ${formatUnitSample('temperature',18,units)} °${units.temperature.toUpperCase()} · ${formatUnitSample('altitude',1650,units)} ${units.elevation} · ${formatUnitSample('distance',5.2,units)} ${units.distance}`;
}
function askDeleteProject(id){const item=mergeProjects(savedProjects,getLocal(),[project]).find(p=>p.id===id);if(!item)return;dialog('Delete this face?',`<p class="confirm-text">Delete <strong>${escapeHTML(item.name)}</strong> from this server and browser? Download a JSON backup first if you want to keep the design.</p><div class="dialog-actions"><button class="button danger" data-confirm-delete="${escapeHTML(id)}">Delete face</button><button class="button" data-projects>Keep face</button></div>`,'YOUR COLLECTION');}
function askTemplate(id){const t=TEMPLATE_DEFINITIONS.find(t=>t.id===id);dialog(`Start with ${t.name}?`,`<p class="confirm-text">Replace the current layout with the ${t.name} template. Your project name stays the same, and you can undo this change.</p><div class="dialog-actions"><button class="button primary" data-apply-template="${t.id}">Use template</button><button class="button" data-close>Keep designing</button></div>`,'STARTING POINT');}

setupLibrary();render();$('.studio').inert=true;for(const el of [$('#project-name'),$('#projects-button'),$('#export-button'),$('#share-button')])el.disabled=true;
document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b)return;const d=b.dataset;
  if(d.add){if(suppressAdd?.type===d.add&&performance.now()<suppressAdd.until){suppressAdd=null;return;}addElement(d.add);return;}if(d.template){askTemplate(d.template);return;}
  if(d.layoutAction){arrangeSelected(d.layoutAction);return;}
  if(d.selectionAction){const actions={duplicate,delete:removeSelected,lock:()=>bulkSelection('locked',true),unlock:()=>bulkSelection('locked',false),hide:()=>bulkSelection('visible',false),show:()=>bulkSelection('visible',true),clear:()=>selectElement(null)};actions[d.selectionAction]?.();return;}
  if(d.applyTemplate){mutate(()=>{const template=createProject(d.applyTemplate,project.device);project.elements=template.elements;project.background=template.background;defaultSelection();});closeDialog();return;}
  if(d.unitPreset){const form=$('#units-form');if(!form)return;const units=d.unitPreset==='imperial'?IMPERIAL_UNITS:METRIC_UNITS;for(const [key,value] of Object.entries(units))form.elements.namedItem(key).value=value;updateUnitExamples();return;}
  if(d.units!==undefined){showUnits();return;}
  if(d.resetCaption!==undefined&&selected()&&!selected().locked){mutate(()=>{for(const key of ['labelText','labelFontSize','labelColor','labelAlign','labelGap'])delete selected()[key];});return;}
  if(d.labelAlign&&selected()&&!selected().locked){mutate(()=>selected().labelAlign=d.labelAlign);return;}
  if(d.labelColor&&selected()&&!selected().locked){mutate(()=>selected().labelColor=d.labelColor);return;}
  if(d.align&&selected()&&!selected().locked){mutate(()=>selected().align=d.align);return;}
  if(d.color&&selected()&&!selected().locked){mutate(()=>selected().color=d.color);return;}
  if(d.background){mutate(()=>{const old=project.background;project.background=d.background;if(old!==d.background&&bounds().display==='mip')for(const e of project.elements){e.color=e.color==='#111111'?'#eeeeee':'#111111';if(e.labelColor)e.labelColor=e.labelColor==='#111111'?'#eeeeee':'#111111';}});return;}
  if(d.toggleVisible){mutate(()=>{const e=project.elements.find(e=>e.id===d.toggleVisible);e.visible=!e.visible;});return;}
  if(d.close!==undefined){closeDialog();return;}
  if(d.download){try{if(d.download==='garmin')download(createSourceZip(project),'application/zip','zip');if(d.download==='json')download(JSON.stringify(project,null,2),'application/json','json');if(d.download==='svg')download(`<svg xmlns="http://www.w3.org/2000/svg" width="${bounds().width}" height="${bounds().height}" viewBox="0 0 ${bounds().width} ${bounds().height}">${faceMarkup(false)}</svg>`,'image/svg+xml','svg');toast('Download ready');}catch(error){toast(error.message);}return;}
  if(d.open){const p=mergeProjects(savedProjects,getLocal(),[project]).find(p=>p.id===d.open);if(p){setProject(p);closeDialog();toast(`${p.name} opened`);}return;}
  if(d.new!==undefined){setProject(createProject('minimal',project.device));project.name='Untitled face';renderHeader();scheduleSave();closeDialog();return;}
  if(d.copy!==undefined){const p=clone(project);p.id=createProject().id;p.name=`${p.name} copy`.slice(0,80);setProject(p);closeDialog();toast('Face duplicated');return;}
  if(d.import!==undefined){$('#import-file').click();return;}
  if(d.deleteProject){askDeleteProject(d.deleteProject);return;}
  if(d.confirmDelete){const deletingCurrent=project.id===d.confirmDelete;if(deletingCurrent)clearTimeout(autosaveTimer);try{await pendingSave;await api(`/api/projects/${encodeURIComponent(d.confirmDelete)}`,{method:'DELETE'});}catch(error){if(deletingCurrent)scheduleSave();toast(`Could not delete from server: ${error.message}`);return;}savedProjects=savedProjects.filter(p=>p.id!==d.confirmDelete);try{localStorage.setItem(storageKey,JSON.stringify(getLocal().filter(p=>p.id!==d.confirmDelete)));}catch{}if(project.id===d.confirmDelete){clearTimeout(autosaveTimer);project=createProject();history=[];future=[];defaultSelection();render();scheduleSave();}await showProjects();toast('Face deleted');return;}
  if(d.projects!==undefined){showProjects();return;}
  if(d.resetSamples!==undefined){samples={};renderFace();closeDialog();return;}
  const actions={'fit-face-button':()=>mutate(()=>project.elements=project.elements.map(e=>effectiveElement(e,bounds(),true))),'share-button':()=>workflows.showShare(),'projects-button':showProjects,'export-button':showExport,'help-button':showHelp,'preview-data-button':showSamples,'units-button':showUnits,'undo-button':undo,'redo-button':redo,'delete-button':removeSelected,'duplicate-button':duplicate,'layer-up':()=>reorder(1),'layer-down':()=>reorder(-1),'edit-view':()=>{preview=false;render();},'preview-view':()=>{preview=true;render();},'grid-button':()=>mutate(()=>project.settings.grid=!project.settings.grid),'snap-button':()=>mutate(()=>project.settings.snap=!project.settings.snap),'zoom-in':()=>mutate(()=>project.settings.zoom=Math.min(1.5,Math.round((project.settings.zoom+.1)*10)/10)),'zoom-out':()=>mutate(()=>project.settings.zoom=Math.max(.5,Math.round((project.settings.zoom-.1)*10)/10)),'zoom-reset':()=>mutate(()=>project.settings.zoom=1),'elements-tab':()=>switchTab(false),'templates-tab':()=>switchTab(true)};actions[b.id]?.();
});
function switchTab(templates){if(templates)workflows.loadTemplates();$('#elements-panel').hidden=templates;$('#templates-panel').hidden=!templates;$('#elements-tab').classList.toggle('active',!templates);$('#templates-tab').classList.toggle('active',templates);$('#elements-tab').setAttribute('aria-selected',!templates);$('#templates-tab').setAttribute('aria-selected',templates);}
function startTextEdit(input){return{target:input,checkpoint:false,base:effectiveSelected()};}
document.addEventListener('focusin',event=>{if(event.target.id==='project-name'||event.target.dataset.property)textEdit=startTextEdit(event.target);});
function applyNumericProperty(e,key,value,base=effectiveSelected()){
  const limits={x:[0,bounds().width-base.width],y:[0,bounds().height-base.height],width:[1,bounds().width],height:[1,bounds().height],fontSize:[4,bounds().fontMax],labelFontSize:[5,bounds().fontMax],labelGap:[0,32],strokeWidth:[1,24],cornerRadius:[0,100],goal:[0,1000000]};
  if(!limits[key])return;
  if(key==='goal'&&base.source==='distance')value=canonicalUnitSample('distance',value,project.settings.units);
  const [min,max]=limits[key];value=Math.min(max,Math.max(min,value));
  if(['labelGap','strokeWidth','cornerRadius'].includes(key))value=Math.round(value);
  if(key==='width'||key==='height')Object.assign(e,resizeElement(base,{[key]:value},bounds(),{...safetyOptions(),region:analyzeElement(base,bounds()).region}));
  else{Object.assign(e,base,{[key]:value});fitElement(e);}
}
function updatePropertyNumbers(active){const e=effectiveSelected();if(!e)return;const caption=captionStyle(e,bounds(),project.settings.units);for(const key of ['x','y','width','height','fontSize','labelFontSize','labelGap','strokeWidth','cornerRadius','goal']){const input=$(`#property-${key}`);if(input&&input!==active)input.value=key==='goal'?displayedGoal(e):Math.round((e[key]??({labelFontSize:caption.fontSize,labelGap:caption.gap,strokeWidth:1,cornerRadius:0}[key]))*100)/100;}}
document.addEventListener('focusout',event=>{if(event.target.dataset.property&&event.target.type==='number')updatePropertyNumbers(null);});
document.addEventListener('input',event=>{const input=event.target;const isName=input.id==='project-name';const key=input.dataset.property;if(input.id==='element-search'){renderElementLibrary();return;}const literal=key==='text'||key==='labelText';if(!isName&&!literal&&input.type!=='number')return;if(!isName&&!key)return;const e=selected();if(!isName&&(!e||e.locked))return;if(!isName&&!literal&&(input.value===''||!Number.isFinite(Number(input.value))))return;if(!textEdit||textEdit.target!==input)textEdit=startTextEdit(input);if(!textEdit.checkpoint){checkpoint();textEdit.checkpoint=true;}if(isName)project.name=input.value.trim().slice(0,80)||'Untitled face';else if(literal)e[key]=input.value.slice(0,key==='text'?120:32);else applyNumericProperty(e,key,Number(input.value),textEdit.base);renderFace();renderLayers();renderToolbar();updatePropertyNumbers(input);scheduleSave();});
document.addEventListener('change',async event=>{const input=event.target;if(input.form?.id==='units-form'){updateUnitExamples();return;}if(input.dataset.unavailable){input.form.elements.namedItem(input.dataset.unavailable).disabled=input.checked;return;}if(input.matches('[data-custom-color],[data-custom-label-color],[data-custom-background]')){if(bounds().display!=='amoled')return;if(input.hasAttribute('data-custom-background'))mutate(()=>project.background=input.value);else if(selected()&&!selected().locked)mutate(()=>selected()[input.hasAttribute('data-custom-label-color')?'labelColor':'color']=input.value);return;}if(input.id==='project-name'){renderHeader();return;}if(['text','labelText'].includes(input.dataset.property))return;if(input.id==='safety-margin-toggle'){mutate(()=>{project.settings.safetyMargin=input.checked;if(input.checked)project.elements=project.elements.map(e=>effectiveElement(e,bounds(),true));});return;}if(input.id==='device-select'){mutate(()=>project=resizeProject(project,input.value));renderElementLibrary();return;}
  if(input.dataset.property){const e=selected();if(!e)return;const key=input.dataset.property;if(e.locked&&key!=='locked')return;
    if(input.type==='number'){if(!Number.isFinite(Number(input.value))){renderProperties();return;}if(!textEdit?.checkpoint){checkpoint();applyNumericProperty(e,key,Number(input.value));scheduleSave();}render();textEdit=null;return;}
    const value=input.type==='checkbox'?input.checked:input.value;if(e[key]===value){renderProperties();return;}mutate(()=>{Object.assign(e,effectiveSelected());e[key]=value;fitElement(e);});return;}
  if(input.id==='import-file'&&input.files[0]){try{const file=input.files[0];if(file.size>1024*1024)throw new Error('Choose a JSON file under 1 MB.');const imported=normalizeProject(JSON.parse(await file.text()));imported.id=createProject().id;imported.name=`${imported.name} imported`.slice(0,80);setProject(imported);closeDialog();toast('Design imported');}catch(error){toast(`Import failed: ${error.message}`);}input.value='';}
});
document.addEventListener('click',event=>{const row=event.target.closest('[data-layer]');if(row&&!event.target.closest('button'))selectElement(row.dataset.layer,{toggle:event.shiftKey});});
document.addEventListener('keydown',event=>{
  if($('#app-dialog').open||event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  const mod=event.ctrlKey||event.metaKey, key=event.key.toLowerCase();
  if(key==='escape'){finishDrag(null,true);selectElement(null);return;}
  if(drag)return;
  if(mod&&key==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}
  if(mod&&key==='y'){event.preventDefault();redo();return;}
  if(mod&&key==='s'){event.preventDefault();clearTimeout(autosaveTimer);saveProject(clone(project));toast('Design saved');return;}
  if(preview)return;
  if(mod&&key==='a'&&(event.target.closest('.studio')||event.target===document.body)){event.preventDefault();selectAll();return;}
  if(mod&&key==='d'){event.preventDefault();duplicate();return;}
  if(key==='delete'||key==='backspace'){event.preventDefault();removeSelected();return;}
  const row=event.target.closest('[data-layer]');
  if(row&&!event.target.closest('button')&&(key==='enter'||key===' ')){event.preventDefault();selectElement(row.dataset.layer,{toggle:event.shiftKey});$('#layers-list').querySelector(`[data-layer="${CSS.escape(row.dataset.layer)}"]`)?.focus();return;}
  const delta={arrowleft:[-1,0],arrowright:[1,0],arrowup:[0,-1],arrowdown:[0,1]}[key];
  if(delta&&selectedIds.size){event.preventDefault();const step=event.shiftKey?10:1, bases=selectedElements().filter(e=>!e.locked&&e.visible!==false).map(e=>effectiveElement(e,bounds(),safetyOptions().safetyMargin)), result=moveSelection(bases,bounds(),delta[0]*step,delta[1]*step,movementOptions());if(result.changed)mutate(()=>applyMovedElements(result.elements));}
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if(form.id==='units-form'){
    event.preventDefault();
    try{const units=normalizeUnits(Object.fromEntries(new FormData(form)));mutate(()=>project.settings.units=units);closeDialog();toast('Units applied');}catch(error){toast(error.message);}return;
  }
  if(form.id!=='sample-form')return;event.preventDefault();
  try{
    const next={...samples};
    for(const [key,value] of new FormData(form)){
      const baseline=sampleBaseline[key];
      next[key]=baseline&&value===baseline.display?baseline.canonical:unitCategory(key)?canonicalUnitSample(key,value,project.settings.units):form.elements.namedItem(key).type==='number'?Number(value):String(value);
    }
    for(const input of form.querySelectorAll('[data-unavailable]:checked'))next[input.dataset.unavailable]=null;
    samples=next;renderFace();closeDialog();toast('Preview updated');
  }catch(error){toast(`Check the sample reading: ${error.message}`);}
});
const canvas=$('#face-canvas');let drag=null;
function canvasPoint(event){const r=canvas.getBoundingClientRect();return{x:(event.clientX-r.left)/r.width*bounds().width,y:(event.clientY-r.top)/r.height*bounds().height};}
function applyMovedElements(elements){for(const moved of elements){const element=project.elements.find(e=>e.id===moved.id);if(element)Object.assign(element,moved);}}
function geometryChanged(elements){return elements.some(next=>{const old=project.elements.find(e=>e.id===next.id);return old&&['x','y','width','height','fontSize'].some(key=>old[key]!==next[key]);});}
function captureDrag(event){canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});event.preventDefault();}
canvas.addEventListener('pointerdown',event=>{
  if(preview||event.button!==0||event.isPrimary===false||drag)return;
  const resizing=!!event.target.closest('[data-resize]'), id=event.altKey?null:event.target.closest('[data-element]')?.dataset.element;
  const start=canvasPoint(event), clientStart={x:event.clientX,y:event.clientY};
  if(!id){const initial=[...selectedIds];drag={kind:'marquee',pointer:event.pointerId,start,clientStart,initial,primary:selectedId,additive:event.shiftKey,bases:project.elements.filter(e=>e.visible!==false).map(e=>effectiveElement(e,bounds(),safetyOptions().safetyMargin)),moved:false};if(!event.shiftKey)setSelection([]);selectionBox={...start,width:0,height:0};render();captureDrag(event);return;}
  if(event.shiftKey){selectElement(id,{toggle:true});canvas.focus({preventScroll:true});event.preventDefault();return;}
  selectElement(id,{preserve:!resizing});
  const element=project.elements.find(e=>e.id===id);if(element.locked){canvas.focus({preventScroll:true});return;}
  const bases=selectedElements().filter(e=>!e.locked&&e.visible!==false).map(e=>effectiveElement(e,bounds(),safetyOptions().safetyMargin));
  drag={kind:resizing?'resize':'move',id,pointer:event.pointerId,start,clientStart,bases,base:effectiveSelected(),single:selectedIds.size===1,regions:new Map(bases.map(e=>[e.id,analyzeElement(e,bounds()).region])),moved:false,before:null};captureDrag(event);
});
canvas.addEventListener('pointermove',event=>{
  if(!drag||drag.pointer!==event.pointerId)return;
  if(!drag.moved&&Math.hypot(event.clientX-drag.clientStart.x,event.clientY-drag.clientStart.y)<3)return;
  const point=canvasPoint(event), dx=point.x-drag.start.x, dy=point.y-drag.start.y;
  if(drag.kind==='marquee'){drag.moved=true;const clampPoint=p=>({x:Math.max(0,Math.min(bounds().width,p.x)),y:Math.max(0,Math.min(bounds().height,p.y))});selectionBox=selectionRect(clampPoint(drag.start),clampPoint(point));setSelection([...(drag.additive?drag.initial:[]),...marqueeIds(drag.bases,selectionBox)]);renderFace();renderProperties();renderLayers();renderToolbar();return;}
  let next;
  if(drag.kind==='resize'){next=[resizeElement(drag.base,{width:Math.min(bounds().width,Math.max(1,drag.base.width+dx)),height:Math.min(bounds().height,Math.max(1,drag.base.height+dy))},bounds(),{...safetyOptions(),region:drag.regions.get(drag.id)})];}
  else if(drag.single)next=[constrainElement({...drag.base,x:drag.base.x+dx,y:drag.base.y+dy},bounds(),{...safetyOptions(),snap:project.settings.snap})];
  else next=moveSelection(drag.bases,bounds(),dx,dy,{...movementOptions(),snap:project.settings.snap,regions:drag.regions}).elements;
  if(!geometryChanged(next))return;
  if(!drag.moved){drag.before=selectionState();drag.previousHistory=[...history];drag.previousFuture=[...future];checkpoint();drag.moved=true;}
  applyMovedElements(next);renderFace();
});
function finishDrag(event,cancel=false){
  if(!drag||(event&&event.pointerId!==drag.pointer))return;
  const finished=drag;drag=null;selectionBox=null;
  if(canvas.hasPointerCapture(finished.pointer))canvas.releasePointerCapture(finished.pointer);
  if(finished.kind==='marquee'){if(cancel)setSelection(finished.initial,finished.primary);render();return;}
  if(finished.moved){if(JSON.stringify(project)===JSON.stringify(finished.before.project)){history=finished.previousHistory;future=finished.previousFuture;}else scheduleSave();}
  render();
}
canvas.addEventListener('pointerup',event=>finishDrag(event));
canvas.addEventListener('pointercancel',event=>finishDrag(event,true));
canvas.addEventListener('lostpointercapture',event=>finishDrag(event,true));
window.addEventListener('blur',()=>finishDrag(null,true));
document.addEventListener('pointerdown',event=>{const card=event.target.closest('[data-add]');if(!card||event.button!==0)return;libraryDrag={type:card.dataset.add,pointer:event.pointerId,card,startX:event.clientX,startY:event.clientY,moved:false};card.setPointerCapture(event.pointerId);event.preventDefault();});
document.addEventListener('pointermove',event=>{if(!libraryDrag||event.pointerId!==libraryDrag.pointer)return;if(!libraryDrag.moved&&Math.hypot(event.clientX-libraryDrag.startX,event.clientY-libraryDrag.startY)<5)return;libraryDrag.moved=true;let ghost=$('#drag-ghost');if(!ghost){ghost=document.createElement('div');ghost.id='drag-ghost';ghost.setAttribute('aria-hidden','true');document.body.append(ghost);}ghost.textContent=LABELS[libraryDrag.type];ghost.style.left=`${event.clientX+14}px`;ghost.style.top=`${event.clientY+14}px`;});
function finishLibraryDrag(event){if(!libraryDrag||event.pointerId!==libraryDrag.pointer)return;const moving=libraryDrag;libraryDrag=null;$('#drag-ghost')?.remove();if(!moving.moved)return;suppressAdd={type:moving.type,until:performance.now()+500};if(event.type==='pointercancel')return;const r=canvas.getBoundingClientRect();if(event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom)addElement(moving.type,canvasPoint(event));}
document.addEventListener('pointerup',finishLibraryDrag);document.addEventListener('pointercancel',finishLibraryDrag);
document.addEventListener('dragstart',event=>{const card=event.target.closest('[data-add]');if(!card)return;event.dataTransfer.setData('application/x-instinct-element',card.dataset.add);event.dataTransfer.setData('text/plain',card.dataset.add);event.dataTransfer.effectAllowed='copy';});
canvas.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('application/x-instinct-element')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
canvas.addEventListener('drop',event=>{event.preventDefault();const type=event.dataTransfer.getData('application/x-instinct-element');if(Object.hasOwn(LABELS,type))addElement(type,canvasPoint(event));});
$('#app-dialog').addEventListener('click',event=>{if(event.target===$('#app-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
window.addEventListener('resize',renderToolbar);
window.addEventListener('beforeunload',()=>{if(!initialized)return;putLocal(project);if(autosaveTimer)fetch(`/api/projects/${encodeURIComponent(project.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(project),keepalive:true}).catch(()=>{});});
async function initialize(){const local=getLocal();let remote=[];try{const data=await api('/api/projects');remote=data.projects;serverOnline=true;}catch{serverOnline=false;}savedProjects=mergeProjects(remote,local);let active;try{active=localStorage.getItem('instinctual-face-active');}catch{}if(savedProjects.length){project=savedProjects.find(p=>p.id===active)||savedProjects[0];}else{project=createProject();}defaultSelection();render();initialized=true;$('.studio').inert=false;for(const el of [$('#project-name'),$('#projects-button'),$('#export-button'),$('#share-button')])el.disabled=false;saveProject(clone(project));await workflows.initialize();}
initialize();
