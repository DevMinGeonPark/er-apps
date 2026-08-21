#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
arcane-forge — 이터널리턴 전적을 판타지 결사(오더) 페르소나 사이트로 만들어 배포한다.

  python3 forge.py <계정명> [--slug feiran] [--port 3260] [--no-deploy] [--force-order elementalist]

1) dak.gg 전적 스크래핑(헤드리스 Chrome)
2) 결사(오더) 카탈로그(디자인 팔레트는 코드가 통제)
3) Claude(claude -p)가 결사 선택 + 칭호/주문·기예 별칭/카피 생성
4) 템플릿 렌더 → 단일 HTML (마법서/검술서 무드)
5) pm2 serve + Cloudflare 터널 ingress/DNS 자동 배포

무협판(wuxia-forge)의 짝. 문파→오더, 무공→기예/주문, 교리→신조로 옮긴 판타지 버전.
"""
import sys, os, re, json, subprocess, argparse, html, urllib.parse, glob, time, base64

ROOT = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(ROOT, "template.html")
TUNNEL_ID = "6f3e3a11-eda8-4e16-b447-741ac0f39095"
CF_CONFIG = os.path.expanduser("~/.cloudflared/config.yml")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SERVE_BASE = os.path.expanduser("~/fantasy/sites")
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

# ───────────────────────── 결사(오더) 카탈로그 ─────────────────────────
# 디자인 팔레트는 여기서 통제. Claude는 'order' 키만 고르고 텍스트를 채운다.
# rune: 봉인 문양 1글자 / tag: 라틴 약어(타이틀·푸터용) / book: 비급서 종류 / kind: 비주얼 계열
ORDERS = {
 "elementalist": dict(ko="원소술사", tag="ARC", rune="✦", top="A R C A N U M",
   kind="grimoire", book="元素魔導書 · GRIMOIRE OF ELEMENTS",
   kicker="ELEMENTALIST · 元素魔導書", void="#0a1020", accent="#4fb8ff", abright="#8fd6ff",
   sub="#b08cff", gold="#cdb47e", ink="#dfe8f5", inkb="#f2f8ff",
   tier_hint="원거리·캐스팅·화려한 콤보", desc="화·빙·뇌의 원소를 부리는 비전 마법사. 화려한 캐스팅으로 전장을 지배한다."),
 "necromancer": dict(ko="강령술사", tag="MORS", rune="☠", top="N E C R O",
   kind="grimoire", book="死靈書 · CODEX OF THE DEAD",
   kicker="NECROMANCER · 死靈書", void="#0c0810", accent="#a64fff", abright="#c68fff",
   sub="#5fd14b", gold="#b08040", ink="#e6daf0", inkb="#f5f0ff",
   tier_hint="하이리스크·어둠·금단", desc="죽음과 어둠을 다루는 금단의 술사. 광기에 가까운 하이리스크 하이리턴의 사령 마법."),
 "cleric": dict(ko="신성 사제", tag="LVX", rune="☩", top="S A N C T U M",
   kind="grimoire", book="聖典 · LITURGY OF LIGHT",
   kicker="CLERIC · 聖典", void="#14110a", accent="#e6c46a", abright="#f5dd9a",
   sub="#8fc7e8", gold="#e6c98a", ink="#efe6d6", inkb="#fff8ec",
   tier_hint="치유·축복·서포터", desc="빛과 신성을 다루는 사제. 치유와 축복으로 동료를 지키는 자비의 성직자."),
 "swordmaster": dict(ko="검성", tag="ENS", rune="⚔", top="E N S I S",
   kind="blade", book="劍術書 · TREATISE OF THE BLADE",
   kicker="SWORDMASTER · 劍術書", void="#0a0e14", accent="#8fb8d6", abright="#c0e0f0",
   sub="#d6a45a", gold="#cdb47e", ink="#e3ecf2", inkb="#f4faff",
   tier_hint="정통 검술·밸런스·콤보", desc="검 하나에 평생을 바친 정통 검의 달인. 긍지 높은 일격과 현란한 검초."),
 "paladin": dict(ko="성기사단", tag="ORDO", rune="✠", top="O R D O",
   kind="blade", book="武勳錄 · CHRONICLE OF VALOR",
   kicker="PALADIN · 武勳錄", void="#120c08", accent="#e0b048", abright="#f0c86a",
   sub="#d65a3a", gold="#e6c98a", ink="#f0e6d6", inkb="#fff6e8",
   tier_hint="최상위·탱커·헌신", desc="맹세로 무장한 성스러운 기사. 강철 같은 방어와 헌신, 정의의 수호자."),
 "monk": dict(ko="권사", tag="PUGN", rune="❂", top="P U G I L",
   kind="blade", book="鬪氣書 · MANUAL OF THE FIST",
   kicker="MONK · 鬪氣書", void="#140a08", accent="#ff7a3a", abright="#ffa060",
   sub="#d6a45a", gold="#caa45a", ink="#f2e2d6", inkb="#fff4ec",
   tier_hint="근접·한방·정면돌파", desc="맨몸과 투기로 싸우는 무투가. 묵직한 한방과 우직한 정면돌파의 권격."),
 "assassin": dict(ko="암살길드", tag="UMBRA", rune="❖", top="U M B R A",
   kind="grimoire", book="暗影書 · LEDGER OF SHADOWS",
   kicker="ASSASSIN · 暗影書", void="#08120d", accent="#3fd6a0", abright="#6ff0c4",
   sub="#7a6f8a", gold="#9a8c5a", ink="#dfeae8", inkb="#eef5f3",
   tier_hint="암살·잠입·독·포킹", desc="그림자에 숨어 독과 단검으로 숨통을 끊는 청부 살수들의 결사."),
 "rogue": dict(ko="도적단", tag="VAGUS", rune="◈", top="V A G U S",
   kind="blade", book="浪人錄 · TALES OF THE VAGABOND",
   kicker="ROGUE · 浪人錄", void="#120d08", accent="#c79a4e", abright="#e0b86a",
   sub="#8a6f3a", gold="#d9c089", ink="#ece2cf", inkb="#fff6e6",
   tier_hint="자유·기습·다인원", desc="격식 없는 거리의 무뢰배·현상금 사냥꾼. 흥과 깡, 자유로운 기습의 한탕."),
 "imperial": dict(ko="황실 근위", tag="IMPER", rune="⚜", top="I M P E R I A L",
   kind="blade", book="勅令 · DECREE OF THE CROWN",
   kicker="IMPERIAL GUARD · 勅令", void="#0e0a16", accent="#a06ad6", abright="#c49af0",
   sub="#e6c46a", gold="#e6c46a", ink="#e9e2f3", inkb="#f6f0ff",
   tier_hint="위엄·정통·운영", desc="제국의 옥좌를 지키는 근위. 위엄과 정통, 흔들림 없는 질서의 화신."),
 "druid": dict(ko="드루이드", tag="SILVA", rune="❦", top="S I L V A",
   kind="grimoire", book="野獸誌 · BESTIARY OF THE WILD",
   kicker="DRUID · 野獸誌", void="#0a1408", accent="#6fb84f", abright="#92e070",
   sub="#caa45a", gold="#b9d97a", ink="#e2f0da", inkb="#f0ffe6",
   tier_hint="야수·정령·원시", desc="맹수와 정령을 부리는 자연의 술사. 길들지 않은 야성과 원시의 마법."),
 "ranger": dict(ko="레인저", tag="VENAT", rune="✧", top="V E N A T O R",
   kind="grimoire", book="狩獵書 · CODEX OF THE HUNT",
   kicker="RANGER · 狩獵書", void="#08140f", accent="#4fd6c0", abright="#82f0d8",
   sub="#8fc7a0", gold="#cdb47e", ink="#dff3ee", inkb="#eef9f5",
   tier_hint="원거리·기동·추격", desc="숲을 누비는 활의 사냥꾼. 빠른 기동과 추격, 한 호흡에 적중하는 쾌속 사격."),
}

def css_vars(key):
    s = ORDERS[key]
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

def gen_persona_image(out_dir, rec, order):
    """모스트1 캐릭터 초상을 reference로, 분류된 결사 무드의 개인 대표 키아트를 생성."""
    key = openai_key()
    if not key or not rec["arts"]:
        return False
    en = rec["arts"][0]["en"]
    purl = f"https://cdn.dak.gg/assets/er/game-assets/11.4.0/CharProfile_{en}_S000.png"
    pin = f"/tmp/aforge_portrait_{en}.png"
    subprocess.run(["curl", "-s", "-m", "30", "-o", pin, purl], capture_output=True)
    if not os.path.exists(pin) or os.path.getsize(pin) < 1000:
        return False
    S = ORDERS[order]
    prompt = (f"Reimagine the person in this image as a {S['ko']} ({S['kicker'].split(' · ')[0]}) of a high-fantasy "
              f"world. {S['desc']} Keep their recognizable face, hair and outfit motifs, but transform them into a "
              f"fantasy {S['ko']} with fitting fantasy armor or robes and a matching weapon or arcane focus. "
              f"Illuminated manuscript / dark-fantasy game key art aesthetic, ornate grimoire and rune motifs, "
              f"{S['accent']} color palette, dramatic cinematic lighting, vertical portrait, no text, no watermark.")
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
    out = f"/tmp/aforge_{enc}.html"
    udir = f"/tmp/chrome-aforge-{enc}"
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
    subprocess.run(["pkill", "-f", f"chrome-aforge-{enc}"], capture_output=True)
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
def load_char_orders():
    """factions.json의 캐릭터→결사 매핑 (en→order)을 로드."""
    p = os.path.join(ROOT, "factions.json")
    m = {}
    if os.path.exists(p):
        for order, arr in json.load(open(p)).items():
            for c in arr:
                if c.get("en"):
                    m[c["en"]] = order
    return m

def decide_order(rec, char_orders):
    """모스트 순서대로 factions.json에 등록된 첫 실험체의 결사 = 그 유저의 결사."""
    for a in rec["arts"]:
        if a["en"] in char_orders:
            return char_orders[a["en"]]
    return "rogue"  # 미등록 시 도적단(무뢰배)

def build_persona(account, rec, order):
    """결사는 모스트로 이미 정해졌다. Claude는 그 결사 기준 칭호·카피·기예별칭·신조만 생성."""
    S = ORDERS[order]
    arts_txt = "\n".join(
        f"  {i+1}. {a['name']} ({a['en']}) — {a['plays']}, 승률 {a['winrate']}, RP {a['rp']}"
        for i, a in enumerate(rec["arts"])) or "  (모스트 없음)"
    schema = {
      "title_epithet": "히어로 큰 칭호. 라틴/영문 대문자 1~3단어 (예 ASHEN PYROMANCER, OATHKEEPER, VENOM CHAINWEAVER)",
      "gate_name": "인트로에 띄울 결사 인장 명문. 라틴 1~2단어 대문자 (예 ORDO UMBRAE, ARCANUM IGNIS)",
      "hero_sub": f"닉 · {S['ko']} 직위 (예 페이란 · {S['ko']} 대마도사 / 수석 사냥꾼 / 검의 맹주)",
      "hero_copy": "히어로 카피 1~2문장. <b>강조</b> 1~2개 허용. 전적 사실을 서양 판타지 어투로.",
      "scrollcue": "스크롤 유도 문구 (예 행적을 펼치려면 내려가라 ▾)",
      "rec_title": "전적 섹션 제목 (예 행적의 연대기, 위업의 기록)", "rec_rune": "룬/연금술 기호 1글자",
      "art_title": f"모스트 섹션 제목 (예 {S['ko']}의 주문서, 봉인된 기예, 비전의 장)", "art_rune": "룬/연금술 기호 1글자",
      "main_realm": "메인 기예 구분선 라벨. 라틴/영문 (예 THE MASTERWORK · I, PRIME SPELL)",
      "dao_title": f"신조 섹션 제목 (예 {S['ko']}의 세 서약, 결사의 계율, THREE OATHS)", "dao_rune": "룬/연금술 기호 1글자",
      "bg": ["배경 워터마크 라틴/영문 단어 4개 배열 (대문자)"],
      "arts": [{"art_ko": "기예/주문 한글명 (예 그림자 송곳니, 독무의 결계)", "art_glyph": "룬/연금술 기호 1글자",
                "who": "캐릭터역할 · 기예(원어) 형식", "note": "1~2문장 해설"}],
      "doctrines": [{"no": "I", "h": "서약/계율 제목", "p": "<span class='k'>키워드</span> 포함 해설"}],
      "out_title": "마무리 제목", "out_desc": "마무리 한 문장", "out_seal": "인장 룬/기호 1글자",
    }
    prompt = f"""너는 서양 하이판타지(검과 마법, 기사단·마탑·결사) 설정 작가다. 한 이터널리턴 플레이어의 판타지 페르소나를 만든다.

