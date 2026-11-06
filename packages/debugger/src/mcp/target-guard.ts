/**
 * 폰 쪽 `target.js` 가드 — debugger-client 버전과 무관하게 "다른 미니앱이 이미 붙어 있다"를
 * 미니앱 화면에 알린다.
 *
 * 거부된 미니앱은 옛 debug-console(≤0.1.7)을 싣고 있는 경우가 많아 4409 WS close를 화면에
 * 띄우지 못한다. 그런데 모든 debug-console·debugger-client 버전은 relay의 `target.js`를 script 태그로 불러
 * 실행한다. relay가 붙은 미니앱이 있을 때만 chii의 `target.js` 앞에 이 가드를 붙여 내려주면,
 * 페이지 호스트가 붙은 호스트와 다를 때 경고를 그리고 chii 코드를 실행하지 않는다. 같은
 * 호스트(새로고침·재스캔)는 chii 본문을 그대로 실행한다.
 *
 * SECRET-HANDLING: 가드에는 붙은 호스트명과 그 첫 DNS 라벨만 들어간다. `at=`·relay 호스트·
 * 페이지 URL은 어디에도 넣지 않는다(chii 본문은 실행 시점에 script src에서 서버 URL을 얻는다).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { isPreRenameDeviceProtocol } from '@apps-in-toss/internal-protocol/attach-handshake';
import { hostLabel } from './target-busy.js';

const require = createRequire(import.meta.url);

let cachedChiiTargetScript: string | null | undefined;

/** chii가 서빙하는 `target.js` 원본. 못 읽으면 `null`(호출자는 chii 기본 응답으로 fail-open). */
export function readChiiTargetScript(): string | null {
  if (cachedChiiTargetScript !== undefined) return cachedChiiTargetScript;
  try {
    const entry = require.resolve('chii');
    cachedChiiTargetScript = readFileSync(
      join(dirname(entry), '..', 'public', 'target.js'),
      'utf8',
    );
  } catch {
    cachedChiiTargetScript = null;
  }
  return cachedChiiTargetScript;
}

/** `<script>`/줄바꿈 문자 해석 사고를 막는 JSON 직렬화. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
}

export function busyWarningText(label: string): string {
  return `디버거가 이미 다른 미니앱(${label})에 연결돼 있어서 이 미니앱은 연결하지 않았어요. 이 미니앱을 디버깅하려면 ${label} 미니앱을 X로 닫은 뒤 QR을 다시 스캔하세요.`;
}

export const BUSY_CONSOLE_WARNING =
  '[ait-debugger] 다른 미니앱이 이미 디버거에 연결돼 있어서 이 미니앱은 연결하지 않았어요.';

/**
 * 붙은 호스트가 알려져 있으면(`null` 제외) 가드를 앞에 붙인 target.js를, 아니면 `null`을 돌려준다.
 */
export function buildGuardedTargetScript(
  chiiBody: string,
  attachedHosts: ReadonlyArray<string | null>,
): string | null {
  const hosts = [
    ...new Set(
      attachedHosts.filter((h): h is string => h !== null && h !== '').map((h) => h.toLowerCase()),
    ),
  ];
  const first = hosts[0];
  if (first === undefined) return null;
  const text = busyWarningText(hostLabel(first));
  const guard = `;(function(){
var H=${safeJson(hosts)},M=${safeJson(text)},W=${safeJson(BUSY_CONSOLE_WARNING)};
var h='';try{h=String(location.hostname||'').toLowerCase()}catch(e){}
if(h===''||H.indexOf(h)!==-1)return false;
try{var d=Object.getOwnPropertyDescriptor(window,'__ait_debug_status');if(!d||d.writable||d.set)window.__ait_debug_status='relay-busy'}catch(e){}
try{console.warn(W)}catch(e){}
function show(){try{
var host=document.createElement('div');
host.style.cssText='position:fixed;top:0;left:0;right:0;width:100%;z-index:2147483647;margin:0;padding:0;';
var root=host.attachShadow?host.attachShadow({mode:'closed'}):host;
var bar=document.createElement('div');
bar.style.cssText='box-sizing:border-box;width:100%;padding:12px 16px;background:#b3261e;color:#fff;font:600 14px/1.5 -apple-system,system-ui,sans-serif;word-break:keep-all;cursor:pointer;';
bar.textContent=M;
bar.addEventListener('click',function(){if(host.parentNode)host.parentNode.removeChild(host)});
root.appendChild(bar);
(document.body||document.documentElement).appendChild(host);
}catch(e){}}
if(document.body)show();else document.addEventListener('DOMContentLoaded',show);
return true;
})()||(function(){
`;
  return `${guard}${chiiBody}\n}).call(this);\n`;
}

