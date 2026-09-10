#!/usr/bin/env bash
# 정적 사이트 조립 — 각 앱의 public/ 을 dist/<slug>/ 로 복사한다.
# 공용 클라이언트는 shared/ 심볼릭 링크이므로 -L로 실체를 복사한다.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist

cp -R hub/. dist/
mkdir -p dist/shared dist/assets
cp shared/lumia-documents.js shared/night-clerk.js shared/night-clerk.css dist/shared/
cp docs/lumia-night-clerk-2026-09-10/assets/lumia-art.jpg dist/assets/lumia-art.jpg

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

# 제외된 상황판의 이전 주소는 문서국으로 안내한다. 원본 지도 소스는 보존한다.
mkdir -p dist/map
cat > dist/map/index.html <<'HTML'
<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=/"><title>루미아 문서국</title><a href="/">루미아 문서국으로 이동</a></html>
HTML

# 커스텀 도메인을 쓸 때만 존재 — Cloudflare DNS에 CNAME er -> devmingeonpark.github.io 를
# 먼저 넣고, 루트에 CNAME 파일(내용: er.dev-heptivision.com)을 만들면 자동으로 실린다
[ -f CNAME ] && cp CNAME dist/CNAME

# GitHub Pages 의 Jekyll 처리를 끈다 (_shared 같은 밑줄 경로가 누락되는 것 방지)
touch dist/.nojekyll

echo "dist/ 조립 완료 — $(find dist -type f | wc -l | tr -d ' ') 파일 / $(du -sh dist | cut -f1)"
