#!/usr/bin/env bash
# 정적 사이트 조립 — 각 앱의 public/ 을 dist/<slug>/ 로 복사한다.
# 공용 클라이언트는 shared/ 심볼릭 링크이므로 -L로 실체를 복사한다.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist

cp hub/index.html dist/index.html

for pair in er-cert:cert er-death:death er-fault:fault er-enemy:enemy er-credit:credit er-payroll:payroll; do
  src="${pair%%:*}"; slug="${pair##*:}"
  cp -RL "$src/public" "dist/$slug"
done

# 공개 서버 주소만 주입한다. API_KEY 등 서버 비밀은 빌드에서 읽지 않는다.
python3 - <<'PY'
import json, os
from pathlib import Path
from urllib.parse import urlsplit
origin = os.environ.get('ER_PUBLIC_API_BASE', 'https://erps.dev-heptivision.com').rstrip('/')
url = urlsplit(origin)
if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment or url.path:
    raise SystemExit('ER_PUBLIC_API_BASE에는 공개 API 서버의 origin만 지정하세요.')
for app in ('cert', 'credit', 'death', 'fault', 'enemy', 'payroll'):
    Path('dist', app, 'er-config.js').write_text('globalThis.ER_API_BASE_URL ||= ' + json.dumps(origin) + ';\n')
PY

# er-map 은 원래 정적 — 자체 완결된 dist.html 하나가 산출물이다
mkdir -p dist/map
cp er-map/dist.html dist/map/index.html

# 커스텀 도메인을 쓸 때만 존재 — Cloudflare DNS에 CNAME er -> devmingeonpark.github.io 를
# 먼저 넣고, 루트에 CNAME 파일(내용: er.dev-heptivision.com)을 만들면 자동으로 실린다
[ -f CNAME ] && cp CNAME dist/CNAME

# GitHub Pages 의 Jekyll 처리를 끈다 (_shared 같은 밑줄 경로가 누락되는 것 방지)
touch dist/.nojekyll

echo "dist/ 조립 완료 — $(find dist -type f | wc -l | tr -d ' ') 파일 / $(du -sh dist | cut -f1)"
