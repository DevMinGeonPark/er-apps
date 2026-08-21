#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wuxia-forge — 이터널리턴 전적을 무협 방파 페르소나 사이트로 만들어 배포한다.

  python3 forge.py <계정명> [--slug feiran] [--port 3230] [--no-deploy] [--open-sec wudang]

1) dak.gg 전적 스크래핑(헤드리스 Chrome)
2) 방파 카탈로그(디자인 팔레트는 코드가 통제)
3) Claude(claude -p)가 방파 선택 + 도호/무공 별칭/카피 생성
4) 템플릿 렌더 → 단일 HTML
5) pm2 serve + Cloudflare 터널 ingress/DNS 자동 배포
"""
import sys, os, re, json, subprocess, argparse, html, urllib.parse, glob, time, base64

ROOT = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(ROOT, "template.html")
TUNNEL_ID = "6f3e3a11-eda8-4e16-b447-741ac0f39095"
CF_CONFIG = os.path.expanduser("~/.cloudflared/config.yml")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SERVE_BASE = os.path.expanduser("~/move")
DOMAIN = "dev-heptivision.com"

# ───────────────────────── 색 헬퍼 ─────────────────────────
def _hx(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def _to(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(c))) for c in rgb)
def mix(a, b, t):
    ra, rb = _hx(a), _hx(b); return _to(tuple(ra[i] + (rb[i]-ra[i])*t for i in range(3)))
def lighten(h, t): return mix(h, "#ffffff", t)
def darken(h, t):  return mix(h, "#000000", t)
def rgba(h, a):
    r, g, b = _hx(h); return f"rgba({r},{g},{b},{a})"

# ───────────────────────── 방파 카탈로그 ─────────────────────────
# 디자인 팔레트는 여기서 통제. Claude는 'sect' 키만 고르고 텍스트를 채운다.
SECTS = {
 "shaolin":  dict(ko="소림사", hanja="少林", sigil="禪", top="少 林 寺",
   kicker="SHAOLIN · 少林 武僧錄", void="#140f0a", accent="#d9a441", abright="#f0c66a",
   sub="#c0703a", gold="#e6c98a", ink="#efe6d6", inkb="#fff8ec",
   tier_hint="최상위·탱커/브루저·인내", desc="정파 최고봉. 외공/나한권, 강인한 방어와 인내의 무승 문파."),
 "wudang":   dict(ko="무당파", hanja="武當", sigil="太", top="武 當 派",
   kicker="WUDANG · 武當派 道行錄", void="#081416", accent="#4fd6bf", abright="#73f0db",
   sub="#6db8e8", gold="#cdb47e", ink="#dff3ee", inkb="#eef5f3",
   tier_hint="고티어·밸런스·유능제강", desc="태극의 유(柔)로 강을 제압. 권/검 균형, 침착한 도가 검선."),
 "hwasan":   dict(ko="화산파", hanja="華山", sigil="梅", top="華 山 派",
   kicker="HWASAN · 華山派 梅花譜", void="#160a10", accent="#ff6fa5", abright="#ff9cc4",
   sub="#c264ff", gold="#e6b8d0", ink="#f6e6ee", inkb="#fff2f7",
   tier_hint="고티어·검·화려한 콤보", desc="매화검법. 화려하고 현란한 검초, 콤보로 적을 베는 검문."),
 "amita":    dict(ko="아미파", hanja="峨嵋", sigil="峨", top="峨 嵋 派",
   kicker="AMITA · 峨嵋派 慈劍錄", void="#0d0a18", accent="#a98cff", abright="#c6b2ff",
   sub="#5fd6e0", gold="#cdb47e", ink="#e7e2f5", inkb="#f3f0ff",
   tier_hint="여성문파·우아·표독", desc="여협의 문파. 우아하나 표독한 자청 검, 불도(佛道)의 자비와 살(殺)."),
 "tangmun":  dict(ko="당문", hanja="唐門", sigil="毒", top="唐 門",
   kicker="TANGMUN · 唐門 暗器譜", void="#0a140d", accent="#7fd14b", abright="#a6f06f",
   sub="#caa45a", gold="#b9d97a", ink="#e2f3df", inkb="#f0fff0",
   tier_hint="암살·포킹·원거리·독", desc="사천당가. 암기와 독, 거리에서 적을 갉는 암살·견제 문파."),
 "paengga":  dict(ko="하북팽가", hanja="彭家", sigil="刀", top="河 北 彭 家",
   kicker="PAENGGA · 河北彭家 刀譜", void="#100b0a", accent="#d6483a", abright="#ff6a52",
   sub="#8a8f99", gold="#caa45a", ink="#f0e2df", inkb="#fff4f0",
   tier_hint="패도·근접·한방", desc="오대세가의 도가(刀家). 묵직한 패도와 일도양단, 강철 같은 근접 압박."),
 "haomun":   dict(ko="하오문", hanja="下五門", sigil="影", top="下 五 門",
   kicker="HAOMUN · 下五門 暗影錄", void="#0a0e10", accent="#3fb6a0", abright="#6fe0c4",
   sub="#7a6f8a", gold="#9a8c5a", ink="#dfeae8", inkb="#eef5f3",
   tier_hint="암살·잠입·정보", desc="밑바닥 정보조직. 그림자에 숨어 단검으로 숨통을 끊는 자객들의 문(門)."),
 "cheonma":  dict(ko="천마신교", hanja="天魔", sigil="魔", top="天 魔 神 敎",
   kicker="HEAVENLY DEMON · 天魔神敎", void="#0a0608", accent="#d62828", abright="#ff3b30",
   sub="#9b3fdb", gold="#caa45a", ink="#ece0cf", inkb="#fff5f0",
   tier_hint="최상위·극공격·하이리스크", desc="마교. 압도적 공격성과 하이리스크 하이리턴, 본좌의 마공."),
 "hyeolgyo": dict(ko="혈교", hanja="血敎", sigil="血", top="血 敎",
   kicker="BLOOD CULT · 血敎", void="#0c0506", accent="#e02233", abright="#ff4555",
   sub="#a8324a", gold="#b08040", ink="#f0d8d8", inkb="#fff0f0",
   tier_hint="공격·다이브·피의 한타", desc="사파 혈교. 피를 보는 다이브와 난전, 광기의 혈공."),
 "jeomchang":dict(ko="점창파", hanja="點蒼", sigil="劍", top="點 蒼 派",
   kicker="JEOMCHANG · 點蒼派 快劍", void="#08120f", accent="#3fd6a0", abright="#6ff0c4",
   sub="#5fbce0", gold="#cdb47e", ink="#dff3ec", inkb="#eef5f1",
   tier_hint="기동·쾌속·암살·추격", desc="쾌검의 문파. 빠른 기동과 추격, 한 호흡에 베는 속도의 검."),
 "gonryun":  dict(ko="곤륜파", hanja="崑崙", sigil="仙", top="崑 崙 派",
   kicker="GONRYUN · 崑崙派 雲劍", void="#0a1018", accent="#8fc7f0", abright="#b8e0ff",
   sub="#a98cff", gold="#cdb47e", ink="#e6eef5", inkb="#f4faff",
   tier_hint="중상위·정석·운영", desc="신선의 검문. 구름 같은 운영과 정석, 멀리 보는 대국관."),
 "hangsan":  dict(ko="항산파", hanja="恒山", sigil="恒", top="恒 山 派",
   kicker="HANGSAN · 恒山派 慈悲劍", void="#0e0a14", accent="#b89cff", abright="#d4c2ff",
   sub="#8fc7f0", gold="#cdb47e", ink="#e9e4f3", inkb="#f5f2ff",
   tier_hint="여성문파·수비·끈기", desc="비구니 검문. 자비와 인내, 끈질긴 수비로 끝까지 버티는 여승의 검."),
 "gaebang":  dict(ko="개방", hanja="丐幇", sigil="丐", top="丐 幇",
   kicker="GAEBANG · 丐幇 浪人錄", void="#120d08", accent="#c79a4e", abright="#e0b86a",
   sub="#8a6f3a", gold="#d9c089", ink="#ece2cf", inkb="#fff6e6",
   tier_hint="저~중티어·자유·다인원", desc="천하제일 거지방. 격식 없이 자유로운 막싸움, 흥과 깡의 방파."),
 "nokrim":   dict(ko="녹림", hanja="綠林", sigil="林", top="綠 林",
   kicker="NOKRIM · 綠林 山賊錄", void="#0a1410", accent="#5fb86f", abright="#82e090",
   sub="#caa45a", gold="#b9d97a", ink="#e0f0e2", inkb="#f0fff0",
   tier_hint="저티어·근성·기습", desc="산채의 녹림호걸. 거칠고 근성 있는 기습과 패도, 산적의 무공."),
 "bukhae":   dict(ko="북해빙궁", hanja="氷宮", sigil="氷", top="北 海 氷 宮",
   kicker="BUKHAE · 北海氷宮 雪錄", void="#08121c", accent="#6fd0f0", abright="#a8e8ff",
   sub="#b0a8e0", gold="#cdd8e8", ink="#dfeef5", inkb="#f0f8ff",
   tier_hint="새외·냉정·빙공·설녀", desc="새외의 빙궁. 차갑고 고고한 설녀들의 빙공, 감정을 얼린 절대 냉정."),
 "seojang":  dict(ko="서장밀교", hanja="密敎", sigil="密", top="西 藏 密 敎",
   kicker="SEOJANG · 西藏密敎 呪錄", void="#140c1c", accent="#b07ad0", abright="#d4a0f0",
   sub="#d0a85a", gold="#e0c070", ink="#ece2f5", inkb="#f6f0ff",
   tier_hint="새외·주술·밀법·소환", desc="설산 너머 밀교. 주문과 소환, 알 수 없는 밀법을 부리는 이방의 술사들."),
 "namman":   dict(ko="남만야수궁", hanja="野獸宮", sigil="獸", top="南 蠻 野 獸 宮",
   kicker="NAMMAN · 南蠻野獸宮 獸錄", void="#0c1409", accent="#8fc83a", abright="#b6e860",
   sub="#caa45a", gold="#b9d97a", ink="#e2f0da", inkb="#f0ffe6",
   tier_hint="새외·야수·고독·원시", desc="남쪽 변방의 야수궁. 맹수를 부리고 고독(蠱毒)을 다루는, 길들지 않은 야성의 무리."),
 "gongjeok": dict(ko="무림공적", hanja="公敵", sigil="敵", top="武 林 公 敵",
   kicker="ENEMY OF THE MARTIAL WORLD · 武林公敵", void="#0c0807", accent="#c0392b", abright="#e74c3c",
   sub="#7a6a5a", gold="#9a7a3a", ink="#e8dcc8", inkb="#fff2e2",
   tier_hint="수배·탈주·추방·무소속", desc="어느 문파에도 속하지 않고, 무림을 등지고 잠적하여 모든 문파의 수배를 받는 공공의 적. 돌아오지 않는 탈주자."),
}

def css_vars(key):
    s = SECTS[key]
    v, ac, ab, sub, gold, ink, inkb = (s["void"], s["accent"], s["abright"],
                                       s["sub"], s["gold"], s["ink"], s["inkb"])
    ad = darken(ac, .35)
    vars = {
        "void": v, "void2": lighten(v, .04), "panel": mix(v, ac, .10),
        "panel2": mix(v, ac, .16), "accent": ac, "accent-bright": ab,
        "accent-deep": ad, "sub": sub, "gold": gold, "ink": ink, "ink-bright": inkb,
        "ash": mix(ink, v, .45), "line-accent": rgba(ac, ".3"),
        "glow1": rgba(ac, ".13"), "glow2": rgba(sub, ".12"), "glow3": rgba(ad, ".18"),
        "mote": rgba(ab, ".5"), "gate1": darken(mix(v, ac, .12), .2), "gate2": darken(v, .35),
        "accent-glow": rgba(ac, ".5"), "accent-soft": rgba(ac, ".16"),
        "accent-ring": rgba(ac, ".5"), "accent-ring2": rgba(sub, ".5"),
        "chip-bg": rgba(ac, ".05"), "trend-bg": rgba(mix(v, ac, .08), ".6"),
        "out-bg": f"linear-gradient(160deg, {rgba(ad,'.22')}, {lighten(v,.04)})",
    }
    return "\n".join(f"  --{k}:{val};" for k, val in vars.items())

# ───────────────────────── 대표 이미지 (모스트1 reference) ─────────────────────────
def openai_key():
    p = os.path.expanduser("~/move/homepage/.env.local")
    if os.path.exists(p):
        for line in open(p):
            if line.startswith("OPENAI_API_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("OPENAI_API_KEY", "")

def gen_persona_image(out_dir, rec, sect):
    """모스트1 캐릭터 초상을 reference로, 분류된 문파 무드의 개인 대표 키아트를 생성."""
    key = openai_key()
    if not key or not rec["arts"]:
        return False
    en = rec["arts"][0]["en"]
    purl = f"https://cdn.dak.gg/assets/er/game-assets/11.4.0/CharProfile_{en}_S000.png"
    pin = f"/tmp/forge_portrait_{en}.png"
    subprocess.run(["curl", "-s", "-m", "30", "-o", pin, purl], capture_output=True)
    if not os.path.exists(pin) or os.path.getsize(pin) < 1000:
        return False
    S = SECTS[sect]
    prompt = (f"Reimagine the person in this image as a {S['ko']} ({S['hanja']}) warrior of the Korean wuxia "
              f"martial-arts world. {S['desc']} Keep their recognizable face, hair and outfit motifs, but transform "
              f"them into a wuxia martial artist with period robes and a fitting weapon. Ink-wash painting fused with "
              f"dark fantasy game key art, {S['accent']} color palette, dramatic cinematic lighting, vertical portrait, "
              f"no text, no watermark.")
    out = os.path.join(out_dir, "keyart.png")
    r = subprocess.run(["curl", "-s", "-m", "180", "https://api.openai.com/v1/images/edits",
        "-H", f"Authorization: Bearer {key}",
        "-F", "model=gpt-image-1", "-F", f"image[]=@{pin}",
        "-F", f"prompt={prompt}", "-F", "size=1024x1536", "-F", "quality=medium"],
        capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        open(out, "wb").write(base64.b64decode(d["data"][0]["b64_json"]))
        return True
    except Exception as e:
        print("   이미지 생성 실패:", str(e)[:100], "::", r.stdout[:160])
        return False

# ───────────────────────── 스크래핑 ─────────────────────────
def fetch_dom(account):
    enc = urllib.parse.quote(account)
    url = f"https://dak.gg/er/players/{enc}"
    out = f"/tmp/forge_{enc}.html"
    udir = f"/tmp/chrome-forge-{enc}"
    if os.path.exists(out):
        os.remove(out)
    p = subprocess.Popen([CHROME, "--headless=new", f"--user-data-dir={udir}",
        "--disable-gpu", "--no-sandbox", "--virtual-time-budget=15000",
        "--dump-dom", url], stdout=open(out, "w"), stderr=subprocess.DEVNULL)
    for _ in range(28):
        time.sleep(1)
        if os.path.exists(out) and os.path.getsize(out) > 8000:
            break
    time.sleep(1)
    subprocess.run(["pkill", "-f", f"chrome-forge-{enc}"], capture_output=True)
    subprocess.run(["pkill", "-f", "GoogleUpdater"], capture_output=True)
    return out, url

def _clean(t):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t)).strip()

def parse_record(path):
    raw = open(path, encoding="utf-8", errors="ignore").read()
    rec = {"raw_tier": None, "tier": None, "rp": None, "rank": None,
           "local_rank": None, "level": None, "tier_emblem": None, "arts": []}
    m = re.search(r'images/rank/round/(\d+)\.png', raw)
    if m:
        rec["tier_emblem"] = f"https://cdn.dak.gg/assets/er/images/rank/round/{m.group(1)}.png"
    m = re.search(r'class="tier">([^<]+)</div>', raw)
    if m: rec["raw_tier"] = _clean(m.group(1))
    m = re.search(r'class="rp">([\d,]+)<span', raw)
    if m: rec["rp"] = m.group(1).replace(",", "")
    m = re.search(r'class="rank">([^<]+)</div>', raw)
    if m: rec["rank"] = _clean(m.group(1))
    m = re.search(r'class="local-rank">([^<]+)</div>', raw)
    if m: rec["local_rank"] = _clean(m.group(1))
    m = re.search(r'(?:Lv\.?|레벨)\s*([\d,]+)', raw) or re.search(r'accountLevel"?\s*:\s*(\d+)', raw)
    if m: rec["level"] = m.group(1).replace(",", "")
    # 모스트 캐릭터 (랭크 실험체 통계 테이블)
    for tr in re.findall(r'<tr>(.*?)</tr>', raw, re.S):
        if 'class="character"' not in tr:
            continue
        name = re.search(r'character-name">([^<]+)<', tr)
        plays = re.search(r'class="plays">([^<]+)<', tr)
        wr = re.search(r'class="win-rate">([^<]+)<', tr)
        en = re.search(r'/er/characters/([A-Za-z0-9_]+)', tr)
        rp = re.search(r'class="rp"[^>]*>.*?>([\d,]+)<', tr, re.S)
        if not name:
            continue
        rec["arts"].append({
            "name": _clean(name.group(1)),
            "en": en.group(1) if en else "",
            "plays": _clean(plays.group(1)) if plays else "",
            "winrate": _clean(wr.group(1)) if wr else "",
            "rp": rp.group(1).replace(",", "") if rp else "",
        })
    rec["arts"] = rec["arts"][:6]
    if rec["raw_tier"]:
        rec["tier"] = re.split(r"\s*-\s*", rec["raw_tier"])[0].strip()
    return rec

# ───────────────────────── Claude 페르소나 ─────────────────────────
def load_char_sects():
    """factions.json의 캐릭터→문파 매핑 (en→sect)을 로드."""
    p = os.path.join(ROOT, "factions.json")
    m = {}
    if os.path.exists(p):
        for sect, arr in json.load(open(p)).items():
            for c in arr:
                if c.get("en"):
                    m[c["en"]] = sect
    return m

def decide_sect(rec, char_sects):
    """모스트 순서대로 factions.json에 등록된 첫 실험체의 문파 = 그 유저의 문파."""
    for a in rec["arts"]:
        if a["en"] in char_sects:
            return char_sects[a["en"]]
    return "gaebang"  # 미등록 시 개방(낭인)

def build_persona(account, rec, sect, note=""):
    """문파는 모스트로 이미 정해졌다. Claude는 그 문파 기준 도호·카피·무공별칭·교리만 생성."""
    S = SECTS[sect]
    note_line = f"\n[이 사람의 캐릭터 이미지 힌트 — 도호·카피·교리에 반드시 녹여라] {note}\n" if note else ""
    arts_txt = "\n".join(
        f"  {i+1}. {a['name']} ({a['en']}) — {a['plays']}, 승률 {a['winrate']}, RP {a['rp']}"
        for i, a in enumerate(rec["arts"])) or "  (모스트 없음)"
    schema = {
      "title_hanja": "히어로 큰 한자 도호 3~4자 (예 飛蘭眞人)",
      "gate_name": "인트로 닉 한자 2~3자",
      "hero_sub": f"닉 · {S['ko']} 직위 (예 페이란 · {S['ko']} 장로)",
      "hero_copy": "히어로 카피 1~2문장. <b>강조</b> 1~2개 허용. 전적 사실을 무협 어투로.",
      "scrollcue": "스크롤 유도 문구 (예 도행을 살피려면 내려가라 ▾)",
      "rec_title": "전적 섹션 제목 (예 도행 이력)", "rec_hanja": "1자",
      "art_title": f"모스트 섹션 제목 (예 {S['ko']} 절기)", "art_hanja": "1자",
      "main_realm": "메인 절기 구분선 라벨 (예 本派 絶藝 · MAIN)",
      "dao_title": f"교리 섹션 제목 (예 {S['ko']} 三道)", "dao_hanja": "1자",
      "bg": ["배경 워터마크 한자 4자 배열"],
      "arts": [{"art_ko": "무공 한글명", "art_hanja": "glyph용 한자 1자",
                "who": "캐릭터역할 · 무공(한자) 형식", "note": "1~2문장 해설"}],
      "doctrines": [{"no": "一", "h": "교리 제목", "p": "<span class='k'>키워드</span> 포함 해설"}],
      "out_title": "마무리 제목", "out_desc": "마무리 한 문장", "out_seal": "인장 한자 1자",
    }
    prompt = f"""너는 무협 설정 작가다. 한 이터널리턴 플레이어의 무협 페르소나를 만든다.

