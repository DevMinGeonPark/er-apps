#!/usr/bin/env bash
# dist/ 를 로컬에서 띄우고 헤드리스 Chrome으로 각 페이지를 실제 렌더해 확인한다.
# 정적 배포에서 유일하게 새로 쓴 경로(html2canvas PNG)까지 여기서 검증된다.
#   ./smoke.sh
set -uo pipefail
cd "$(dirname "$0")"
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT=8099
N='Nicholas'

python3 -m http.server "$PORT" --directory dist >/dev/null 2>&1 & HTTPD=$!
disown $HTTPD 2>/dev/null
trap 'kill $HTTPD 2>/dev/null; rm -f dist/death/_pngtest.html' EXIT
sleep 1

# 사망진단서 PNG(html2canvas) 검증용 임시 페이지 — 진단서 렌더 후 직접 래스터화한다
sed 's#</body>#<script>\
(async () => {\
  for (let i = 0; i < 120 \&\& document.getElementById("certRoot").hidden; i++) await new Promise(r => setTimeout(r, 500));\
  try {\
    const c = await html2canvas(document.getElementById("certRoot"), { scale: 1, useCORS: true });\
    document.title = "PNGRESULT " + c.width + "x" + c.height;\
  } catch (e) { document.title = "PNGRESULT FAIL " + e; }\
})();\
</script></body>#' dist/death/index.html > dist/death/_pngtest.html

fail=0
render() { # render <경로> <기대문자열> <설명>
  local dir out
  dir=$(mktemp -d /tmp/chrome-XXXX)
  ( "$CHROME" --headless=new --user-data-dir="$dir" --disable-gpu --no-first-run \
      --use-mock-keychain --password-store=basic \
      --virtual-time-budget=45000 --dump-dom "http://localhost:$PORT/$1" >/tmp/smoke.html 2>/dev/null ) & local ch=$!
  for _ in $(seq 1 60); do kill -0 $ch 2>/dev/null || break; sleep 1; done
  kill $ch 2>/dev/null; pkill -f "user-data-dir=$dir" 2>/dev/null; rm -rf "$dir"
  if grep -q "$2" /tmp/smoke.html; then
    echo "  OK   $3"
  else
    echo "  FAIL $3  (기대: $2)"; fail=1
  fi
}

echo "정적 사이트 스모크 테스트"
render ""                                   "루미아 문서국"        "허브"
render "cert/?name=$N&char=44"              "AGL-"                 "자격증 발급"
render "death/?name=$N"                     "사망진단서"           "사망진단서 발급"
render "death/_pngtest.html?name=$N"        "PNGRESULT [0-9]"      "진단서 PNG 래스터화(html2canvas)"
render "enemy/?me=$N"                       "killer-card"          "원수 색출"
render "credit/?name=하늘"                   "등급"                 "신용등급표"
render "fault/"                             "option value=\"auto\""  "과실비율 폼(시즌 목록 로드)"
render "map/"                               "<svg"                 "루미아섬 지도"

[ $fail -eq 0 ] && echo "전부 통과" || { echo "실패 있음"; exit 1; }
