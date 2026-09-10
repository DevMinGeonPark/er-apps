/* Explicit, local Web Share preparation. Loading this module never opens a share sheet. */
(function (root, factory) {
  'use strict';
  const share = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = share;
  if (root) root.LumiaTypeShare = share;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const PREPARE_TIMEOUT_MS = 20000;
  let current = null;
  let activeShare = null;

  function describe(profile, nickname, scored) {
    if (!profile || typeof profile.code !== 'string' || !/^[01]{4}$/.test(profile.code)) return null;
    const type = typeof root.LumiaType?.getType === 'function' ? root.LumiaType.getType(profile.code) : profile;
    if (!type || typeof type.name !== 'string') return null;
    const name = typeof nickname === 'string' ? nickname.trim().slice(0, 100) : '';
    let score = null;
    if (scored !== null && scored !== undefined) {
      if (!Array.isArray(scored.axes) || scored.axes.length !== 4 || !scored.axes.every(axis =>
        Array.isArray(axis?.counts) && axis.counts.length === 2 && axis.counts.every(count => Number.isInteger(count) && count >= 0))) return null;
      score = { ...scored, axes: scored.axes.map(axis => ({ ...axis, counts: [...axis.counts] })) };
    }
    const key = JSON.stringify([type.code, name, score ? score.axes.map(axis => axis.counts) : null]);
    return { key, type, nickname: name, scored: score };
  }

  function stateFor(description) {
    if (!description || !current || current.key !== description.key) return { ready: false, preparing: false };
    const state = { ready: current.status === 'ready' && !!current.file, preparing: current.status === 'preparing' };
    if (current.message) state.message = current.message;
    return state;
  }

  function getState(profile, nickname = '', scored = null) {
    return stateFor(describe(profile, nickname, scored));
  }

  function prepare(profile, nickname = '', scored = null) {
    const description = describe(profile, nickname, scored);
    if (!description) return Promise.resolve({ ready: false, preparing: false, message: '공유할 유형과 응답을 먼저 확인해 주세요.' });
    if (current?.key === description.key) {
      if (current.status === 'preparing') return current.promise;
      if (current.status === 'ready') return Promise.resolve(stateFor(description));
    }

    // A new entry replaces the only cached image. Late completions cannot restore old images.
    const entry = { key: description.key, status: 'preparing', file: null, message: '', promise: null };
    current = entry;
    let timeout;
    const work = Promise.resolve().then(async () => {
      if (typeof root.File !== 'function') throw new Error('이 브라우저에서는 이미지 파일 공유를 준비할 수 없습니다. 유형 링크로 공유해 주세요.');
      if (typeof root.LumiaTypeExport?.render !== 'function') throw new Error('결과 카드 이미지를 준비하지 못했습니다. 유형 링크로 공유하거나 잠시 후 다시 시도해 주세요.');
      const canvas = await root.LumiaTypeExport.render(description.type, description.nickname, description.scored);
      if (!canvas || typeof canvas.toBlob !== 'function') throw new Error('결과 카드 이미지를 준비하지 못했습니다. 유형 링크로 공유해 주세요.');
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('결과 카드를 PNG로 변환하지 못했습니다. 유형 링크로 공유해 주세요.')), 'image/png');
      });
      return new root.File([blob], 'lumia-type-' + description.type.code + '.png', { type: 'image/png' });
    });
    const deadline = new Promise((_, reject) => {
      timeout = root.setTimeout(() => reject(new Error('이미지 준비 시간이 초과되었습니다. 유형 링크로 공유하거나 다시 시도해 주세요.')), PREPARE_TIMEOUT_MS);
    });
    entry.promise = Promise.race([work, deadline]).then(file => {
      if (current !== entry) return { ready: false, preparing: false };
      entry.file = file;
      entry.status = 'ready';
      return stateFor(description);
    }, error => {
      if (current !== entry) return { ready: false, preparing: false };
      entry.status = 'failed';
      entry.message = error?.message || '이미지 공유를 준비하지 못했습니다. 유형 링크로 공유해 주세요.';
      return stateFor(description);
    }).finally(() => root.clearTimeout(timeout));
    return entry.promise;
  }

  function linkData(description) {
    const url = new root.URL('/type/', root.location?.href || root.location?.origin);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('공유할 사이트 주소를 확인하지 못했습니다. 웹사이트에서 다시 열어 주세요.');
    url.hash = 'type=' + description.type.code;
    return {
      title: description.type.name + ' · 이리 팀원 유형 검사',
      text: description.type.name + (description.type.tagline ? ' · ' + description.type.tagline : ''),
      url: url.href,
    };
  }

  function failed(error, mode) {
    return error?.name === 'AbortError'
      ? { status: 'cancelled', mode, message: '공유를 취소했습니다.' }
      : { status: 'error', mode, message: '공유 창을 열지 못했습니다. 다시 누르거나 유형 링크 복사를 이용해 주세요.' };
  }

  function share(profile, nickname = '', scored = null) {
    const description = describe(profile, nickname, scored);
    if (!description) return Promise.resolve({ status: 'error', mode: 'link', message: '공유할 유형과 응답을 먼저 확인해 주세요.' });
    if (activeShare) {
      if (activeShare.key === description.key) return activeShare.promise;
      return Promise.resolve({ status: 'error', mode: 'link', message: '다른 공유 창이 열려 있습니다. 닫은 뒤 다시 시도해 주세요.' });
    }
    const navigator = root.navigator;
    if (typeof navigator?.share !== 'function') return Promise.resolve({ status: 'unsupported', mode: 'link', message: '이 브라우저는 공유 창을 지원하지 않습니다. 유형 링크 복사를 이용해 주세요.' });
    let payload;
    try { payload = linkData(description); }
    catch (error) { return Promise.resolve({ status: 'error', mode: 'link', message: error.message }); }

    let mode = 'link';
    if (current?.key === description.key && current.status === 'ready' && current.file && typeof navigator.canShare === 'function') {
      try {
        if (navigator.canShare({ files: [current.file] })) {
          payload = { ...payload, files: [current.file] };
          mode = 'file';
        }
      } catch { /* A file capability check may throw. Link sharing remains available. */ }
    }

    let nativeResult;
    try {
      // No render, promise continuation, or await may precede this call: preserve the click gesture.
      nativeResult = navigator.share(payload);
    } catch (error) {
      if (mode === 'file' && ['TypeError', 'NotSupportedError'].includes(error?.name)) {
        // A synchronous capability mismatch still permits link fallback in this same gesture.
        mode = 'link';
        try { nativeResult = navigator.share(linkData(description)); }
        catch (fallbackError) { return Promise.resolve(failed(fallbackError, mode)); }
      } else return Promise.resolve(failed(error, mode));
    }
    const attempt = { key: description.key, promise: null };
    attempt.promise = Promise.resolve(nativeResult).then(
      () => ({ status: 'shared', mode }),
      error => failed(error, mode),
    ).finally(() => { if (activeShare === attempt) activeShare = null; });
    activeShare = attempt;
    return attempt.promise;
  }

  return Object.freeze({ prepare, share, getState });
});