이 사람은 모스트(주력) 실험체에 따라 이미 **{S['ko']}({S['kicker'].split(' · ')[0]})** 소속으로 정해졌다.
{S['ko']} 이미지: {S['desc']} (기풍: {S['tier_hint']})
세계관 톤: 고대 그리모어·룬·연금술·기사도·결사(오더)의 서양 판타지. D&D/다크판타지 느낌.

[플레이어] 닉네임: {account}
[전적] 티어 {rec.get('tier')} / RP {rec.get('rp')} / {rec.get('rank')} / 레벨 {rec.get('level')}
[모스트 실험체 — {S['ko']} 기예/주문으로 별칭]
{arts_txt}

[지침]
- 이 사람을 {S['ko']}의 일원으로 그려라. 칭호·카피·기예별칭·서약 모두 {S['ko']} 색깔에 맞게.
- arts 배열은 위 모스트 순서와 1:1, 같은 개수. 첫 번째가 그 사람의 '비전(메인)'.
- 실제 수치는 코드가 넣으니 너는 기예 별칭/해설만. 승률 낮아도 비하 말고 '연마 중인 비술'로.
- 큰 칭호(title_epithet)·인장(gate_name)·구분선(main_realm)·배경(bg)은 라틴/영문 대문자. 한글은 부제·해설·서약에만.
- ⚠️ 무협 금지: '비기·절기·도호·내공·문파·三戒·무공·도행·심법' 등 무협/동양 무협 용어와 한자(漢字) 부기를 절대 쓰지 마라.
  대신 '주문·비술·비전·룬·결계·서약·맹세·계율·결사·오의·금단의 술법' 같은 서양 판타지 어휘를 써라.
