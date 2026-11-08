import { describe, expect, it } from 'vitest';
import {
  decodeBase64Url,
  encodeBase64Url,
  formatRelayCertParam,
  formatRelaySignature,
  isRelayHostName,
  isRelayPublicKey,
  isRelaySignature,
  parseRelayCertDocument,
  parseRelayCertParam,
  parseRelayHostSignature,
  parseRelaySignature,
  RELAY_CERT_COMPACT_BYTES,
  RELAY_CERT_DOCUMENT_MAX_BYTES,
  RELAY_CERT_DOCUMENT_MAX_CERTS,
  RELAY_CERT_DOCUMENT_VERSION,
  RELAY_CERT_DOMAIN,
  RELAY_CERT_MAX_LIFETIME_SECONDS,
  RELAY_CERT_PARAM,
  RELAY_CERT_PATH,
  RELAY_LINK_DOMAIN,
  RELAY_SIGNATURE_BYTES,
  RELAY_SIGNATURE_PARAM,
  relayCertMessage,
  relayHostMessage,
  relayLinkMessage,
  relayOriginOf,
  relaySessionKeyId,
  sanitizeRelayHostName,
} from '../relay-signature.js';

/** A canonical 87-char key starting with 0x04 ('B' = 000001, so 'BA…' = 0x04 0x00 …). */
const PUB = `BA${'A'.repeat(85)}`;
/** A canonical 86-char signature (all zero bytes). */
const SIG = 'A'.repeat(86);
const NB = 1_800_000_000;
const NA = NB + 1200;

const KID = PUB.slice(1, 9);
const linkSig = (kid = KID, link = SIG) => `${kid}.${link}`;

type CertFields = { pub: unknown; nb: unknown; na: unknown; sig: unknown };
const cert = (over: Partial<CertFields> = {}): Record<string, unknown> => ({
  pub: PUB,
  nb: NB,
  na: NA,
  sig: SIG,
  ...over,
});
const doc = (certs: unknown[] = [cert()], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, certs, ...extra });

describe('relay signature wire format', () => {
  it('pins the parameter name, domains and message layouts', () => {
    expect(RELAY_SIGNATURE_PARAM).toBe('sig');
    expect(RELAY_LINK_DOMAIN).toBe('ait-relay-sig-v2');
    expect(RELAY_CERT_DOMAIN).toBe('ait-relay-cert-v1');
    expect(RELAY_CERT_MAX_LIFETIME_SECONDS).toBe(3600);
    expect(RELAY_CERT_PATH).toBe('/relay-cert');
    expect(RELAY_CERT_DOCUMENT_VERSION).toBe(1);
    expect(RELAY_CERT_DOCUMENT_MAX_BYTES).toBe(4096);
    expect(RELAY_CERT_DOCUMENT_MAX_CERTS).toBe(4);
    expect(relayLinkMessage('wss://abc.trycloudflare.com', 'a'.repeat(32))).toBe(
      `ait-relay-sig-v2\nwss://abc.trycloudflare.com\n${'a'.repeat(32)}`,
    );
    expect(relayCertMessage(PUB, NB, NA)).toBe(`ait-relay-cert-v1\n${PUB}\n${NB}\n${NA}`);
  });

  it('normalises a relay URL to its origin', () => {
    expect(relayOriginOf('wss://Abc.trycloudflare.com/')).toBe('wss://abc.trycloudflare.com');
    expect(relayOriginOf('wss://abc.trycloudflare.com/x?y=1#z')).toBe(
      'wss://abc.trycloudflare.com',
    );
    expect(relayOriginOf('wss://127.0.0.1:9100')).toBe('wss://127.0.0.1:9100');
    expect(relayOriginOf('wss://abc.trycloudflare.com:443')).toBe('wss://abc.trycloudflare.com');
    expect(relayOriginOf('wss://[::1]:9100/')).toBe('wss://[::1]:9100');
    expect(relayOriginOf('wss://user@abc.trycloudflare.com')).toBeNull();
    expect(relayOriginOf('wss://')).toBeNull();
    expect(relayOriginOf('https://abc.trycloudflare.com')).toBeNull();
    expect(relayOriginOf('not a url')).toBeNull();
  });

  it('checks key shape by length and alphabet', () => {
    expect(isRelayPublicKey('B'.repeat(87))).toBe(true);
    expect(isRelayPublicKey('B'.repeat(86))).toBe(false);
    expect(isRelayPublicKey('B'.repeat(86) + '+')).toBe(false);
  });

  it('decodes canonical unpadded base64url only', () => {
    expect(Array.from(decodeBase64Url('AAEC') ?? [])).toEqual([0, 1, 2]);
    expect(decodeBase64Url('A')).toBeNull();
    expect(decodeBase64Url('A+B/')).toBeNull();
    expect(decodeBase64Url('A'.repeat(86))?.length).toBe(RELAY_SIGNATURE_BYTES);
    // 'AB' = 000000 000001: the last 4 bits are not used and must be zero.
    expect(decodeBase64Url('AB')).toBeNull();
    expect(Array.from(decodeBase64Url('AQ') ?? [])).toEqual([1]);
  });
});

