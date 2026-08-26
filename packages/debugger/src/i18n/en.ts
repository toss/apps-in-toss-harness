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
  'dashboard.title': 'AIT Debug Dashboard',
  'dashboard.updated': 'Last updated: {ts}',
  'dashboard.tunnel.section': 'Tunnel status',
  'dashboard.tunnel.up': 'Connected',
  'dashboard.tunnel.down': 'Disconnected',
  'dashboard.attach.section': 'Attach QR',
  'dashboard.attach.hint': 'Call the start_attach MCP tool to show the QR here.',
  'dashboard.attach.tunnelDown':
    'Relay disconnected — this QR is no longer valid. Restart the relay, then regenerate the QR.',
  'dashboard.pages.section': 'Connected Pages',
  'dashboard.pages.empty': 'No attached pages',
  'dashboard.url.copy': 'Copy',
  'dashboard.url.copied': 'Copied',
  'dashboard.inspector.section': 'Inspector',
  'dashboard.inspector.open': 'Open DevTools',
  'dashboard.inspector.waiting': 'Attach a page to enable the "Open DevTools" button',
  'inspector.error.noTarget': 'No page attached. Attach a device and try again.',
  'inspector.error.relayDown': 'Relay is not active. Start a relay session first.',
  'dashboard.watchdog.title': 'Server has shut down',
  'dashboard.watchdog.body':
    'The MCP server has stopped. This session is no longer active. You may close this tab.',
  'dashboard.watchdog.close': 'Close tab',
  'dashboard.conn.lost': 'Connection lost — reconnecting…',
  'dashboard.session.completeTitle': 'Test run complete',
  'dashboard.session.completeBody': 'The runner exited cleanly. See your terminal for results.',
  'dashboard.session.shutdownTitle': 'Debug server stopped',
  'dashboard.session.shutdownBody':
    'The MCP server has shut down; this session is no longer live. You can close this tab.',
  'attach.title': 'AIT Debug Session — QR Scan',
  'attach.deployment': 'deployment: {label}',
  'attach.steps.section': 'How to scan',
  'attach.faq.section': 'Troubleshooting checklist',
  'attach.url.section': 'URL (fallback)',
  'attach.mode.intossDev': 'env 3 — intoss-private relay dev',
  'attach.intoss.step1': 'Open the Toss app.',
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
    '<strong>TOTP gate Layer C is inactive</strong> — check that <code>AIT_DEBUG_TOTP_SECRET</code> is set on the relay server',
};
