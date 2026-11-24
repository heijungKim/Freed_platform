export const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
export const num = (n) => Number(n || 0).toLocaleString('ko-KR');
export const maskCard = (no) => (no ? `${no.slice(0, 4)}-${no.slice(4, 6)}**-****-${no.slice(12)}` : '');
export const fmtCard = (no) => (no ? no.replace(/(\d{4})(?=\d)/g, '$1-') : '');

export const today = () => toDateStr(new Date());
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); };
export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const LABELS = {
  status: { ACTIVE: '활성', INACTIVE: '비활성' },
  cardStatus: { ACTIVE: '정상', SUSPENDED: '정지', LOST: '분실', EXPIRED: '만료' },
  txType: { CHARGE: '충전', PAYMENT: '결제', REFUND: '환불' },
  txStatus: { APPROVED: '승인', CANCELLED: '취소', FAILED: '실패' },
  role: { SUPER_ADMIN: '최고 관리자', ADMIN: '관리자', USER: '일반 사용자' },
  protection: { TRUST: '신탁', GUARANTEE: '지급보증보험', DEPOSIT: '예치' },
};

const TONE = {
  ACTIVE: 'green', APPROVED: 'green', INACTIVE: 'gray', SUSPENDED: 'amber', LOST: 'red', EXPIRED: 'gray',
  CANCELLED: 'red', FAILED: 'red', CHARGE: 'blue', PAYMENT: 'violet', REFUND: 'amber',
  SUPER_ADMIN: 'violet', ADMIN: 'blue', USER: 'gray',
  TRUST: 'blue', GUARANTEE: 'violet', DEPOSIT: 'amber',
};
export const toneOf = (v) => TONE[v] || 'gray';
