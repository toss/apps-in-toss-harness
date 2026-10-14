/**
 * Node-side dashboard/attach/inspector string catalog (Korean — source of
 * truth; keys are typed from this file).
 *
 * Vendored from devtools' `src/i18n/ko.ts`
 * (devtools@61aa2d0228df27c2c0ab2405726dd5301067981e, "SPLIT FREEZE"
 * devtools#813) — ONLY the `dashboard.*` / `attach.*` / `inspector.*` keys
 * (51 of the original 225) that back the Node HTTP dashboard/attach pages
 * served from `src/mcp/qr-http-server.ts`. The panel keys
 * (174) stay in devtools — those back browser-only UI that never runs in
 * this package's Node process.
 *
 * This is a deliberate subset extraction (not the full i18n split — see this
 * repo's issue #3 / CLAUDE.md "i18n 실제 분할"), landed here in D2 because the
 * mapping table for this vendor step names exactly these 51 keys.
 */

export const ko = {
  'dashboard.lang.ko': '한국어',
  'dashboard.lang.en': 'English',
  'dashboard.title': 'AIT 디버그 Dashboard',
  'dashboard.updated': '마지막 갱신: {ts}',
  'dashboard.tunnel.section': '터널 상태',
  'dashboard.tunnel.up': '연결됨',
  'dashboard.tunnel.down': '끊어짐',
  'dashboard.attach.section': 'Attach QR',
  'dashboard.attach.hint': 'start_attach MCP tool을 호출하면 QR이 여기에 표시됩니다.',
  'dashboard.attach.tunnelDown':
    'relay 연결이 끊겼습니다 — 이 QR은 더 이상 유효하지 않습니다. relay를 재시작한 뒤 QR을 다시 생성하세요.',
  'dashboard.attach.reopenHint':
    '토스 앱에서 이 미니앱이 이미 열려 있으면 QR을 스캔해도 새로고침되지 않아 attach되지 않아요. 미니앱 상단의 X 버튼으로 먼저 닫은 뒤 다시 스캔하세요.',
  'dashboard.pages.section': '연결된 Pages',
  'dashboard.pages.empty': 'attach된 페이지 없음',
  'dashboard.url.copy': '복사',
  'dashboard.url.copied': '복사됨',
  'dashboard.inspector.section': '인스펙터',
  'dashboard.inspector.open': '디버그 툴 열기',
  'dashboard.inspector.waiting': '페이지를 attach하면 "디버그 툴 열기" 버튼이 표시됩니다',
  'inspector.error.noTarget': '연결된 페이지가 없습니다. 기기를 attach한 후 다시 시도하세요.',
  'inspector.error.relayDown': 'relay가 활성화되지 않았습니다. start_debug로 relay를 기동하세요.',
  'dashboard.watchdog.title': '서버가 종료되었습니다',
  'dashboard.watchdog.body':
    'MCP server가 종료되어 이 세션이 더 이상 유효하지 않습니다. 이 탭을 닫아도 됩니다.',
  'dashboard.watchdog.close': '탭 닫기',
  'dashboard.conn.lost': '연결 끊김 — 재연결 시도 중…',
  'dashboard.superseded.title': '다른 탭에서 대시보드가 열려 있어요',
  'dashboard.superseded.body':
    '이 탭은 더 이상 갱신되지 않아요. 가장 최근에 연 대시보드 탭을 쓰시거나, 이 탭을 닫아도 됩니다.',
  'dashboard.session.completeTitle': '테스트 실행 완료',
  'dashboard.session.completeBody': '러너가 정상 종료되었습니다. 결과는 터미널에서 확인하세요.',
  'dashboard.session.shutdownTitle': '디버그 서버가 종료되었습니다',
  'dashboard.session.shutdownBody':
    'MCP server가 종료되어 이 세션이 더 이상 유효하지 않습니다. 이 탭을 닫아도 됩니다.',
  'dashboard.timeline.section': 'attach 진행 단계',
  'dashboard.timeline.empty': '아직 attach 시도가 없어요',
  'dashboard.timeline.tunnelUp': '터널 연결됨',
  'dashboard.timeline.tunnelDown': '터널 끊김',
  'dashboard.timeline.qrIssued': 'QR 발급됨 — 폰으로 스캔하세요',
  'dashboard.timeline.qrReissued': 'QR 재발급 (코드 갱신)',
  'dashboard.timeline.handshake': '폰이 이번 QR의 페이지를 열었어요',
  'dashboard.timeline.scriptServed': '폰이 디버거 스크립트를 불러왔어요',
  'dashboard.timeline.authHttpRejected': '폰의 코드가 거부됐어요 (QR 만료 또는 지난 QR)',
  'dashboard.timeline.authWsRejected': '폰의 코드가 거부됐어요 (QR 만료 또는 지난 QR)',
  'dashboard.timeline.targetConnected': '폰 연결됨',
  'dashboard.timeline.targetDisconnected': '폰 연결이 끊겼어요',
  'dashboard.timeline.rejectedBusy':
    '{rejected} 미니앱의 연결을 거부했어요 (먼저 연결된 미니앱: {attached}). 바꾸려면 먼저 연결된 미니앱을 X로 닫고 QR을 다시 스캔하세요',
  'dashboard.timeline.matched': '미니앱 페이지 매칭됨',
  'dashboard.timeline.cdpReady': 'CDP 준비 완료',
  'dashboard.session.lineDaemon': 'MCP 데몬 세션 · {time} 시작 · PID {pid}',
  'dashboard.session.lineTestRunner': '테스트 러너 세션 · {time} 시작 · PID {pid}',
  'attach.title': 'AIT 디버그 세션 — QR 스캔',
  'attach.deployment': 'deployment: {label}',
  'attach.steps.section': '스캔 절차',
  'attach.faq.section': '진단 체크리스트',
  'attach.url.section': 'URL (fallback)',
  'attach.mode.intossDev': '환경 3 — intoss-private relay dev',
  'attach.intoss.step1':
    '토스 앱을 실행하세요. 이 미니앱이 이미 열려 있다면 스캔해도 새로고침되지 않으니, X 버튼으로 먼저 닫으세요.',
  'attach.intoss.step2': '폰 카메라 앱으로 QR 코드를 스캔하세요.',
  'attach.intoss.step3': '팝업이 뜨면 <strong>"토스로 열기"</strong>를 탭하세요.',
  'attach.intoss.step4': '미니앱이 열리고 디버그 세션이 자동으로 attach됩니다.',
  'attach.intoss.step5':
    '<strong>테스트가 끝날 때까지 토스 앱을 화면 앞에 유지하세요</strong> — 백그라운드로 전환하면 디버그 세션이 끊어집니다.',
  'attach.intoss.faq.appNotOpen':
    '<strong>토스 앱이 안 열리는 경우</strong> — 앱 버전 확인, 카메라 앱으로 스캔 (토스 앱 내 QR 리더 X)',
  'attach.intoss.faq.prepare':
    '<strong>미니앱이 PREPARE 상태에서 멈추는 경우</strong> — deep-link에 <code>_deploymentId</code> 파라미터가 있는지 확인',
  'attach.intoss.faq.chii':
    '<strong>Chii 주입 실패 / 콘솔이 비어 있는 경우</strong> — 미니앱 번들에 <code>in-app</code> debug import가 있는지 확인',
  'attach.intoss.faq.totp':
    '<strong>TOTP gate Layer C가 비활성인 경우</strong> — relay 서버에 <code>AIT_DEBUG_TOTP_SECRET</code>이 설정돼 있는지 확인',
} as const;

export type StringKey = keyof typeof ko;
