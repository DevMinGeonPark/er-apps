// Offline play-style UI checks. Every non-local request is blocked before transport.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const require = createRequire(new URL('../er-agent/map/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const root = resolve('dist');
const output = resolve('.cache/lumia-type');
const storageKey = 'lumia.type.v1';
const checks = [], failures = [], browserErrors = [], missingFiles = [], blockedRequests = [], apiAttempts = [];
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); response.end(); return; }
  if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(root, '.' + pathname);
  if (!file.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json',
    }[extname(file)] || 'application/octet-stream' });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;

async function preparePage(page) {
  page.setDefaultTimeout(6000);
  page.setDefaultNavigationTimeout(15000);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  // Even an accidental automatic share/print in the app must never open OS UI.
  await page.evaluateOnNewDocument(() => {
    window.lumiaNativeShareCalls = [];
    window.lumiaNativeCanShare = true;
    window.lumiaNativeShareError = null;
    window.lumiaPrintCalls = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => window.lumiaNativeCanShare });
    Object.defineProperty(navigator, 'share', { configurable: true, value: payload => {
      window.lumiaNativeShareCalls.push(payload);
      return window.lumiaNativeShareError
        ? Promise.reject(new DOMException('Offline native share fixture', window.lumiaNativeShareError))
        : Promise.resolve();
    } });
    window.print = () => {
      const sheet = document.querySelector('.type-print-sheet');
      const image = sheet?.querySelector('.type-print-image');
      window.lumiaPrintCalls.push({
        src: image?.src, complete: image?.complete, width: image?.naturalWidth, height: image?.naturalHeight,
        hasSheet: !!sheet,
      });
    };
  });
  await page.setRequestInterception(true);
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('dialog', async dialog => {
    browserErrors.push(`Unexpected ${dialog.type()} dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  page.on('response', response => {
    if (response.url().startsWith(base) && response.status() === 404) missingFiles.push(response.url());
  });
  page.on('request', request => {
    const url = new URL(request.url());
    const inMemory = ['data:', 'blob:'].includes(url.protocol);
    const localPortrait = url.origin === base && /^\/type\/art\/[01]{4}\.png$/.test(url.pathname);
    const isApi = !inMemory && (/\/api(?:\/|$)/.test(url.pathname)
      || (['fetch', 'xhr'].includes(request.resourceType()) && !localPortrait));
    if (isApi) apiAttempts.push(url.origin + url.pathname);
    if (inMemory || (url.origin === base && !isApi)) {
      request.continue();
    } else {
      blockedRequests.push({ url: url.origin + url.pathname, kind: request.resourceType() });
      request.abort('blockedbyclient');
    }
  });
}
async function check(label, work) {
  try { await work(); checks.push(label); console.log('PASS', label); }
  catch (error) { failures.push({ label, error: error.message }); console.error('FAIL', label, error.message); }
}
async function go(page, suffix = '') {
  await page.goto(base + '/type/' + suffix, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#type-start');
}
async function stage(page, expected) {
  await page.waitForFunction(expected => document.body.dataset.typeStage === expected, { timeout: 6000 }, expected);
}
async function fill(page, selector, value) {
  await page.$eval(selector, (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function text(page, selector) { return page.$eval(selector, element => element.textContent); }
async function snapshotProgress(page) {
  return page.evaluate(key => ({ local: localStorage.getItem(key), session: sessionStorage.getItem(key) }), storageKey);
}
async function reset(page) {
  await go(page);
  await page.evaluate(key => { localStorage.removeItem(key); sessionStorage.removeItem(key); LumiaContext.setNickname(''); }, storageKey);
  await page.reload({ waitUntil: 'networkidle0' });
  await stage(page, 'intro');
}
async function answer(page, value) {
  await page.$eval(`[name="type-answer"][value="${value}"]`, element => element.click());
}
async function finishQuiz(page, answers = Array(12).fill(0)) {
  for (let index = 0; index < 12; index++) {
    await stage(page, 'question');
    await answer(page, answers[index]);
    await page.click('#type-next');
  }
  await stage(page, 'result');
}
async function finishWithAxisCounts(page, leftCount, rightCount) {
  assert.equal(leftCount + rightCount, 3);
  const answers = await page.evaluate(leftCount => {
    const occurrence = Array(4).fill(0);
    return LumiaType.questions.map(question => {
      const wantedPole = occurrence[question.axis]++ < leftCount ? 0 : 1;
      return question.choices.findIndex(choice => choice.pole === wantedPole);
    });
  }, leftCount);
  assert(answers.every(answer => answer === 0 || answer === 1), 'each question must offer both axis poles');
  await page.click('#type-start');
  await finishQuiz(page, answers);
}
async function axisSnapshot(page) {
  return page.$$eval('#type-axis-list .type-axis', elements => elements.map(element => {
    const chart = element.querySelector('.type-axis-chart');
    const track = chart?.querySelector('.type-axis-track');
    const value = chart?.querySelector('.type-axis-value');
    const rect = element.getBoundingClientRect();
    return {
      left: element.getAttribute('data-count-left'), right: element.getAttribute('data-count-right'),
      unmeasured: chart?.classList.contains('is-unmeasured'), role: chart?.getAttribute('role'),
      aria: chart?.getAttribute('aria-label'), center: element.querySelector('.type-axis-center strong')?.textContent,
      detail: element.querySelector('.type-axis-detail')?.textContent,
      dominantKeys: element.querySelectorAll('.type-axis-key.is-dominant').length,
      dominantColor: getComputedStyle(element.querySelector('.type-axis-key.is-dominant')).backgroundColor,
      arcCount: chart?.querySelectorAll('circle.type-axis-value').length,
      pathLength: value?.getAttribute('pathLength'), dash: value?.getAttribute('stroke-dasharray'),
      arcColor: value ? getComputedStyle(value).stroke : null,
      trackDash: track ? getComputedStyle(track).strokeDasharray : null,
      box: { x: rect.x, y: rect.y, width: rect.width },
    };
  }));
}
async function captureAxes(page, label) {
  for (const width of [360, 1440]) {
    await page.setViewport({ width, height: width === 360 ? 844 : 1000 });
    await noOverflow(page, `${label} ${width}`);
    const axes = await axisSnapshot(page);
    assert.equal(axes.length, 4);
    assert(Math.abs(axes[0].box.y - axes[1].box.y) < 2, `${label} ${width}: first two donuts must share a row`);
    assert(Math.abs(axes[2].box.y - axes[3].box.y) < 2, `${label} ${width}: last two donuts must share a row`);
    assert(axes[1].box.x > axes[0].box.x && axes[2].box.y > axes[0].box.y, `${label} ${width}: axes must form a 2 by 2 grid`);
    await (await page.$('#type-axis-list')).screenshot({ path: resolve(output, `axes-${label}-${width}.png`) });
  }
}
async function noOverflow(page, label) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: horizontal overflow`);
}
async function pngPixelFingerprint(page, source) {
  return page.evaluate(async source => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    return { width: canvas.width, height: canvas.height, digest: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  }, source);
}
async function downloadPng(page) {
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output, eventsEnabled: true });
  let filename, guid, timer;
  const downloaded = new Promise((done, reject) => {
    timer = setTimeout(() => reject(new Error('PNG download did not complete within 25 seconds')), 25000);
    client.on('Browser.downloadWillBegin', event => { filename = event.suggestedFilename; guid = event.guid; });
    client.on('Browser.downloadProgress', event => {
      if (guid && event.guid !== guid) return;
      if (event.state === 'completed') { clearTimeout(timer); done(); }
      if (event.state === 'canceled') { clearTimeout(timer); reject(new Error('PNG download was canceled')); }
    });
  });
  try {
    await page.click('#type-png');
    await downloaded;
    assert(filename?.endsWith('.png'), 'download must use a PNG filename');
    const bytes = await readFile(resolve(output, filename));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert(bytes.length > 10000, `PNG is too small to contain the result (${bytes.length} bytes)`);
    assert(bytes.readUInt32BE(16) >= 300 && bytes.readUInt32BE(20) >= 300, 'PNG must contain a readable document');
    return { filename, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } finally { clearTimeout(timer); await client.detach(); }
}

