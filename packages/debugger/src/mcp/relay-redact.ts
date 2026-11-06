/**
 * Masking for the relay address and the relay auth code in text and tool output.
 *
 * The tunnel host and the `at` code together are what lets a device attach, so
 * they stay out of anything that is recorded: status output, logs, error
 * messages, the page list. Only `start_attach` (and the dashboard it opens on
 * loopback) carries the real address, because the phone needs it.
 *
 * SECRET-HANDLING: nothing in here logs; the functions only return masked text.
 */

const MASK = '***';

/**
 * A relay address for display: scheme, a masked first host label, and the rest
 * of the host. The path, query and port are dropped. `wss://abc-def.trycloudflare.com/x?at=1`
 * becomes `wss://***.trycloudflare.com`. Anything that does not parse as a URL
 * becomes a bare mask.
 */
export function maskRelayUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    const labels = url.hostname.split('.');
    const rest = labels.length > 1 ? `.${labels.slice(1).join('.')}` : '';
    return `${url.protocol}//${MASK}${rest}`;
  } catch {
    return MASK;
  }
}

/** Replaces the value of a `name=` query pair, whatever follows up to the next separator. */
const QUERY_PAIR = (name: string): RegExp => new RegExp(`\\b${name}=[^&\\s"'#]+`, 'g');

/**
 * Masks relay addresses and auth codes inside free text (a URL, an error
 * message, a log line): `wss://` and tunnel `https://` addresses, `at=`, `sig=`
 * and `relay=` query values, and the `/at/<code>/` path prefix (versioned or not).
 */
export function redactRelayText(text: string): string {
  return text
    .replace(/(\/(?:v[1-9][0-9]{0,8}\/)?at\/)[^/?\s"']+/g, '$1<redacted>')
    .replace(QUERY_PAIR('at'), 'at=<redacted>')
    .replace(QUERY_PAIR('sig'), 'sig=<redacted>')
    .replace(QUERY_PAIR('relay'), 'relay=<redacted>')
    .replace(QUERY_PAIR('dashtoken'), 'dashtoken=<redacted>')
    .replace(/\bwss?(?::\/\/|%3A%2F%2F)[^\s"'<>)&]+/gi, 'wss://***')
    .replace(
      /\bhttps?(?::\/\/|%3A%2F%2F)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.trycloudflare\.com[^\s"'<>)&]*/gi,
      'https://***',
    );
}
