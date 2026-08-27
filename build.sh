#!/usr/bin/env bash
# 정적 사이트 조립 — 각 앱의 public/ 을 dist/<slug>/ 로 복사한다.
# dakgg-core.js 는 shared/ 를 가리키는 심볼릭 링크라 -L 로 실체를 복사한다.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist

cp hub/index.html dist/index.html

for pair in er-cert:cert er-death:death er-fault:fault er-enemy:enemy er-credit:credit; do
  src="${pair%%:*}"; slug="${pair##*:}"
  cp -RL "$src/public" "dist/$slug"
done

# er-map 은 원래 정적 — 자체 완결된 dist.html 하나가 산출물이다
mkdir -p dist/map
cp er-map/dist.html dist/map/index.html

# 커스텀 도메인을 쓸 때만 존재 — Cloudflare DNS에 CNAME er -> devmingeonpark.github.io 를
# 먼저 넣고, 루트에 CNAME 파일(내용: er.dev-heptivision.com)을 만들면 자동으로 실린다
[ -f CNAME ] && cp CNAME dist/CNAME

# GitHub Pages 의 Jekyll 처리를 끈다 (_shared 같은 밑줄 경로가 누락되는 것 방지)
touch dist/.nojekyll

echo "dist/ 조립 완료 — $(find dist -type f | wc -l | tr -d ' ') 파일 / $(du -sh dist | cut -f1)"
