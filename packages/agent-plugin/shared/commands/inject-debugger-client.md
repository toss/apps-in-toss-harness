---
description: 'Install @apps-in-toss/debugger-client into an existing project as a dependency — setup only, not a diagnosis (use /ait:debug to debug a running app).'
argument-hint: ''
---

Load the `inject` skill — the user invoked the **debugger-client facet** (`/ait:inject-debugger-client`): they want to install `@apps-in-toss/debugger-client` (on-device attach, the only debug package that could end up in a release bundle) as a `devDependencies` entry and wire up the build-time `__DEBUG_BUILD__` gate (entry import plus bundler `define`, true only for `AIT_DEBUG_BUILD=1` builds). Jump to the "debugger-client facet — `/ait:inject-debugger-client`" section, not the devtools facet. Takes no argument.
