# Security policy

[한국어](SECURITY.md)

If you find a security problem in this repo, report it privately through GitHub's private vulnerability reporting. Please do not open a public issue or pull request for it.

## How to report

1. Open a private report from this repo's [Security tab > Report a vulnerability](https://github.com/toss/apps-in-toss-harness/security/advisories/new).
2. Include the items listed under "What to include" below.

Reports are visible to repo administrators only. If the private reporting option is not available to you, open an issue that says only that you have a security question, with no details, and an administrator will tell you how to continue in private.

## Scope

The packages this repo owns:

- `packages/agent-plugin`
- `packages/debugger`
- `packages/debug-console`
- `shared/internal-protocol`

Out of scope: third-party dependencies, packages this repo does not publish (for example `@apps-in-toss/web-framework`), and the Apps in Toss console and servers. Please report those to the owning project.

## No secret goes into a bundle

A debug bundle carries relay public keys only. The relay signing key derives from the same secret as the connection codes, so a secret inside a bundle would let anyone who unpacks it sign their own tunnel. `debug-console` therefore has no device-side code-verification hook and no build define for injecting a secret; only the relay verifies a code value. `check:gate-dist` fails if the shipped artifact carries a name that would bring either back. If you find a secret in a bundle, please report it as described above.

## Known limitations

- `esbuild` and its platform binary are installed from the npm registry at install time and are not hash-pinned the way cloudflared is.
- The device trusts the relay public keys baked into the bundle, and there is no device-side expiry. If `.ait_relay` may have leaked, rotate the key with `debugger relay-key --rotate` and rebuild the debug bundles.

## What to include

- The affected package and version (or commit)
- Steps to reproduce, the expected behaviour and the actual behaviour
- Impact: who can do what that they could not before
- A minimal reproduction or configuration, if you can

Do not send real credentials, tokens or personal data. Redact values if needed.

## Notes

- There is no response-time or fix-time commitment.
- There is no bounty program.
- Please do not disclose the details before a fix is released.
