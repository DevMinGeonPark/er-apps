// Synthetic document checks. The calling harness intercepts all external requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const fixture = JSON.parse(await readFile(new URL('./fixtures/lumia-death-fault.json', import.meta.url), 'utf8'));

export async function checkDocuments({ page, go, fill, waitState, check, text, output }) {
  async function installDeath() {
    await page.evaluate(data => {
      window.deathFixture = data;
      window.deathCalls = [];
      ER.deathCert = async (name, gameId) => {
        deathCalls.push({ name, gameId });
        const result = structuredClone(deathFixture);
        result.victim.nickname = name;
        if (gameId) { result.death.gameId = gameId; result.death.placeName = '검증용 이전 장소'; }
        return result;
      };
    }, fixture.death);
  }
  async function installFault(result = fixture.fault) {
    await page.evaluate(data => {
      window.faultFixture = data;
      window.faultCalls = [];
      ER.assessRequest = async request => { faultCalls.push(request); return structuredClone(faultFixture); };
    }, result);
  }
  async function faultNames() {
    await fill('#me', fixture.fault.names[0]);
    await fill('#mate1', fixture.fault.names[1]);
    await fill('#mate2', fixture.fault.names[2]);
  }
  async function download(selector, filename) {
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output, eventsEnabled: true });
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`PNG download timed out: ${filename}`)), 25000);
      client.on('Browser.downloadProgress', event => {
        if (event.state === 'completed') { clearTimeout(timer); resolve(); }
        else if (event.state === 'canceled') { clearTimeout(timer); reject(new Error('PNG download canceled')); }
      });
    });
    try {
      await page.click(selector);
      await done;
      const bytes = await readFile(resolve(output, filename));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert(bytes.length > 10000, 'PNG must contain a rendered document');
    } finally { await client.detach(); }
  }

  await check('death full vertical certificate, cause order, reselection, responsive document', async () => {
    await go('death'); await installDeath();
    await fill('#nick', '가상검증본인');
    assert.equal(await page.$eval('#actions', el => el.hidden), true);
    await page.click('#issueBtn'); await waitState('result');
    const document = await text('#certRoot');
    for (const field of ['가상검증본인', '계정 레벨', '숙련 무기', '사망 일시', '사망 장소', '기왕력', '직접 사인', '선행 사인', '사망의 종류', '처형 도구', '활동 이력', '범행 동기', '검시관 소견', '공식 Open API', '법적 효력']) assert(document.includes(field), `missing death field: ${field}`);
    assert(document.indexOf('검증용 직접 사인') < document.indexOf('검증용 선행 사인'));
    assert.doesNotMatch(document, /undefined|NaN|Infinity/);
    assert.equal(await page.$$('.picker-item').then(list => list.length), 2);
    await page.click('.picker-item:nth-child(2)'); await waitState('result');
    assert.equal(await page.evaluate(() => deathCalls[1].gameId), 990002);
    assert.match(await text('#certRoot'), /검증용 이전 장소/);
    assert.equal(await page.$eval('.picker-item:nth-child(2)', el => el.getAttribute('aria-pressed')), 'true');
    for (const width of [360, 390, 720, 768, 860, 1024, 1200, 1440]) {
      await page.setViewport({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `death result overflows at ${width}`);
    }
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(output, 'death-result-mobile.png'), fullPage: true });
  });
  await check('death PNG and light PDF contain document only', async () => {
    await page.setViewport({ width: 1200, height: 1000 });
    await download('#pngBtn', '사망진단서_가상검증본인.png');
    await page.emulateMediaType('print');
    try {
      for (const selector of ['.lc-clerk', '.lc-header', '.issue-panel', '#actions']) assert.equal(await page.$eval(selector, el => getComputedStyle(el).display), 'none');
      assert.equal(await page.$eval('.paper', el => getComputedStyle(el).backgroundColor), 'rgb(251, 250, 246)');
      assert.equal(await page.$eval('.paper', el => getComputedStyle(el).color), 'rgb(35, 35, 35)');
      await page.pdf({ path: resolve(output, 'death-print.pdf'), format: 'A4', printBackground: true });
    } finally { await page.emulateMediaType('screen'); }
  });
  await check('death empty, player error, partial response and canceled late response', async () => {
    await page.evaluate(() => { ER.deathCert = async () => { throw new Error('조회한 최근 40판 내 사망 상세 기록이 없습니다.'); }; });
    await fill('#nick', '가상빈기록'); await page.click('#issueBtn');
    await page.waitForFunction(() => document.querySelector('#hint').textContent.includes('조회 범위에 사망 기록이 없습니다.'));
    assert.equal(await page.$eval('#actions', el => el.hidden), true);
    await page.evaluate(() => { ER.deathCert = async () => { throw new Error('플레이어를 찾을 수 없습니다.'); }; });
    await page.click('#issueBtn'); await waitState('error');
    assert.match(await text('#hint'), /플레이어/);
    assert.equal(await page.$eval('#nick', el => el.value), '가상빈기록');
    await page.evaluate(() => { ER.deathCert = async () => ({ death: {} }); });
    await page.click('#issueBtn'); await waitState('error');
    assert.match(await text('#hint'), /일부 기록/);
    await page.evaluate(() => { ER.deathCert = () => new Promise(resolve => { window.finishDeath = resolve; }); });
    await page.click('#issueBtn'); await waitState('loading');
    await page.evaluate(() => document.querySelector('#issueForm').requestSubmit());
    await page.keyboard.press('Escape'); await waitState('intake');
    await page.evaluate(() => { const data = structuredClone(deathFixture); data.victim.nickname = '늦은응답'; finishDeath(data); });
    assert.equal(await page.$eval('#certRoot', el => el.hidden), true);
    assert.equal(await page.$eval('#issueBtn', el => el.disabled), false);
    assert.doesNotMatch(await text('#certRoot'), /늦은응답/);
  });
  await check('fault full required inputs, defaults, shared match and evidence selection', async () => {
    await go('fault'); await installFault();
    assert.equal(await page.$eval('#self-summary', el => el.hidden), false);
    assert.equal(await page.$eval('#me', el => el.hidden), true);
    await fill('#me', '보존된닉네임');
    assert.equal(await text('#self-nickname'), '보존된닉네임');
    await page.click('#edit-self');
    assert.equal(await page.$eval('#me', el => el.hidden), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'me');
    assert.equal(await page.$eval('#pages', el => el.value), '3');
    assert.equal(await page.$eval('#mode', el => el.value), 'all');
    assert.equal(await page.$eval('#season', el => el.value), 'auto');
    assert.equal(await page.$eval('#mate1', el => el.required), true);
    assert.equal(await page.$eval('#mate2', el => el.required), false);
    await faultNames();
    await page.click('#go'); await waitState('result');
    assert.equal(await page.evaluate(() => faultCalls.length), 1);
    assert.equal(await page.$eval('#match-choice', el => el.options.length), 3);
    assert.match(await text('#assessment'), /가상검증본인 39%/);
    assert.match(await text('#assessment'), /2회 · 벌점 44점/);
    assert.match(await text('#assessment'), /합계 100%/);
    await page.select('#match-choice', '0');
    const result = await text('#assessment');
    for (const field of ['990101', '45%', '35%', '20%', '8,420', '12,680', '10,120', '생존', '기권', '검증용 조기 이탈', '검증용 팀원 구호']) assert(result.includes(field), `missing fault field: ${field}`);
    assert.doesNotMatch(result, /undefined|NaN|Infinity/);
    await page.focus('.acc-toggle'); await page.keyboard.press('Enter');
    assert.equal(await page.$eval('.acc-toggle', el => el.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.$eval('#acc-detail-0', el => el.hidden), false);
    assert.match(await text('#acc-detail-0'), /기권/);
    for (const width of [360, 390, 720, 768, 860, 1024, 1200, 1440]) {
      await page.setViewport({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `fault result overflows at ${width}`);
    }
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(output, 'fault-result-mobile.png'), fullPage: true });
    await page.select('#match-choice', '1');
    assert.match(await text('#assessment'), /100%와 다를 수 있습니다/);
    assert.match(await text('#assessment'), /RP 미제공/);
    await page.select('#match-choice', '0');
  });
  await check('fault selected match PNG preserves every participant and evidence', async () => {
    await page.setViewport({ width: 1200, height: 1000 });
    const exportText = await text('#paper-svg');
    for (const field of ['990101', '가상검증본인', '가상팀원1', '가상팀원2', '45%', '35%', '20%', '8,420', '검증용 조기 이탈', '검증용 팀원 구호', '법률 효력']) assert(exportText.includes(field), `missing exported fault field: ${field}`);
    assert.doesNotMatch(exportText, /야간 기록관|LUMIA ARCHIVES/);
    await download('#png', '과실비율산정서_가상검증본인_가상팀원1_가상팀원2_경기990101.png');
    await page.emulateMediaType('print');
    try {
      assert.equal(await page.$eval('.lc-clerk', el => getComputedStyle(el).display), 'none');
      assert.equal(await page.$eval('.assessment', el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
      await page.pdf({ path: resolve(output, 'fault-print.pdf'), format: 'A4', printBackground: true });
    } finally { await page.emulateMediaType('screen'); }
  });
  await check('fault no accident, no shared games, teammate failure, partial, canceled late response', async () => {
    await page.click('#again'); await installFault(fixture.faultNoAccident);
    await page.click('#go'); await waitState('result');
    assert.match(await text('#assessment'), /무사고 확인서/);
    assert.match(await text('#assessment'), /심의 대상 패배 사고가 없습니다/);
    assert.equal(await page.$('.fault-bar'), null);
    await page.click('#again');
    await page.evaluate(() => { ER.assessRequest = async () => { throw new Error('최근 시즌에서 함께한 게임을 찾지 못했습니다.'); }; });
    await page.click('#go'); await waitState('error');
    assert.match(await text('#form-error'), /함께한 게임/);
    await page.evaluate(() => { ER.assessRequest = async () => { throw new Error('팀원 가상팀원1 조회에 실패했습니다.'); }; });
    await page.click('#go'); await waitState('error');
    assert.match(await text('#form-error'), /팀원 가상팀원1/);
    assert.equal(await page.$eval('#mate1', el => el.value), fixture.fault.names[1]);
    await page.evaluate(() => { ER.assessRequest = async () => ({ names: ['일부누락'] }); });
    await page.click('#go'); await waitState('error');
    assert.match(await text('#form-error'), /일부 기록/);
    await page.evaluate(() => { window.pendingCalls = 0; ER.assessRequest = () => { pendingCalls++; return new Promise(resolve => { window.finishFault = resolve; }); }; });
    await page.click('#go'); await waitState('loading');
    await page.evaluate(() => document.querySelector('#form-section').requestSubmit());
    assert.equal(await page.evaluate(() => pendingCalls), 1);
    await page.click('#cancel'); await waitState('intake');
    assert.equal(await page.$eval('#me', el => el.hidden), false);
    await page.evaluate(data => finishFault(data), fixture.fault);
    assert.equal(await page.$eval('#result-section', el => el.hidden), true);
    assert.equal(await page.$eval('#go', el => el.disabled), false);
    await page.evaluate(() => { ER.assessRequest = async () => { throw new Error('별도 조회가 실행되면 안 됩니다.'); }; });
    await fill('#mate1', fixture.fault.names[0]); await page.click('#go');
    assert.equal(await page.$eval('#mate1', el => el.getAttribute('aria-invalid')), 'true');
    assert.match(await text('#mate1-error'), /같은 닉네임/);
  });
}
