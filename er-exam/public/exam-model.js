/* 운영방법론 모의고사 — local exam model. No network or player records.
   Answer key: 미스릴 티어 "닌황"의 운영 방법론 (docs/lumia-exam-2026-09-18/README.md). */
(function (root, factory) {
  'use strict';
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.LumiaExam = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SOURCE = { author: '닌황', tier: '미스릴' };

  const domains = [
    { id: 'vision', title: '시야·정보', advice: '어떤 지역이든 처음 들어간 사람이 CCTV를 켠다. 옵젝 지역도 CCTV부터.' },
    { id: 'join', title: '합류·분산 파밍', advice: '늑대 전 풀템이면 즉시 합류, 후면 내 지역 동물을 털고 합류. 합류 뒤엔 인접 지역으로 흩어져 55m를 유지한다.' },
    { id: 'economy', title: '크레딧 경제', advice: '1일차 밤이 끝날 때 280크레딧. 변이 동물 → 곰 → 크레딧 큐브 순으로 모아 2일차 낮 포스 코어를 뽑는다.' },
    { id: 'territory', title: '지역 선점', advice: '변이 동물을 먹었으면 생명의 나무·운석 지역을 확보하고, 리젠 동물로 옵젝을 준비한다. 합류 지점은 고밸류 지역 쪽으로.' },
    { id: 'objective', title: '오브젝트·교전 판단', advice: '조합·숙작·템을 보고 이길 싸움만 적극적으로. 적이 3팀이면 다른 옵젝, 4팀 이상이면 난전에서 점수를 챙긴다.' },
    { id: 'zone', title: '금지구역 판독', advice: '옵젝 싸움 뒤엔 금지구역이 풀리는 쪽으로. 못 먹었다면 강팀과 떨어져 약팀 구역에서만 싸운다.' },
    { id: 'growth', title: '후반 성장·마무리', advice: '3일차 숙작 낮 14 · 밤 15~16, 4일차 이후 20레벨·20숙련도. 위클라인을 먹었으면 끝 지역부터 몬다.' },
  ];

  // weight: 1 기본 지식 · 2 응용 · 3 상황 판단. credit: 1 정답 · 0.5 부분 점수 · 0 오답.
  const questions = [
    { id: 'e01', domain: 'vision', weight: 1, prompt: '팀이 처음 가는 지역에 막 들어선다. CCTV는 누가 켜는가?',
      source: '어떤지역이든 처음 갔을때 첫번째로 진입하는사람이 무조건 cctv키기',
      choices: [
        { text: '파밍이 먼저 끝나 여유가 생긴 사람', credit: 0 },
        { text: '첫 번째로 진입한 사람이 무조건', credit: 1 },
        { text: '교전이 예상될 때만 가까운 사람이', credit: 0 },
        { text: '시야 담당으로 정해 둔 한 명', credit: 0 },
      ] },
    { id: 'e02', domain: 'vision', weight: 2, prompt: '2일차 낮, 포스 코어를 뽑고 오브젝트 지역에 도착했다. 가장 먼저 할 일은?',
      source: '옵젝 지역 cctv따기',
      choices: [
        { text: '오브젝트 지역의 CCTV부터 딴다', credit: 1 },
        { text: '오브젝트 바로 앞 부쉬에서 대기한다', credit: 0 },
        { text: '주변 동물부터 정리한다', credit: 0 },
        { text: '팀원과 흩어져 각자 길목을 막는다', credit: 0 },
      ] },

    { id: 'e03', domain: 'join', weight: 1, prompt: '1일차 낮, 늑대가 나오기 전에 보라 풀템을 완성했다.',
      source: '보라풀템 띄우는 시점이 늑대가 나오기 전이면 무조건 팀 합류',
      choices: [
        { text: '내 지역 동물을 다 털고 합류한다', credit: 0.5 },
        { text: '혼자 옆 지역으로 넘어가 파밍을 이어간다', credit: 0 },
        { text: '무조건 팀에 합류한다', credit: 1 },
        { text: '근처의 적을 찾아 먼저 교전을 건다', credit: 0 },
      ] },
    { id: 'e04', domain: 'join', weight: 1, prompt: '1일차 낮, 보라 풀템을 완성했는데 이미 늑대가 나온 뒤다.',
      source: '보라풀템 띄우는 시점이 늑대가 나온 후라면 본인 지역 동물 다 털고 합류',
      choices: [
        { text: '동물은 두고 곧바로 팀에 합류한다', credit: 0.5 },
        { text: '팀원을 내 지역으로 불러 함께 잡는다', credit: 0 },
        { text: '밤이 될 때까지 혼자 파밍한다', credit: 0 },
        { text: '본인 지역 동물을 다 털고 합류한다', credit: 1 },
      ] },
    { id: 'e05', domain: 'join', weight: 2, prompt: '팀 합류를 마쳤다. 이후 파밍 대형으로 옳은 것은?',
      source: '합류후 팀원과 같은지역 파밍x · 무조건 인근지역 55m거리유지하면서 파밍',
      choices: [
        { text: '인근 지역으로 나뉘어 55m 거리를 유지하며 파밍', credit: 1 },
        { text: '같은 지역에서 뭉쳐 다니며 파밍', credit: 0 },
        { text: '인근 지역으로 나뉘되 거리는 신경 쓰지 않는다', credit: 0.5 },
        { text: '맵 반대편까지 넓게 흩어져 파밍', credit: 0 },
      ] },
    { id: 'e06', domain: 'join', weight: 2, prompt: '합류 후 팀원과 같은 지역에서 파밍하면 안 되는 이유는?',
      source: '2명이 한지역 파밍하면 크레딧 반토막손해',
      choices: [
        { text: '적에게 위치가 한꺼번에 노출된다', credit: 0 },
        { text: '동물 리젠이 느려진다', credit: 0 },
        { text: '두 명이 한 지역을 파밍하면 크레딧이 반토막 난다', credit: 1 },
        { text: '숙련도가 나눠 들어간다', credit: 0 },
      ] },
    { id: 'e07', domain: 'join', weight: 2, prompt: '세 명이 인근 지역으로 나뉘어 파밍하기 좋은 조합은?',
      source: 'ex) 숲-모사-호텔 / 양궁장-주유소-학교 / 창고-항구-바지선 / 묘지-병원-공장',
      choices: [
        { text: '양궁장 - 병원 - 항구', credit: 0 },
        { text: '절 - 창고 - 주유소', credit: 0 },
        { text: '호텔 - 공장 - 학교', credit: 0 },
        { text: '숲 - 모래사장 - 호텔', credit: 1 },
      ] },

    { id: 'e08', domain: 'economy', weight: 1, prompt: '1일차 밤이 끝나는 시점의 크레딧 목표와 그 이유는?',
      source: '1일차 밤이 끝나는 시점에 280원이 모이면 안정적으로 포코 가능',
      choices: [
        { text: '200 — 전술 스킬 강화', credit: 0 },
        { text: '280 — 2일차 낮에 포스 코어를 안정적으로 뽑기 위해', credit: 1 },
        { text: '350 — 미스릴을 바로 사기 위해', credit: 0 },
        { text: '목표 없이 모이는 대로', credit: 0 },
      ] },
    { id: 'e09', domain: 'economy', weight: 2, prompt: '1일차 밤의 파밍 우선도는?',
      source: '파밍 우선도 : 변이크립->곰->크레딧 큐브',
      choices: [
        { text: '변이 동물 → 곰 → 크레딧 큐브', credit: 1 },
        { text: '곰 → 변이 동물 → 크레딧 큐브', credit: 0.5 },
        { text: '크레딧 큐브 → 변이 동물 → 곰', credit: 0 },
        { text: '크레딧 큐브 → 곰 → 변이 동물', credit: 0 },
      ] },
    { id: 'e10', domain: 'economy', weight: 2, prompt: '2일차 낮, 키오스크에 자리를 잡았다. 포스 코어 다음 순서는?',
      source: '포스코어 뽑은 이후 오브젝트 준비',
      choices: [
        { text: '크레딧을 더 모아 포스 코어를 하나 더 뽑는다', credit: 0 },
        { text: '금지구역을 피해 맵 끝으로 빠진다', credit: 0 },
        { text: '오브젝트를 준비한다', credit: 1 },
        { text: '가까운 팀에 바로 교전을 건다', credit: 0 },
      ] },
    { id: 'e11', domain: 'economy', weight: 2, prompt: '포스 코어를 뽑은 뒤 어떤 오브젝트를 준비하는가?',
      source: '이때 생나 or 운석을 먹었다면 알파 못먹었으면 상자',
      choices: [
        { text: '생나·운석 확보와 상관없이 무조건 알파', credit: 0.5 },
        { text: '생나·운석을 먹었으면 상자, 못 먹었으면 알파', credit: 0 },
        { text: '오브젝트는 포기하고 파밍에 집중', credit: 0 },
        { text: '생나·운석을 먹었으면 알파, 못 먹었으면 상자', credit: 1 },
      ] },

    { id: 'e12', domain: 'territory', weight: 2, prompt: '1일차 밤, 변이 동물을 무탈하게 먹었다. 다음 목표는?',
      source: '무탈하게 변이동물 먹었으면 생나 or 운석지역 확보',
      choices: [
        { text: '크레딧 큐브만 계속 돈다', credit: 0 },
        { text: '생명의 나무 또는 운석 지역을 확보한다', credit: 1 },
        { text: '가까운 팀을 찾아 교전한다', credit: 0 },
        { text: '키오스크로 가서 미리 대기한다', credit: 0 },
      ] },
    { id: 'e13', domain: 'territory', weight: 1, prompt: '방법론이 예로 든 고밸류 지역이 아닌 곳은?',
      source: 'ex) 호텔, 묘지, 절, 주유소라인 or 항구라인 (고벨류지역)',
      choices: [
        { text: '호텔', credit: 0 },
        { text: '묘지', credit: 0 },
        { text: '골목길', credit: 1 },
        { text: '절', credit: 0 },
      ] },
    { id: 'e14', domain: 'territory', weight: 3, prompt: '1일차 낮, 팀이 합류할 지점은 무엇을 기준으로 정하는가?',
      source: '편하게 지역선점을 하기위해서 1일차 낮에 합류할곳을 잘정해야함 (팀이 고벨류 지역에서 루트가 끝나면 그쪽으로 합류)',
      choices: [
        { text: '루트가 고밸류 지역에서 끝나는 팀원 쪽 — 밤의 지역 선점이 편해진다', credit: 1 },
        { text: '가장 먼저 템을 완성한 팀원 쪽', credit: 0 },
        { text: '세 명 동선의 정확한 중간 지점', credit: 0 },
        { text: '적이 가장 적어 보이는 맵 외곽', credit: 0 },
      ] },
    { id: 'e15', domain: 'territory', weight: 2, prompt: '생나·운석 지역을 확보했다. 오브젝트 전까지 무엇을 하는가?',
      source: '지역확보후 리젠되는 들개, 멧돼지 먹으면서 옵젝 준비',
      choices: [
        { text: '부쉬에 숨어 시간을 보낸다', credit: 0 },
        { text: '옆 지역 팀을 먼저 치러 간다', credit: 0 },
        { text: '확보한 지역을 비우고 큐브를 돈다', credit: 0 },
        { text: '리젠되는 들개·멧돼지를 먹으며 옵젝을 준비한다', credit: 1 },
      ] },
    { id: 'e16', domain: 'territory', weight: 2, prompt: '1일차 밤, 오브젝트는 승산이 없어 보인다. 대안은?',
      source: '옵젝 안될거같으면 양궁장 공장 변늑 먹기',
      choices: [
        { text: '그래도 옵젝에 가서 한타를 본다', credit: 0 },
        { text: '양궁장·공장의 변이 늑대를 먹는다', credit: 1 },
        { text: '아무것도 하지 않고 2일차를 기다린다', credit: 0 },
        { text: '다른 팀의 옵젝 싸움을 구경만 한다', credit: 0 },
      ] },

    { id: 'e17', domain: 'objective', weight: 2, prompt: '2일차 낮부터 교전은 어떤 기준으로 거는가?',
      source: '이때부턴 상대 조합, 숙작, 템 보고 이길거 같으면 적극적으로 교전할것',
      choices: [
        { text: '마주치는 팀은 전부 싸운다', credit: 0 },
        { text: '3일차까지는 모든 교전을 피한다', credit: 0 },
        { text: '상대 조합·숙작·템을 보고 이길 것 같으면 적극적으로', credit: 1 },
        { text: '상대의 킬 수만 보고 판단한다', credit: 0.5 },
      ] },
    { id: 'e18', domain: 'objective', weight: 3, prompt: '오브젝트에 도착했더니 적이 3팀 모여 있다.',
      source: '적이 3팀이면 바로 다른옵젝 노리기',
      choices: [
        { text: '바로 다른 오브젝트를 노린다', credit: 1 },
        { text: '가장 약해 보이는 팀부터 문다', credit: 0 },
        { text: '싸움이 끝날 때까지 뒤에서 기다린다', credit: 0.5 },
        { text: '그대로 난전에 참여한다', credit: 0 },
      ] },
    { id: 'e19', domain: 'objective', weight: 2, prompt: '오브젝트에 적이 4팀 이상 몰려 큰 난전이 됐다.',
      source: '적이 4팀이상이면 머리박고 점수 복사',
      choices: [
        { text: '3팀일 때처럼 다른 오브젝트로 돌린다', credit: 0.5 },
        { text: '포기하고 맵 끝으로 빠진다', credit: 0 },
        { text: '오브젝트 막타만 노린다', credit: 0 },
        { text: '빼지 않고 난전에 머리 박아 점수를 챙긴다', credit: 1 },
      ] },

    { id: 'e20', domain: 'zone', weight: 3, prompt: '2일차 밤, 오브젝트 싸움이 끝났다. 어디로 움직이는가?',
      source: '옵젝 싸움본 후 금지구역 풀리는쪽으로 이동 · 확정적으로 동물을먹을수 있는곳이 금지구역이 풀리는 곳',
      choices: [
        { text: '다음 오브젝트가 나오는 지역', credit: 0 },
        { text: '금지구역이 풀리는 쪽 — 확정적으로 동물을 먹을 수 있다', credit: 1 },
        { text: '맵 중앙', credit: 0 },
        { text: '방금 싸운 자리에서 정비하며 대기', credit: 0 },
      ] },
    { id: 'e21', domain: 'zone', weight: 3, prompt: '2일차 밤 이후 강팀 구역과 약팀 구역은 무엇으로 갈리는가?',
      source: '금지구역 풀리는 곳 동물을 먹을수 있다 없다로 강팀이 있는 구역, 약팀이 있는구역이 나뉘게 됨',
      choices: [
        { text: '팀의 누적 킬 수', credit: 0 },
        { text: '맵 중앙에 가까운 정도', credit: 0 },
        { text: '금지구역이 풀리는 곳의 동물을 먹을 수 있느냐', credit: 1 },
        { text: '키오스크까지의 거리', credit: 0 },
      ] },
    { id: 'e22', domain: 'zone', weight: 3, prompt: '금지구역이 풀리는 쪽을 차지하지 못했다.',
      source: '금지구역이 풀리는쪽을 먹지 못했다면 강팀과 최대한 떨어져서 약팀이 있는구역에서만 교전할것',
      choices: [
        { text: '강팀에게 싸움을 걸어 자리를 뺏는다', credit: 0 },
        { text: '끝까지 모든 교전을 피한다', credit: 0.5 },
        { text: '풀리는 구역 입구에서 나오는 팀을 기다린다', credit: 0 },
        { text: '강팀과 최대한 떨어져 약팀이 있는 구역에서만 교전한다', credit: 1 },
      ] },

    { id: 'e23', domain: 'growth', weight: 2, prompt: '3일차의 평균 숙작(무기 숙련도) 기준은?',
      source: '낮 평균숙작 : 14 · 밤 평균숙작 : 15~16',
      choices: [
        { text: '낮 14 · 밤 15~16', credit: 1 },
        { text: '낮 10 · 밤 12', credit: 0 },
        { text: '낮 12 · 밤 13~14', credit: 0.5 },
        { text: '낮 17 · 밤 19~20', credit: 0 },
      ] },
    { id: 'e24', domain: 'growth', weight: 2, prompt: '4일차 이후, 방법론이 굉장히 중요하다고 꼽은 지표는?',
      source: '20레벨 20숙련도가 굉장히 중요함. 닫혔다 열리는 금지구역, 그게 아니더라도 최대한 동물을 먹으면서 레벨과 숙련도작 하기',
      choices: [
        { text: '팀 누적 킬 수', credit: 0 },
        { text: '20레벨·20숙련도 — 동물을 최대한 먹으며 맞춘다', credit: 1 },
        { text: '보유 크레딧', credit: 0 },
        { text: '전설 아이템 개수', credit: 0 },
      ] },
    { id: 'e25', domain: 'growth', weight: 3, prompt: '위클라인을 먹었다. 이후 운영은?',
      source: '위클 먹었으면 끝지역부터 다른팀들 몰기',
      choices: [
        { text: '맵 중앙을 잡고 버틴다', credit: 0 },
        { text: '안전한 구석에서 순위 방어를 한다', credit: 0 },
        { text: '끝 지역부터 다른 팀들을 몬다', credit: 1 },
        { text: '가장 강한 팀부터 찾아가 싸운다', credit: 0 },
      ] },
  ];

  // 답안지가 미스릴 유저의 방법론이므로 만점의 천장은 미스릴이다.
  // 데미갓·이터니티는 점수가 아니라 순위로 정해지는 티어라 채점으로 판정하지 않는다.
  // min: 가중 득점률(%) 하한. 4지선다 무작위 응답(약 25%)은 브론즈에 머문다.
  const tiers = [
    { id: 'iron', name: '아이언', min: 0, color: '#8a8f94', divisions: true, comment: '아직 루트만 돌고 있어요. 1일차 낮의 합류 규칙부터 외워 봅시다.' },
    { id: 'bronze', name: '브론즈', min: 20, color: '#b0764a', divisions: true, comment: '찍어도 나오는 점수대. 280크레딧과 포스 코어 타이밍이 첫 번째 과제입니다.' },
    { id: 'silver', name: '실버', min: 35, color: '#b9c4cc', divisions: true, comment: '초반 규칙은 알고 있어요. 합류 뒤의 분산 파밍과 지역 선점을 다듬을 차례.' },
    { id: 'gold', name: '골드', min: 50, color: '#e0b84f', divisions: true, comment: '하루 단위의 흐름은 잡혀 있습니다. 옵젝 앞에서의 팀 수 판단이 갈림길이에요.' },
    { id: 'platinum', name: '플래티넘', min: 62, color: '#5fc3b4', divisions: true, comment: '운영의 뼈대가 있습니다. 2일차 밤 금지구역 판독에서 점수가 샙니다.' },
    { id: 'diamond', name: '다이아몬드', min: 74, color: '#7fa8f5', divisions: true, comment: '대부분의 판단이 방법론과 같습니다. 틀린 문항이 곧 실전에서 새는 RP예요.' },
    { id: 'meteorite', name: '메테오라이트', min: 84, color: '#b48cf0', divisions: false, comment: '거의 같은 그림을 보고 있습니다. 남은 건 상황 판단 한두 개.' },
    { id: 'mithril', name: '미스릴', min: 94, color: '#9fe8ff', divisions: false, comment: '출제자와 같은 운영을 하고 있습니다. 이제 손이 따라오면 됩니다.' },
  ];
  const DIVISIONS = ['IV', 'III', 'II', 'I'];

  function tierFor(percent) {
    let index = 0;
    tiers.forEach((tier, i) => { if (percent >= tier.min) index = i; });
    const tier = tiers[index];
    const ceiling = index + 1 < tiers.length ? tiers[index + 1].min : 100;
    const division = tier.divisions
      ? DIVISIONS[Math.min(3, Math.floor((percent - tier.min) / (ceiling - tier.min) * 4))]
      : '';
    return { tier, division, label: division ? `${tier.name} ${division}` : tier.name, next: tiers[index + 1] || null };
  }

  // answers: { [questionId]: choiceIndex }. 미응답은 0점.
  function score(answers) {
    const byDomain = new Map(domains.map(domain => [domain.id, { ...domain, earned: 0, max: 0 }]));
    const review = questions.map(question => {
      const picked = Number.isInteger(answers?.[question.id]) ? question.choices[answers[question.id]] : undefined;
      const credit = picked ? picked.credit : 0;
      const bucket = byDomain.get(question.domain);
      bucket.earned += credit * question.weight;
      bucket.max += question.weight;
      return { id: question.id, credit, picked: picked ? answers[question.id] : null, correct: question.choices.findIndex(choice => choice.credit === 1) };
    });
    const list = [...byDomain.values()].map(item => ({ ...item, percent: Math.round(item.earned / item.max * 100) }));
    const earned = list.reduce((sum, item) => sum + item.earned, 0);
    const max = list.reduce((sum, item) => sum + item.max, 0);
    const percent = Math.round(earned / max * 1000) / 10;
    const weakest = list.reduce((low, item) => item.earned / item.max < low.earned / low.max ? item : low);
    return { earned, max, percent, ...tierFor(percent), domains: list, weakest, review };
  }

  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }

  return freeze({ VERSION: 1, SOURCE, domains, questions, tiers, tierFor, score });
});
