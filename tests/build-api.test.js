import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {startServer,isLocalDesktopRequest} from '../server.mjs';
import {createProject,createElement} from '../web/model.js';
import {DEVICES} from '../web/devices.js';
import {CompilerError} from '../compiler.mjs';
import {IMPERIAL_UNITS} from '../web/units.js';

async function fixture(t, override={}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'instinctual-build-api-'));
  const calls=[];
  const compiler={status:async()=>({available:true,devices:['instinct3solar45mm']}),setup:async input=>{calls.push(['setup',input]);return {available:true};},setupDesktop:async input=>{calls.push(['desktop-setup',input]);return {available:true,desktopSetupSupported:true};},openSdkManager:async()=>{calls.push(['open-manager']);return {available:true,desktopSetupSupported:true};},refreshProfiles:async()=>{calls.push(['refresh']);return {devices:['instinct3solar45mm']};},build:async input=>{calls.push(['build',input]);return {filename:'summit.prg',bytes:Buffer.from('test watch binary')};},...override};
  const app=await startServer({host:'127.0.0.1',port:0,dataDir,compiler});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const request=(route,body,method=body===undefined?'GET':'POST',headers={})=>new Promise((resolve,reject)=>{
    // Raw HTTP deliberately permits forged Host headers that browser fetch forbids.
    const client=http.request(app.url+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}},response=>{
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
      response.on('error',reject);
    });
    client.on('error',reject);
    client.end(body===undefined?undefined:JSON.stringify(body));
  });
  return {request,calls,url:app.url};
}

test('build API downloads validated design results with attachment headers',async t=>{
  const {request,calls}=await fixture(t);
  const p=createProject('summit','instinct3solar45mm');
  const response=await request('/api/build',p);
  assert.equal(response.status,200);
  assert.equal(await response.text(),'test watch binary');
  assert.equal(response.headers.get('content-disposition'),'attachment; filename="summit.prg"');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(calls,[['build',p]]);
});

test('build API retains only fixed unit choices and rejects injected nested unit fields',async t=>{
  const {request,calls}=await fixture(t);
  const design=createProject('trail','instinct3solar50mm');
  design.settings.units={...IMPERIAL_UNITS};
  design.elements.push({...createElement('progressRing','instinct3solar50mm'),source:'distance',goal:1.609344});
  assert.equal((await request('/api/build',design)).status,200);
  assert.deepEqual(calls,[['build',design]]);
  for(const units of [null,[],{command:'bad'},{temperature:'f; source()'},{distance:{source:'bad'}},JSON.parse('{"__proto__":{"polluted":true}}')]){
    assert.equal((await request('/api/build',{...design,settings:{...design.settings,units}})).status,400);
  }
  assert.equal(calls.length,1);
});

test('build rejects source, commands, paths, scripts and malformed fields before calling compiler',async t=>{
  const {request,calls}=await fixture(t);
  for(const key of ['source','command','sdkPath','script','__proto__']) {
    const p=createProject();Object.defineProperty(p,key,{value:'untrusted',enumerable:true});
    assert.equal((await request('/api/build',p)).status,400);
  }
  const p=createProject();p.elements[0].script='evil';
  assert.equal((await request('/api/build',p)).status,400);
  const q=createProject();q.settings.shell='evil';
  assert.equal((await request('/api/build',q)).status,400);
  assert.deepEqual(calls,[]);
});

test('build retains bounded independent captions and trusted graphics without accepting new code fields',async t=>{
  const {request,calls}=await fixture(t);
  const design=createProject('minimal');
  design.elements=[{...createElement('heart'),labelText:'PULSE %',labelFontSize:10,labelColor:'#eeeeee',labelAlign:'left',labelGap:4},createElement('progressBar'),createElement('icon')];
  assert.equal((await request('/api/build',design)).status,200);
  assert.deepEqual(calls,[['build',design]]);
  for(const [type,key,value] of [['heart','labelText','X'.repeat(33)],['heart','labelFontSize','shell()'],['progressBar','source','../secret'],['icon','icon','file:///secret'],['rectangle','cornerRadius',Infinity],['circle','labelText','UNSUPPORTED']]){
    const bad={...design,elements:[{...createElement(type),[key]:value}]};
    assert.equal((await request('/api/build',bad)).status,400,`${type}.${key}`);
  }
  assert.equal(calls.length,1);
});

