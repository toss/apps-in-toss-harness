/**
 * Relay key lifetime constants, kept apart from the key store so light modules
 * (timeline, bundle check) can name the default without loading the store.
 */

export const DEFAULT_KEY_TTL_HOURS = 24;
export const MAX_KEY_TTL_HOURS = 72;
