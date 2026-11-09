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
  'dashboard.title': 'AIT 디버그',
  'dashboard.updated': '마지막 갱신: {ts}',
  'dashboard.tunnel.section': '연결 통로',
  'dashboard.tunnel.up': '연결됨',
  'dashboard.tunnel.down': '끊어짐',
  'dashboard.attach.section': 'Attach QR',
  'dashboard.attach.hint':
    '아직 QR이 없어요. Claude에게 "폰에 연결해 줘"라고 요청하면 여기에 QR이 나타나요.',
  'dashboard.attach.tunnelDown':
    '폰과 이어 주는 연결 통로가 끊겼어요. 이 QR은 더 쓸 수 없어요. Claude에게 다시 연결해 달라고 요청하면 새 QR이 만들어져요.',
  'dashboard.attach.reopenHint':
    '토스 앱에 이 미니앱이 이미 열려 있으면 QR을 스캔해도 새로고침되지 않아요. 미니앱 상단의 X 버튼으로 먼저 닫은 뒤 다시 스캔하세요.',
  'dashboard.pages.section': '연결된 페이지',
  'dashboard.pages.empty': '연결된 페이지가 없어요',
  'dashboard.url.copy': '링크 복사',
  'dashboard.url.copied': '복사했어요',
  'dashboard.inspector.section': '인스펙터',
  'dashboard.inspector.open': '디버그 툴 열기',
  'dashboard.inspector.waiting': '페이지가 연결되면 "디버그 툴 열기" 버튼이 나타나요',
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
  'dashboard.timeline.section': '연결 진행 기록',
  'dashboard.timeline.empty': '아직 연결 시도가 없어요',
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
  'dashboard.timeline.cdpReady': '디버거 준비 완료',
  'dashboard.session.lineDaemon': 'MCP 데몬 세션 · {time} 시작 · PID {pid}',
  'dashboard.session.lineTestRunner': '테스트 러너 세션 · {time} 시작 · PID {pid}',
  'dashboard.control.section': '세션',
  'dashboard.control.attached': '폰 연결됨 · {time}에 자동으로 끊겨요',
  'dashboard.control.attachedWarn': '곧 자동으로 끊겨요 ({time}) · 폰에서 [계속]을 누르면 이어져요',
  'dashboard.control.armed': 'QR을 쓸 수 있어요 · {time}까지',
  'dashboard.control.idle': '지금은 연결할 수 없어요. 새 QR을 만들어 주세요',
  'dashboard.control.ended.user': '연결을 끊었어요',
  'dashboard.control.ended.idle': '한동안 쓰지 않아 자동으로 끊겼어요',
  'dashboard.control.ended.expired': '세션 시간이 다 돼서 끊겼어요',
  'dashboard.control.ended.replaced': '다른 기기가 이어받아 끊겼어요',
  'dashboard.control.ended.revoked': '세션이 끝났어요',
  'dashboard.control.tunnelClosed': '쓰지 않아 터널을 닫아 뒀어요. 새 QR을 만들면 다시 열어요',
  'dashboard.control.kill': '연결 끊기',
  'dashboard.control.newQr': '새 QR',
  'dashboard.control.ua.ios': 'iOS 기기',
  'dashboard.control.ua.android': 'Android 기기',
  'dashboard.control.ua.other': '기타 기기',
  'dashboard.control.ua.none': '알 수 없는 기기',
  'dashboard.control.claim.claim': '이 QR을 처음 연 기기: {device} · {time}',
  'dashboard.control.claim.contested':
    '다른 기기가 같은 QR로 접속을 시도했어요: {device} · {time}. QR이 퍼졌을 수 있으니 연결 끊기를 눌러 주세요',
  'dashboard.control.claim.replaced': '연결된 폰을 다른 기기가 이어받았어요: {device} · {time}',
  'dashboard.control.noScheme': '먼저 start_attach로 앱 주소를 알려 주세요',
  'dashboard.control.failed': '요청을 처리하지 못했어요',
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
    '<strong>인증 코드가 만료됐다고 나오는 경우</strong> — 이 대시보드의 최신 QR로 다시 스캔 (오래된 QR의 코드는 받아 주지 않음)',
  'dashboard.wait.title': '폰으로 QR을 스캔하세요',
  'dashboard.wait.sub': '토스 앱의 카메라로 QR을 읽으면 미니앱이 열리고 자동으로 연결돼요.',
  'dashboard.timer.label': '{sec}초 뒤 새 QR로 바뀌어요',
  'dashboard.timer.note':
    'QR은 {every}초마다 새 코드로 바뀌어요. 화면에 보이는 QR을 그대로 스캔하세요.',
  'dashboard.connecting.title': '폰과 연결하는 중이에요',
  'dashboard.connecting.sub': '미니앱을 닫지 말고 잠시만 기다려 주세요.',
  'dashboard.connecting.slow': '1분 넘게 멈춰 있으면 미니앱을 닫고 QR을 다시 스캔해 보세요.',
  'dashboard.step.tunnel': '연결 통로 준비',
  'dashboard.step.qr': 'QR 만들기',
  'dashboard.step.open': '폰에서 미니앱 열기',
  'dashboard.step.connect': '폰과 연결',
  'dashboard.step.ready': '디버거 준비',
  'dashboard.connected.title': '폰이 연결됐어요',
  'dashboard.connected.sub': '{device}에서 실행 중인 미니앱을 디버깅할 수 있어요.',
  'dashboard.connected.subNoDevice': '폰에서 실행 중인 미니앱을 디버깅할 수 있어요.',
  'dashboard.connected.left': '아무 작업이 없으면 {left} 뒤에 연결이 끊겨요.',
  'dashboard.connected.leftWarn':
    '곧 연결이 끊겨요 ({left} 남음). 폰에서 [계속]을 누르면 이어져요.',
  'dashboard.error.title': '연결이 끊겼어요',
  'dashboard.notice.rejected':
    '폰이 보낸 코드가 맞지 않았어요. QR이 오래됐을 수 있으니 지금 화면의 QR을 다시 스캔하세요.',
  'dashboard.notice.busy':
    '다른 미니앱이 이미 연결돼 있어서 이번 연결은 거절됐어요. 연결된 앱을 닫거나 [연결 끊기]를 누른 뒤 다시 스캔하세요.',
  'dashboard.notice.disconnected': '폰 연결이 끊겼어요. 미니앱을 다시 열거나 QR을 다시 스캔하세요.',
  'dashboard.details.summary': '자세히',
  'dashboard.time.minSec': '{m}분 {s}초',
  'dashboard.time.sec': '{s}초',
  'dashboard.qr.alt': '폰으로 스캔할 QR 코드',
} as const;

export type StringKey = keyof typeof ko;
