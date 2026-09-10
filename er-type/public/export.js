/* Result cards are drawn locally. No remote fonts, images, or rendering API. */
(function (global) {
  'use strict';

  const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const WIDTH = 1080;
  const HEIGHT = 1512;

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

  async function render(profile, nickname = '') {
    const type = global.LumiaType?.getType(profile?.code);
    if (!type) throw new Error('유형을 먼저 선택해주세요.');
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
    text('LUMIA ARCHIVES   /   TEAMMATE FILE', 82, 66, 20, '#a9bebd');
    text('이리 팀원 유형 검사', 82, 110, 25, '#e4e9e2');
    line(82, 170, 916, '#526367');
    const fileNumber = String(parseInt(type.code, 2) + 1).padStart(2, '0');
    text('TYPE ' + fileNumber + ' / 16', 82, 214, 24, accent);

    // Four small marks encode the four gameplay preferences, as a file emblem.
    type.code.split('').forEach((bit, i) => {
      const x = 840 + (i % 2) * 68;
      const y = 212 + Math.floor(i / 2) * 68;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 50, 50);
      ctx.fillStyle = accent;
      ctx.fillRect(x + (bit === '0' ? 8 : 29), y + 8, 13, 34);
    });
    const cleanName = typeof nickname === 'string' ? nickname.trim().slice(0, 100) : '';
    text(cleanName ? cleanName + '의 플레이 성향' : '나는 어떤 이리 팀원일까?', 82, 288, 26, '#a9bebd', 704, 38, 1);
    const titleBottom = text(type.name, 78, 354, 68, '#eef0e8', 924, 86, 2, 700);
    text('“' + type.tagline + '”', 82, titleBottom + 24, 30, accent, 916, 44, 3);

    ctx.fillStyle = '#e8e9df';
    ctx.fillRect(48, 686, 984, 712);
    text('나의 네 가지 선택', 82, 724, 22, '#526562');
    let x = 82;
    global.LumiaType.axes.forEach((axis, i) => {
      text(axis.poles[Number(type.code[i])], x, 770, 37, '#20342e', 204, 50, 1, 700);
      x += 229;
    });
    line(82, 845, 916, '#b9c2b5');
    text('내가 보는 나', 82, 878, 22, '#617069');
    text(type.selfView, 82, 920, 28, '#243830', 916, 42, 3);
    text('팀원이 보는 나', 82, 1070, 22, '#617069');
    text(type.teamView, 82, 1112, 28, '#243830', 916, 42, 3);
    line(82, 1255, 916, '#b9c2b5');
    const best = global.LumiaType.getType(type.best);
    text('같이 큐 잡고 싶은 유형', 82, 1284, 20, '#617069');
    text(best?.name || '서로의 콜을 들어주는 팀원', 82, 1325, 29, '#243830', 916, 42, 1, 600);
    text('게임 플레이를 재미로 보는 12문항 검사', 82, 1425, 20, '#a9bebd');
    const url = new URL('/type/', location.href);
    text(url.host + url.pathname, 82, 1460, 19, '#a9bebd');
    return canvas;
  }

  async function save(profile, nickname) {
    const canvas = await render(profile, nickname);
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
