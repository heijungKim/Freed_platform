# Freed Platform ERP

선불카드 플랫폼 운영을 위한 **관리자 전용** ERP입니다.

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
