#!/usr/bin/env python3
# 10개 세력 대표 키아트를 OpenAI gpt-image-1로 병렬 생성 → ~/move/<sect>/keyart.png
import os, subprocess, base64, json, concurrent.futures

KEY = ""
for line in open(os.path.expanduser("~/move/homepage/.env.local")):
    if line.startswith("OPENAI_API_KEY"):
        KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
assert KEY, "no key"

STYLE = "ink wash painting fused with dark fantasy game key art, cinematic dramatic lighting, vertical portrait, highly detailed, no text, no watermark"
PROMPTS = {
 "shaolin":   f"A Shaolin warrior monk in golden kasaya robe in a fierce fist stance, ancient temple and incense smoke, warm gold and ash-grey tones, buddhist halo, {STYLE}",
 "wudang":    f"A Wudang taoist sword master in mountain mist with a glowing taegeuk yin-yang symbol, jade-teal and deep ink tones, serene and powerful, {STYLE}",
 "hwasan":    f"An elegant swordsman amid swirling pink plum blossoms unleashing flamboyant sword qi, pink and silver tones, {STYLE}",
 "jeomchang": f"A swift shadow swordsman wielding twin daggers with motion-blur speed streaks, teal-green tones, deadly assassin, {STYLE}",
 "amita":     f"A graceful female warrior heroine with a flowing whip and folding fan, amethyst purple and plum tones, elegant and lethal, {STYLE}",
 "gaebang":   f"A ragged wandering beggar martial artist with a bamboo staff and wine gourd, earthy brown tones, carefree grin, {STYLE}",
 "tangmun":   f"A masked poison assassin hurling hidden darts through toxic green mist, dark green and black tones, mechanical traps, {STYLE}",
 "paengga":   f"A mighty warrior swinging a massive heavy broadsword, steel-grey and blood-red tones, brutal overwhelming power, {STYLE}",
 "cheonma":   f"A demonic heavenly-demon cult master wrapped in crimson blood aura holding a dark katana, blood-red and black tones, menacing, {STYLE}",
 "haomun":    f"A hooded shadow assassin with a curved dagger emerging from pitch darkness, muted teal and grey tones, stealth underworld, {STYLE}",
}

def gen(item):
    sect, prompt = item
    d = os.path.expanduser(f"~/move/{sect}")
    os.makedirs(d, exist_ok=True)
    out = os.path.join(d, "keyart.png")
    body = json.dumps({"model": "gpt-image-1", "prompt": prompt,
                       "size": "1024x1536", "quality": "medium", "n": 1})
    r = subprocess.run(["curl", "-s", "-m", "120",
        "https://api.openai.com/v1/images/generations",
        "-H", f"Authorization: Bearer {KEY}",
        "-H", "Content-Type: application/json", "-d", body],
        capture_output=True, text=True)
    try:
        data = json.loads(r.stdout)
        b = data["data"][0]["b64_json"]
        open(out, "wb").write(base64.b64decode(b))
        return f"OK   {sect:10s} {os.path.getsize(out)//1024}KB"
    except Exception as e:
        return f"FAIL {sect:10s} {str(e)[:80]} :: {r.stdout[:160]}"

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    for res in ex.map(gen, PROMPTS.items()):
        print(res, flush=True)
print("DONE")