test('valid large designs can compile independently of the portable share-code byte limit',async t=>{
  const {request,calls}=await fixture(t);
  const p=createProject();
  p.elements=Array.from({length:100},(_,index)=>({id:`text-${index}`,type:'text',x:10,y:10,width:120,height:22,fontSize:16,align:'left',color:'#eeeeee',label:false,visible:true,locked:false,text:'界'.repeat(120)}));
  assert.ok(Buffer.byteLength(JSON.stringify(p))>32768);
  assert.equal((await request('/api/build',p)).status,200);
  assert.equal(calls[0][1].elements.length,100);
});

test('compiler setup requires explicit license acceptance and refresh accepts no filesystem paths',async t=>{
  const {request,calls}=await fixture(t);
  assert.equal((await request('/api/compiler')).status,200);
  assert.equal((await request('/api/compiler/setup',{})).status,400);
  assert.equal((await request('/api/compiler/setup',{acceptedLicense:false})).status,400);
  assert.equal((await request('/api/compiler/setup',{acceptedLicense:true,url:'https://attacker.invalid'})).status,400);
  assert.equal((await request('/api/compiler/setup',{acceptedLicense:true})).status,200);
  assert.equal((await request('/api/compiler/refresh',{path:'/etc'})).status,400);
  assert.equal((await request('/api/compiler/refresh',{})).status,200);
  assert.deepEqual(calls,[['setup',{acceptedLicense:true}],['refresh']]);
});

test('desktop actions accept only local same-origin JSON with their fixed input schema',async t=>{
  const {request,calls,url}=await fixture(t);
  const headers={Origin:url,'Sec-Fetch-Site':'same-origin'};
  assert.equal((await request('/api/compiler/desktop-setup',{},'POST',headers)).status,400);
  assert.equal((await request('/api/compiler/desktop-setup',{acceptedLicense:false},'POST',headers)).status,400);
  assert.equal((await request('/api/compiler/desktop-setup',{acceptedLicense:true,command:'bad'},'POST',headers)).status,400);
  assert.equal((await request('/api/compiler/desktop-setup',{acceptedLicense:true},'POST',{...headers,'Content-Type':'text/plain'})).status,415);
  assert.equal((await request('/api/compiler/desktop-setup',{acceptedLicense:true},'POST',headers)).status,200);
  assert.equal((await request('/api/compiler/open-manager',{path:'/tmp'},'POST',headers)).status,400);
  assert.equal((await request('/api/compiler/open-manager',{},'POST',headers)).status,200);
  assert.deepEqual(calls,[['desktop-setup',{acceptedLicense:true}],['open-manager']]);
});

test('desktop endpoints reject missing origins, cross-origin callers, forwarding and rebinding Hosts',async t=>{
  const {request,calls,url}=await fixture(t);
  for (const route of ['/api/compiler/desktop-setup','/api/compiler/open-manager']) {
    const body=route.endsWith('desktop-setup')?{acceptedLicense:true}:{};
    for (const headers of [{},{Origin:'https://attacker.invalid'},{Origin:url,'X-Forwarded-For':'127.0.0.1'},{Origin:url,Forwarded:'for=127.0.0.1'},{Origin:url,Via:'proxy'},{Origin:url,'X-Real-IP':'127.0.0.1'},{Origin:url,'Sec-Fetch-Site':'cross-site'},{Origin:url,'Sec-Fetch-Site':'same-site'},{Origin:url,Host:new URL(url).host.replace('127.0.0.1','attacker.invalid')},{Origin:url,Host:'127.0.0.1:1'}]) {
      assert.equal((await request(route,body,'POST',headers)).status,403,JSON.stringify(headers));
    }
  }
  assert.deepEqual(calls,[]);
});

