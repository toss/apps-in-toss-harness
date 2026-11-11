/**
 * Policy for `run_script` (and, on a real phone, `run_tests`).
 *
 * `AIT_DEBUG_EVALUATE` in the MCP server `env` of `.mcp.json` picks one of:
 *
 * - `confirm`: every expression is confirmed on the phone (default for a real phone).
 *   "1시간 동안 묻지 않기" lets the developer stop the questions for an hour (or until
 *   the phone disconnects), and it means the agent may run any code, payments included.
 * - `confirm-on-sensitive`: weaker opt-in. The developer confirms only when the expression
 *   mentions something that reaches the SDK, the network or storage. The list is string
 *   matching and an expression can build the names from pieces
 *   (`window['__s'+'dk']`), so it is not a boundary.
 * - `free`: no confirmation (default for the local browser).
 * - `off`: `run_script` and `run_tests` are refused.
 *
 * Only the developer can change the policy; an agent has no tool for it.
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
  return kind === 'relay' ? 'confirm' : 'free';
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
