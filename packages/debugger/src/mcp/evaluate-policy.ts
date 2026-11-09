/**
 * Policy for `evaluate` (and, on a real phone, `run_tests`).
 *
 * `AIT_DEBUG_EVALUATE` in the MCP server `env` of `.mcp.json` picks one of:
 *
 * - `free`: no confirmation.
 * - `confirm-on-sensitive`: the developer confirms on the phone when the expression
 *   mentions something that reaches the SDK, the network or storage (default for a real
 *   phone).
 * - `confirm`: every expression is confirmed.
 * - `off`: `evaluate` and `run_tests` are refused.
 *
 * The local browser defaults to `free`.
 *
 * The sensitive list is a speed bump, not a boundary: an expression can build the names
 * from pieces. It exists so that a casual `fetch(...)` or `__sdk.x()` that a page text
 * talked the agent into stops at the developer once. Only the developer can change the
 * policy; an agent has no tool for it.
 */

export type EvaluatePolicy = 'free' | 'confirm-on-sensitive' | 'confirm' | 'off';

const POLICIES: ReadonlySet<string> = new Set(['free', 'confirm-on-sensitive', 'confirm', 'off']);

/** The policy for `kind`, from the env value (unknown values fall back to the default). */
export function resolveEvaluatePolicy(
  raw: string | undefined,
  kind: 'relay' | 'local',
): EvaluatePolicy {
  const value = raw?.trim().toLowerCase();
  if (value !== undefined && POLICIES.has(value)) return value as EvaluatePolicy;
  return kind === 'relay' ? 'confirm-on-sensitive' : 'free';
}

const SENSITIVE: readonly RegExp[] = [
  /__sdk/,
  /__appsInTossNativeBridge/,
  /ReactNativeWebView/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bsendBeacon\b/,
  /\bWebSocket\b/,
  /\blocalStorage\b/,
  /\bdocument\s*\.\s*cookie\b/,
  /\bimport\s*\(/,
  /\beval\b/,
  /\bFunction\b/,
];

export function isSensitiveExpression(expression: string): boolean {
  return SENSITIVE.some((re) => re.test(expression));
}

export type EvaluateDecision = 'allow' | 'confirm' | 'deny';

export function decideEvaluate(policy: EvaluatePolicy, expression: string): EvaluateDecision {
  switch (policy) {
    case 'free':
      return 'allow';
    case 'off':
      return 'deny';
    case 'confirm':
      return 'confirm';
    case 'confirm-on-sensitive':
      return isSensitiveExpression(expression) ? 'confirm' : 'allow';
  }
}
