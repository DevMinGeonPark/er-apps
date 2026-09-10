// Synthetic browser coverage only. The parent harness intercepts every external request.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/lumia-cert-credit.json', import.meta.url), 'utf8'));

export async function checkDocuments({ page, go, fill, waitState, check, text, output }) {
  async function installFixtures() {
    await page.evaluate(data => {
      window.lumiaFixtures = data;
      window.lumiaCalls = { certificate: 0, ledger: 0, report: 0 };
      const portrait = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="178" height="178"><rect width="178" height="178" fill="#a6babc"/><text x="50" y="90">Fixture</text></svg>');
      DAK.charImgUrl = () => portrait;
      DAK.skinImgUrl = () => portrait;
      DAK.getCharacters = async () => structuredClone(data.characters);
      DAK.issueCertificate = async name => { window.lumiaCalls.certificate++; const value = structuredClone(data.certificate); value.player.name = name; return value; };
      DAK.report = async name => { window.lumiaCalls.ledger++; const value = structuredClone(data.creditTable); value.player.name = name; return value; };
      DAK.credit = async (name, cid) => { window.lumiaCalls.report++; const value = structuredClone(Number(cid) === 3 ? data.thinFileReport : data.creditReport); value.player.name = name; return value; };
    }, fixtures);
  }

  await check('certificate collapsed selector, keyboard controls, skin/templates and full evidence', async () => {
    await go('cert');
    await installFixtures();
    await page.evaluate(async () => { DAK.getCharacters = async () => { throw new Error('metadata fixture unavailable'); }; await loadCharacters(); });
    assert.equal(await page.$eval('#characters-retry', el => el.hidden), false);
    assert.match(await text('#character-error'), /불러오지 못/);
    await page.evaluate(() => { DAK.getCharacters = async () => structuredClone(lumiaFixtures.characters); });
    await page.click('#characters-retry');
    await page.waitForFunction(() => document.querySelectorAll('.char-cell').length === 3);
    await page.evaluate(() => loadCharacters());
    assert.equal(await page.$eval('#character-picker', el => el.hidden), true);
    await fill('#nickname', '합성자격검증');
    assert.equal(await page.$eval('#issue-btn', el => el.disabled), true);
    await page.click('#character-toggle');
    await fill('#char-search', '재키');
    assert.equal(await page.$$('.char-cell').then(items => items.length), 1);
    await page.focus('.char-cell'); await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#character-picker', el => el.hidden), true);
    assert.match(await text('#selected-character'), /재키/);
    await page.click('.skin-cell:nth-child(2)');
    await page.click('#form-section [data-style="classic"]');
    await page.click('#issue-btn'); await waitState('result');
    assert.match(await text('#cert-wrap'), /합성자격검증/);
    assert.match(await text('#cert-wrap'), /시험용 스킨/);
    assert.match(await text('#cert-wrap'), /산업기사/);
    await page.click('#cert-section [data-style="aglaia"]');
    assert.equal(await page.evaluate(() => lumiaCalls.certificate), 1, 'template change must not query records');
    assert.match(await text('#cert-wrap'), /연구소장/);
    await page.click('.evidence summary');
    assert.match(await text('#season-detail'), /랭크/); assert.match(await text('#season-detail'), /코발트/);
    assert.match(await text('#season-detail'), /시즌 8/); assert.match(await text('#season-detail'), /1건 조회 실패/);
    for (const width of [360, 720, 1440]) {
      await page.setViewport({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.screenshot({ path: resolve(output, 'cert-result-desktop.png'), fullPage: true });
  });

  await check('certificate document-only PNG export with local fonts', async () => {
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output, eventsEnabled: true });
    const downloaded = new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Certificate PNG timed out')), 20000);
      client.on('Browser.downloadProgress', event => { if (event.state === 'completed') { clearTimeout(timer); done(); } });
    });
    await page.click('#download-btn'); await downloaded;
    const bytes = await readFile(resolve(output, 'ER자격증_합성자격검증_재키.png'));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert(bytes.length > 10000);
    await client.detach();
  });

  await check('certificate insufficient records, retry, portrait failure and stale cancellation', async () => {
    await page.click('#again-btn');
    assert.equal(await page.$eval('#nickname', el => el.value), '합성자격검증');
    await page.evaluate(() => { DAK.issueCertificate = async () => ({ ...structuredClone(lumiaFixtures.certificate), charStats: { play: 0 } }); });
    await page.click('#issue-btn'); await waitState('error');
    assert.equal(await page.$eval('#cert-section', el => el.hidden), true);
    assert.match(await text('#form-error'), /자료 부족/);
    await page.evaluate(() => { DAK.issueCertificate = async () => { throw new Error('플레이어를 찾을 수 없습니다. 닉네임을 확인해주세요.'); }; });
    await page.click('#issue-btn'); await waitState('error');
    assert.equal(await page.$eval('#nickname', el => el.getAttribute('aria-invalid')), 'true');
    await page.evaluate(() => { DAK.issueCertificate = () => new Promise(resolve => { window.finishCertificate = resolve; }); });
    await page.click('#issue-btn'); await waitState('loading');
    await page.click('#cancel-btn'); await waitState('intake');
    await page.evaluate(() => finishCertificate(lumiaFixtures.certificate));
    assert.equal(await page.$eval('#cert-section', el => el.hidden), true);
    await page.evaluate(() => {
      DAK.issueCertificate = async () => structuredClone(lumiaFixtures.certificate);
      DAK.skinImgUrl = () => 'https://fixture.invalid/unavailable-image';
    });
    await page.click('#issue-btn'); await waitState('result');
    await page.waitForFunction(() => !document.querySelector('#portrait-notice').hidden);
    assert.match(await text('#cert-wrap'), /재키/);
    assert.match(await text('#portrait-notice'), /실험체 이름/);
  });

  await check('credit accessible empty input, ledger client sort, detailed report and Thin File', async () => {
    await go('credit'); await installFixtures();
    await fill('#name', ''); await page.click('#form button');
    assert.equal(await page.$eval('#name', el => el.getAttribute('aria-invalid')), 'true');
    await fill('#name', '합성신용검증'); await page.click('#form button'); await waitState('result');
    assert.match(await text('#table-view'), /합성신용검증/);
    assert.match(await text('#table-view'), /자료 부족 1종/);
    await page.click('[data-sort="name"]');
    assert.equal(await page.evaluate(() => lumiaCalls.ledger), 1);
    assert.match(await text('.row-link:first-child'), /리오/);
    await page.click('[data-report="1"]');
    await page.waitForFunction(() => !document.querySelector('#report-view').hidden);
    assert.match(await text('#report-view'), /840점 \/ 1000점/);
    assert.match(await text('#report-view'), /연체 기록/);
    assert.match(await text('#report-view'), /본인 전체 평균/);
    assert.match(await text('#report-view'), /이 브라우저/);
    await page.click('#back');
    await page.waitForFunction(() => !document.querySelector('#table-view').hidden);
    await page.click('[data-report="3"]');
    await page.waitForFunction(() => !document.querySelector('#report-view').hidden);
    assert.match(await text('#report-view'), /평가불가/);
    assert.match(await text('#report-view'), /보류/); assert.match(await text('#report-view'), /보증인/);
    assert.doesNotMatch(await text('.big-grade'), /0점|null|F등급/);
    assert.equal(await page.$$('.gauge').then(items => items.length), 0);
    for (const width of [360, 768, 1440]) {
      await page.setViewport({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(output, 'credit-thin-file-mobile.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#table-view').hidden);
    assert.equal(await page.evaluate(() => document.body.dataset.lumiaState), 'result');
  });

  await check('credit single-report print, retry and canceled responses', async () => {
    await page.click('[data-report="1"]');
    await page.waitForFunction(() => !document.querySelector('#report-view').hidden);
    await page.evaluate(() => { window.print = () => { window.dispatchEvent(new Event('beforeprint')); window.lumiaPrinted = true; }; });
    await page.click('#print-report'); await page.waitForFunction(() => window.lumiaPrinted);
    assert(await page.$$eval('#report-view details', items => items.every(item => item.open)));
    await page.emulateMediaType('print');
    assert.equal(await page.$eval('.lc-clerk', el => getComputedStyle(el).display), 'none');
    assert.equal(await page.$eval('.search-card', el => getComputedStyle(el).display), 'none');
    assert.equal(await page.$eval('#table-view', el => getComputedStyle(el).display), 'none');
    await page.pdf({ path: resolve(output, 'credit-report-print.pdf'), format: 'A4', printBackground: true });
    await page.emulateMediaType('screen');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.evaluate(() => { DAK.report = async () => { throw new Error('외부 서비스 응답 실패'); }; });
    await fill('#name', '실패검증'); await page.click('#form button'); await waitState('error');
    assert.equal(await page.$eval('#retry', el => el.hidden), false);
    assert.equal(await page.$eval('#name', el => el.value), '실패검증');
    await page.evaluate(() => { DAK.report = () => new Promise(resolve => { window.finishCredit = resolve; }); });
    await page.click('#retry'); await waitState('loading'); await page.click('#cancel'); await waitState('intake');
    await page.evaluate(() => finishCredit(lumiaFixtures.creditTable));
    assert.equal(await page.$eval('#table-view', el => el.hidden), true);
    assert.equal(await page.$eval('#form button', el => el.disabled), false);
  });
}
