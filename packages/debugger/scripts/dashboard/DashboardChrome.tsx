/**
 * DashboardChrome.tsx — precompiled static chrome for the debug dashboard.
 *
 * BUILD-TIME ONLY. This file lives under scripts/ and is consumed exclusively
 * by scripts/build-dashboard-html.ts, which calls renderToStaticMarkup() and
 * emits src/mcp/dashboard.generated.ts (plain string exports). It MUST NOT be
 * imported from src/ — that would drag React into the MCP daemon bundle and
 * violate the INSTALL-GRAPH invariant (check-mcp-react-free.sh).
 *
 * Screen model: one hero card (`#stage`) shows exactly one pane at a time,
 * chosen by `data-view`:
 *   wait        — the QR is the hero (scan with the phone)
 *   connecting  — progress steps while the phone opens the mini-app
 *   connected   — device, time left, DevTools link, pages
 *   error       — the connection path dropped (cause + next action)
 * The server writes the first `data-view`; the inline client script keeps it
 * current from the `/events` frames. Diagnostics live in a collapsed
 * "자세히" block and never show the tunnel host, tokens or the attach link.
 *
 * Token-fill: per-request values are `__PLACEHOLDER__` strings that
 * qr-http-server.ts replaces at runtime (see the token map in
 * dashboard.generated.ts). No per-request value is baked in here.
 *
 * Locale: each locale's chrome is a separate export, rendered once per locale
 * at build time by build-dashboard-html.ts.
 *
 * SECRET-HANDLING:
 *   - No per-request values here — all tokens are placeholders.
 *   - wssUrl must never appear in generated output; the build script asserts this.
 */

interface DashboardChromeProps {
  /** ko or en — used in <html lang="…"> */
  lang: string;
  /** Resolved strings for the static labels. */
  strings: {
    title: string;
    qrNoneTitle: string;
    qrNoneBody: string;
    qrMake: string;
    updatedPrefix: string;
    waitTitle: string;
    waitSub: string;
    copy: string;
    connectingTitle: string;
    connectingSub: string;
    connectingSlow: string;
    steps: { tunnel: string; qr: string; open: string; connect: string; ready: string };
    connectedTitle: string;
    peekOpen: string;
    peekClose: string;
    peekWarn: string;
    errorTitle: string;
    errorBody: string;
    detailsSummary: string;
  };
}

