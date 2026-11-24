# Freed Platform ERP

선불카드 플랫폼 운영을 위한 **관리자 전용** ERP입니다.

**▶ 바로 체험하기 (GitHub Pages 데모): https://heijungkim.github.io/freed_platform/**

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/heijungKim/freed_platform?quickstart=1)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/heijungKim/freed_platform)

## GitHub Pages 데모

https://heijungkim.github.io/freed_platform/ — 설치 없이 링크로 바로 접속 (관리자 `admin` / `admin1234`)

- 서버 코드(`server/routes`, 거래·잔액 로직, 관리자 인증)를 그대로 브라우저 안에서 실행합니다 (SQLite WASM).
- **데이터는 접속한 각자의 브라우저에만 저장**되며 다른 사람과 공유되지 않습니다. 사이드바의 "데모 데이터 초기화"로 처음 상태로 돌릴 수 있습니다.
- 로그인 검사도 브라우저 안에서 이루어지므로 **보안이 필요한 실제 운영에는 사용하지 마세요.** 실제 운영은 아래 Codespaces/Render/자체 서버로 실행합니다.
- `main` 브랜치에 push 하면 GitHub Actions가 `gh-pages` 브랜치로 자동 배포합니다. (`npm run build:pages` 로 직접 빌드 가능)

## GitHub 임시 링크로 바로 실행 (Codespaces)

1. **Open in GitHub Codespaces** 버튼 클릭 → **Create codespace**
2. 2~3분 후 자동으로 빌드·실행되고, 터미널에 접속 링크(`https://<이름>-4000.app.github.dev`)와 `admin` 비밀번호가 표시됩니다.
3. 해당 링크는 공개로 전환되어 다른 사람도 접속할 수 있습니다. Codespace를 중지하면 링크도 닫힙니다.

> 비밀번호는 Codespace 안의 `data/admin-password.txt`에도 저장됩니다. 공개 링크이므로 데모 계정은 생성되지 않습니다.
> Codespace는 30분 동안 사용이 없으면 자동으로 중지됩니다(GitHub 설정에서 변경 가능).

## 인터넷 주소로 배포하기 (Render, 무료)

1. 위 **Deploy to Render** 버튼 클릭 → GitHub 계정으로 Render 로그인
2. **Deploy Blueprint** 클릭 → 3~5분 후 `https://freed-platform-erp-xxxx.onrender.com` 형태의 주소 생성
3. Render 대시보드 → 서비스 → **Environment** 탭에서 `ADMIN_PASSWORD` 값 확인 → 아이디 `admin` 으로 로그인

> 공개 배포 시 관리자 비밀번호는 무작위로 생성되며, 데모 계정(manager01, user01)은 만들어지지 않습니다.
> 무료 플랜은 15분간 접속이 없으면 잠들고(첫 접속 시 30초~1분 대기), 재시작·재배포 시 데이터가 초기화됩니다.
> 데이터를 계속 보관하려면 유료 플랜에서 Persistent Disk를 붙이고 `DB_PATH`를 디스크 경로로 지정하세요.

| 메뉴 | 기능 |
|---|---|
| 법인 | 고객 법인 등록·수정·삭제, 사업자번호 중복 검사, 법인별 카드 수/잔액 |
| PG | PG사 등록, 코드·MID·수수료율·정산주기 관리, 누적 결제액 |
| 거래내역 | 기간/법인/PG/유형/상태 검색, 합계, 상세보기, 거래 취소(잔액 원복), 수기 거래 등록, CSV 다운로드 |
| 선불카드 관리 | 카드 발급(초기 충전), 충전, 상태 변경(정상/정지/분실/만료), 충전 한도, 카드별 거래 조회 |
| 집계 | 기간별 KPI, 일별/월별 추이 차트, 법인별·PG별 집계 |
| 사용자 관리 | 계정 생성·수정·삭제, 권한 지정, 비밀번호 초기화 (최고 관리자 전용) |

## 로그인 / 권한

- **최고 관리자(SUPER_ADMIN)**, **관리자(ADMIN)** 만 로그인할 수 있습니다. **일반 사용자(USER)** 와 비활성 계정은 로그인이 거부됩니다.
- 모든 `/api/*` 요청은 서버에서 관리자 세션을 검사합니다 (HttpOnly · SameSite=Strict 쿠키, 8시간 슬라이딩 만료).
- 비밀번호는 scrypt로 해시하여 저장하며, 로그인 실패는 15분 동안 10회로 제한됩니다.
- 사용자 등록·수정은 최고 관리자만 가능하고, 활성 최고 관리자는 항상 1명 이상 유지됩니다.

최초 실행 시 기본 계정이 생성됩니다. **로그인 후 바로 비밀번호를 변경하세요.**

| 아이디 | 비밀번호 | 권한 |
|---|---|---|
| `admin` | `admin1234` | 최고 관리자 |
| `manager01` | `manager1234` | 관리자 (데모) |
| `user01` | `user12345` | 일반 사용자 — 로그인 불가 (데모) |

## 실행 방법

요구사항: **Node.js 22.13 이상** (내장 SQLite 사용, 별도 DB 설치 불필요)

```bash
npm install
npm run build   # 프론트엔드 빌드
npm start       # http://localhost:4000
```

개발 모드 (터미널 2개):

```bash
npm run dev:server   # API :4000 (자동 재시작)
npm run dev:client   # 화면 :5173 (API 프록시)
```

기타:

```bash
npm test        # API 테스트
npm run seed    # DB 초기화 후 데모 데이터 재생성
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `4000` | 서버 포트 |
| `DB_PATH` | `data/erp.db` | SQLite 파일 경로 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin1234` | 최초 실행 시 만들 관리자 계정 |
| `SEED_DEMO` | `true` | DB가 비어있을 때 데모 데이터 생성 (`false`로 끄기) |
| `SEED_DEMO_USERS` | `true` | 데모 계정(manager01, user01) 생성 여부 — 공개 배포 시 `false` |
| `COOKIE_SECURE` | `false` | HTTPS 운영 시 `true` |
| `TRUST_PROXY` | `false` | 리버스 프록시 뒤에서 운영 시 `true` |

## 구조

```
server/            Express API
  db.js            스키마 (users, sessions, corporations, pgs, cards, transactions)
  auth.js          비밀번호 해시, 세션, 관리자 권한 미들웨어
  ledger.js        거래 생성/취소 + 카드 잔액 반영 (DB 트랜잭션)
  routes/          메뉴별 API
  seed.js          기본 관리자 / 데모 데이터
client/src/        React (Vite) 화면
  pages/           Login, Corporations, Pgs, Transactions, Cards, Stats, Users
```

### 잔액 규칙
- 충전·환불: 잔액 증가 (충전 한도 초과 불가) / 결제: 잔액 차감 (잔액 부족 시 거부, PG 필수, 수수료 = 금액 × PG 수수료율)
- 거래 취소: 승인 거래만 가능하며 잔액이 원복됩니다.
- 정상(ACTIVE) 카드만 거래할 수 있습니다.
