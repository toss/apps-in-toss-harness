/**
 * Debug-mode `AitSource` — forwards `AIT.*` methods over the Chii channel.
 *
 * The AIT domain (`AIT.getSdkCallHistory` / `getMockState` /
 * `getOperationalEnvironment`) is non-standard CDP: the in-app side registers a
 * handler for these methods and answers them over the same Chii websocket the
 * CDP commands use. Building the AIT source on `ChiiCdpConnection.sendCommand`
 * means both domains share one transport (spec: "the same MCP server forwards
 * both CDP and AIT domains").
 *
 * The in-app `AIT.*` handler lives downstream in sdk-example. Here we build
 * the MCP-server-side forwarding + the injectable seam; tests inject a fake
 * `AitSource` returning canned responses, so this forwarding layer needs no
 * phone.
 *
 * Node-only (wraps the relay websocket connection).
 */

import type {
  AitMethodMap,
  AitMethodName,
  AitMockState,
  AitOperationalEnvironment,
  AitSdkCallHistory,
  AitSource,
} from './ait-source.js';
import { ToolMessageError } from './tool-message-error.js';

/** The slice of `ChiiCdpConnection` this source needs (keeps it testable). */
export interface AitCommandSender {
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Narrows an `AIT.getSdkCallHistory` response, tolerating a missing array. */
function asSdkCallHistory(raw: unknown): AitSdkCallHistory {
  if (isObject(raw) && Array.isArray(raw.calls)) {
    return { calls: raw.calls as AitSdkCallHistory['calls'] };
  }
  return { calls: [] };
}

/** Narrows an `AIT.getMockState` response to an opaque record. */
function asMockState(raw: unknown): AitMockState {
  return isObject(raw) ? raw : {};
}

/** Narrows an `AIT.getOperationalEnvironment` response. */
function asOperationalEnvironment(raw: unknown): AitOperationalEnvironment {
  const environment =
    isObject(raw) && typeof raw.environment === 'string' ? raw.environment : 'unknown';
  const sdkVersion = isObject(raw) && typeof raw.sdkVersion === 'string' ? raw.sdkVersion : null;
  return { environment, sdkVersion };
}

/** True when the page answered that it does not implement the method. */
function isUnimplemented(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unimplemented|not implemented|method not found|wasn't found|was not found/i.test(message);
}

/**
 * Real-device fallback for `AIT.getOperationalEnvironment`: the page has no
 * `AIT.*` handler, but the dog-food bridge `window.__sdkCall` (the same path
 * `call_sdk` uses) can answer it. `sdkVersion` is read from `window.__sdk` when
 * the bundle exposes it, else null.
 */
const OPERATIONAL_ENVIRONMENT_EXPRESSION =
  '(async () => {' +
  " if (typeof window.__sdkCall !== 'function') return JSON.stringify({ok:false});" +
  ' try {' +
  "  const env = await window.__sdkCall('getOperationalEnvironment');" +
  '  const v = window.__sdk && (window.__sdk.version || window.__sdk.sdkVersion);' +
  "  return JSON.stringify({ok:true,environment:env,sdkVersion:typeof v === 'string' ? v : null});" +
  ' } catch (e) { return JSON.stringify({ok:false}); }' +
  '})()';

const LOCAL_ONLY_MESSAGE = (method: string): string =>
  `${method}은 로컬 mock 환경(start_debug로 mock 전환)에서만 쓸 수 있습니다. ` +
  '실기기(relay)의 페이지에는 이 데이터를 돌려주는 곳이 없습니다. ' +
  '실기기에서는 call_sdk로 SDK를 직접 호출하거나 list_console_messages·evaluate로 확인하세요.';

export class ChiiAitSource implements AitSource {
  constructor(private readonly sender: AitCommandSender) {}

  private async operationalEnvironmentViaSdkCall(): Promise<AitOperationalEnvironment | null> {
    const res = await this.sender.sendCommand('Runtime.evaluate', {
      expression: OPERATIONAL_ENVIRONMENT_EXPRESSION,
      returnByValue: true,
      awaitPromise: true,
    });
    const value = isObject(res) && isObject(res.result) ? res.result.value : undefined;
    if (typeof value !== 'string') return null;
    try {
      const parsed: unknown = JSON.parse(value);
      if (isObject(parsed) && parsed.ok === true && typeof parsed.environment === 'string') {
        return {
          environment: parsed.environment,
          sdkVersion: typeof parsed.sdkVersion === 'string' ? parsed.sdkVersion : null,
        };
      }
    } catch {
      // fall through
    }
    return null;
  }

  async get<M extends AitMethodName>(method: M): Promise<AitMethodMap[M]> {
    let raw: unknown;
    try {
      raw = await this.sender.sendCommand(method);
    } catch (err) {
      if (!isUnimplemented(err)) throw err;
      if (method === 'AIT.getOperationalEnvironment') {
        const viaSdk = await this.operationalEnvironmentViaSdkCall();
        if (viaSdk) return viaSdk as AitMethodMap[M];
        throw new ToolMessageError(
          'AIT.getOperationalEnvironment 실패: 페이지가 이 메서드를 지원하지 않고 ' +
            'window.__sdkCall로도 값을 읽지 못했습니다. dog-food 빌드인지 확인하고 ' +
            'call_sdk("getOperationalEnvironment")를 직접 호출해 보세요.',
        );
      }
      throw new ToolMessageError(LOCAL_ONLY_MESSAGE(method));
    }
    // The map's value type is resolved per-key below; the cast is the single
    // narrowing point (each branch returns the precise shape for `method`).
    switch (method) {
      case 'AIT.getSdkCallHistory':
        return asSdkCallHistory(raw) as AitMethodMap[M];
      case 'AIT.getMockState':
        return asMockState(raw) as AitMethodMap[M];
      case 'AIT.getOperationalEnvironment':
        return asOperationalEnvironment(raw) as AitMethodMap[M];
      default:
        throw new Error(`Unknown AIT method: ${String(method)}`);
    }
  }
}
