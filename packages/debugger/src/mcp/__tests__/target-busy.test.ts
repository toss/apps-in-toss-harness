/**
 * "먼저 붙은 미니앱이 이긴다" 정책의 순수 부분 — 호스트 추출, 라벨, 거부 판정.
 */
import { describe, expect, it } from 'vitest';
import { extractTargetPageHost, hostLabel, shouldRejectNewTarget } from '../target-busy.js';

describe('extractTargetPageHost', () => {
  it('returns only the lower-cased hostname of the chii url param', () => {
    const page = 'https://Foo.private-apps.tossmini.com/p?at=123456&relay=wss%3A%2F%2Fh#x';
    const url = `/target/id1?${new URLSearchParams({ url: page, title: 't' })}`;
    expect(extractTargetPageHost(url)).toBe('foo.private-apps.tossmini.com');
  });

  it('returns null when url is absent, empty, or not parseable', () => {
    expect(extractTargetPageHost('/target/id1?title=t')).toBeNull();
    expect(extractTargetPageHost('/target/id1?url=')).toBeNull();
    expect(extractTargetPageHost('/target/id1?url=not%20a%20url')).toBeNull();
  });
});

describe('hostLabel', () => {
  it('keeps only the first DNS label', () => {
    expect(hostLabel('bar.private-apps.tossmini.com')).toBe('bar');
    expect(hostLabel(null)).toBe('알 수 없는 미니앱');
  });
});

describe('shouldRejectNewTarget', () => {
  const foo = 'foo.private-apps.tossmini.com';
  const bar = 'bar.private-apps.tossmini.com';

  it('rejects a different host while another page is attached', () => {
    expect(shouldRejectNewTarget({ pageHost: bar, attachedHosts: [foo] })).toBe(true);
  });

  it('allows the same host (reload / re-scan of the same app)', () => {
    expect(shouldRejectNewTarget({ pageHost: foo, attachedHosts: [foo] })).toBe(false);
    expect(shouldRejectNewTarget({ pageHost: foo, attachedHosts: [foo, foo] })).toBe(false);
  });

  it('allows anything when no page is attached', () => {
    expect(shouldRejectNewTarget({ pageHost: bar, attachedHosts: [] })).toBe(false);
  });

  it('allows a newcomer whose host is unknown (no url param): no evidence it is a different app', () => {
    expect(shouldRejectNewTarget({ pageHost: null, attachedHosts: [foo] })).toBe(false);
  });

  it('ignores attached pages whose host is unknown', () => {
    expect(shouldRejectNewTarget({ pageHost: bar, attachedHosts: [null] })).toBe(false);
  });
});