/**
 * On-phone text for a device whose protocol differs from the relay's.
 *
 * A device older than the relay is a pre-rename `@apps-in-toss/debug-console` (protocol 2 or
 * lower, see `isPreRenameDeviceProtocol`; a newer-but-still-older `debugger-client` gets a plain
 * "update debugger-client" text): the package continues as `@apps-in-toss/debugger-client`, so the text names the new
 * package and the 0.3.1 floor of both packages instead of "update debug-console". A device
 * newer than the relay needs a newer daemon.
 */
export function updateRequiredText(devicePathProtocol: number, hostProtocol: number): string {
  if (devicePathProtocol < hostProtocol) {
    return isPreRenameDeviceProtocol(devicePathProtocol)
      ? '이 미니앱에 들어 있는 @apps-in-toss/debug-console은 @apps-in-toss/debugger-client로 이름이 바뀌었고, 지금 디버거와는 연결되지 않아요. debug-console을 지우고 @apps-in-toss/debugger-client 0.3.1 이상을 설치해 다시 배포한 뒤 QR을 다시 스캔하세요.'
      : '이 미니앱의 @apps-in-toss/debugger-client가 디버거(@apps-in-toss/debugger)보다 오래돼서 연결하지 않았어요. debugger-client를 최신 버전으로 올려 다시 배포한 뒤 QR을 다시 스캔하세요.';
  }
  return '디버거(@apps-in-toss/debugger)가 이 미니앱의 @apps-in-toss/debugger-client보다 오래돼서 연결하지 않았어요. 디버거를 0.3.1 이상 최신 버전으로 올려 다시 실행하세요.';
}

export const UPDATE_REQUIRED_CONSOLE_WARNING =
  '[ait-debugger] 디버거와 미니앱 쪽 패키지의 프로토콜이 달라서 연결하지 않았어요. @apps-in-toss/debugger와 @apps-in-toss/debugger-client를 0.3.1 이상으로 함께 맞추세요.';

/**
 * `target.js` 대신 내려주는 스크립트. 프로토콜이 다른 기기는 chii 코드를 받지 못하고, 화면 위쪽에
 * 업데이트 필요 막대만 그린다(탭하면 닫힘). 옛 debug-console도 `target.js`를 script 태그로
 * 실행하므로 이 막대는 어떤 버전에서도 보인다.
 *
 * SECRET-HANDLING: 고정 문구와 프로토콜 번호만 들어 있다. `at=`·relay 호스트·페이지 URL은 없다.
 */
export function buildUpdateRequiredScript(
  devicePathProtocol: number,
  hostProtocol: number,
): string {
  const text = updateRequiredText(devicePathProtocol, hostProtocol);
  return `;(function(){
var M=${safeJson(text)},W=${safeJson(UPDATE_REQUIRED_CONSOLE_WARNING)};
try{var d=Object.getOwnPropertyDescriptor(window,'__ait_debug_status');if(!d||d.writable||d.set)window.__ait_debug_status='update-required'}catch(e){}
try{console.warn(W)}catch(e){}
function show(){try{
var host=document.createElement('div');
host.style.cssText='position:fixed;top:0;left:0;right:0;width:100%;z-index:2147483647;margin:0;padding:0;';
var root=host.attachShadow?host.attachShadow({mode:'closed'}):host;
var bar=document.createElement('div');
bar.style.cssText='box-sizing:border-box;width:100%;padding:12px 16px;background:#b3261e;color:#fff;font:600 14px/1.5 -apple-system,system-ui,sans-serif;word-break:keep-all;cursor:pointer;';
bar.textContent=M;
bar.addEventListener('click',function(){if(host.parentNode)host.parentNode.removeChild(host)});
root.appendChild(bar);
(document.body||document.documentElement).appendChild(host);
}catch(e){}}
if(document.body)show();else document.addEventListener('DOMContentLoaded',show);
})();
`;
}
