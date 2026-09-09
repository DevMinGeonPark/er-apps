// 자격증·신용평가의 전 시즌 상세 누적 및 스킨 이미지용 DAK 클라이언트.
// 이름·직군은 공식 ERCore 메타에서 읽고, 기존 전 시즌 기록의 DAK ID는 별도로 유지한다.
(function (global) {
  const DAK = 'https://er.dakgg.io/api/v1';
  const META_TTL = 6 * 3600 * 1000;

  const cache = new Map(); // key -> { at, ttl, value }
  function cacheGet(key) {
    const e = cache.get(key);
    if (!e) return null;
    if (Date.now() - e.at > e.ttl) { cache.delete(key); return null; }
    return e.value;
  }
  function cacheSet(key, value, ttl) {
    cache.set(key, { at: Date.now(), ttl, value });
    if (cache.size > 800) {
      const now = Date.now();
      for (const [k, e] of cache) if (now - e.at > e.ttl) cache.delete(k);
    }
  }

  async function dakJson(pathname, ttl) {
    const key = 'dak:' + pathname;
    const hit = cacheGet(key);
    if (hit) return hit;
    const res = await fetch(DAK + pathname, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const err = new Error(`dak.gg ${res.status} for ${pathname}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    cacheSet(key, json, ttl);
    return json;
  }

  // 이미지 URL을 동기적으로 뽑아야 해서(렌더 중 호출) 따로 들고 있는다
  let charsCache = null;
  async function getCharacters() {
    if (charsCache) return charsCache;
    const [d, official] = await Promise.all([
      dakJson('/data/characters?hl=ko', META_TTL), global.ERCore.getCharacters(),
    ]);
    const byKey = new Map(official.map(c => [c.key, c]));
    charsCache = d.characters.map(c => {
      const current = byKey.get(c.key);
      if (!current) throw new Error(`공식 실험체 정보와 연결하지 못했습니다: ${c.key}`);
      return ({
      id: c.id, key: c.key, name: current.name, imageUrl: 'https:' + c.imageUrl,
      masteries: c.masteries || [],
      archeTypes: current.archeTypes,
      skins: (c.skins || []).map(s => ({
        id: s.id, name: s.name, grade: s.grade, imageName: s.imageName,
        // CharResult(전신) URL을 CharProfile(초상)로 바꿔 증명사진용으로 사용
        profileUrl: ('https:' + s.imageUrl).replace('CharResult_', 'CharProfile_'),
      })),
    }); });
    return charsCache;
  }

  // 구 /img/char/:key · /img/skin/:imageName 프록시 라우트 대체.
  // getCharacters() 이후에만 호출된다(렌더 시점).
  function charImgUrl(key) {
    if (!key) return '';
    const k = String(key).toLowerCase();
    const c = (charsCache || []).find(x => x.key.toLowerCase() === k);
    return c ? c.imageUrl : '';
  }
  function skinImgUrl(imageName) {
    if (!imageName) return '';
    for (const c of charsCache || []) {
      const s = c.skins.find(x => x.imageName === imageName);
      if (s) return s.profileUrl;
    }
    // 스킨 목록이 비어 합성한 <key>_S000 인 경우 기본 캐릭터 이미지로 떨어뜨린다
    const m = /^(.+)_S\d+$/.exec(imageName);
    return m ? charImgUrl(m[1]) : '';
  }

  // 이미지 -> data: URI (SVG 인라인 삽입용). 구 프록시가 하던 일.
  async function imgToDataUri(url) {
    const blob = await (await fetch(url)).blob();
    return await new Promise(r => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsDataURL(blob);
    });
  }

  global.DAKCore = { DAK, META_TTL, cacheGet, cacheSet, dakJson, getCharacters, charImgUrl, skinImgUrl, imgToDataUri };
})(typeof window !== 'undefined' ? window : globalThis);