describe('parseRelaySignature', () => {
  it('parses `<keyId>.<linkSig>` and round-trips through formatRelaySignature', () => {
    const value = linkSig();
    const parts = parseRelaySignature(value);
    expect(parts).not.toBeNull();
    expect(parts!.keyId).toBe(KID);
    expect(parts!.linkSignatureBytes).toHaveLength(64);
    expect(isRelaySignature(value)).toBe(true);
    expect(formatRelaySignature(PUB, SIG)).toBe(value);
    expect(relaySessionKeyId(PUB)).toBe(KID);
    expect(value).toHaveLength(95);
  });

  const malformed: Array<[string, unknown]> = [
    ['not a string', 42],
    ['null', null],
    ['empty', ''],
    ['v1 single signature', SIG],
    ['retired self-contained certificate', [PUB, NB, NA, SIG, SIG].join('.')],
    ['key id too short', linkSig(KID.slice(1))],
    ['key id too long', linkSig(`${KID}A`)],
    ['key id bad alphabet', linkSig(`${KID.slice(1)}+`)],
    ['no separator', `${KID}${SIG}`],
    ['three fields', `${linkSig()}.${SIG}`],
    ['trailing dot', `${linkSig()}.`],
    ['other separator', linkSig().replace('.', '~')],
    ['link signature too short', linkSig(KID, SIG.slice(1))],
    ['link signature too long', linkSig(KID, `${SIG}A`)],
    ['link signature bad alphabet', linkSig(KID, `${SIG.slice(0, -1)}/`)],
    ['link signature non-canonical tail', linkSig(KID, `${SIG.slice(0, -1)}B`)],
    ['whitespace', ` ${linkSig()}`],
  ];

  it.each(malformed)('rejects %s', (_name, value) => {
    expect(parseRelaySignature(value)).toBeNull();
    expect(isRelaySignature(value)).toBe(false);
  });
});

