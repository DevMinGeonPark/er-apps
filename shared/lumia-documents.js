/* Shared document registry and browser-only context. No lookup is started here. */
(function (global) {
  'use strict';

  const documents = [
    {
      id: 'license', name: '실험체 자격증', category: '증명·평가',
      short: '누적 전적으로 산정하는 자격 등급',
      description: '전 시즌 누적 전적으로 자격 등급을 산정합니다. 기능사부터 명장까지, 자격증으로 발급합니다.',
      target: '전 시즌 누적 전적', href: '/cert/', status: 'active',
      inputSchema: [
        { name: 'nickname', label: '닉네임', required: true },
        { name: 'character', label: '운용 실험체', required: true },
        { name: 'skin', label: '증명사진 스킨', required: false },
        { name: 'style', label: '증서 양식', options: ['aglaia', 'classic'], required: true },
      ],
      inputHint: '접수대에서 운용 실험체·증명사진 스킨·증서 양식을 고릅니다.',
      dialogue: { quote: '자격증? …응.\n잘한다는 말로는 부족했나 보네.', aside: '전 시즌 기록까지 봐야 하니까, 잠깐 기다려.' },
    },
    {
      id: 'autopsy', name: '사망진단서', category: '경기 분석',
      short: '마지막 경기의 사망 원인',
      description: '최근 경기의 사망 기록에서 선행 사인부터 직접 사인까지 역추적해 사망진단서를 작성합니다.',
      target: '최근 경기의 사망 기록', href: '/death/', status: 'active',
      inputSchema: [{ name: 'nickname', label: '닉네임', required: true }],
      inputHint: '접수대에서 닉네임을 확인한 뒤 사망 기록을 조회합니다.',
      dialogue: { quote: '또 죽었어?\n…알았어. 어디서 죽었는데.', aside: '변명은 됐고. 기록으로 볼게.' },
    },
    {
      id: 'liability', name: '과실비율 산정서', category: '경기 분석',
      short: '함께 패배한 팀원들의 과실비율',
      description: '듀오·트리오가 함께 패배한 경기를 비교해 팀원별 과실비율을 산정합니다.',
      target: '함께 패배한 경기', href: '/fault/', status: 'active',
      inputSchema: [
        { name: 'me', label: '내 닉네임', required: true },
        { name: 'mate1', label: '팀원 1', required: true },
        { name: 'mate2', label: '팀원 2', required: false },
        { name: 'season', label: '조회 시즌', required: true },
        { name: 'mode', label: '사고 유형', options: ['all', 'squad', 'cobalt'], required: true },
        { name: 'pages', label: '조회 범위', options: [2, 3, 5], required: true },
      ],
      inputHint: '접수대에서 팀원 1명 이상·시즌·사고 유형·최근 40·60·100판을 선택합니다.',
      dialogue: { quote: '이번에도 네 잘못은\n아니라는 거지?', aside: '일단 앉아. 셋 다 확인할 테니까.' },
    },
    {
      id: 'tracking', name: '원수 관측소', category: '추적·조회',
      short: '나를 처치한 실험체의 이후 행적',
      description: '나를 처치한 실험체를 찾아 이후 행적과 최종 결과를 추적합니다.',
      target: '나를 처치한 실험체', href: '/enemy/', status: 'active',
      inputSchema: [
        { name: 'me', label: '내 닉네임으로 색출', alternative: 'enemy', required: true },
        { name: 'enemy', label: '상대 닉네임 직접 입력', alternative: 'me', required: true },
      ],
      inputHint: '접수대에서 내 닉네임으로 후보를 찾거나 상대 닉네임을 직접 입력합니다.',
      dialogue: { quote: '아직도 그 사람 찾고 있어?\n…이름 줘 봐.', aside: '그 뒤에 어떻게 됐는지만 확인할게.' },
    },
    {
      id: 'credit', name: '루미아 신용정보원', category: '증명·평가',
      short: '실험체별 신용등급과 연체 이력',
      description: '실험체별 성적을 신용등급으로 환산합니다. 표본 부족 여부와 연체 이력까지 확인합니다.',
      target: '실험체별 성적', href: '/credit/', status: 'active',
      inputSchema: [{ name: 'nickname', label: '닉네임', required: true }],
      inputHint: '접수대에서 닉네임을 조회한 뒤 실험체별 평가서를 확인합니다.',
      dialogue: { quote: '그 실험체, 또 하려고?\n…기록부터 보고 결정해.', aside: '등급 낮다고 나한테 따지진 말고.' },
    },
    {
      id: 'payroll', name: '루미아 노동청', category: '정산',
      short: '랭크 RP를 급여로 환산한 명세서',
      description: '랭크 RP를 급여로 정산하고 플레이 시간에 따른 시급을 공개합니다.',
      target: '랭크 경기 기록', href: '/payroll/', status: 'active',
      inputSchema: [
        { name: 'nickname', label: '닉네임', required: true },
        { name: 'count', label: '최근 랭크 경기', options: [10, 20, 30], required: true },
      ],
      inputHint: '접수대에서 최근 랭크 10·20·30판 중 정산 범위를 선택합니다.',
      dialogue: { quote: '이만큼 했는데\n오히려 깎였다고?', aside: '…명세서 뽑아줄게.' },
    },
  ];

  const STORAGE_KEY = 'lumia.context.v1';
  const normalizeNickname = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';
  function normalizeContext(value) {
    if (!value || value.version !== 1) return { version: 1, nickname: '', recent: [], updatedAt: 0 };
    const validIds = new Set(documents.map(item => item.id));
    return {
      version: 1,
      updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
      nickname: normalizeNickname(value.nickname),
      recent: Array.isArray(value.recent)
        ? [...new Set(value.recent.filter(id => typeof id === 'string' && validIds.has(id)))].slice(0, 3)
        : [],
    };
  }
  function readContext(fallback = null) {
    let readable = false;
    let latest = null;
    for (const storageName of ['localStorage', 'sessionStorage']) {
      try {
        const raw = global[storageName]?.getItem(STORAGE_KEY);
        if (global[storageName]) readable = true;
        if (raw) {
          const candidate = normalizeContext(JSON.parse(raw));
          if (!latest || candidate.updatedAt > latest.updatedAt) latest = candidate;
        }
      } catch (_) { /* A blocked or damaged store must not block the lobby. */ }
    }
    return latest || normalizeContext(readable ? null : fallback);
  }
  let context = readContext();
  function persist() {
    context = normalizeContext(context);
    context.updatedAt = Math.max(Date.now(), context.updatedAt + 1);
    for (const storageName of ['localStorage', 'sessionStorage']) {
      try { global[storageName]?.setItem(STORAGE_KEY, JSON.stringify(context)); } catch (_) { /* Memory fallback. */ }
    }
  }

  // Public interfaces used by the lobby and every document's common shell.
  global.LumiaDocuments = documents;
  global.LumiaContext = {
    refresh() { context = readContext(context); },
    getNickname() { return context.nickname; },
    setNickname(value) { context.nickname = normalizeNickname(value); persist(); return context.nickname; },
    remember(id) {
      if (!documents.some(item => item.id === id && item.status === 'active')) return;
      context.recent = [id, ...context.recent.filter(existing => existing !== id)].slice(0, 3);
      persist();
    },
    getRecent() { context = normalizeContext(context); return context.recent.slice(); },
  };
  global.addEventListener?.('storage', event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    try { context = normalizeContext(JSON.parse(event.newValue)); }
    catch (_) { context = normalizeContext(null); }
  });

  // Pure, registry-derived catalog rules also used for local scalability checks.
  global.LumiaCatalog = {
    selectPage(items, category = '전체', query = '', page = 0, size = 6) {
      const normalize = text => String(text ?? '').toLocaleLowerCase('ko-KR').replace(/\s+/gu, '');
      const term = normalize(query);
      const filtered = items.filter(item => (category === '전체' || item.category === category)
        && normalize([item.name, item.category, item.short, item.description, ...(item.searchKeywords || [])].join(' ')).includes(term));
      const pageSize = Number.isFinite(size) ? Math.max(1, Math.floor(size)) : 6;
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const current = Number.isFinite(page) ? Math.min(Math.max(0, Math.floor(page)), pages - 1) : 0;
      return { items: filtered.slice(current * pageSize, (current + 1) * pageSize), count: filtered.length, page: current, pages };
    },
  };
})(globalThis);
