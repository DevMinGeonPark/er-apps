// Offline UI regression: every external request is intercepted; no API server or keys.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const require = createRequire(new URL('../er-agent/map/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const root = resolve('dist'), output = resolve('.cache/night-clerk');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  let pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(root, '.' + pathname);
  if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.jpg':'image/jpeg', '.woff':'font/woff', '.png':'image/png' }[extname(file)] || 'application/octet-stream' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const portrait = await readFile(resolve('docs/lumia-night-clerk-2026-09-10/assets/lumia-art.jpg'));
const characters = [{ id: 1, key: 'Jackie', name: '재키', imageUrl:'/portrait.jpg', archeTypes:['Warrior'], masteries:['TwoHandSword'], skins:[{ id:1,name:'기본 재키',grade:1,imageName:'Jackie_S000',profileUrl:'/portrait.jpg' }] }];
const metadata = { provider:'official', characters, seasons:[{id:41,key:'SEASON_41',name:'시즌 41',isCurrent:1}], areas:[],masteries:[],monsters:[] };
const failures = [], checks = [], externalRequests = [], browserErrors = [], missingFiles = [];
let browser;
try {
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, args:['--no-first-run','--use-mock-keychain','--password-store=basic'] });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.setRequestInterception(true);
  page.on('pageerror', err => browserErrors.push(err.message));
  page.on('response', response => { if (response.url().startsWith(base) && response.status()===404) missingFiles.push(response.url()); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === base || ['data:','blob:'].includes(url.protocol)) { request.continue(); return; }
    externalRequests.push(url.origin + url.pathname);
    const headers = { 'Access-Control-Allow-Origin':'*' };
    if (url.pathname.endsWith('/metadata')) request.respond({ status:200,contentType:'application/json',headers,body:JSON.stringify(metadata) });
    else if (url.pathname.endsWith('/data/characters')) request.respond({status:200,contentType:'application/json',headers,body:JSON.stringify({characters:characters.map(c=>({...c,imageUrl:'//fixture.invalid/portrait.jpg',skins:c.skins.map(s=>({...s,imageUrl:'//fixture.invalid/CharResult_Jackie_S000.jpg'}))}))})});
    else if (request.resourceType()==='image' || /portrait|CharProfile/.test(url.pathname)) request.respond({status:200,contentType:'image/jpeg',headers,body:portrait});
    else if (request.resourceType()==='stylesheet') request.respond({status:200,contentType:'text/css',body:''});
    else request.respond({status:503,contentType:'application/json',headers,body:JSON.stringify({message:'오프라인 검증: 외부 조회는 차단되어 있습니다.'})});
  });
  async function check(label, fn) { try { await fn(); checks.push(label); console.log('PASS',label); } catch(error) { failures.push({label,error:error.message}); console.log('FAIL',label,error.message); } }
  const go = async slug => { await page.goto(base + '/' + (slug ? slug+'/' : ''), {waitUntil:'networkidle0'}); };
  const text = selector => page.$eval(selector, el=>el.textContent);
  async function fill(selector, value) { await page.$eval(selector,(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},value); }
  async function waitState(state) { await page.waitForFunction(state=>document.body.dataset.lumiaState===state, {timeout:6000}, state); }
  await check('all seven routes / responsive widths / no map navigation', async () => {
    for (const slug of ['', 'cert','death','fault','enemy','credit','payroll']) {
      await go(slug);
      for (const width of [360,390,720,768,860,1024,1200,1440]) {
        await page.setViewport({width,height:1000});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${slug||'home'} overflows at ${width}`);
      }
      await page.setViewport({width:720,height:500,deviceScaleFactor:2});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${slug||'home'} overflows at effective 200% zoom`);
      await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});
      assert.equal(await page.$$eval('a[href*="/map"]',els=>els.length),0);
      assert.equal(await page.$$eval(slug?'.lc-art':'.am-art',els=>els.filter(el=>el.complete&&el.naturalWidth>0).length),1);
      await page.screenshot({path:resolve(output,`${slug||'lobby'}-desktop.png`),fullPage:true});
      await page.setViewport({width:390,height:844});
      await page.screenshot({path:resolve(output,`${slug||'lobby'}-mobile.png`),fullPage:true});
    }
  });
  await check('lobby search, empty state, history, nickname and route adapter',async()=>{
    await go(''); await page.click('#am-open');
    assert.equal(await page.$$eval('#am-results button',els=>els.length),6);
    await fill('#am-query','급 여');
    assert.match(await text('#am-results'),/노동청/);
    await fill('#am-query','없는문서'); assert.equal(await page.$eval('#am-empty',el=>el.hidden),false);
    await fill('#am-query','사망'); await page.click('#am-results button');
    assert.match(await text('#am-document-title'),/사망/);
    await fill('#am-nickname','<야간 & 기록관>'); await page.click('#am-detail-back'); await page.waitForFunction(()=>document.querySelector('#lam').dataset.view==='catalog');
    assert.equal(await page.$eval('#am-query',el=>el.value),'사망');
    await page.click('#am-results button');
    await page.click('#am-submit'); await page.waitForFunction(()=>location.pathname==='/death/' && !!document.querySelector('#nick'));
    assert.equal(new URL(page.url()).pathname,'/death/'); assert.equal(new URL(page.url()).search,'');
    assert.equal(await page.$eval('#nick',el=>el.value),'<야간 & 기록관>');
    assert.equal(await page.$eval('#certRoot',el=>el.hidden),true);
    await page.evaluate(()=>history.back()); await page.waitForFunction(()=>location.pathname==='/' && !!document.querySelector('#am-nickname'));
    assert.equal(await page.$eval('#am-nickname',el=>el.value),'<야간 & 기록관>');
    await page.keyboard.press('Escape'); await page.waitForFunction(()=>document.querySelector('#lam').dataset.view==='catalog'); await page.keyboard.press('Escape'); await page.waitForFunction(()=>document.querySelector('#lam').dataset.view==='home');
    assert.equal(await page.$eval('#lam',el=>el.dataset.view),'home');
    assert(await page.$$eval('#am-recent button',els=>els.length)<=3);
  });
  await check('payroll example, real response rendering, missing RP, empty/error, cancel',async()=>{
    await go('payroll'); assert.equal(await page.$eval('#results',el=>el.hidden),true);
    await page.click('#demo'); await waitState('result');
    assert.match(await text('#payslip'),/가상 예시/); assert.match(await text('.net-amount'),/[−-]41/);
    assert.equal(await page.$eval('#share',el=>el.disabled),true);
    await page.evaluate(()=>{ERCore.getMatches=async nickname=>Array.from({length:13},(_,i)=>({gameId:100+i,nickname,matchingMode:3,startDtm:new Date(Date.UTC(2026,8,1,0,i*30)).toISOString(),playTime:1800,mmrGainInGame:27,mmrLossEntryCost:-42,mmrGain:-15,gameRank:6}));});
    await fill('#nickname','합성근로자'); await page.click('#submit'); await waitState('result');
    assert.match(await text('.net-amount'),/[−-]195/); assert.match(await text('#action-status'),/13판/);
    assert.doesNotMatch(await text('#payslip'),/NaN|undefined|Infinity/);
    await page.click('#ledger summary'); assert.equal(await page.$$eval('#ledger-body tr',els=>els.length),13);
    await page.screenshot({path:resolve(output,'payroll-result-mobile.png'),fullPage:true});
    await page.evaluate(()=>{ERCore.getMatches=async()=>{throw new Error('외부 서비스 실패 테스트');};});
    await fill('#nickname','실패'); await page.click('#submit'); await waitState('error'); assert.match(await text('#status'),/이전 결과/);
    await page.evaluate(()=>{ERCore.getMatches=()=>new Promise(resolve=>{window.finishLookup=resolve;});});
    await fill('#nickname','지연'); await page.click('#submit'); await waitState('loading'); await page.keyboard.press('Escape');
    await page.evaluate(()=>finishLookup([{gameId:9,nickname:'늦은응답',matchingMode:3,startDtm:'2026-09-09T12:00:00Z',playTime:600,mmrGain:1,mmrGainInGame:1,mmrLossEntryCost:0,gameRank:1}]));
    assert.doesNotMatch(await text('#payslip'),/늦은응답/); assert.equal(await page.$eval('#submit',el=>el.disabled),false);
    await page.evaluate(()=>{ERCore.getMatches=async()=>[{gameId:9,nickname:'누락',matchingMode:3,startDtm:'2026-09-09T12:00:00Z',playTime:600,mmrGain:null,mmrGainInGame:null,mmrLossEntryCost:0,gameRank:1}];});
    await page.click('#submit'); await waitState('result'); assert.match(await text('.net-amount'),/정산 보류/);
    await page.evaluate(()=>{ERCore.getMatches=async()=>[];}); await page.click('#submit'); await waitState('error'); assert.match(await text('#status'),/랭크 근무 기록/);
  });
  await check('enemy two intake paths, real candidate/observation, no fake realtime, stale cancellation',async()=>{
    await go('enemy');
    await page.evaluate(()=>{
      ER.killers=async name=>({me:name,scanned:3,beastDeaths:1,zoneDeaths:0,killers:[{nickname:'합성상대',count:2,last:{byCharKey:null,byCharName:'재키',placeName:'골목길',modeName:'랭크',startDtm:'2026-09-09T12:00:00Z',gameId:1}}]});
      ER.observe=async enemy=>({target:{nickname:enemy,accountLevel:12,seasonPlays:3,averageKills:2,mmr:0},myDeath:null,chain:null,afterGames:[],fate:{total:null,tone:'silent',text:'조회 범위에서 이후 랭크 기록을 찾지 못했습니다.'}});
    });
    await fill('#meInput','합성본인'); await page.click('#meBtn'); await waitState('result');
    assert.equal(await page.$$('.killer-card').then(els=>els.length),1);
    await page.click('.killer-card'); await page.waitForFunction(()=>!document.querySelector('#obsSec').hidden);
    assert.match(await text('#obsRoot'),/합성상대/); assert.match(await text('#obsRoot'),/이후 랭크 기록/);
    await page.click('#directToggle'); assert.equal(await page.$eval('#meForm',el=>el.hidden),true);
    await fill('#enemyInput','상대직접'); await page.click('#directForm button'); await waitState('result');
    assert.match(await text('#obsRoot'),/상대직접/);
    await page.screenshot({path:resolve(output,'enemy-result-mobile.png'),fullPage:true});
    await page.evaluate(()=>{ER.observe=()=>new Promise(resolve=>{window.finishEnemy=resolve;});});
    await fill('#enemyInput','지연상대'); await page.click('#directForm button'); await waitState('loading');
    await page.click('#directToggle'); await page.evaluate(()=>finishEnemy({target:{nickname:'늦은상대'},afterGames:[],fate:{total:null,tone:'silent',text:'없음'}}));
    assert.equal(await page.$eval('#obsSec',el=>el.hidden),true); assert.equal(await page.$eval('#meBtn',el=>el.disabled),false);
    assert.equal(await page.$eval('#meInput',el=>el.value),'합성본인');
  });
  await check('PNG and print export only payroll document',async()=>{
    await go('payroll'); await page.click('#demo'); await waitState('result');
    const client=await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output,eventsEnabled:true});
    const downloaded=new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('PNG download timed out')),20000);client.on('Browser.downloadProgress',event=>{if(event.state==='completed'){clearTimeout(timer);done();}});});
    await page.click('#save'); await downloaded;
    const bytes=await readFile(resolve(output,'루미아_급여명세서_예시.png')); assert.equal(bytes.subarray(1,4).toString(),'PNG'); assert(bytes.length>10000);
    await page.emulateMediaType('print'); assert.equal(await page.$eval('.lc-clerk',el=>getComputedStyle(el).display),'none');
    await page.pdf({path:resolve(output,'payroll-print.pdf'),format:'A4',printBackground:true}); await page.emulateMediaType('screen');
  });
  // Optional document fixtures are supplied alongside the implementations.
  if (process.env.LUMIA_EXTRA_CHECKS) {
    for (const module of ['./check-night-clerk-death-fault.mjs','./check-night-clerk-cert-credit.mjs','./check-night-clerk-navigation.mjs']) {
      await (await import(module)).checkDocuments({page,go,fill,waitState,check,text,output});
    }
  }
  await check('no browser exceptions or missing local assets',async()=>{assert.deepEqual(browserErrors,[]);assert.deepEqual([...new Set(missingFiles)],[]);});
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(done=>server.close(done));
}
const report={checkedAt:new Date().toISOString(),mode:'offline — external requests intercepted',checks,failures,browserErrors,missingFiles,interceptedExternalRequests:externalRequests.length};
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(failures.length) process.exitCode=1;