describe('parseRelayCertDocument', () => {
  it('parses a document with one certificate', () => {
    const certs = parseRelayCertDocument(doc());
    expect(certs).not.toBeNull();
    expect(certs).toHaveLength(1);
    const [one] = certs!;
    expect(one!.sessionPublicKey).toBe(PUB);
    expect(one!.sessionPublicKeyBytes).toHaveLength(65);
    expect(one!.sessionPublicKeyBytes[0]).toBe(0x04);
    expect(one!.keyId).toBe(KID);
    expect(one!.notBefore).toBe(NB);
    expect(one!.notAfter).toBe(NA);
    expect(one!.certSignature).toBe(SIG);
    expect(one!.certSignatureBytes).toHaveLength(64);
  });

  it('accepts up to the maximum number of certificates and the maximum lifetime', () => {
    expect(
      parseRelayCertDocument(
        doc(Array.from({ length: RELAY_CERT_DOCUMENT_MAX_CERTS }, () => cert())),
      ),
    ).toHaveLength(RELAY_CERT_DOCUMENT_MAX_CERTS);
    expect(
      parseRelayCertDocument(doc([cert({ na: NB + RELAY_CERT_MAX_LIFETIME_SECONDS })])),
    ).not.toBeNull();
  });

  const malformed: Array<[string, unknown]> = [
    ['not a string', { v: 1, certs: [cert()] }],
    ['not JSON', '{"v":1,'],
    ['JSON array', '[]'],
    ['JSON null', 'null'],
    ['wrong version', JSON.stringify({ v: 2, certs: [cert()] })],
    ['version as string', JSON.stringify({ v: '1', certs: [cert()] })],
    ['missing certs', JSON.stringify({ v: 1 })],
    ['extra top-level key', doc([cert()], { x: 1 })],
    ['certs not an array', JSON.stringify({ v: 1, certs: cert() })],
    ['empty certs', doc([])],
    [
      'too many certs',
      doc(Array.from({ length: RELAY_CERT_DOCUMENT_MAX_CERTS + 1 }, () => cert())),
    ],
    ['oversize text', doc([cert()]) + ' '.repeat(RELAY_CERT_DOCUMENT_MAX_BYTES)],
    ['cert extra key', doc([{ ...cert(), x: 1 }])],
    ['cert missing key', doc([{ pub: PUB, nb: NB, na: NA }])],
    ['cert not an object', doc(['x'])],
    ['key too short', doc([cert({ pub: PUB.slice(1) })])],
    ['key bad alphabet', doc([cert({ pub: `${PUB.slice(0, -1)}+` })])],
    ['key not uncompressed (0x02 prefix)', doc([cert({ pub: `Ag${'A'.repeat(85)}` })])],
    ['key non-canonical tail', doc([cert({ pub: `${PUB.slice(0, -1)}B` })])],
    ['nb as string', doc([cert({ nb: String(NB) })])],
    ['nb zero', doc([cert({ nb: 0 })])],
    ['nb negative', doc([cert({ nb: -NB })])],
    ['nb fractional', doc([cert({ nb: NB + 0.5 })])],
    ['na equal to nb', doc([cert({ na: NB })])],
    ['na before nb', doc([cert({ na: NB - 1 })])],
    ['lifetime over the cap', doc([cert({ na: NB + RELAY_CERT_MAX_LIFETIME_SECONDS + 1 })])],
    ['cert signature too short', doc([cert({ sig: SIG.slice(1) })])],
    ['cert signature bad alphabet', doc([cert({ sig: `${SIG.slice(0, -1)}=` })])],
    ['cert signature non-canonical tail', doc([cert({ sig: `${SIG.slice(0, -1)}B` })])],
    ['one bad cert among good ones', doc([cert(), cert({ sig: 'x' })])],
  ];

  it.each(malformed)('rejects %s', (_name, value) => {
    expect(parseRelayCertDocument(value)).toBeNull();
  });
});