const STEP_KEYS = ['tunnel', 'qr', 'open', 'connect', 'ready'] as const;

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f4f5f7;
  --surface: #ffffff;
  --surface-2: #f7f8fa;
  --text: #191f28;
  --muted: #5b6573;
  --faint: #8a93a0;
  --line: #e3e6ea;
  --primary: #1b64da;
  --primary-hover: #1553b8;
  --on-primary: #ffffff;
  --ok: #0b7a3b;
  --ok-bg: #e2f5e9;
  --bad: #b3261e;
  --bad-bg: #fdeceb;
  --warn: #7a4f00;
  --warn-bg: #fff3d1;
  --chip-bg: #eceef2;
  --focus: #1b64da;
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px -12px rgba(16, 24, 40, 0.12);
  --sp-1: 8px;
  --sp-2: 16px;
  --sp-3: 24px;
  --sp-4: 32px;
  --radius: 20px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101216;
    --surface: #181b21;
    --surface-2: #1e222a;
    --text: #eef1f5;
    --muted: #a3adba;
    --faint: #78818e;
    --line: #2a2f38;
    --primary: #7db2ff;
    --primary-hover: #a3c8ff;
    --on-primary: #0a1424;
    --ok: #5fd68b;
    --ok-bg: #12301f;
    --bad: #ff9a92;
    --bad-bg: #3a1a18;
    --warn: #ffd06b;
    --warn-bg: #3a2c0a;
    --chip-bg: #242932;
    --focus: #a3c8ff;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px -12px rgba(0, 0, 0, 0.6);
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--font); font-size: 16px; line-height: 1.5;
  padding: var(--sp-3) var(--sp-2) var(--sp-4);
  overflow-x: hidden;
}
.shell { max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--sp-2); }
main.shell { max-width: none; margin: 0; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 8px; }
h1 { font-size: 17px; line-height: 24px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
h2 { font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 var(--sp-1); text-align: center; }
h3 { font-size: 13px; line-height: 20px; font-weight: 600; margin: 0 0 var(--sp-1); color: var(--muted); }
p { margin: 0; }
.top { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-1) var(--sp-2); padding: 0 4px var(--sp-1); }
.top h1 { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; }
.top h1::before {
  content: ""; flex: 0 0 auto; width: 12px; height: 12px; border-radius: 4px; background: var(--primary);
  box-shadow: 4px 4px 0 -1px var(--primary-hover); opacity: 0.9; margin-right: 4px;
}
.status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 13px; line-height: 20px; font-weight: 600; white-space: nowrap; }
.status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.status-ready { background: var(--chip-bg); color: var(--muted); }
.status-up { background: var(--ok-bg); color: var(--ok); }
.status-down { background: var(--bad-bg); color: var(--bad); }
.lang-switcher { display: flex; gap: 2px; font-size: 13px; }
.lang-switcher a { color: var(--faint); text-decoration: none; padding: 4px 8px; border-radius: 8px; }
.lang-switcher a:hover { color: var(--text); }
.lang-switcher a.active { color: var(--text); font-weight: 700; background: var(--chip-bg); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--sp-3); box-shadow: var(--shadow); }
.hero { padding: var(--sp-4) var(--sp-3); }
.lead { text-align: center; color: var(--muted); font-size: 15px; line-height: 24px; max-width: 380px; margin: 0 auto var(--sp-3); }
.pane { display: none; }
[data-view="wait"] [data-pane="wait"],
[data-view="connecting"] [data-pane="connecting"],
[data-view="connected"] [data-pane="connected"],
[data-view="error"] [data-pane="error"] { display: block; }
.notice { margin: 0 auto var(--sp-2); max-width: 380px; padding: 12px var(--sp-2); border-radius: 12px; background: var(--warn-bg); color: var(--warn); font-size: 14px; line-height: 22px; }
.notice[hidden] { display: none; }
#attach-section { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); }
[data-qr="0"] #attach-section { display: none; }
.qr-frame {
  position: relative; width: min(100%, 288px); aspect-ratio: 1 / 1; margin: 0 auto;
  background: #fff; border-radius: 20px; padding: 16px;
  box-shadow: 0 0 0 1px var(--line), 0 16px 32px -16px rgba(16, 24, 40, 0.25);
}
img.qr {
  display: block; width: 100%; height: 100%; opacity: 0; transition: opacity 0.18s ease;
  image-rendering: pixelated; image-rendering: crisp-edges;
}
.qr-frame[data-ready="1"] img.qr { opacity: 1; }
.qr-skel {
  position: absolute; inset: 0; border-radius: 20px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px; color: #5b6573; font-size: 14px;
  background: linear-gradient(100deg, #f3f4f6 30%, #fafafb 50%, #f3f4f6 70%) 0 0 / 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
.qr-frame[data-ready="1"] .qr-skel { display: none; }
.qr-skel i { width: 24px; height: 24px; border-radius: 50%; border: 3px solid #d5d9df; border-top-color: #1b64da; animation: spin 0.9s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
.hint { font-size: 14px; line-height: 22px; color: var(--muted); text-align: center; max-width: 380px; }
.reopen-hint { font-size: 13px; color: var(--faint); }
.timer { display: none; flex-direction: column; align-items: center; gap: 6px; margin-top: var(--sp-3); }
[data-qr="1"] .timer { display: flex; }
.timer-bar { width: min(100%, 288px); height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
.timer-bar i { display: block; height: 100%; width: 100%; background: var(--primary); transform-origin: left center; }
.timer-text { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; min-height: 20px; }
.note { font-size: 13px; line-height: 20px; color: var(--faint); text-align: center; max-width: 380px; margin: var(--sp-1) auto 0; }
[data-qr="0"] .note-qr { display: none; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-1); margin-top: var(--sp-3); }
.btn {
  appearance: none; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
  min-height: 44px; padding: 0 var(--sp-3); border-radius: 12px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text);
  display: inline-flex; align-items: center; justify-content: center; text-decoration: none;
  transition: background 0.12s;
}
.btn:hover:not(:disabled) { background: var(--surface-2); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn[hidden] { display: none; }
.btn-primary { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
.btn-primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.btn-danger { color: var(--bad); }
#copy-btn { display: none; }
[data-qr="1"] #copy-btn { display: inline-flex; }
.qr-none { display: none; text-align: center; padding: var(--sp-2) 0; }
[data-qr="0"] .qr-none { display: block; }
/* No QR: the "scan the QR" heading would contradict the empty state below it. */
[data-qr="0"] > h2, [data-qr="0"] > .lead { display: none; }
.qr-none .badge, .state-badge {
  width: 64px; height: 64px; margin: 0 auto var(--sp-2); border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700;
  background: var(--chip-bg); color: var(--muted);
}
.qr-none .qr-none-title { font-size: 18px; line-height: 26px; font-weight: 700; margin-bottom: 4px; }
.qr-none .actions { margin-top: var(--sp-3); }
.state-badge.ok { background: var(--ok-bg); color: var(--ok); }
.state-badge.bad { background: var(--bad-bg); color: var(--bad); }
.steps { list-style: none; margin: var(--sp-3) auto 0; padding: var(--sp-2) var(--sp-3); max-width: 340px; display: flex; flex-direction: column; gap: 14px; background: var(--surface-2); border-radius: 16px; }
.steps li { display: flex; align-items: center; gap: 12px; font-size: 15px; color: var(--faint); }
.steps .dot {
  flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid var(--line); display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; line-height: 1; font-weight: 700;
}
.steps li.done { color: var(--text); }
.steps li.done .dot { background: var(--ok); border-color: var(--ok); color: var(--surface); }
.steps li.done .dot::after { content: "\\2713"; }
.steps li.current { color: var(--text); font-weight: 600; }
.steps li.current .dot { border-color: var(--primary); border-top-color: transparent; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .steps li.current .dot { animation: none; border-top-color: var(--primary); }
  .qr-skel, .qr-skel i { animation: none; }
  img.qr { transition: none; }
}
.cta { display: flex; justify-content: center; margin-top: var(--sp-3); }
.inspector-link {
  display: inline-flex; align-items: center; justify-content: center; min-height: 48px; min-width: 200px;
  padding: 0 var(--sp-3); border-radius: 12px; font-size: 16px; font-weight: 700; text-decoration: none;
  background: var(--primary); color: var(--on-primary);
}
.inspector-link:hover { background: var(--primary-hover); }
.inspector-hint { font-size: 14px; color: var(--muted); text-align: center; }
.facts { display: flex; flex-direction: column; gap: 4px; text-align: center; color: var(--muted); font-size: 15px; }
.facts .warn { color: var(--warn); font-weight: 600; }
.pages { margin-top: var(--sp-3); border-top: 1px solid var(--line); padding-top: var(--sp-2); }
.pages ul, .details-body ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.pages li { font-size: 14px; line-height: 22px; display: flex; gap: var(--sp-1); align-items: baseline; }
li.empty { color: var(--muted); }
.page-id { font-family: var(--mono); font-size: 12px; color: var(--muted); flex: 0 0 auto; }
.page-url { word-break: break-all; }
.ctl { display: block; padding: var(--sp-2) var(--sp-3); box-shadow: none; background: var(--surface-2); }
.ctl .ctl-head { font-size: 12px; font-weight: 600; color: var(--faint); letter-spacing: 0.04em; text-transform: uppercase; }
.ctl p { font-size: 14px; line-height: 22px; margin: 2px 0; color: var(--text); }
.ctl ul { list-style: none; margin: 4px 0; padding: 0; font-size: 13px; line-height: 20px; color: var(--muted); }
.ctl li.contested { color: var(--bad); font-weight: 600; }
.ctl .err { color: var(--bad); min-height: 0; }
.ctl .err:empty { display: none; }
.ctl .actions { justify-content: flex-start; margin-top: var(--sp-1); }
.ctl .btn { min-height: 40px; font-size: 14px; padding: 0 var(--sp-2); }
details.details { padding: 0; box-shadow: none; background: transparent; }
details.details > summary {
  cursor: pointer; padding: 12px var(--sp-2); font-size: 14px; font-weight: 600; color: var(--muted); list-style: none;
  display: flex; align-items: center; gap: var(--sp-1); min-height: 44px;
}
details.details > summary::-webkit-details-marker { display: none; }
details.details > summary::before { content: "\\25B8"; color: var(--faint); transition: transform 0.15s; }
details.details[open] > summary::before { transform: rotate(90deg); }
details.details[open] { background: var(--surface); }
.details-body { padding: 0 var(--sp-2) var(--sp-2); display: flex; flex-direction: column; gap: var(--sp-2); }
.session-line { font-size: 13px; color: var(--muted); }
.session-line:empty { display: none; }
.updated { font-size: 12px; color: var(--faint); font-family: var(--mono); }
#timeline-list li { font-size: 13px; line-height: 20px; }
li.stage-ok .stage-time, li.stage-bad .stage-time { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-right: 6px; }
li.stage-bad { color: var(--bad); }
/* connected + QR 보기: wait 창(QR·남은 시간·새 QR 만들기)을 연결 화면 아래에 펼친다. */
.peek-warn { display: none; }
.peek-bar { margin-top: var(--sp-3); }
.peek-bar .peek-close, [data-peek="1"] .peek-bar .peek-open { display: none; }
[data-peek="1"] .peek-bar .peek-close { display: inline; }
[data-view="connected"][data-peek="1"] [data-pane="wait"] { display: block; margin-top: var(--sp-3); }
[data-view="connected"][data-peek="1"] [data-pane="wait"] > h2,
[data-view="connected"][data-peek="1"] [data-pane="wait"] > .lead,
[data-view="connected"][data-peek="1"] [data-pane="wait"] > .notice:not(.peek-warn) { display: none; }
[data-view="connected"][data-peek="1"] .peek-warn { display: block; }
#stage[data-view="error"] ~ #ait-control #ait-control-newqr,
#stage[data-view="wait"]:has([data-qr="0"]) ~ #ait-control #ait-control-newqr { display: none; }
.lang-switcher { margin-left: auto; }
@media (max-width: 480px) {
  .top h1 { order: 1; }
  .lang-switcher { order: 2; }
  .status { order: 3; }
  body { padding: var(--sp-2) 12px var(--sp-3); }
  .hero { padding: var(--sp-3) var(--sp-2); }
  h2 { font-size: 22px; line-height: 30px; }
  .qr-frame { padding: 12px; }
}
`;

/**
 * Static dashboard chrome — head/style + skeleton body structure.
 * All dynamic slots are `__PLACEHOLDER__` strings that qr-http-server.ts
 * fills with real per-request values at runtime.
 */
export function DashboardChrome({ lang, strings }: DashboardChromeProps) {
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{strings.title}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <div className="shell">
          <header className="top">
            <h1>{strings.title}</h1>
            {/* __TUNNEL_CLASS__ and __TUNNEL_STATUS__ filled at runtime */}
            <span className="status __TUNNEL_CLASS__" id="tunnel-status" role="status">
              __TUNNEL_STATUS__
            </span>
            {/* __LANG_SWITCHER__ is filled at runtime by qr-http-server.ts */}
            {'__LANG_SWITCHER__'}
          </header>

          <main className="shell">
            <section
              className="card hero"
              id="stage"
              data-view="__VIEW__"
              data-peek="0"
              aria-live="polite"
            >
              <div className="pane" data-pane="wait" data-qr="__HAS_QR__">
                <p className="notice peek-warn" id="peek-warn" role="note">
                  {strings.peekWarn}
                </p>
                <h2>{strings.waitTitle}</h2>
                <p className="lead">{strings.waitSub}</p>
                <div className="notice" id="notice" role="alert" hidden />
                {/* __ATTACH_SECTION__ filled at runtime (QR frame + reopen hint, or empty) */}
                <div id="attach-section">__ATTACH_SECTION__</div>
                {/* Shown instead of the QR when no QR exists: never an empty card. */}
                <div className="qr-none">
                  <div className="badge" aria-hidden="true">
                    {'?'}
                  </div>
                  <p className="qr-none-title">{strings.qrNoneTitle}</p>
                  <p className="hint">{strings.qrNoneBody}</p>
                  <div className="actions">
                    <button className="btn btn-primary" type="button" data-act="new-qr" hidden>
                      {strings.qrMake}
                    </button>
                  </div>
                </div>
                <div className="timer" aria-hidden="true">
                  <div className="timer-bar">
                    <i id="qr-timer-bar" />
                  </div>
                  <span className="timer-text" id="qr-timer-text" />
                </div>
                <p className="note note-qr">__TIMER_NOTE__</p>
                <div className="actions">
                  <button
                    className="btn copy-btn"
                    id="copy-btn"
                    type="button"
                    data-url="__COPY_URL__"
                  >
                    {strings.copy}
                  </button>
                </div>
              </div>

              <div className="pane" data-pane="connecting">
                <h2>{strings.connectingTitle}</h2>
                <p className="lead">{strings.connectingSub}</p>
                <ol className="steps" id="steps">
                  {STEP_KEYS.map((k) => (
                    <li key={k} data-step={k}>
                      <span className="dot" aria-hidden="true" />
                      <span>{strings.steps[k]}</span>
                    </li>
                  ))}
                </ol>
                <p className="note">{strings.connectingSlow}</p>
              </div>

              <div className="pane" data-pane="connected">
                <div className="state-badge ok" aria-hidden="true">
                  {'\u2713'}
                </div>
                <h2>{strings.connectedTitle}</h2>
                <div className="facts">
                  <p id="conn-sub" />
                  <p id="conn-left" />
                </div>
                {/* __INSPECTOR_SECTION__ filled at runtime (link or waiting hint, #503) */}
                <div className="cta">{'__INSPECTOR_SECTION__'}</div>
                {/* __PAGES_SECTION__ filled at runtime — empty string when pages===null */}
                {'__PAGES_SECTION__'}
                {/* QR 보기: 접힌 기본값. 펼침 상태는 stage[data-peek]에 있어 SSE 재렌더에도 남는다. */}
                <div className="actions peek-bar">
                  <button
                    className="btn"
                    id="qr-peek-toggle"
                    type="button"
                    aria-expanded="false"
                    aria-controls="stage"
                  >
                    <span className="peek-open">{strings.peekOpen}</span>
                    <span className="peek-close">{strings.peekClose}</span>
                  </button>
                </div>
              </div>

              <div className="pane" data-pane="error">
                <div className="state-badge bad" aria-hidden="true">
                  {'!'}
                </div>
                <h2>{strings.errorTitle}</h2>
                <p className="lead">{strings.errorBody}</p>
                <div className="actions">
                  <button className="btn" type="button" data-act="new-qr" hidden>
                    {strings.qrMake}
                  </button>
                </div>
              </div>
            </section>

            {/* __CONTROL_SECTION__ filled at runtime — empty when the state has no control */}
            {'__CONTROL_SECTION__'}

            <details className="card details" id="diag">
              <summary>{strings.detailsSummary}</summary>
              <div className="details-body">
                {/* __SESSION_LINE__ filled at runtime — empty (and hidden via :empty) when no session info */}
                <p className="session-line" id="session-line">
                  __SESSION_LINE__
                </p>
                {/* __TIMELINE_SECTION__ filled at runtime — empty string when stages is not provided */}
                {'__TIMELINE_SECTION__'}
                {/* __NOW__ is filled at runtime by qr-http-server.ts */}
                <p className="updated" id="updated">
                  {strings.updatedPrefix}__NOW__
                </p>
              </div>
            </details>
          </main>
        </div>
      </body>
    </html>
  );
}
