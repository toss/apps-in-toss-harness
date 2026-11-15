/**
 * Relay key lifetime constants, kept apart from the key store so light modules
 * (timeline, bundle check) can name the default without loading the store.
 *
 * A key lives 4 weeks (the env override can only shorten it). One week before
 * the signing key expires the store makes the next key, so a bundle built after
 * that pins both and keeps attaching; a bundle built before it attaches until
 * the signing key expires, which is at least that one week away.
 */

/** Default and maximum key lifetime: 4 weeks. */
export const DEFAULT_KEY_TTL_HOURS = 28 * 24;
export const MAX_KEY_TTL_HOURS = 28 * 24;

/** The next key is made when the signing key has this much life left or less. */
export const KEY_PRE_ROTATION_HOURS = 7 * 24;
