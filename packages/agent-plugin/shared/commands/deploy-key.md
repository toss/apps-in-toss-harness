---
description: 'Issue a Deploy Key and save it to ~/.ait/credentials so `ait deploy --profile` works (no plaintext echo).'
argument-hint: '[profile-name]'
---

Load the `deploy` skill — the user invoked the **Deploy Key facet** (`/ait:deploy-key`): they want to issue a Deploy Key and save it as a `~/.ait/credentials` profile (the auth prerequisite of deploy). Jump to the "Deploy Key facet — `/ait:deploy-key`" section, not the bundle upload flow. The optional `[profile-name]` argument names the profile. Never re-echo the issued key.
