/**
 * Which `call_sdk` methods may run without the developer's say-so on a real phone.
 * Three tiers:
 *
 * - **free**: getters that only read device or app state, plus effects that touch no
 *   user data, money, network, storage or permission (`generateHapticFeedback`). The
 *   lists come from the exports of `@apps-in-toss/web-framework` 3.8.0 (the version
 *   create-ait-app pins) and the official docs, and are deliberately short. Anything that
 *   returns an identifier of the user or the device, a link carrying a session, or that
 *   can change state is not on them.
 * - **confirm**: everything else, including names this list has never seen (share,
 *   permission requests, opening a URL or scheme, storage writes, clipboard, location,
 *   contacts, camera, login ...). The developer taps 허용 on the phone (phone-confirm.ts);
 *   "1시간 동안 묻지 않기" skips the dialog for an hour (or until the phone disconnects).
 * - **confirm-always**: payments and anything that spends or grants money or points
 *   (`checkoutPayment`, `requestTossPayPaysBilling`, the IAP order functions,
 *   `grantPromotionReward*`, `contactsViral` rewards). Asks on every call. "1시간 동안
 *   묻지 않기" never covers it.
 * - **deny**: a name that is not a plain identifier or a one-level `Namespace.method` pair
 *   of plain identifiers, or in which a segment is a key every object has (`constructor`,
 *   `__proto__` ...).
 *
 * Names are classified as written, the dotted form included. `IAP.getPendingOrders`,
 * `TossPay.authorize`, `Promotion.*` and `Viral.*` are confirm-always, and so is any name in
 * which one segment looks like a payment.
 *
 * The developer can widen the free tier with `AIT_DEBUG_SDK_ALLOW` (comma-separated
 * method names) in the MCP server `env` of `.mcp.json`. A payment name on that list is
 * ignored with a warning on stderr. An agent has no way to change the list.
 *
 * SECRET-HANDLING: names only.
 */

/** Read-only getters of `@apps-in-toss/web-framework` 3.8.0 that need no confirmation. */
export const READ_ONLY_SDK_GETTERS: ReadonlySet<string> = new Set([
  'getAppsInTossGlobals',
  'getLocale',
  'getNetworkStatus',
  'getOperationalEnvironment',
  'getPermission',
  'getPlatformOS',
  'getSafeAreaInsets',
  'getServerTime',
  'getTossAppVersion',
  'isMinVersionSupported',
  'SafeAreaInsets.get',
]);

/**
 * Effects that touch no user data, money, network, storage or permission. Haptics only:
 * `generateHapticFeedback` (docs: Device.triggerHaptic). Anything unsure stays out.
 */
export const HARMLESS_SDK_EFFECTS: ReadonlySet<string> = new Set(['generateHapticFeedback']);

/**
 * Payment and reward names of `@apps-in-toss/web-framework` (docs: TossPay.authorize,
 * TossPay.authorizeSubscription, IAP.*, Promotion.grantReward, Viral/contactsViral).
 * `call_sdk` reaches the flat exports and one-level namespaced calls (`IAP.getPendingOrders`);
 * the namespace objects (`IAP`, `TossPay`, `Promotion`, `Viral`) are listed in
 * {@link PAYMENT_SDK_NAMESPACES} and every segment is checked against {@link PAYMENT_NAME_PATTERN}.
 */
export const PAYMENT_SDK_NAMES: ReadonlySet<string> = new Set([
  'checkoutPayment',
  'requestTossPayPaysBilling',
  'createOneTimePurchaseOrder',
  'createSubscriptionPurchaseOrder',
  'completeProductGrant',
  'getPendingOrders',
  'getCompletedOrRefundedOrders',
  'getSubscriptionInfo',
  'grantPromotionReward',
  'grantPromotionRewardForGame',
  'contactsViral',
]);

/** Namespace objects whose every method is confirm-always. */
export const PAYMENT_SDK_NAMESPACES: ReadonlySet<string> = new Set([
  'IAP',
  'TossPay',
  'Promotion',
  'Viral',
]);

/** Catches payment-like names the set above has not seen (older or newer SDK versions). */
const PAYMENT_NAME_PATTERN =
  /purchase|payment|checkout|billing|subscription|order|reward|promotion|productgrant|tosspay|^iap|^viral|contactsviral/i;

/** True when the whole name, or any dot-separated segment of it, is a payment name. */
export function isPaymentSdkName(name: string): boolean {
  return name
    .split('.')
    .some(
      (segment) =>
        PAYMENT_SDK_NAMES.has(segment) ||
        PAYMENT_SDK_NAMESPACES.has(segment) ||
        PAYMENT_NAME_PATTERN.test(segment),
    );
}

/** A flat export (`getLocale`) or one-level namespaced call (`IAP.getPendingOrders`). */
const SDK_CALL_NAME = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)?$/;

/** True for a well-formed call name none of whose segments is a key every object has. */
function isValidSdkCallName(name: string): boolean {
  return (
    SDK_CALL_NAME.test(name) && !name.split('.').some((segment) => segment in Object.prototype)
  );
}

export type SdkTier = 'free' | 'confirm' | 'confirm-always';

export type SdkDecision =
  | { decision: 'allow'; via: 'read-only' | 'harmless' | 'allowlist' | 'local' }
  | { decision: 'confirm'; tier: 'confirm' | 'confirm-always' }
  | { decision: 'deny'; reason: string };

const warnedPaymentAllow = new Set<string>();

/**
 * Reads `AIT_DEBUG_SDK_ALLOW` into a set of method names (flat or `Namespace.method`) (anything else is dropped).
 * Payment names are dropped too, with one stderr warning per name.
 */
export function parseSdkAllowlist(raw: string | undefined): ReadonlySet<string> {
  const names = new Set<string>();
  if (raw === undefined) return names;
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (!isValidSdkCallName(name)) continue;
    if (isPaymentSdkName(name)) {
      if (!warnedPaymentAllow.has(name)) {
        warnedPaymentAllow.add(name);
        process.stderr.write(
          `[ait-debugger] AIT_DEBUG_SDK_ALLOW: ${name}은(는) 결제 관련 이름이라 무시합니다. 결제는 항상 폰에서 확인합니다.\n`,
        );
      }
      continue;
    }
    names.add(name);
  }
  return names;
}

export function classifySdkCall(
  name: string,
  allowlist: ReadonlySet<string> = new Set(),
): SdkDecision {
  if (!isValidSdkCallName(name)) {
    return { decision: 'deny', reason: 'invalid-name' };
  }
  // Payments first: nothing, not even a hand-built allow set, moves them to free.
  if (isPaymentSdkName(name)) return { decision: 'confirm', tier: 'confirm-always' };
  if (READ_ONLY_SDK_GETTERS.has(name)) return { decision: 'allow', via: 'read-only' };
  if (HARMLESS_SDK_EFFECTS.has(name)) return { decision: 'allow', via: 'harmless' };
  if (allowlist.has(name)) return { decision: 'allow', via: 'allowlist' };
  return { decision: 'confirm', tier: 'confirm' };
}
