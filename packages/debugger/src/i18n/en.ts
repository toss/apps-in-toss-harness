/**
 * Node-side dashboard/attach/inspector string catalog (English).
 *
 * Vendored from devtools' `src/i18n/en.ts`
 * (devtools@61aa2d0228df27c2c0ab2405726dd5301067981e) — mirrors every key in
 * `./ko.ts` (same 51-key subset; see that file's header for scope).
 */
import type { StringKey } from './ko.js';

export const en: Record<StringKey, string> = {
  'dashboard.lang.ko': '한국어',
  'dashboard.lang.en': 'English',
  'dashboard.title': 'AIT Debug',
  'dashboard.forbidden.title': 'This tab lost its access',
  'dashboard.forbidden.body':
    'The debugger could not let this tab in, probably because the browser was restarted or the tab was opened in a different browser. The button below opens a new dashboard tab with a fresh access link.',
  'dashboard.forbidden.button': 'Open a fresh dashboard tab',
  'dashboard.forbidden.opened': 'A new tab was opened. You can close this one.',
  'dashboard.forbidden.rateLimited': 'Please try again in a moment.',
  'dashboard.forbidden.failed': 'Could not open a tab. Ask your agent to call start_attach again.',
  'dashboard.updated': 'Last updated: {ts}',
  'dashboard.tunnel.section': 'Connection path',
  'dashboard.tunnel.up': 'Connected',
  'dashboard.tunnel.down': 'Disconnected',
  'dashboard.attach.section': 'Attach QR',
  'dashboard.attach.hint':
    'No QR yet. Ask Claude to "connect my phone" and the QR will show up here.',
  'dashboard.attach.tunnelDown':
    'The connection path to your phone dropped, so this QR no longer works. Ask Claude to connect again and a new QR will be created.',
  'dashboard.attach.reopenHint':
    'If the mini-app is already open in the Toss app, scanning the QR does not reload it. Close the mini-app with the X button first, then scan again.',
  'dashboard.pages.section': 'Connected pages',
  'dashboard.pages.empty': 'No connected pages',
  'dashboard.url.copy': 'Copy link',
  'dashboard.url.copied': 'Copied',
  'dashboard.inspector.section': 'Inspector',
  'dashboard.inspector.open': 'Open DevTools',
  'dashboard.inspector.waiting': 'The "Open DevTools" button appears once a page is connected',
  'inspector.error.noTarget': 'No page attached. Attach a device and try again.',
  'inspector.error.relayDown': 'Relay is not active. Start a relay session first.',
  'dashboard.watchdog.title': 'Server has shut down',
  'dashboard.watchdog.body':
    'The MCP server has stopped. This session is no longer active. You may close this tab.',
  'dashboard.watchdog.close': 'Close tab',
  'dashboard.watchdog.closeManual': 'Close this tab from your browser',
  'dashboard.conn.lost': 'Connection lost — reconnecting…',
  'dashboard.superseded.title': 'The dashboard is open in another tab',
  'dashboard.superseded.body':
    'This tab no longer updates. Use the most recently opened dashboard tab, or close this one.',
  'dashboard.session.completeTitle': 'Test run complete',
  'dashboard.session.completeBody': 'The runner exited cleanly. See your terminal for results.',
  'dashboard.session.shutdownTitle': 'Debug server stopped',
  'dashboard.session.shutdownBody':
    'The MCP server has shut down; this session is no longer live. You can close this tab.',
  'dashboard.timeline.section': 'Connection log',
  'dashboard.timeline.empty': 'No connection attempt yet',
  'dashboard.timeline.tunnelUp': 'Tunnel connected',
  'dashboard.timeline.tunnelDown': 'Tunnel down',
  'dashboard.timeline.qrIssued': 'QR issued — scan it with the phone',
  'dashboard.timeline.qrReissued': 'QR re-issued (code refreshed)',
  'dashboard.timeline.handshake': "The phone opened this QR's page",
  'dashboard.timeline.scriptServed': 'The phone loaded the debugger script',
  'dashboard.timeline.authHttpRejected': "The phone's code was rejected (expired or old QR)",
  'dashboard.timeline.authWsRejected': "The phone's code was rejected (expired or old QR)",
  'dashboard.timeline.targetConnected': 'Phone connected',
  'dashboard.timeline.targetDisconnected': 'Phone connection dropped',
  'dashboard.timeline.rejectedBusy':
    'Rejected mini-app {rejected} (already attached: {attached}). To switch, close the attached mini-app and scan the QR again',
  'dashboard.timeline.matched': 'Mini-app page matched',
  'dashboard.timeline.cdpReady': 'Debugger ready',
  'dashboard.session.lineDaemon': 'MCP daemon session · started {time} · PID {pid}',
  'dashboard.session.lineTestRunner': 'Test runner session · started {time} · PID {pid}',
  'dashboard.control.section': 'Session',
  'dashboard.control.attached': 'Phone connected · ends automatically at {time}',
  'dashboard.control.attachedWarn':
    'Ending soon ({time}) · tap [Continue] on the phone to keep going',
  'dashboard.control.armed': 'The QR is usable · until {time}',
  'dashboard.control.idle': 'Not accepting connections. Create a new QR',
  'dashboard.control.ended.user': 'You ended the connection',
  'dashboard.control.ended.idle': 'Ended automatically after sitting unused',
  'dashboard.control.ended.expired': 'Ended because the session time ran out',
  'dashboard.control.ended.replaced': 'Ended because another device took over',
  'dashboard.control.ended.revoked': 'The session ended',
  'dashboard.control.tunnelClosed': 'The tunnel was closed while unused. A new QR opens it again',
  'dashboard.control.kill': 'Disconnect',
  'dashboard.control.newQr': 'New QR',
  'dashboard.control.ua.ios': 'iOS device',
  'dashboard.control.ua.android': 'Android device',
  'dashboard.control.ua.other': 'Other device',
  'dashboard.control.ua.none': 'Unknown device',
  'dashboard.control.claim.claim': 'First device to open this QR: {device} · {time}',
  'dashboard.control.claim.contested':
    'Another device tried to use the same QR: {device} · {time}. The QR may have spread, so press Disconnect',
  'dashboard.control.claim.replaced':
    'Another device took over the connected phone: {device} · {time}',
  'dashboard.control.noScheme': 'Call start_attach first so the app address is known',
  'dashboard.control.failed': 'The request could not be completed',
  'attach.title': 'AIT Debug Session — QR Scan',
  'attach.deployment': 'deployment: {label}',
  'attach.steps.section': 'How to scan',
  'attach.faq.section': 'Troubleshooting checklist',
  'attach.url.section': 'URL (fallback)',
  'attach.mode.intossDev': 'env 3 — intoss-private relay dev',
  'attach.intoss.step1':
    'Open the Toss app. If this mini-app is already open, scanning will not reload it, so close it with the X button first.',
  'attach.intoss.step2': 'Scan the QR code with your phone camera app.',
  'attach.intoss.step3': 'Tap <strong>"Open in Toss"</strong> when the popup appears.',
  'attach.intoss.step4': 'The mini-app opens and the debug session attaches automatically.',
  'attach.intoss.step5':
    '<strong>Keep the Toss app in the foreground until the test run finishes</strong> — backgrounding it will drop the debug session.',
  'attach.intoss.faq.appNotOpen':
    '<strong>Toss app does not open</strong> — check app version; scan with the system camera app (not the Toss in-app QR reader)',
  'attach.intoss.faq.prepare':
    '<strong>Mini-app stuck in PREPARE state</strong> — verify the deep-link has a <code>_deploymentId</code> parameter',
  'attach.intoss.faq.chii':
    '<strong>Chii injection failure / console is empty</strong> — verify the mini-app bundle has an <code>in-app</code> debug import',
  'attach.intoss.faq.totp':
    '<strong>The code is reported as expired</strong> — scan the latest QR on this dashboard again (the relay rejects the code of an old QR)',
  'dashboard.wait.title': 'Scan the QR with your phone',
  'dashboard.wait.sub':
    'Read it with the Toss app camera. The mini-app opens and connects on its own.',
  'dashboard.timer.label': 'New QR in {sec}s',
  'dashboard.timer.note':
    'This QR stays valid for about 2 minutes. The screen swaps in a fresh code every {every} seconds.',
  'dashboard.status.ready': 'Path ready',
  'dashboard.status.attached': 'Phone connected',
  'dashboard.qr.loading': 'Loading the QR',
  'dashboard.qr.none.title': 'No QR right now',
  'dashboard.qr.none.body':
    'Your phone cannot connect at the moment. Create a new QR to scan again.',
  'dashboard.qr.make': 'Create a new QR',
  'dashboard.connecting.title': 'Connecting to your phone',
  'dashboard.connecting.sub': 'Keep the mini-app open and wait a moment.',
  'dashboard.connecting.slow':
    'If this stays stuck for over a minute, close the mini-app and scan the QR again.',
  'dashboard.step.tunnel': 'Prepare connection path',
  'dashboard.step.qr': 'Create QR',
  'dashboard.step.open': 'Open mini-app on phone',
  'dashboard.step.connect': 'Connect to phone',
  'dashboard.step.ready': 'Debugger ready',
  'dashboard.connected.title': 'Your phone is connected',
  'dashboard.connected.sub': 'You can debug the mini-app running on {device}.',
  'dashboard.connected.subNoDevice': 'You can debug the mini-app running on your phone.',
  'dashboard.connected.left': 'The connection ends in {left} if nothing happens.',
  'dashboard.connected.leftWarn':
    'The connection ends soon ({left} left). Tap [Continue] on the phone to keep it.',
  'dashboard.peek.open': 'Show QR',
  'dashboard.peek.close': 'Hide QR',
  'dashboard.peek.warn': 'Connecting with this QR will disconnect the phone that is connected now.',
  'dashboard.error.title': 'Connection lost',
  'dashboard.notice.rejected':
    'The code from the phone did not match. The QR may be old, so scan the one on screen now.',
  'dashboard.notice.busy':
    'Another mini-app is already connected, so this connection was refused. Close that app or press [Disconnect], then scan again.',
  'dashboard.notice.disconnected':
    'The phone disconnected. Reopen the mini-app or scan the QR again.',
  'dashboard.details.summary': 'Details',
  'dashboard.time.minSec': '{m}m {s}s',
  'dashboard.time.sec': '{s}s',
  'dashboard.qr.alt': 'QR code to scan with your phone',
};