describe('computer name (ahn / ahs)', () => {
  it('relayHostMessage is domain-separated from the link message', () => {
    expect(relayHostMessage('wss://a.trycloudflare.com', 'ab', 'dev-mac')).toBe(
      'ait-relay-host-v1\nwss://a.trycloudflare.com\nab\ndev-mac',
    );
    expect(relayHostMessage('wss://a.trycloudflare.com', 'ab', 'x')).not.toBe(
      relayLinkMessage('wss://a.trycloudflare.com', 'ab'),
    );
  });

  it.each([
    ['Daves-MacBook-Pro.local', 'Daves-MacBook-Pro'],
    ['  host.LOCAL  ', 'host'],
    ['my laptop', 'my-laptop'],
    ['개발-pc', 'pc'],
    ['..__a.b_c-d__..', 'a.b_c-d'],
    ['a.local.local', 'a'],
    ['x'.repeat(60), 'x'.repeat(40)],
  ])('sanitizes %j to %j', (raw, expected) => {
    expect(sanitizeRelayHostName(raw)).toBe(expected);
  });

  it.each([[''], ['   '], ['.local'], ['한글'], [undefined], [42]])('drops %j', (raw) => {
    expect(sanitizeRelayHostName(raw)).toBeUndefined();
  });

  it('whatever it returns is accepted by isRelayHostName', () => {
    for (const raw of ['a b c', 'z'.repeat(39) + '.local', 'ab_.local']) {
      const name = sanitizeRelayHostName(raw);
      expect(name === undefined || isRelayHostName(name)).toBe(true);
    }
  });

  it('isRelayHostName rejects what a link must not carry', () => {
    for (const bad of [
      '',
      'a b',
      'a/b',
      'x'.repeat(41),
      'host.local',
      'h\u00e9',
      '<img>',
      42,
      null,
    ]) {
      expect(isRelayHostName(bad)).toBe(false);
    }
    expect(isRelayHostName('dev-mac_1.corp')).toBe(true);
  });

  it('parseRelayHostSignature accepts one canonical 64-byte signature only', () => {
    expect(parseRelayHostSignature(SIG)).toHaveLength(RELAY_SIGNATURE_BYTES);
    expect(parseRelayHostSignature(SIG.slice(1))).toBeNull();
    expect(parseRelayHostSignature(`${SIG.slice(0, -1)}B`)).toBeNull();
    expect(parseRelayHostSignature(`${SIG.slice(0, -1)}=`)).toBeNull();
    expect(parseRelayHostSignature(null)).toBeNull();
  });
});

describe('compact certificate (arc)', () => {
  const json = { pub: PUB, nb: NB, na: NA, sig: SIG };

  it('uses the arc parameter and is 135 bytes, 180 characters', () => {
    expect(RELAY_CERT_PARAM).toBe('arc');
    const value = formatRelayCertParam(json);
    expect(value).toHaveLength(180);
    expect(RELAY_CERT_COMPACT_BYTES).toBe(135);
  });

  it('round-trips through parseRelayCertParam', () => {
    const parsed = parseRelayCertParam(formatRelayCertParam(json));
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionPublicKey).toBe(PUB);
    expect(parsed?.notBefore).toBe(NB);
    expect(parsed?.notAfter).toBe(NA);
    expect(parsed?.certSignature).toBe(SIG);
    expect(parsed?.keyId).toBe(KID);
  });

  it('rejects wrong types, lengths, alphabets and non-canonical tails', () => {
    const ok = formatRelayCertParam(json) as string;
    expect(parseRelayCertParam(undefined)).toBeNull();
    expect(parseRelayCertParam(null)).toBeNull();
    expect(parseRelayCertParam('')).toBeNull();
    expect(parseRelayCertParam(ok.slice(1))).toBeNull();
    expect(parseRelayCertParam(`${ok}A`)).toBeNull();
    expect(parseRelayCertParam(`${ok.slice(0, -1)}+`)).toBeNull();
  });

  it('rejects a key that is not an uncompressed point', () => {
    const bytes = decodeBase64Url(formatRelayCertParam(json) as string) as Uint8Array;
    bytes[0] = 0x02;
    expect(parseRelayCertParam(encodeBase64Url(bytes))).toBeNull();
  });

  it('rejects a zero or over-long window', () => {
    const bytes = decodeBase64Url(formatRelayCertParam(json) as string) as Uint8Array;
    const view = new DataView(bytes.buffer);
    view.setUint16(65 + 4, 0);
    expect(parseRelayCertParam(encodeBase64Url(bytes))).toBeNull();
    view.setUint16(65 + 4, RELAY_CERT_MAX_LIFETIME_SECONDS + 1);
    expect(parseRelayCertParam(encodeBase64Url(bytes))).toBeNull();
  });

  it('refuses to format what does not fit', () => {
    expect(
      formatRelayCertParam({ ...json, na: NB + RELAY_CERT_MAX_LIFETIME_SECONDS + 1 }),
    ).toBeNull();
    expect(formatRelayCertParam({ ...json, nb: 0xffffffff + 1, na: 0xffffffff + 2 })).toBeNull();
    expect(formatRelayCertParam({ ...json, pub: 'x' })).toBeNull();
  });

  it('encodeBase64Url matches the decoder for every tail length', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 64, 65]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
      expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
    }
  });
});
