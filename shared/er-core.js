// 공식 Open API용 브라우저 클라이언트. 인증과 요청 직렬화는 er-ps 서버가 담당한다.
(function (global) {
  const BASE = (global.ER_API_BASE_URL || 'https://erps.dev-heptivision.com').replace(/\/$/, '') + '/api/v1/series';
  const META_TTL = 6 * 3600000;
  const cache = new Map(), pending = new Map();
  function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry || Date.now() >= entry.until) { cache.delete(key); return null; }
    return entry.value;
  }
  function cacheSet(key, value, ttl) {
    if (cache.size >= 300) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: Date.now() + ttl });
  }
  async function request(path, ttl = 5 * 60000) {
    const hit = cacheGet(path);
    if (hit) return hit;
    if (pending.has(path)) return pending.get(path);
    const work = (async () => {
      const response = await fetch(BASE + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      const value = await response.json();
      if (!response.ok) {
        const error = new Error(value.message || '공식 전적을 불러오지 못했습니다.');
        error.status = response.status; throw error;
      }
      if (value.provider !== 'official') throw new Error('공식 전적 데이터의 출처를 확인할 수 없습니다.');
      cacheSet(path, value, ttl);
      return value;
    })().finally(() => pending.delete(path));
    pending.set(path, work);
    return work;
  }
  let characters = [];
  async function metadata() {
    const result = await request('/metadata', META_TTL);
    characters = result.characters.map(c => ({ ...c, imageUrl: new URL(c.imageUrl, BASE).href,
      skins: c.skins.map(s => ({ ...s, profileUrl: new URL(s.profileUrl, BASE).href })) }));
    result.characters = characters;
    return result;
  }
  async function getCharacters() { return (await metadata()).characters; }
  async function getSeasons() { return (await metadata()).seasons; }
  function getProfile(nickname) { return request('/profile?' + new URLSearchParams({ nickname })); }
  async function getMatches(nickname, { pages = 3, season = null, mode = null } = {}) {
    const data = await request('/matches?' + new URLSearchParams({ nickname, pages }));
    return data.matches.filter(m => (!season || String(m.seasonId) === String(season)) && (!mode || m.matchingMode === mode));
  }
  async function getGame(gameId) { return (await request(`/games/${encodeURIComponent(gameId)}`)).matches; }
  async function findGameRecord(nickname, gameId) {
    const rows = await getGame(gameId);
    return rows.find(row => row.nickname === nickname) || null;
  }
  function charImgUrl(key) { return characters.find(c => c.key.toLowerCase() === String(key).toLowerCase())?.imageUrl || ''; }
  function skinImgUrl(imageName) {
    for (const character of characters) {
      const skin = character.skins.find(s => s.imageName === imageName);
      if (skin) return skin.profileUrl;
    }
    return charImgUrl(String(imageName).replace(/_S\d+$/, ''));
  }
  async function imgToDataUri(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('실험체 이미지를 불러오지 못했습니다.');
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
    });
  }
  global.ERCore = { META_TTL, cacheGet, cacheSet, metadata, getCharacters, getSeasons, getProfile,
    getMatches, getGame, findGameRecord, charImgUrl, skinImgUrl, imgToDataUri };
})(typeof window !== 'undefined' ? window : globalThis);
