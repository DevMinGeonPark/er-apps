#!/usr/bin/env python3
# /tmp/factions.json → 분류 편집기 HTML (~/move/factions/index.html)
import json, os
ORDER=["shaolin","wudang","hwasan","jeomchang","amita","gaebang","tangmun","paengga","cheonma","haomun","bukhae","seojang","namman"]
NAMES={"shaolin":"소림사","wudang":"무당파","hwasan":"화산파","jeomchang":"점창파","amita":"아미파","gaebang":"개방","tangmun":"사천당가","paengga":"하북팽가","cheonma":"천마신교","haomun":"하오문","bukhae":"북해빙궁","seojang":"서장밀교","namman":"남만야수궁"}
data=json.load(open('/tmp/factions.json'))

HEAD='''<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>무림 분류 편집기 — 88실험체 / 13문파</title>
<link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0c0a0e;color:#e8dfd2;font-family:"Noto Sans KR",sans-serif;padding-bottom:230px}
.head{text-align:center;padding:36px 16px 12px}
.head h1{font-family:"Ma Shan Zheng";font-size:clamp(28px,6vw,50px);color:#caa45a}
.head p{color:#9c8a7a;font-size:13px;margin-top:6px}
.sect{max-width:1180px;margin:0 auto;padding:10px 18px}
.sect h2{font-family:"Ma Shan Zheng";font-size:23px;color:#d6906a;border-bottom:1px solid rgba(202,164,90,.25);padding-bottom:6px;margin:18px 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:9px}
.c{display:flex;gap:9px;align-items:flex-start;background:#15111a;border:1px solid rgba(200,160,230,.12);border-radius:10px;padding:8px;transition:.2s}
.c.moved{border-color:#d6906a;background:#1d1418}
.c img{width:44px;height:44px;border-radius:8px;object-fit:cover;background:#221a2a;flex:none}
.c .info{flex:1;min-width:0}
.c .nm{font-weight:700;font-size:14px}
.c .wp{font-size:10px;color:#8a7c92}
.c .why{font-size:10px;color:#6f8a7a;margin:2px 0;line-height:1.3;max-height:26px;overflow:hidden}
.c select{width:100%;margin-top:3px;background:#0c0a0e;color:#e8dfd2;border:1px solid rgba(200,160,230,.2);border-radius:5px;padding:3px;font-size:12px;font-family:inherit}
.bar{position:fixed;left:0;right:0;bottom:0;background:#120e16;border-top:2px solid #caa45a;padding:12px 18px;z-index:10}
.bar .row{max-width:1180px;margin:0 auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.bar b{color:#d6906a;font-size:15px}
.bar textarea{flex:1;min-width:240px;height:82px;background:#0c0a0e;color:#9fe6c8;border:1px solid rgba(202,164,90,.3);border-radius:8px;padding:8px;font-family:monospace;font-size:13px}
.btn{background:#caa45a;color:#1a120a;border:none;border-radius:8px;padding:12px 20px;font-weight:900;cursor:pointer;font-size:14px}
.btn:hover{background:#e0b86a}.btn.r{background:#3a3030;color:#caa45a}
</style></head><body>
<div class="head"><h1>武林 分類 編輯 — 13門派</h1><p>커뮤니티 평판(나무위키) + 무기군 기반 분류 · 드롭다운으로 수정 → 하단 복사</p></div>
<div id="root"></div>
<div class="bar"><div class="row"><b id="cnt">수정 0건</b>
<textarea id="out" readonly placeholder="변경하면 '캐릭터 → 문파' 목록이 자동 생성됩니다"></textarea>
<button class="btn" onclick="cp()">📋 복사</button><button class="btn r" onclick="rs()">초기화</button></div></div>
<script>
'''
TAIL='''
const orig={},root=document.getElementById('root');
const order=["shaolin","wudang","hwasan","jeomchang","amita","gaebang","tangmun","paengga","cheonma","haomun","bukhae","seojang","namman"];
order.forEach(k=>{const arr=DATA[k]||[];const sec=document.createElement('div');sec.className='sect';
 sec.innerHTML=`<h2>${SECTS[k]} <span style="font-size:13px;color:#8a7c92">(${arr.length})</span></h2>`;
 const g=document.createElement('div');g.className='grid';
 arr.forEach(c=>{orig[c.en]=k;
  const opts=order.map(s=>`<option value="${s}"${s===k?' selected':''}>${SECTS[s]}</option>`).join('');
  const card=document.createElement('div');card.className='c';card.id='c_'+c.en;
  card.innerHTML=`<img src="https://cdn.dak.gg/assets/er/game-assets/11.4.0/CharProfile_${c.en}_S000.png" loading="lazy" onerror="this.style.opacity=.2">
   <div class="info"><div class="nm">${c.ko}</div><div class="wp">${c.weapon||''}</div><div class="why" title="${(c.why||'').replace(/"/g,'')}">${c.why||''}</div>
   <select data-en="${c.en}" data-ko="${c.ko}" onchange="ch(this)">${opts}</select></div>`;
  g.appendChild(card);});
 sec.appendChild(g);root.appendChild(sec);});
function ch(s){document.getElementById('c_'+s.dataset.en).classList.toggle('moved',s.value!==orig[s.dataset.en]);upd();}
function upd(){const L=[];document.querySelectorAll('select').forEach(s=>{if(s.value!==orig[s.dataset.en])L.push(`${s.dataset.ko} → ${SECTS[s.value]}`);});
 document.getElementById('cnt').textContent='수정 '+L.length+'건';document.getElementById('out').value=L.join('\\n');}
function cp(){const t=document.getElementById('out');t.select();navigator.clipboard.writeText(t.value);event.target.textContent='✓ 복사됨';setTimeout(()=>event.target.textContent='📋 복사',1200);}
function rs(){document.querySelectorAll('select').forEach(s=>{s.value=orig[s.dataset.en];document.getElementById('c_'+s.dataset.en).classList.remove('moved');});upd();}
</script></body></html>'''
html=HEAD+"const DATA="+json.dumps(data,ensure_ascii=False)+";\nconst SECTS="+json.dumps(NAMES,ensure_ascii=False)+";\n"+TAIL
open(os.path.expanduser('~/move/factions/index.html'),'w',encoding='utf-8').write(html)
print("편집기 갱신:",len(html),"bytes / 분포:",{NAMES[k]:len(data.get(k,[])) for k in ORDER})
