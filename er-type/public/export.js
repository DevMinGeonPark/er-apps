/* One local card renderer for PNG, native sharing, and PDF printing. */
(function (global) {
  'use strict';

  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const WIDTH = 1080;
  const HEIGHT = 1512;
  const portraits = new Map();

  function loadPortrait(code) {
    if (portraits.has(code)) return portraits.get(code);
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => { portraits.delete(code); reject(new Error('유형 그림을 불러오는 중입니다. 잠시 뒤 다시 저장해 주세요.')); }, 15000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); portraits.delete(code); reject(new Error('유형 그림을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.')); };
      img.src = new URL(`/type/art/${code}.png`, location.href).href;
    });
    portraits.set(code, promise);
    return promise;
  }

  function textLines(ctx, value, width, maxLines = Infinity) {
    const lines = [];
    let line = '';
    for (const char of Array.from(String(value ?? ''))) {
      if (char === '\n' || (line && ctx.measureText(line + char).width > width)) {
        lines.push(line.trimEnd());
        line = char === '\n' ? '' : char;
      } else line += char;
    }
    if (line) lines.push(line.trimEnd());
    if (lines.length > maxLines) {
      lines.length = maxLines;
      let last = lines.at(-1);
      while (last && ctx.measureText(last + '…').width > width) last = Array.from(last).slice(0, -1).join('');
      lines[maxLines - 1] = last + '…';
    }
    return lines;
  }

  async function render(profile, nickname = '', scored = null) {
    const type = global.LumiaType?.getType(profile?.code);
    if (!type) throw new Error('유형을 먼저 선택해주세요.');
    const portrait = await loadPortrait(type.code);
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이 브라우저에서는 카드 이미지를 만들 수 없어요.');
    const colors = ['#c7d5c3', '#b7cbd5', '#d5bfaa', '#c6bfd5'];
    const accent = colors[parseInt(type.code, 2) % colors.length];
    ctx.fillStyle = '#0d1b21';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const line = (x, y, w, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, 1); };
    function text(value, x, y, size, color, width = 916, lineHeight = size * 1.45, maxLines = Infinity, weight = 400) {
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      const lines = textLines(ctx, value, width, maxLines);
      lines.forEach((part, i) => ctx.fillText(part, x, y + i * lineHeight));
      return y + lines.length * lineHeight;
    }
    text('LUMIA ARCHIVES   /   TEAMMATE FILE', 64, 49, 20, '#a9bebd');
    text('이리 팀원 유형 검사', 64, 88, 25, '#e4e9e2');
    line(64, 144, 952, '#526367');
    const fileNumber = String(parseInt(type.code, 2) + 1).padStart(2, '0');
    text('TYPE ' + fileNumber + ' / 16', 64, 184, 22, accent);
    ctx.drawImage(portrait, 606, 194, 410, 410);
    const cleanName = typeof nickname === 'string' ? nickname.trim().slice(0, 100) : '';
    text(cleanName ? cleanName + '의 플레이 성향' : '나는 어떤 이리 팀원일까?', 64, 236, 23, '#a9bebd', 496, 34, 1);
    const titleBottom = text(type.name, 60, 295, 58, '#eef0e8', 506, 76, 3, 700);
    text('“' + type.tagline + '”', 64, titleBottom + 23, 26, accent, 495, 39, 3);

    ctx.fillStyle = '#e8e9df';
    ctx.fillRect(48, 660, 984, 738);
    text(scored ? '나의 네 가지 선택' : '이 유형의 네 가지 성향', 82, 692, 22, '#526562');
    global.LumiaType.axes.forEach((axis, i) => {
      const pole = Number(type.code[i]);
      const candidate = scored?.code === type.code ? scored.axes?.[i]?.counts : null;
      const counts = Array.isArray(candidate) && candidate.length === 2 && candidate.every(n => Number.isInteger(n) && n >= 0 && n <= 3)
        && candidate[0] + candidate[1] === 3 && candidate[pole] >= 2 ? candidate : null;
      const cx = 197 + i * 229;
      const cy = 842;
      function centered(value, y, size, color, weight = 400) {
        ctx.font = `${weight} ${size}px ${FONT}`;
        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        ctx.fillText(value, cx - ctx.measureText(value).width / 2, y);
      }
      centered(axis.poles.join(' · '), 750, 21, '#53654d');
      ctx.beginPath();
      ctx.lineWidth = counts ? 14 : 5;
      ctx.strokeStyle = '#bdc8b4';
      ctx.setLineDash(counts ? [] : [4, 7]);
      ctx.arc(cx, cy, 61, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (counts) {
        ctx.beginPath();
        ctx.strokeStyle = '#536e58';
        ctx.arc(cx, cy, 61, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * counts[pole] / 3);
        ctx.stroke();
      }
      centered(axis.poles[pole], 813, 33, '#314b38', 600);
      centered(counts ? `${counts[pole]} / 3 선택` : '유형 성향', 858, 18, '#5d6b54');
      centered(counts ? `${axis.poles[0]} ${counts[0]}회 · ${axis.poles[1]} ${counts[1]}회` : axis.poles[pole] + ' 성향', 932, 18, '#53654d');
    });
    line(82, 983, 916, '#b9c2b5');
    text('내가 보는 나', 82, 1015, 22, '#617069');
    text(type.selfView, 82, 1059, 27, '#243830', 422, 40, 4);
    text('팀원이 보는 나', 574, 1015, 22, '#617069');
    text(type.teamView, 574, 1059, 27, '#243830', 422, 40, 4);
    line(82, 1237, 916, '#b9c2b5');
    const best = global.LumiaType.getType(type.best);
    text('같이 큐 잡고 싶은 유형', 82, 1267, 20, '#617069');
    text(best?.name || '서로의 콜을 들어주는 팀원', 82, 1308, 30, '#243830', 916, 42, 1, 600);
    text('게임 플레이를 재미로 보는 12문항 검사', 82, 1425, 20, '#a9bebd');
    const url = new URL('/type/', location.href);
    text(url.host + url.pathname, 82, 1460, 19, '#a9bebd');
    return canvas;
  }

  async function save(profile, nickname, scored = null) {
    const canvas = await render(profile, nickname, scored);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('이미지를 저장하지 못했어요. 다시 눌러주세요.')), 'image/png'));
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lumia-type-' + profile.code + '.png';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { blob, filename: link.download };
  }

  global.LumiaTypeExport = { render, save };
})(globalThis);