test('desktop gate rejects remote sockets even when they spoof all local headers',()=>{
  const request={socket:{remoteAddress:'127.0.0.1',localPort:3000},headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','sec-fetch-site':'same-origin'}};
  assert.equal(isLocalDesktopRequest(request,{requireOrigin:true}),true);
  for (const remoteAddress of ['192.168.1.2','172.17.0.1','::ffff:192.168.1.2','::2',undefined]) assert.equal(isLocalDesktopRequest({...request,socket:{...request.socket,remoteAddress}},{requireOrigin:true}),false);
  for (const host of ['attacker.invalid:3000','localhost.attacker.invalid:3000','localhost.:3000','user@localhost:3000','localhost:3000/','localhost:3000/path','localhost:3000?query','localhost:3000#fragment','localhost:3001','localhost:03000','127%2e0%2e0%2e1:3000']) assert.equal(isLocalDesktopRequest({...request,headers:{...request.headers,host}}),false,host);
  const ipv6={socket:{remoteAddress:'::1',localPort:3000},headers:{host:'[::1]:3000',origin:'http://[::1]:3000'}};
  assert.equal(isLocalDesktopRequest(ipv6,{requireOrigin:true}),true);
  const defaultPort={socket:{remoteAddress:'127.0.0.1',localPort:80},headers:{host:'localhost',origin:'http://localhost'}};
  assert.equal(isLocalDesktopRequest(defaultPort,{requireOrigin:true}),true);
  assert.equal(isLocalDesktopRequest({...defaultPort,headers:{host:'localhost:80',origin:'http://localhost'}},{requireOrigin:true}),true);
});

test('compiler status hides desktop actions from browser connections with an unsafe Host or forwarding',async t=>{
  const {request,url}=await fixture(t,{status:async()=>({available:true,desktopSetupSupported:true,desktopSetupReason:'Local desktop available.'})});
  assert.equal((await (await request('/api/compiler')).json()).desktopSetupSupported,true);
  const unsafe=await (await request('/api/compiler',undefined,'GET',{Host:new URL(url).host.replace('127.0.0.1','attacker.invalid')})).json();
  assert.equal(unsafe.desktopSetupSupported,false);
  assert.match(unsafe.desktopSetupReason,/localhost/);
  assert.equal((await (await request('/api/compiler',undefined,'GET',{'X-Forwarded-Host':new URL(url).host})).json()).desktopSetupSupported,false);
});

test('missing profiles and real compiler diagnostics are surfaced without a fake binary',async t=>{
  const {request}=await fixture(t,{build:async()=>{throw new CompilerError('Watch profile missing',503,'Download it in Garmin SDK Manager.');}});
  const response=await request('/api/build',createProject());
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'Watch profile missing',diagnostics:'Download it in Garmin SDK Manager.'});
  assert.equal(response.headers.get('content-disposition'),null);
});

test('server persistence accepts every supported profile and full RGB only for AMOLED',async t=>{
  const {request}=await fixture(t);
  for(const [id,d] of Object.entries(DEVICES)) {
    const p=createProject('summit',id);
    if(d.display==='amoled'){p.elements[0].color='#23A1F7';p.background='#000000';}
    const response=await request('/api/projects/'+p.id,p,'PUT');
    assert.equal(response.status,200,id);
    const saved=(await response.json()).project;
    assert.equal(saved.device,id);
    if(d.display==='amoled')assert.equal(saved.elements[0].color,'#23a1f7');
  }
  const p=createProject();p.background='#ff0000';
  assert.equal((await request('/api/projects/'+p.id,p,'PUT')).status,400);
});
