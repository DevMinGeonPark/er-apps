# 루미아 문서국 · 야간 기록관 UI 인계

2026-09-10 사용자가 승인한 확장형 로비를 다시 구현하기 위한 자산과 명세. 실제 프로젝트는 `mini-mingeon@100.119.40.108:/Users/mini-mingeon/er-apps`이며 요청의 er-app은 이 프로젝트를 뜻하는 것으로 CNAME으로 확인했다. 앱 코드와 배포는 변경하지 않았다.

- `preview.html`: 브라우저로 바로 열 수 있는 실행 시안. 로컬 JPG 참조. 기본1200px wrapper.
- `approved-original.fragment.html`: 승인 원본에서 사용자 최신 요청에 따라 상황판 footer만 제거(이미지 base64 내장).
- `approved-local.fragment.html`: 동일 fragment에서 이미지 경로만 로컬 자산으로 변경.
- `assets/lumia-art.jpg`: 실제 승인 시안에 쓰인 원화.
- `assets/night-clerk-original.png`: 고해상도 생성 원본. 캐릭터를 새로 생성하지 말 것.
- `IMPLEMENTATION-PROMPT.md`: 다음 구현 에이전트에 전달할 상세 프롬프트. 이것과 원본 fragment를 함께 읽을 것.
- `SHA256SUMS`: 전송 무결성 확인용.

모형에는 조회 API가 없고 접수는 연출이다. 최근 목록과 닉네임은 브라우저의 현재 페이지 안에서만 유지된다. Google Fonts는 인터넷 연결을 사용하며 폰트 파일은 포함하지 않았다. 영구 저장·실제 문서별 입력·API/결과 화면/기존 route 연결은 구현 프롬프트 요구사항이다. 모형을 운영 코드로 단순 덮어쓰지 말 것.

실행: 이 폴더에서 `python3 -m http.server 8765 --bind 127.0.0.1` 후 브라우저에서 `http://127.0.0.1:8765/preview.html`을 연다. 서버 없이 파일을 직접 열어도 모형 동작 가능. 사용자 데이터 조회 없이 검토할 수 있다.

전송된 디렉터리는 `docs/lumia-night-clerk-2026-09-10/`. 기존 `docs/official-api-migration.md` 및 기존 소스는 보존했다. 문서별 UIUX 확장 설계는 추가 자료로 이 폴더에 넣을 수 있다.

최신 결정: 루미아섬 상황판은 대상에서 제외·제거한다. 모든 동봉 시안의 관련 footer를 제거했으며 구현 시 공통 내비에서도 제외한다. 기존 라이브 페이지 자체는 이번 인계 작업에서 수정하지 않았다.

## 문서별 UIUX 추가자료

- `DOCUMENT-UIUX-SPEC.md`: 실제 서비스와 원격 코드를 확인해 작성한 6문서별 상세 설계. 입력·조회 상태·결과 정보·기존 기능 보존 기준.
- `document-studio.fragment.html`: 6문서의 접수/결과 예시 토글 인터랙티브 시안. 실제 조회를 수행하지 않는다.
- `document-studio.html`: 위 시안을 브라우저에서 바로 열 수 있는 standalone 문서.

문서별 화면 구현 시 상세 설계와 실행 시안을 함께 읽고, 기존 실제 사이트의 입력 항목·판정 로직·PNG/PDF 및 링크 저장 기능을 유지한다. 시안은 결과 예시이며 실제 데이터나 판정 결과가 아니다. 상황판은 모든 설계 대상에서 제외한다.
