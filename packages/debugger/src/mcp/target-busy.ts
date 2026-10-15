/**
 * "먼저 붙은 미니앱이 이긴다" 정책의 순수 부분 — relay 업그레이드 게이트와 데몬이 공유한다.
 *
 * relay 하나는 미니앱 하나만 디버깅한다. 이미 어떤 미니앱 페이지가 붙어 있는데 다른 미니앱
 * (페이지 호스트가 다름)이 `/target/<id>`로 들어오면 새 쪽을 거부(close 4409)한다. 같은 호스트의
 * 새로고침·재스캔은 거부하지 않는다 — 기존의 "새 target이 이전 것을 교체" 동작이 그대로다.
 *
 * SECRET-HANDLING: 페이지 URL에는 `at=`·relay 호스트가 실려 오므로 여기서는 호스트명만 뽑고
 * URL 자체는 어디에도 남기지 않는다. 표시용 라벨은 호스트의 첫 DNS 라벨(`foo`)뿐이다.
 *
 * 경량 모듈: 의존성이 없다(relay·attach-timeline·chii-connection이 모두 불러온다).
 */

/**
 * chii target 업그레이드 URL(`/target/<id>?url=<페이지 URL>&…`)에서 페이지 호스트명만 뽑는다.
 * `url` 쿼리가 없거나 파싱되지 않으면 `null`. 호스트명은 소문자로 정규화한다.
 */
export function extractTargetPageHost(reqUrl: string): string | null {
  try {
    const pageUrl = new URL(reqUrl, 'http://relay.invalid').searchParams.get('url');
    if (pageUrl === null || pageUrl === '') return null;
    const host = new URL(pageUrl).hostname.toLowerCase();
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

/** 사용자에게 보이는 이름: 호스트의 첫 DNS 라벨(`foo.private-apps.tossmini.com` → `foo`). */
export function hostLabel(host: string | null): string {
  if (host === null || host === '') return '알 수 없는 미니앱';
  const first = host.split('.')[0];
  return first !== undefined && first !== '' ? first : '알 수 없는 미니앱';
}

/**
 * 새 target을 거부할지 정한다.
 *
 * - 붙어 있는 페이지가 없으면 허용.
 * - 새 페이지의 호스트를 모르면(`url` 쿼리 없음) 허용 — 다른 앱이라는 증거가 없으므로 기존
 *   동작(교체)을 유지한다. 판단 불가를 거부로 처리하면 정상 attach를 막을 수 있다.
 * - 붙어 있는 페이지의 호스트를 모르는 경우(`null`)는 비교 대상에서 뺀다.
 * - 붙어 있는 호스트 중 하나라도 새 호스트와 다르면 거부(정확한 호스트명 일치만 같은 앱).
 */
export function shouldRejectNewTarget(info: {
  pageHost: string | null;
  attachedHosts: ReadonlyArray<string | null>;
}): boolean {
  if (info.pageHost === null) return false;
  const known = info.attachedHosts.filter((h): h is string => h !== null);
  return known.some((h) => h !== info.pageHost);
}