const artifacts = [];
try {
  await readFile(resolve(root, 'type/index.html'));
  browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--no-first-run', '--use-mock-keychain', '--password-store=basic'],
  });
  const page = await browser.newPage();
  await preparePage(page);

  await check('12 questions require explicit next, preserve previous answers, and resume after reload', async () => {
    await reset(page);
    await fill(page, '#type-nickname', '검증기록관');
    await page.click('#type-start');
    await stage(page, 'question');
    const firstQuestion = await text(page, '#type-question-title');
    assert.equal(await page.$$eval('[name="type-answer"]', elements => elements.length), 2);
    assert.equal(await page.$eval('#type-next', element => element.disabled), true);
    await answer(page, 1);
    assert.equal(await text(page, '#type-question-title'), firstQuestion, 'selecting an answer must not auto-advance');
    await page.click('#type-next');
    const secondQuestion = await text(page, '#type-question-title');
    assert.notEqual(secondQuestion, firstQuestion);
    await answer(page, 0);
    await page.click('#type-prev');
    assert.equal(await text(page, '#type-question-title'), firstQuestion);
    assert.equal(await page.$eval('[name="type-answer"]:checked', element => element.value), '1');
    await page.click('#type-next');
    assert.equal(await text(page, '#type-question-title'), secondQuestion);
    assert.equal(await page.$eval('[name="type-answer"]:checked', element => element.value), '0');
    const beforeReload = await snapshotProgress(page);
    assert(beforeReload.local || beforeReload.session, 'in-progress answers must be stored');
    await page.reload({ waitUntil: 'networkidle0' });
    if (await page.evaluate(() => document.body.dataset.typeStage === 'intro')) await page.click('#type-start');
    await stage(page, 'question');
    assert.equal(await text(page, '#type-question-title'), secondQuestion);
    assert.equal(await page.$eval('[name="type-answer"]:checked', element => element.value), '0');
    for (let index = 1; index < 12; index++) {
      await answer(page, index % 2);
      await page.click('#type-next');
    }
    await stage(page, 'result');
    assert.match(await text(page, '#type-profile'), /검증기록관/);
    assert.doesNotMatch(await text(page, '#type-profile'), /undefined|NaN|Infinity/);
  });

  await check('introduction offers restart only for saved answers and resets to unanswered question one', async () => {
    await reset(page);
    assert.equal(await page.$eval('#type-reset-progress', element => element.hidden), true);
    await page.click('#type-start');
    await stage(page, 'question');
    const firstQuestion = await text(page, '#type-question-title');
    await answer(page, 0);
    await page.click('#type-next');
    await answer(page, 1);
    await page.click('#type-pause');
    await stage(page, 'intro');
    assert.equal(await page.$eval('#type-reset-progress', element => element.hidden), false);
    await page.click('#type-reset-progress');
    await stage(page, 'question');
    assert.equal(await text(page, '#type-question-title'), firstQuestion);
    assert.equal(await page.$$eval('[name="type-answer"]:checked', elements => elements.length), 0);
    assert.equal(await page.$eval('#type-next', element => element.disabled), true);
    const saved = await snapshotProgress(page);
    const progress = JSON.parse(saved.local || saved.session);
    assert.equal(progress.index, 0);
    assert.equal(progress.completed, false);
    assert.deepEqual(progress.answers, Array(12).fill(null));
  });

  await check('measured donut charts show actual 2:1, 3:0, and 0:3 choices with labels and a 2 by 2 layout', async () => {
    for (const [left, right] of [[2, 1], [3, 0], [0, 3]]) {
      await reset(page);
      await finishWithAxisCounts(page, left, right);
      const names = await page.evaluate(() => LumiaType.axes.map(axis => axis.poles));
      const axes = await axisSnapshot(page);
      assert.equal(axes.length, 4);
      axes.forEach((axis, index) => {
        const pole = left > right ? 0 : 1;
        assert.equal(axis.left, String(left));
        assert.equal(axis.right, String(right));
        assert.equal(axis.unmeasured, false);
        assert.equal(axis.arcCount, 1);
        assert.equal(axis.pathLength, '100');
        const [amount, circumference] = axis.dash.split(/[\s,]+/).map(Number);
        assert(Math.abs(amount - Math.max(left, right) / 3 * 100) < 0.000001, `${left}:${right} arc must show the actual dominant count`);
        assert.equal(circumference, 100);
        assert.equal(axis.center, names[index][pole]);
        assert.equal(axis.role, 'img');
        assert(axis.aria.includes(`${names[index][0]} ${left}회`));
        assert(axis.aria.includes(`${names[index][1]} ${right}회`));
        assert(axis.detail.includes(`${names[index][0]} ${left}회`));
        assert(axis.detail.includes(`${names[index][1]} ${right}회`));
        assert.equal(axis.dominantKeys, 1);
        assert.equal(axis.dominantColor, axis.arcColor, 'dominant legend color must match the measured arc');
      });
      await captureAxes(page, `${left}-${right}`);
    }
  });

  await check('all 16 shared result types are distinct and never overwrite saved progress', async () => {
    await reset(page);
    await page.click('#type-start');
    await answer(page, 1);
    await page.click('#type-next');
    const saved = await snapshotProgress(page);
    const profiles = new Set();
    for (let index = 0; index < 16; index++) {
      const code = index.toString(2).padStart(4, '0');
      await go(page, '#type=' + code);
      await stage(page, 'result');
      assert.equal(await page.$eval('#type-profile', element => element.dataset.code), code);
      assert.match((await text(page, '#type-code')).trim(), /^\d{2}\s*\/\s*16$/, 'the visible type label must use the user-facing document number');
      assert.equal(await page.$$eval('#type-profile .type-axis', elements => elements.length), 4);
      const sharedAxes = await axisSnapshot(page);
      sharedAxes.forEach(axis => {
        assert.equal(axis.left, null);
        assert.equal(axis.right, null);
        assert.equal(axis.unmeasured, true);
        assert.equal(axis.arcCount, 0, 'a shared type must never fabricate measured arc proportions');
        assert(axis.trackDash && axis.trackDash !== 'none', 'unknown proportions use a dotted outline');
        assert.doesNotMatch(axis.detail, /\d+\s*회/);
      });
      const profile = (await text(page, '#type-profile')).trim();
      assert(profile.length > 100, `${code}: result profile must contain explanations`);
      assert.doesNotMatch(profile, /undefined|NaN|Infinity/);
      profiles.add(profile);
      assert.deepEqual(await snapshotProgress(page), saved, `${code}: shared result replaced my saved answers`);
    }
    assert.equal(profiles.size, 16, 'all sixteen codes must render distinct profiles');
    await captureAxes(page, 'shared');
    await page.$eval('#type-catalog', element => { element.open = true; });
    assert.equal(await page.$$eval('#type-catalog [data-type]', elements => elements.length), 16);
    await page.click('#type-catalog [data-type="0101"]');
    assert.equal(await page.$eval('#type-profile', element => element.dataset.code), '0101');
    assert.deepEqual(await snapshotProgress(page), saved, 'catalog exploration must not replace my answers');
    await go(page);
    if (await page.evaluate(() => document.body.dataset.typeStage === 'intro')) await page.click('#type-start');
    await stage(page, 'question');
    assert.deepEqual(await snapshotProgress(page), saved, 'returning from a shared result must retain my question position');
  });

  await check('all sixteen result portraits and catalog thumbnails use distinct local type artwork', async () => {
    const fingerprints = new Set();
    for (let index = 0; index < 16; index++) {
      const code = index.toString(2).padStart(4, '0');
      const bytes = await readFile(resolve(root, 'type/art', code + '.png'));
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${code}: portrait must be a PNG file`);
      assert(bytes.length > 10000, `${code}: portrait must contain real artwork`);
      fingerprints.add(createHash('sha256').update(bytes).digest('hex'));
      await go(page, '#type=' + code);
      await stage(page, 'result');
      await page.waitForFunction(() => {
        const portrait = document.querySelector('#type-portrait');
        return portrait?.complete && portrait.naturalWidth > 0;
      });
      const portrait = await page.$eval('#type-portrait', image => ({
        path: new URL(image.currentSrc || image.src).pathname, width: image.naturalWidth,
        height: image.naturalHeight, alt: image.alt, inProfile: !!image.closest('#type-profile'),
      }));
      assert.equal(portrait.path, `/type/art/${code}.png`);
      assert(portrait.width >= 200 && portrait.height >= 200, `${code}: portrait resolution must be usable`);
      assert.equal(portrait.inProfile, true);
    }
    assert.equal(fingerprints.size, 16, 'different type codes must not reuse one placeholder portrait');
    await page.$eval('#type-catalog', element => { element.open = true; });
    const thumbnails = await page.$$eval('#type-catalog [data-type]', buttons => buttons.map(button => ({
      code: button.dataset.type,
      path: button.querySelector('img') ? new URL(button.querySelector('img').src).pathname : null,
    })));
    assert.equal(thumbnails.length, 16);
    thumbnails.forEach(thumbnail => assert.equal(thumbnail.path, `/type/art/${thumbnail.code}.png`));
  });

  await check('invalid shared hashes do not create a result or overwrite saved answers', async () => {
    await reset(page);
    await page.click('#type-start');
    await answer(page, 0);
    const saved = await snapshotProgress(page);
    for (const hash of ['#type=000', '#type=00000', '#type=2222', '#type=abcd', '#type=%3Cscript%3E', '#type=0000extra']) {
      await go(page, hash);
      assert.notEqual(await page.evaluate(() => document.body.dataset.typeStage), 'result', hash);
      assert.deepEqual(await snapshotProgress(page), saved, `${hash}: invalid hash changed saved answers`);
    }
  });

  await check('two and three member teams support identical types and show a useful comparison', async () => {
    await go(page, '#type=0000');
    await stage(page, 'result');
    const choices = await page.$$eval('#type-friend-one option', options => options.filter(option => /^[01]{4}$/.test(option.value)).map(option => option.value));
    assert.equal(new Set(choices).size, 16);
    await page.select('#type-friend-one', '0000');
    await page.click('#type-team-submit');
    assert.equal(await page.$eval('#type-team-result', element => element.hidden), false);
    const duo = await text(page, '#type-team-result');
    assert.match(await text(page, '#type-team-result .type-team-role:first-of-type h5'), /^기준 유형\s*·/, 'shared result must identify its first member as the reference type');
    assert(duo.trim().length > 50, 'same-type duo must have a written interpretation');
    assert.doesNotMatch(duo, /undefined|NaN|Infinity/);
    await page.select('#type-friend-two', '0000');
    await page.click('#type-team-submit');
    const sameTrio = await text(page, '#type-team-result');
    assert(sameTrio.trim().length > 50);
    assert.notEqual(sameTrio, duo, 'adding a third identical member must update the team result');
    await page.select('#type-friend-one', '1111');
    await page.select('#type-friend-two', '0101');
    await page.click('#type-team-submit');
    assert.notEqual(await text(page, '#type-team-result'), sameTrio);
    assert.doesNotMatch(await text(page, '#type-team-result'), /undefined|NaN|Infinity/);
  });

  await check('copy failure reveals a selectable result URL and PNG is an actual document image', async () => {
    await go(page, '#type=0101');
    await stage(page, 'result');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async () => { throw new DOMException('Offline clipboard denial fixture', 'NotAllowedError'); },
      } });
    });
    await page.click('#type-copy');
    await page.waitForFunction(() => {
      const input = document.querySelector('#type-share-link');
      return input && !input.hidden && input.getBoundingClientRect().height > 0;
    });
    const link = new URL(await page.$eval('#type-share-link', element => element.value));
    assert.equal(link.origin, base);
    assert.equal(link.pathname, '/type/');
    assert.match(link.hash, /^#type=[01]{4}$/);
    assert.equal(await page.$eval('#type-share-link', element => element.readOnly), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'type-share-link');
    artifacts.push(await downloadPng(page));
  });

  await check('native sharing is invoked only by a click and shares a local PNG or a type-only URL', async () => {
    await go(page, '#type=0101');
    await stage(page, 'result');
    assert.equal(await page.evaluate(() => lumiaNativeShareCalls.length), 0, 'preparing a result must never open a share sheet');
    await page.waitForFunction(() => LumiaTypeShare.getState(LumiaType.getType('0101'), '', null).ready, { timeout: 25000 });
    await page.waitForFunction(() => !document.querySelector('#type-share').disabled);
    await page.click('#type-share');
    await page.waitForFunction(() => lumiaNativeShareCalls.length === 1);
    const sharedFile = await page.evaluate(async () => {
      const payload = lumiaNativeShareCalls[0];
      const file = payload.files?.[0];
      return {
        title: payload.title, text: payload.text, url: payload.url,
        files: payload.files?.length || 0, name: file?.name, mime: file?.type, bytes: file?.size,
        signature: file ? [...new Uint8Array(await file.slice(0, 8).arrayBuffer())] : [],
      };
    });
    assert.equal(sharedFile.files, 1);
    assert.equal(sharedFile.mime, 'image/png');
    assert(sharedFile.bytes > 10000);
    assert.deepEqual(sharedFile.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.match(sharedFile.name, /^lumia-type-[01]{4}\.png$/);
    const url = new URL(sharedFile.url);
    assert.equal(url.origin, base);
    assert.equal(url.pathname, '/type/');
    assert.equal(url.search, '');
    assert.equal(url.hash, '#type=0101');

    await page.evaluate(() => { lumiaNativeCanShare = false; });
    await page.click('#type-share');
    await page.waitForFunction(() => lumiaNativeShareCalls.length === 2);
    assert.equal(await page.evaluate(() => lumiaNativeShareCalls[1].files?.length || 0), 0, 'unsupported file sharing must fall back to a type URL');
    assert.equal(await page.evaluate(() => lumiaNativeShareCalls[1].url), sharedFile.url);

    await page.evaluate(() => { lumiaNativeShareError = 'AbortError'; });
    await page.click('#type-share');
    await page.waitForFunction(() => lumiaNativeShareCalls.length === 3);
    await page.waitForFunction(() => document.querySelector('#type-status').textContent.includes('취소'));
    assert.equal(await page.$eval('#type-share', element => element.disabled), false);
  });

  await check('one PDF click prepares the same art-and-donut card as PNG and prints one A4 page', async () => {
    await reset(page);
    await fill(page, '#type-nickname', '인쇄검증기록관');
    await finishWithAxisCounts(page, 2, 1);
    await page.waitForFunction(() => document.querySelector('#type-portrait')?.complete && document.querySelector('#type-portrait').naturalWidth > 0);
    const png = await downloadPng(page);
    const pngBytes = await readFile(resolve(output, png.filename));
    assert.equal(await page.evaluate(() => lumiaPrintCalls.length), 0, 'result rendering must not print automatically');
    await page.waitForFunction(() => !document.querySelector('#type-pdf').disabled, { timeout: 25000 });
    await page.click('#type-pdf');
    await page.waitForFunction(() => lumiaPrintCalls.length === 1, { timeout: 25000 });
    const printed = await page.evaluate(() => lumiaPrintCalls[0]);
    assert.equal(printed.hasSheet, true);
    assert.equal(printed.complete, true, 'the print image must finish decoding before print()');
    assert(printed.width >= 300 && printed.height >= 300);
    assert.match(printed.src, /^data:image\/png;base64,/);
    assert.deepEqual(await pngPixelFingerprint(page, printed.src),
      await pngPixelFingerprint(page, 'data:image/png;base64,' + pngBytes.toString('base64')),
      'PDF and PNG must use the same complete result card');
    await page.emulateMediaType('print');
    try {
      assert.equal(await page.$eval('.type-print-sheet', element => getComputedStyle(element).display === 'none'), false);
      assert.equal(await page.$eval('.lc-clerk', element => getComputedStyle(element).display), 'none');
      assert.equal(await page.$eval('.lc-header', element => getComputedStyle(element).display), 'none');
      const pdfName = 'lumia-type-print.pdf';
      await page.pdf({ path: resolve(output, pdfName), format: 'A4', printBackground: true, preferCSSPageSize: true });
      const pdf = await readFile(resolve(output, pdfName));
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert(pdf.length > 10000);
      assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1, 'the result card must fit on one PDF page');
      const box = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      assert(box && Math.abs(Number(box[1]) - 595.28) < 2 && Math.abs(Number(box[2]) - 841.89) < 2, 'PDF must use A4 page dimensions');
      artifacts.push(png, { filename: pdfName, bytes: pdf.length, pages: 1 });
    } finally { await page.emulateMediaType('screen'); }
    assert.equal(await page.evaluate(() => lumiaPrintCalls.length), 1, 'PDF preparation must not require another button click');
  });

  await check('nickname text is escaped in result and never interpreted as markup', async () => {
    await reset(page);
    const nickname = '<img src=x onerror=alert(1)>';
    await fill(page, '#type-nickname', nickname);
    await page.click('#type-start');
    await finishQuiz(page);
    const profile = await text(page, '#type-profile');
    assert(profile.includes(nickname), 'result must display the supplied nickname as text');
    assert.equal(await page.$$eval('#type-profile [onerror], #type-profile script, #type-profile img[src="x"]', elements => elements.length), 0);
    assert.equal(new URL(page.url()).search, '', 'nickname must not leak into query parameters');
  });

  await check('360/390/768/1440 reflow keeps introduction, question, result, and team usable', async () => {
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewport({ width, height: width < 768 ? 844 : 1000 });
      await reset(page);
      await noOverflow(page, `intro ${width}`);
      await page.screenshot({ path: resolve(output, `intro-${width}.png`), fullPage: true });
      await page.click('#type-start');
      await stage(page, 'question');
      await noOverflow(page, `question ${width}`);
      await page.screenshot({ path: resolve(output, `question-${width}.png`), fullPage: true });
      await go(page, '#type=1111');
      await stage(page, 'result');
      await noOverflow(page, `result ${width}`);
      await page.select('#type-friend-one', '1111');
      await page.select('#type-friend-two', '0000');
      await page.click('#type-team-submit');
      await noOverflow(page, `team ${width}`);
      await page.screenshot({ path: resolve(output, `result-team-${width}.png`), fullPage: true });
    }
  });

  await check('blocked local and session storage still allows a full in-memory quiz', async () => {
    const isolated = await browser.createBrowserContext();
    const denied = await isolated.newPage();
    await preparePage(denied);
    await denied.evaluateOnNewDocument(() => {
      for (const key of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, key, { configurable: true, get() { throw new DOMException('Storage denied fixture', 'SecurityError'); } });
      }
    });
    try {
      await go(denied);
      await fill(denied, '#type-nickname', '저장없이검증');
      await denied.click('#type-start');
      await finishQuiz(denied, Array(12).fill(1));
      assert.match(await text(denied, '#type-profile'), /저장없이검증/);
      assert.doesNotMatch(await text(denied, '#type-profile'), /undefined|NaN|Infinity/);
    } finally { await isolated.close(); }
  });

  await check('lobby search, pagination, and common document navigation include the new test', async () => {
    await page.goto(base + '/', { waitUntil: 'networkidle0' });
    await page.click('#am-open');
    await fill(page, '#am-query', '플레이 성향');
    assert.equal(await page.$$eval('#am-results button', elements => elements.length), 1);
    assert.equal(await page.$eval('#am-results button', element => element.dataset.document),
      await page.evaluate(() => LumiaDocuments.find(item => item.href === '/type/').id));
    await page.click('#am-results button');
    await page.click('#am-submit');
    await page.waitForFunction(() => location.pathname === '/type/' && !!document.querySelector('#type-start'));
    const selected = await page.$eval('#lc-document-select', element => element.value);
    assert(selected);
    assert.equal(await page.evaluate(() => LumiaDocuments.find(item => item.href === '/type/').id), selected);
    await page.select('#lc-document-select', 'payroll');
    await page.waitForFunction(() => location.pathname === '/payroll/' && !!document.querySelector('#payroll-form'));
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => location.pathname === '/type/' && !!document.querySelector('#type-start'));
    assert.equal(await page.$eval('#lc-document-select', element => element.value), selected);
    await page.goto(base + '/', { waitUntil: 'networkidle0' });
    await page.click('#am-open');
    const resultCount = await page.evaluate(() => LumiaDocuments.length);
    assert(resultCount >= 7);
    assert.equal(await page.$$eval('#am-results button', elements => elements.length), 6);
    assert.equal(await page.$eval('#am-next', element => element.disabled), false);
    await page.click('#am-next');
    assert(await page.$$eval('#am-results button', elements => elements.length) >= 1);
    assert.equal(await page.$$eval('a[href*="/map"]', elements => elements.length), 0);
  });

  await check('no runtime exceptions, missing local assets, or player/API requests', async () => {
    assert.deepEqual(browserErrors, []);
    assert.deepEqual([...new Set(missingFiles)], []);
    assert.deepEqual(apiAttempts, []);
  });
} catch (error) {
  failures.push({ label: 'harness initialization', error: error.message });
  console.error(error.message);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
const report = {
  checkedAt: new Date().toISOString(), mode: 'offline — every external request blocked',
  checks, failures, browserErrors, missingFiles, blockedRequests, apiAttempts, artifacts,
};
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
