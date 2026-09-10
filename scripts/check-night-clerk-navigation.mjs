// Focus and history regressions. The caller must intercept all external requests.
import assert from 'node:assert/strict';

export async function checkDocuments({ page, go, fill, waitState, check, text }) {
  async function waitDocument(slug, id) {
    await page.waitForFunction(({ slug, id }) => location.pathname === `/${slug}/`
      && document.body.dataset.lumiaDocument === id
      && document.querySelector('#lc-document-select')?.value === id,
    { timeout: 6000 }, { slug, id });
  }
  async function historyStep(direction, slug, id) {
    // Lifecycle waits such as networkidle0 do not fire on every BFCache restore.
    await page.evaluate(direction => history[direction](), direction);
    await waitDocument(slug, id);
  }
  async function assertIntake(...hiddenSections) {
    await waitState('intake');
    assert.equal(await text('.lc-state'), '접수');
    for (const selector of hiddenSections) {
      assert.equal(await page.$eval(selector, element => element.hidden), true, `${selector} must close when returning to intake`);
    }
  }
  async function installEnemy() {
    await page.evaluate(() => {
      ER.killers = async name => ({
        me: name, scanned: 3, beastDeaths: 0, zoneDeaths: 0,
        killers: [{ nickname: '탐색검증상대', count: 2, last: {
          byCharKey: null, byCharName: '재키', placeName: '검증 장소', modeName: '랭크',
          startDtm: '2026-09-09T12:00:00Z', gameId: 1,
        } }],
      });
      ER.observe = async enemy => ({
        target: { nickname: enemy, accountLevel: 12, seasonPlays: 3, averageKills: 2, mmr: 0 },
        myDeath: null, chain: null, afterGames: [],
        fate: { total: null, tone: 'silent', text: '조회 범위에서 이후 랭크 기록을 찾지 못했습니다.' },
      });
    });
  }

  await check('common document select and nickname context restore on BFCache back/forward', async () => {
    await go('payroll');
    await fill('#nickname', '탐색검증근로자');
    await page.evaluate(() => {
      window.lumiaNavigationRestores = [];
      addEventListener('pageshow', event => lumiaNavigationRestores.push(event.persisted));
    });
    await page.select('#lc-document-select', 'tracking');
    await waitDocument('enemy', 'tracking');
    assert.equal(await page.$eval('#meInput', element => element.value), '탐색검증근로자');
    await page.evaluate(() => {
      window.lumiaNavigationRestores = [];
      addEventListener('pageshow', event => lumiaNavigationRestores.push(event.persisted));
    });
    await fill('#meInput', '다른접수대에서수정');

    await historyStep('back', 'payroll', 'payroll');
    assert.equal(await page.evaluate(() => window.lumiaNavigationRestores?.at(-1)), true, 'payroll must exercise an actual BFCache restore');
    assert.equal(await page.evaluate(() => LumiaContext.getNickname()), '다른접수대에서수정', 'a restored page must refresh shared context');
    await historyStep('forward', 'enemy', 'tracking');
    assert.equal(await page.evaluate(() => window.lumiaNavigationRestores?.at(-1)), true, 'enemy must exercise an actual BFCache restore');
    assert.equal(await page.$eval('#meInput', element => element.value), '다른접수대에서수정');

    await historyStep('back', 'payroll', 'payroll');
    // The destination can be selected again after returning to the source desk.
    await page.select('#lc-document-select', 'tracking');
    await waitDocument('enemy', 'tracking');
    assert.equal(new URL(page.url()).search, '', 'desk navigation must not start a query through URL parameters');
  });

  await check('payroll keyboard submission focuses its result and Escape returns to intake', async () => {
    await go('payroll');
    await page.evaluate(() => {
      ERCore.getMatches = async nickname => [{
        gameId: 901, nickname, matchingMode: 3, startDtm: '2026-09-09T12:00:00Z',
        playTime: 1200, mmrGainInGame: 30, mmrLossEntryCost: -42, mmrGain: -12, gameRank: 5,
      }];
    });
    await fill('#nickname', '키보드검증근로자');
    await page.focus('#nickname');
    await page.keyboard.press('Enter');
    await waitState('result');
    await page.waitForFunction(() => document.querySelector('#results').contains(document.activeElement), { timeout: 6000 });
    assert.match(await text('#payslip'), /키보드검증근로자/);
    assert.equal(await page.$eval('#results', element => element.hidden), false);
    await page.keyboard.press('Escape');
    await assertIntake('#results', '#loading');
    assert.equal(await page.$eval('#nickname', element => element.value), '키보드검증근로자');
    assert.equal(await page.$eval('#submit', element => element.disabled), false);

    await page.evaluate(() => { ERCore.getMatches = () => new Promise(resolve => { window.finishNavigationPayroll = resolve; }); });
    await page.click('#submit');
    await waitState('loading');
    await page.keyboard.press('Escape');
    await assertIntake('#results', '#loading');
    await page.evaluate(async () => { finishNavigationPayroll([]); await Promise.resolve(); await Promise.resolve(); });
    await assertIntake('#results', '#loading');
    assert.equal(await page.$eval('#submit', element => element.disabled), false);
  });

  await check('enemy Escape follows observation to candidates to intake, including direct entry', async () => {
    await go('enemy');
    await installEnemy();
    await fill('#meInput', '탐색검증본인');
    await page.click('#meBtn');
    await waitState('result');
    await page.click('.killer-card');
    await page.waitForFunction(() => !document.querySelector('#obsSec').hidden);
    assert.match(await text('#obsRoot'), /탐색검증상대/);
    await page.keyboard.press('Escape');
    await waitState('result');
    assert.equal(await page.$eval('#obsSec', element => element.hidden), true);
    assert.equal(await page.$eval('#killersSec', element => element.hidden), false);
    assert.match(await text('.lc-state'), /원수 후보 명단/);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('killer-card')), true);
    await page.keyboard.press('Escape');
    await assertIntake('#obsSec', '#killersSec');
    assert.equal(await page.$eval('#meInput', element => element.value), '탐색검증본인');

    // A fresh direct observation has no previous candidate list to restore.
    await go('enemy');
    await installEnemy();
    await page.click('#directToggle');
    await fill('#enemyInput', '직접입력검증상대');
    await page.click('#directForm button');
    await waitState('result');
    await page.keyboard.press('Escape');
    await assertIntake('#obsSec', '#killersSec');
    assert.equal(await page.$eval('#directForm', element => element.hidden), false);
    assert.equal(await page.$eval('#enemyInput', element => element.value), '직접입력검증상대');
  });
}
