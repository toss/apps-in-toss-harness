import { describe, expect, it } from 'vitest';
import { buildDeepLinkAttachUrl } from '../deeplink.js';
import { relayRunId } from '../relay-run-id.js';

const SECRET = 'ab'.repeat(32);
const HOST = 'wss://secret-words.trycloudflare.com';

describe('relayRunId', () => {
  it('is 10 hex characters and stable for one secret and host', () => {
    const id = relayRunId(SECRET, HOST);
    expect(id).toMatch(/^[0-9a-f]{10}$/);
    expect(relayRunId(SECRET, HOST)).toBe(id);
  });

  it('changes with the tunnel host and with the secret', () => {
    const id = relayRunId(SECRET, HOST);
    expect(relayRunId(SECRET, 'wss://other-words.trycloudflare.com')).not.toBe(id);
    expect(relayRunId('cd'.repeat(32), HOST)).not.toBe(id);
  });

  it('ignores the path and does not contain the host label', () => {
    expect(relayRunId(SECRET, `${HOST}/x?y=1`)).toBe(relayRunId(SECRET, HOST));
    expect(relayRunId(SECRET, HOST)).not.toContain('secret');
  });

  it('returns undefined without a secret or with an unparsable address', () => {
    expect(relayRunId(undefined, HOST)).toBeUndefined();
    expect(relayRunId('', HOST)).toBeUndefined();
    expect(relayRunId(SECRET, 'not a url')).toBeUndefined();
  });
});

describe('buildDeepLinkAttachUrl run marker', () => {
  const scheme = 'intoss-private://app?_deploymentId=d1';

  it('adds rid= when given and replaces a stale one', () => {
    const first = buildDeepLinkAttachUrl(scheme, HOST, undefined, 'aaaaaaaaaa');
    expect(new URL(first.replace('intoss-private', 'https')).searchParams.get('rid')).toBe(
      'aaaaaaaaaa',
    );
    const second = buildDeepLinkAttachUrl(first, HOST, undefined, 'bbbbbbbbbb');
    expect(second.match(/rid=/g)).toHaveLength(1);
    expect(second).toContain('rid=bbbbbbbbbb');
  });

  it('adds nothing without a marker', () => {
    expect(buildDeepLinkAttachUrl(scheme, HOST)).not.toContain('rid=');
  });
});