- 기호(rune/glyph/seal)는 룬·연금술·점성 기호(✦☩⚔☠❖◈⚜❂❦✧✠⚸♆☉☾⟡) 중에서만. 한자·한글·이모지 금지.
- 과장·환각 금지, 전적 근거. 반드시 JSON만 출력(설명/마크다운 금지):
{json.dumps(schema, ensure_ascii=False, indent=1)}
"""
    res = subprocess.run(["claude", "-p", prompt], capture_output=True, text=True, timeout=240)
    m = re.search(r"\{.*\}", res.stdout.strip(), re.S)
    if not m:
        raise RuntimeError("Claude JSON 파싱 실패:\n" + res.stdout[:500])
    p = json.loads(m.group(0))
    p["order"] = order
    return p

# ───────────────────────── 렌더 ─────────────────────────
def esc(s): return html.escape(str(s), quote=True)

def render(account, slug, rec, p):
    order = p["order"]
    if order not in ORDERS:
        order = "rogue"
    S = ORDERS[order]
    tpl = open(TEMPLATE, encoding="utf-8").read()

    # 칩
    chips = []
    if rec.get("tier"): chips.append(("RANK", rec["tier"]))
    if rec.get("rp"):   chips.append(("RP", rec["rp"]))
    if rec["arts"]:     chips.append(("PRIME", rec["arts"][0]["en"].upper() or rec["arts"][0]["name"]))
    chips_html = "".join(
        f'<span class="chip"><span class="dot"></span>{esc(l)} <span class="v">{esc(v)}</span></span>'
        for l, v in chips)

    # Hero 비주얼: 모스트1 키아트 있으면 사용, 없으면 룬 인장
    keyart_ok = os.path.exists(os.path.join(SERVE_BASE, slug, "keyart.png"))
    if keyart_ok:
        hero_visual = f'<div class="hero-keyart"><img src="keyart.png" alt="{esc(p.get("title_epithet", account))}"></div>'
    else:
        hero_visual = f'<div class="hero-sigil"><svg><use href="#ring"/></svg><div class="hs-core">{esc(S["rune"])}</div></div>'

    # 전적 스탯 카드 (티어 카드엔 dak 엠블럼)
    emb = rec.get("tier_emblem")
    cards = []
    if rec.get("tier"):
        cards.append(("RANK · 위계", rec["tier"], f"{esc(rec.get('rp',''))} RP", emb))
    if rec.get("rank"):
        cards.append(("세계 순위", rec["rank"].split("(")[0].strip(), rec.get("local_rank","").split("(")[0].strip(), None))
    if rec.get("local_rank"):
        cards.append(("대륙 순위", rec["local_rank"].split("위")[0].strip()+"위" if "위" in rec.get("local_rank","") else rec["local_rank"], "아시아 서버", None))
    if rec.get("level"):
        cards.append(("오의 숙련", f"Lv.{rec['level']}", "오래 쌓은 연륜", None))
    while len(cards) < 4:
        cards.append(("—", "—", "", None))
    stat_html = "".join(
        ('<div class="stat">' + (f'<img class="tier-emb" src="{e}" alt="tier">' if e else "") +
         f'<div class="lab">{esc(l)}</div><div class="big">{esc(b)}</div><div class="sub">{esc(s)}</div></div>')
        for l, b, s, e in cards[:4])

    # 기예 카드
    def art_card(i, master=False):
        a = rec["arts"][i]; pa = p["arts"][i] if i < len(p.get("arts", [])) else {}
        cls = "art master" if master else "art"
        meta = []
        if a.get("plays"):   meta.append(("", a["plays"]))
        if a.get("winrate"): meta.append(("승률", a["winrate"]))
        if a.get("rp"):      meta.append(("RP", "+"+a["rp"] if not a["rp"].startswith("-") else a["rp"]))
        meta_html = "".join(f'<div><b>{esc(v)}</b>{esc(l)}</div>' for l, v in meta)
        seal = '<span class="seal-tag">PRIME</span>' if master else ''
        return (f'<div class="{cls}" style="--c:{S["accent"]};--cg:{rgba(S["accent"],".24")}">{seal}'
                f'<div class="art-top"><div class="glyph">{esc(pa.get("art_glyph", S["rune"]))}</div>'
                f'<div><h3>{esc(a["name"])}</h3><div class="who">{esc(pa.get("who",""))}</div></div></div>'
                f'<div class="meta">{meta_html}</div>'
                f'<p class="note">{esc(pa.get("note",""))}</p></div>')

    art_main = art_card(0, master=True) if rec["arts"] else ""
    art_rest = "".join(art_card(i) for i in range(1, len(rec["arts"])))

    doctrines = "".join(
        f'<div class="dao-card"><div class="no">{esc(d.get("no",""))}</div>'
        f'<h4>{esc(d.get("h",""))}</h4><p>{d.get("p","")}</p></div>'
        for d in p.get("doctrines", [])[:3])

    bg = (p.get("bg") or [S["tag"], "ARCANA", "OATH", S["top"].replace(" ", "")])
    bg = (bg + ["ARCANA", "OATH", "RUNE", "SIGIL"])[:4]
    enc = urllib.parse.quote(account)

    repl = {
      "TITLE": f'{S["ko"]} · {p.get("title_epithet","")} · {account}',
      "DESC": f'{account} — {S["ko"]} 페르소나. {rec.get("tier","")} {rec.get("rp","")}RP. 이터널리턴 판타지 결사록.',
      "CSS_VARS": css_vars(order),
      "SECT_TOP": esc(S["top"]), "SIGIL": esc(S["rune"]),
      "GATE_NAME": esc(p.get("gate_name", account)),
      "GATE_HINT": esc(p.get("scrollcue", "― 봉인을 풀고 입문하라 ―")),
      "KICKER": esc(f'{S["kicker"].split(" · ")[0]} · {S["book"].split(" · ")[-1]}'),
      "HERO_HANJA": esc(p.get("title_epithet", account)),
      "HERO_SUB": esc(p.get("hero_sub", f"{account} · {S['ko']}")),
      "HERO_COPY": p.get("hero_copy", ""),
      "CHIPS": chips_html, "HERO_VISUAL": hero_visual,
      "SCROLLCUE": esc(p.get("scrollcue", "내려가라 ▾")),
      "REC_HANJA": esc(p.get("rec_rune", "✦")), "REC_TITLE": esc(p.get("rec_title", "행적의 연대기")),
      "ART_HANJA": esc(p.get("art_rune", S["rune"])), "ART_TITLE": esc(p.get("art_title", f"{S['ko']}의 주문서")),
      "MAIN_REALM": esc(p.get("main_realm", "THE MASTERWORK · I")),
      "DAO_HANJA": esc(p.get("dao_rune", "☩")), "DAO_TITLE": esc(p.get("dao_title", f"{S['ko']}의 서약")),
      "STAT_CARDS": stat_html, "TREND": esc(rec.get("trend", "RP 추이는 전적 원본에서 확인하라.")),
      "ART_MAIN": art_main, "ART_REST": art_rest, "TRAIN_BLOCK": "",
      "DOCTRINES": doctrines,
      "OUT_SEAL": esc(p.get("out_seal", S["rune"])),
      "OUT_TITLE": esc(p.get("out_title", f"{S['ko']}의 길은 계속된다")),
      "OUT_DESC": esc(p.get("out_desc", "다음 전장에서 겨룰 맞수를 기다리며.")),
      "DAK_URL": f"https://dak.gg/er/players/{enc}",
      "FOOT": esc(f'{S["tag"]} · {p.get("title_epithet","")} · ETERNAL RETURN {rec.get("tier","")} {rec.get("rp","")}RP'),
      "BG_HANJA1": esc(bg[0]), "BG_HANJA2": esc(bg[1]), "BG_HANJA3": esc(bg[2]), "BG_HANJA4": esc(bg[3]),
    }
    for k, v in repl.items():
        tpl = tpl.replace("{{" + k + "}}", str(v))
    return tpl, order

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
    # pm2
    subprocess.run(["pm2", "serve", d, str(port), "--name", slug, "--spa"], capture_output=True)
    # dns
    subprocess.run(["cloudflared", "tunnel", "route", "dns", TUNNEL_ID, host], capture_output=True)
    # ingress 추가 (404 줄 앞에 삽입)
    cfg = open(CF_CONFIG).read()
    if host not in cfg:
        block = f"  - hostname: {host}\n    service: http://localhost:{port}\n"
        cfg = cfg.replace("  - service: http_status:404", block + "  - service: http_status:404")
        open(CF_CONFIG, "w").write(cfg)
    subprocess.run(["cloudflared", "tunnel", "ingress", "validate"], capture_output=True)
    subprocess.run(["pm2", "restart", "cf-tunnel"], capture_output=True)
    subprocess.run(["pm2", "save"], capture_output=True)
    return host

# ───────────────────────── main ─────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("account")
    ap.add_argument("--slug")
    ap.add_argument("--port", type=int)
    ap.add_argument("--no-deploy", action="store_true")
    ap.add_argument("--force-order")
    ap.add_argument("--no-image", action="store_true")
    args = ap.parse_args()

    slug = args.slug or re.sub(r"[^a-z0-9-]", "", args.account.lower())
    if not slug:
        sys.exit("한글/비ASCII 계정은 --slug 로 영문 slug를 지정하라. 예: --slug feiran")
    # 무협판(wuxia-forge)과 host 충돌 방지: 판타지 마커를 강제로 붙인다
    if "fantasy" not in slug:
        slug = f"{slug}-fantasy"

    print(f"▶ [1/4] 전적 수집: {args.account}")
    path, url = fetch_dom(args.account)
    rec = parse_record(path)
    print(f"   티어={rec.get('tier')} RP={rec.get('rp')} 모스트={[a['name'] for a in rec['arts']]}")
    if not rec["arts"] and not rec.get("tier"):
        sys.exit("   전적을 못 읽었다. 계정명/공개여부 확인.")

    print("▶ [2/4] 결사 지정 (모스트 기반) + 페르소나 생성")
    char_orders = load_char_orders()
    order = args.force_order or decide_order(rec, char_orders)
    if order not in ORDERS:
        order = "rogue"
    most1 = rec["arts"][0]["name"] if rec["arts"] else "?"
    print(f"   결사={order}({ORDERS[order]['ko']}) ← 모스트1 '{most1}' 기준")
    p = build_persona(args.account, rec, order)
    print(f"   칭호={p.get('title_epithet')}")

    out_dir = os.path.join(SERVE_BASE, slug)
    os.makedirs(out_dir, exist_ok=True)
    if not args.no_image:
        print("▶ [3/4] 대표 이미지 생성 (모스트1 초상 → 결사 무드 키아트)")
        ok = gen_persona_image(out_dir, rec, order)
        print("   keyart:", "생성됨" if ok else "스킵(키 없음/실패)")
    print("▶ [3/4] 렌더")
    html_text, order = render(args.account, slug, rec, p)
    open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8").write(html_text)
    print(f"   → {out_dir}/index.html ({len(html_text)} bytes)")

    if args.no_deploy:
        print("▶ [4/4] --no-deploy: 배포 생략")
        print(f"   미리보기: python3 -m http.server 로 {out_dir} 서빙")
        return

    port = args.port
    if not port:
        port = max([3259] + list(used_ports())) + 1
    print(f"▶ [4/4] 배포 → {slug}.{DOMAIN} (:{port})")
    host = deploy(slug, port, html_text)
    time.sleep(5)
    code = subprocess.run(["curl", "-s", "-m", "8", "-o", "/dev/null", "-w", "%{http_code}",
                           f"https://{host}/"], capture_output=True, text=True).stdout
    print(f"   https://{host}/  →  {code}")

if __name__ == "__main__":
    main()