이 사람은 모스트(주력) 실험체에 따라 이미 **{S['ko']}({S['hanja']})** 소속으로 정해졌다.
{S['ko']} 이미지: {S['desc']} (기풍: {S['tier_hint']})

[플레이어] 닉네임: {account}
[전적] 티어 {rec.get('tier')} / RP {rec.get('rp')} / {rec.get('rank')} / 레벨 {rec.get('level')}
[모스트 실험체 — {S['ko']} 무공으로 별칭]
{arts_txt}
{note_line}
[지침]
- 이 사람을 {S['ko']}의 무인으로 그려라. 도호·카피·무공별칭·교리 모두 {S['ko']} 색깔에 맞게.
- arts 배열은 위 모스트 순서와 1:1, 같은 개수. 첫 번째가 그 사람의 '절기(메인)'.
- 실제 수치는 코드가 넣으니 너는 무공 별칭/해설만. 승률 낮아도 비하 말고 '수련 중인 비기'로.
- 한자는 실존 글자만. 과장·환각 금지, 전적 근거.
- 반드시 JSON만 출력(설명/마크다운 금지):
{json.dumps(schema, ensure_ascii=False, indent=1)}
"""
    res = subprocess.run(["claude", "-p", prompt], capture_output=True, text=True, timeout=240)
    m = re.search(r"\{.*\}", res.stdout.strip(), re.S)
    if not m:
        raise RuntimeError("Claude JSON 파싱 실패:\n" + res.stdout[:500])
    p = json.loads(m.group(0))
    p["sect"] = sect
    return p

# ───────────────────────── 렌더 ─────────────────────────
def esc(s): return html.escape(str(s), quote=True)

def render(account, slug, rec, p):
    sect = p["sect"]
    if sect not in SECTS:
        sect = "gaebang"
    S = SECTS[sect]
    tpl = open(TEMPLATE, encoding="utf-8").read()

    # 칩
    chips = []
    if rec.get("tier"): chips.append(("境地", rec["tier"]))
    if rec.get("rp"):   chips.append(("RP", rec["rp"]))
    if rec["arts"]:     chips.append(("主技", rec["arts"][0]["en"].upper() or rec["arts"][0]["name"]))
    chips_html = "".join(
        f'<span class="chip"><span class="dot"></span>{esc(l)} <span class="v">{esc(v)}</span></span>'
        for l, v in chips)

    # Hero 비주얼: 모스트1 키아트 있으면 사용, 없으면 한자 인장
    keyart_ok = os.path.exists(os.path.join(SERVE_BASE, slug, "keyart.png"))
    if keyart_ok:
        hero_visual = f'<div class="hero-keyart"><img src="keyart.png" alt="{esc(p.get("title_hanja", account))}"></div>'
    else:
        hero_visual = f'<div class="hero-sigil"><svg><use href="#ring"/></svg><div class="hs-core">{esc(S["sigil"])}</div></div>'

    # 전적 스탯 카드 (티어 카드엔 dak 엠블럼)
    emb = rec.get("tier_emblem")
    cards = []
    if rec.get("tier"):
        cards.append(("境地 · TIER", rec["tier"], f"{esc(rec.get('rp',''))} RP", emb))
    if rec.get("rank"):
        cards.append(("천하 순위", rec["rank"].split("(")[0].strip(), rec.get("local_rank","").split("(")[0].strip(), None))
    if rec.get("local_rank"):
        cards.append(("대륙 순위", rec["local_rank"].split("위")[0].strip()+"위" if "위" in rec.get("local_rank","") else rec["local_rank"], "아시아 서버", None))
    if rec.get("level"):
        cards.append(("계정 경지", f"Lv.{rec['level']}", "오래 닦은 내공", None))
    while len(cards) < 4:
        cards.append(("修", "—", "", None))
    stat_html = "".join(
        ('<div class="stat">' + (f'<img class="tier-emb" src="{e}" alt="tier">' if e else "") +
         f'<div class="lab">{esc(l)}</div><div class="big">{esc(b)}</div><div class="sub">{esc(s)}</div></div>')
        for l, b, s, e in cards[:4])

    # 절기 카드
    def art_card(i, master=False):
        a = rec["arts"][i]; pa = p["arts"][i] if i < len(p.get("arts", [])) else {}
        cls = "art master" if master else "art"
        meta = []
        if a.get("plays"):   meta.append(("", a["plays"]))
        if a.get("winrate"): meta.append(("승률", a["winrate"]))
        if a.get("rp"):      meta.append(("RP", "+"+a["rp"] if not a["rp"].startswith("-") else a["rp"]))
        meta_html = "".join(f'<div><b>{esc(v)}</b>{esc(l)}</div>' for l, v in meta)
        seal = '<span class="seal-tag">絶 技</span>' if master else ''
        return (f'<div class="{cls}" style="--c:{S["accent"]};--cg:{rgba(S["accent"],".24")}">{seal}'
                f'<div class="art-top"><div class="glyph">{esc(pa.get("art_hanja","技"))}</div>'
                f'<div><h3>{esc(a["name"])}</h3><div class="who">{esc(pa.get("who",""))}</div></div></div>'
                f'<div class="meta">{meta_html}</div>'
                f'<p class="note">{esc(pa.get("note",""))}</p></div>')

    art_main = art_card(0, master=True) if rec["arts"] else ""
    art_rest = "".join(art_card(i) for i in range(1, len(rec["arts"])))

    doctrines = "".join(
        f'<div class="dao-card"><div class="no">{esc(d.get("no",""))}</div>'
        f'<h4>{esc(d.get("h",""))}</h4><p>{d.get("p","")}</p></div>'
        for d in p.get("doctrines", [])[:3])

    bg = (p.get("bg") or [S["hanja"][0], "技", "道", S["sigil"]])
    bg = (bg + ["道","技","行","心"])[:4]
    enc = urllib.parse.quote(account)

    repl = {
      "TITLE": f'{S["hanja"]} {p.get("title_hanja","")} · {account}',
      "DESC": f'{account} — {S["ko"]} 페르소나. {rec.get("tier","")} {rec.get("rp","")}RP. 이터널리턴 무협 도행록.',
      "CSS_VARS": css_vars(sect),
      "SECT_TOP": esc(S["top"]), "SIGIL": esc(S["sigil"]),
      "GATE_NAME": esc(p.get("gate_name", account)),
      "GATE_HINT": esc(p.get("scrollcue", "― 운무를 헤치고 입문하라 ―")),
      "KICKER": esc(S["kicker"]),
      "HERO_HANJA": esc(p.get("title_hanja", account)),
      "HERO_SUB": esc(p.get("hero_sub", f"{account} · {S['ko']}")),
      "HERO_COPY": p.get("hero_copy", ""),
      "CHIPS": chips_html, "HERO_VISUAL": hero_visual,
      "SCROLLCUE": esc(p.get("scrollcue", "내려가라 ▾")),
      "REC_HANJA": esc(p.get("rec_hanja", "行")), "REC_TITLE": esc(p.get("rec_title", "도행 이력")),
      "ART_HANJA": esc(p.get("art_hanja", "技")), "ART_TITLE": esc(p.get("art_title", f"{S['ko']} 절기")),
      "MAIN_REALM": esc(p.get("main_realm", "本派 絶藝 · MAIN")),
      "DAO_HANJA": esc(p.get("dao_hanja", "道")), "DAO_TITLE": esc(p.get("dao_title", f"{S['ko']} 三道")),
      "STAT_CARDS": stat_html, "TREND": esc(rec.get("trend", "RP 추이는 전적 원본에서 확인하라.")),
      "ART_MAIN": art_main, "ART_REST": art_rest, "TRAIN_BLOCK": "",
      "DOCTRINES": doctrines,
      "OUT_SEAL": esc(p.get("out_seal", S["sigil"])),
      "OUT_TITLE": esc(p.get("out_title", f"{S['ko']}의 길은 계속된다")),
      "OUT_DESC": esc(p.get("out_desc", "섬 위에서 무를 겨룰 동도를 기다리며.")),
      "DAK_URL": f"https://dak.gg/er/players/{enc}",
      "FOOT": esc(f'{S["hanja"]} · {p.get("title_hanja","")} · ETERNAL RETURN {rec.get("tier","")} {rec.get("rp","")}RP'),
      "BG_HANJA1": esc(bg[0]), "BG_HANJA2": esc(bg[1]), "BG_HANJA3": esc(bg[2]), "BG_HANJA4": esc(bg[3]),
    }
    for k, v in repl.items():
        tpl = tpl.replace("{{" + k + "}}", str(v))
    return tpl, sect

# ───────────────────────── 배포 ─────────────────────────
def used_ports():
    ports = set()
    if os.path.exists(CF_CONFIG):
        for m in re.finditer(r"localhost:(\d+)", open(CF_CONFIG).read()):
            ports.add(int(m.group(1)))
    return ports

def deploy(slug, port, html_text):
    d = os.path.join(SERVE_BASE, slug)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(html_text)
    host = f"{slug}.{DOMAIN}"
    cfg = open(CF_CONFIG).read()
    new_host = host not in cfg
    # pm2: 이미 서빙 중이면 그대로(정적 파일이라 덮어쓰기로 즉시 반영), 없을 때만 새로 기동
    exists = subprocess.run(["pm2", "describe", slug], capture_output=True).returncode == 0
    if not exists:
        subprocess.run(["pm2", "serve", d, str(port), "--name", slug, "--spa"], capture_output=True)
    # 새 호스트일 때만 DNS/ingress/터널 재시작 (기존 도메인 재배포는 터널 무중단)
    if new_host:
        subprocess.run(["cloudflared", "tunnel", "route", "dns", TUNNEL_ID, host], capture_output=True)
        block = f"  - hostname: {host}\n    service: http://localhost:{port}\n"
        cfg = cfg.replace("  - service: http_status:404", block + "  - service: http_status:404")
        open(CF_CONFIG, "w").write(cfg)
        subprocess.run(["cloudflared", "tunnel", "ingress", "validate"], capture_output=True)
        subprocess.run(["pm2", "restart", "cf-tunnel"], capture_output=True)
    subprocess.run(["pm2", "save"], capture_output=True)
    return host, new_host

# ───────────────────────── main ─────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("account")
    ap.add_argument("--slug")
    ap.add_argument("--port", type=int)
    ap.add_argument("--no-deploy", action="store_true")
    ap.add_argument("--force-sect")
    ap.add_argument("--no-image", action="store_true")
    ap.add_argument("--note", default="")
    ap.add_argument("--most")
    args = ap.parse_args()

    slug = args.slug or re.sub(r"[^a-z0-9-]", "", args.account.lower())
    if not slug:
        sys.exit("한글/비ASCII 계정은 --slug 로 영문 slug를 지정하라. 예: --slug feiran")

    print(f"▶ [1/4] 전적 수집: {args.account}")
    path, url = fetch_dom(args.account)
    rec = parse_record(path)
    if args.most:  # 특정 모스트를 1순위로 끌어올림 (문파·이미지 기준)
        rec["arts"].sort(key=lambda a: 0 if args.most in (a.get("name", ""), a.get("en", "")) else 1)
    print(f"   티어={rec.get('tier')} RP={rec.get('rp')} 모스트={[a['name'] for a in rec['arts']]}")
    if not rec["arts"] and not rec.get("tier"):
        sys.exit("   전적을 못 읽었다. 계정명/공개여부 확인.")

    print("▶ [2/4] 문파 지정 (모스트 기반) + 페르소나 생성")
    char_sects = load_char_sects()
    sect = args.force_sect or decide_sect(rec, char_sects)
    if sect not in SECTS:
        sect = "gaebang"
    most1 = rec["arts"][0]["name"] if rec["arts"] else "?"
    print(f"   문파={sect}({SECTS[sect]['ko']}) ← 모스트1 '{most1}' 기준")
    p = build_persona(args.account, rec, sect, args.note)
    print(f"   도호={p.get('title_hanja')}")

    out_dir = os.path.join(SERVE_BASE, slug)
    os.makedirs(out_dir, exist_ok=True)
    if not args.no_image:
        print("▶ [3/4] 대표 이미지 생성 (모스트1 초상 → 문파 무드 키아트)")
        ok = gen_persona_image(out_dir, rec, sect)
        print("   keyart:", "생성됨" if ok else "스킵(키 없음/실패)")
    print("▶ [3/4] 렌더")
    html_text, sect = render(args.account, slug, rec, p)
    open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8").write(html_text)
    print(f"   → {out_dir}/index.html ({len(html_text)} bytes)")

    if args.no_deploy:
        print("▶ [4/4] --no-deploy: 배포 생략")
        print(f"   미리보기: python3 -m http.server 로 {out_dir} 서빙")
        return

    port = args.port
    if not port:
        port = max([3219] + list(used_ports())) + 1
    print(f"▶ [4/4] 배포 → {slug}.{DOMAIN} (:{port})")
    host, new_host = deploy(slug, port, html_text)
    if new_host:
        time.sleep(6)  # 신규 도메인만 DNS/터널 안정 대기
    code = subprocess.run(["curl", "-s", "-m", "10", "--resolve", f"{host}:443:104.21.10.236",
                           "-o", "/dev/null", "-w", "%{http_code}", f"https://{host}/"],
                          capture_output=True, text=True).stdout
    tag = "신규 배포(터널 1회 재시작)" if new_host else "재배포(터널 무중단)"
    print(f"   https://{host}/  →  {code}  [{tag}]")

if __name__ == "__main__":
    main()
