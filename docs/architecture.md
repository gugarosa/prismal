# Architecture

Status: Living

Use this reference when changing bundling, frame lifecycles or persisted review contracts.

## Build

[The CLI](../bin/prismal.js) delegates to the functions behind [the package API](../lib/index.js).
[`loadManifest()`](../lib/manifest.js) validates against the rules in the [manifest schema](../schema/prismal.schema.json)
and adds device/current-option defaults. [Conventions](../CONVENTIONS.md) own the dependency rules.

[`build()`](../lib/build.js) resolves local files relative to the manifest, expands `{option}`, deduplicates contents
and injects the client before app scripts. Hashes select routes without duplicating files.
URL sources are resolved by the shell, not rewritten or proxied.

`SHELL_ASSETS` in `lib/build.js` assembles [the HTML template](../shell/lab.html), inline CSS, JSON data and one IIFE.
The JavaScript order is `icons.js`, `state.js`, `frames.js`, `inspect.js`, `pages.js`, `main.js` under `shell/`.
These fragments share lexical scope. [The JS project configuration](../jsconfig.json) checks their bindings and
data shapes without compiling the runtime. ESLint checks local bindings and syntax. Review `const`/`let` across
all fragments.

JSON escapes `<` and line separators. Local HTML is assigned through `iframe.srcdoc`, not an HTML attribute.
Directory watchers stay active across rebuilds; the CLI reconciles dependencies before reporting completion.
Watch writes the artifact but does not reload an open browser.

## Shell ownership

[`state.js`](../shell/state.js) reads the builder's `BuildData` contract and owns persisted choices.
Its named mutation functions do not render. `save()` writes autosave and reports storage errors;
[`main.js`](../shell/main.js) sequences mutations, saving and the appropriate page, rail or panel update.

[`inspect.js`](../shell/inspect.js) owns the selected element, inventory, route and device controls.
It interprets validated frame events and delegates persisted feedback to shell state.
[`pages.js`](../shell/pages.js) owns page markup and the iframe-preserving DOM patcher;
[`frames.js`](../shell/frames.js) owns preview plans, frame records and their lifecycle.
These are responsibilities within the existing scope, not independently loaded modules.

## Client and messages

[`client/prismal.js`](../client/prismal.js) installs `window.prismal` once. JSON in the iframe's `name` carries
choices and state before app scripts run. Name values override debug query parameters; unset choices resolve to `now`.
`frameChoices()` in [shell state](../shell/state.js) combines defaults, current picks and the option under review.

File routes become `location.hash`; an injected `about:srcdoc` base keeps hash links inside the source page.
Local frames allow scripts/forms with opaque sandbox origins. Live frames retain the app's origin.
Messages carry `prismal: 1`; the shell checks the owned window and expected origin, and the client checks its parent.
The client never reads the parent DOM. Only trusted development sources belong in a lab.

[The protocol declarations](../client/protocol.d.ts) describe frame names, client events and shell commands.
JSDoc references them from the producer and consumer; they add no executable code or runtime imports.
`readClientEvent()` in `shell/frames.js` narrows incoming payloads before lifecycle and Inspector handlers use them.
The shell and checker retain separate orchestration, with shared behavioral cases covering frame setup.

## Frames

[Frame management](../shell/frames.js) sets names before navigation and lazy-loads previews, at most two at a time.
A replacement retains the old frame until ready or the three-second visual fallback.
Eight seconds without readiness produces a recovery card.

Disposal clears timers, removes message ownership and releases a load permit once. Stale generations cannot replace
newer frames. `aria-busy` represents the pending generation, not the retained old frame.

The [page patcher](../shell/pages.js) preserves attached iframe nodes; detaching one resets its browsing context.
The client measures after layout, load and fonts, suppresses size changes below two pixels and caps height at 30,000.
Laptop views scale to their column; full phone views scroll within the device viewport. Focus crops use target rectangles.
In `client/prismal.js`, `refresh()` resolves highlights, measures size and focus, then paints overlays independently.
Hover and selection outlines repaint even when there is no focus selector or the document size has not changed.

## Choices

[Shell state](../shell/state.js) owns autosave, import and export. Storage is keyed by title and round.
`validateChoices()` checks the incoming shape; `reconcileChoices()` resolves matching records against the manifest.
`importChoices()` replaces state only after both succeed; title/round mismatches warn.
Export follows the [choices schema](../schema/choices.schema.json) and adds a timestamp.

Null means undecided; `now` means keep current. Element feedback uses name, route and instance index;
journey feedback uses journey and one-based step. Notes, words and answers share the same export.

## Inspect limitations

- [`inspectMessage()`](../shell/inspect.js) receives frame routes but does not synchronize the route picker after
  in-frame navigation. Select the intended route explicitly; feedback records carry the actual frame route.
- Previous/Next cycles instances of the selected name, not the catalog. Inventory entries have no review-completion
  markers, and visibility is document-wide rather than scoped to an active drawer.

## Verification

[`check()`](../lib/check.js) builds first, then opens a file-based harness using the same frame names, sources,
sandbox and dimensions. It visits decision/option/views, configured inspect routes and journey steps, followed by
the generated lab's navigation routes.

Screenshot comparison checks byte equality with Now, not visual similarity. Stable data and manual interaction
checks remain necessary. Element absence warnings run only when explicit inspect routes are configured.

Resolution tries host-project Playwright, package Playwright, then `playwright-core` with installed Chrome.
These optional tools are loaded only by check. [Node tests](../test/) cover contracts and packaging;
[browser tests](../test/e2e/) cover interactions and broken sources. [CI](../.github/workflows/ci.yml)
uses the same verification commands as local development.

[Frame contract cases](../test/e2e/contract.test.js) exercise both the shell and checker with bundled files,
relative and absolute live URLs, state, choice precedence, device dimensions and frame isolation.
[Choice operations](../test/choices.test.js) exercise the state owner without a renderer; actual exported payloads
are checked against the choices schema rather than relying only on a hand-written example.
