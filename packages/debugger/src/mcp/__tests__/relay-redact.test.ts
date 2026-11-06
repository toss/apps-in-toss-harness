import { describe, expect, it } from 'vitest';
import { maskRelayUrl, redactRelayText } from '../relay-redact.js';
import { redactErrorMessage } from '../tools.js';

const CODE = 'c0ffee00'.repeat(4);

describe('maskRelayUrl', () => {
  it('keeps the scheme and the domain, masks the first label, drops path and query', () => {
    expect(maskRelayUrl(`wss://abc-def.trycloudflare.com/v2/at/${CODE}/x?at=${CODE}`)).toBe(
      'wss://***.trycloudflare.com',
    );
  });

  it('passes null through and masks anything unparsable', () => {
    expect(maskRelayUrl(null)).toBeNull();
    expect(maskRelayUrl('not a url')).toBe('***');
  });

  it('never returns the original first label', () => {
    expect(maskRelayUrl('wss://secret-words.trycloudflare.com')).not.toContain('secret-words');
  });
});

describe('redactRelayText', () => {
  it('masks the at query value', () => {
    expect(redactRelayText(`/client/id?target=t&at=${CODE}&x=1`)).toBe(
      '/client/id?target=t&at=<redacted>&x=1',
    );
  });

  it('masks the at path prefix, versioned or not', () => {
    expect(redactRelayText(`GET /v2/at/${CODE}/target.js`)).toBe('GET /v2/at/<redacted>/target.js');
    expect(redactRelayText(`GET /at/${CODE}/target/abc`)).toBe('GET /at/<redacted>/target/abc');
  });

  it('masks the relay param, plain or percent-encoded', () => {
    expect(redactRelayText('app?debug=1&relay=wss%3A%2F%2Fa.trycloudflare.com&x=1')).toBe(
      'app?debug=1&relay=<redacted>&x=1',
    );
    expect(redactRelayText('app?relay=wss://a.trycloudflare.com&x=1')).toBe(
      'app?relay=<redacted>&x=1',
    );
  });

  it('masks bare tunnel addresses in free text', () => {
    const out = redactRelayText(
      'connect to wss://abc.trycloudflare.com/x failed; fetch https://abc.trycloudflare.com/ok',
    );
    expect(out).not.toContain('abc.trycloudflare.com');
  });

  it('leaves unrelated text alone', () => {
    expect(redactRelayText('https://example.com/format?relayed=1&flat=2')).toBe(
      'https://example.com/format?relayed=1&flat=2',
    );
  });

  it('is applied by the error-message redactor', () => {
    const out = redactErrorMessage(
      `request /v2/at/${CODE}/target.js to wss://abc.trycloudflare.com failed`,
    );
    expect(out).not.toContain(CODE);
    expect(out).not.toContain('abc.trycloudflare.com');
  });
});

describe('sig', () => {
  it('is masked like at', () => {
    const sig = 'S'.repeat(86);
    expect(redactRelayText(`app?debug=1&at=${CODE}&sig=${sig}&x=1`)).toBe(
      'app?debug=1&at=<redacted>&sig=<redacted>&x=1',
    );
  });
});
