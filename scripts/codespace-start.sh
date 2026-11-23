#!/usr/bin/env bash
# GitHub Codespaces에서 ERP를 실행하고 임시 공개 링크를 만든다.
set -u
cd "$(dirname "$0")/.."
mkdir -p data

# 최초 실행 시 관리자 비밀번호를 무작위로 생성 (공개 링크이므로 기본 비밀번호 사용 안 함)
PW_FILE=data/admin-password.txt
if [ ! -f "$PW_FILE" ]; then
  node -e "const c=require('crypto');process.stdout.write('Erp'+c.randomBytes(6).toString('hex'))" > "$PW_FILE"
fi
export ADMIN_PASSWORD="$(cat "$PW_FILE")"

[ -d dist ] || npm run build

# 서버가 뜬 뒤 포트를 공개로 전환 (로그인 없이 링크로 접속 가능)
(
  sleep 6
  if [ -n "${CODESPACE_NAME:-}" ]; then
    gh codespace ports visibility 4000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 \
      || echo "[안내] 포트 자동 공개 실패: 아래 'PORTS' 탭에서 4000 포트 우클릭 → Port Visibility → Public"
  fi
) &

URL="http://localhost:4000"
if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-4000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
fi
cat <<MSG

==================================================
  Freed Platform ERP 실행 중
  접속 링크 : $URL
  아이디    : admin
  비밀번호  : $ADMIN_PASSWORD
  (이미 DB가 있다면 기존 비밀번호가 유지됩니다)
==================================================

MSG
exec npm start
