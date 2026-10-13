/**
 * Marks a timer as non-blocking for process exit and returns it.
 *
 * The evaluate / preflight timeouts are raced against a CDP call and never
 * cleared when the call wins. A ref'd 30s timer then outlives the run, so the
 * consumer's `vitest run` sat for its 10s close timeout ("something prevents
 * Vite servers from exiting"). While the relay socket is open the event loop is
 * alive anyway, so an unref'd timer still fires on time during a run.
 */
export function unrefTimer<T>(timer: T): T {
  (timer as { unref?: () => void } | undefined)?.unref?.();
  return timer;
}
