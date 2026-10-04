// @ts-check
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadManifest, normalizeManifest } from "../lib/manifest.js";

const repository = fileURLToPath(new URL("..", import.meta.url));

function minimalManifest() {
  return {
    title: "Round one",
    round: 1,
    decisions: [
      {
        id: "navigation",
        title: "Navigation",
        question: "Which navigation works best?",
        views: [{ caption: "Home", file: "home.html" }],
        options: [{ id: "quiet", name: "Quiet" }],
      },
    ],
  };
}

test("normalizeManifest validates and fills the complete manifest shape", () => {
  const state = { open: true, count: 2, nested: [null, "safe"] };
  const manifest = normalizeManifest({
    $schema: "./schema/prismal.schema.json",
    title: "Lumen review",
    round: 2,
    about: "Fictional notes.",
    base: "https://example.test/app/",
    devices: { tablet: [820, 1180] },
    defaults: { "prior-density": "roomy" },
    decisions: [
      {
        id: "navigation",
        title: "Navigation",
        question: "Which navigation works best?",
        views: [
          {
            caption: "Home",
            file: "screens/{option}.html#inbox",
            focus: 'main > [data-pane="notes"]:not(.hidden)',
            state,
          },
          { caption: "Search", url: "search?mode=review", device: "tablet" },
        ],
        options: [
          { id: "quiet", name: "Quiet" },
          { id: "compact", name: "Compact", kind: "close", why: "More space" },
        ],
      },
    ],
    inspect: [{ label: "Inbox", file: "screens/now.html#inbox", state: { tab: "all" } }],
    questions: [
      {
        id: "density",
        group: "Layout",
        question: "How dense?",
        why: "Sets the rhythm.",
        choices: ["Calm", "Compact"],
      },
    ],
    words: [
      {
        id: "saved",
        group: "Labels",
        term: "Saved",
        means: "Kept for later",
        where: ["Inbox"],
        alternatives: ["Pinned"],
      },
    ],
    elements: [
      {
        name: "Primary note",
        group: "Content",
        selector: 'main > article[data-note="first"]:has(h2)',
        what: "Main note card",
      },
    ],
    journeys: [
      {
        id: "capture-note",
        title: "Capture a note",
        steps: [
          {
            url: "/capture",
            selector: 'button[aria-label="New note"]',
            title: "Start",
            does: "Opens the composer.",
            ask: "Is the action obvious?",
            state: { ready: true },
          },
        ],
      },
    ],
  });

  assert.deepEqual(manifest.devices, {
    laptop: [1440, 900],
    phone: [390, 844],
    tablet: [820, 1180],
  });
  assert.deepEqual(manifest.defaults, { "prior-density": "roomy" });
  assert.deepEqual(manifest.decisions[0].options[0], {
    id: "now",
    name: "Current",
    kind: "current",
  });
  assert.equal(manifest.decisions[0].options[1].kind, "close");
  assert.equal(manifest.decisions[0].views[0].device, "laptop");
  assert.equal(manifest.inspect[0].device, "laptop");
  assert.equal(manifest.journeys[0].steps[0].device, "laptop");
  assert.deepEqual(manifest.decisions[0].views[0].state, state);
  assert.notEqual(manifest.decisions[0].views[0].state, state);
});

test("normalizeManifest permits an empty review-only round", () => {
  assert.deepEqual(normalizeManifest({ title: "Review", round: 1, decisions: [] }), {
    title: "Review",
    round: 1,
    devices: { laptop: [1440, 900], phone: [390, 844] },
    defaults: {},
    decisions: [],
    questions: [],
    words: [],
    elements: [],
    inspect: [],
    journeys: [],
  });
});

test("normalizeManifest reports exact paths for invalid input", () => {
  /** @type {[string, (raw: ReturnType<typeof minimalManifest>) => void, string][]} */
  const cases = [
    ["root key", (raw) => Object.assign(raw, { extra: true }), 'manifest: unknown key "extra"'],
    [
      "missing source",
      (raw) =>
        raw.decisions.push({
          ...structuredClone(raw.decisions[0]),
          id: "second",
          views: [{ caption: "Broken" }],
        }),
      'decisions[1].views[0]: needs "url" or "file"',
    ],
    [
      "two sources",
      (raw) => Object.assign(raw.decisions[0].views[0], { url: "https://example.test" }),
      'decisions[0].views[0]: cannot have both "url" and "file"',
    ],
    [
      "relative URL",
      (raw) => (raw.decisions[0].views = [{ caption: "Home", url: "/home" }]),
      'decisions[0].views[0].url: relative URL needs "base"',
    ],
    [
      "non-http URL",
      (raw) => (raw.decisions[0].views = [{ caption: "Home", url: "file:///home.html" }]),
      "decisions[0].views[0].url: expected absolute http(s) URL",
    ],
    [
      "duplicate decision",
      (raw) => raw.decisions.push(structuredClone(raw.decisions[0])),
      'decisions[1].id: duplicate id "navigation"',
    ],
    [
      "reserved kind",
      (raw) => Object.assign(raw.decisions[0].options[0], { kind: "current" }),
      'decisions[0].options[0].kind: kind "current" is reserved for "now"',
    ],
    [
      "bad now kind",
      (raw) => raw.decisions[0].options.push({ id: "now", name: "Current", kind: "close" }),
      'decisions[0].options[1].kind: "now" must use kind "current"',
    ],
    [
      "no proposal",
      (raw) => (raw.decisions[0].options = [{ id: "now", name: "Current" }]),
      "decisions[0].options: needs 1 to 6 non-now options",
    ],
    [
      "unknown device",
      (raw) => Object.assign(raw.decisions[0].views[0], { device: "watch" }),
      'decisions[0].views[0].device: unknown device "watch"',
    ],
    [
      "non-object state",
      (raw) => Object.assign(raw.decisions[0].views[0], { state: [] }),
      "decisions[0].views[0].state: expected object",
    ],
    [
      "non-JSON state",
      (raw) => Object.assign(raw.decisions[0].views[0], { state: { callback: () => {} } }),
      "decisions[0].views[0].state.callback: expected JSON value",
    ],
    [
      "unknown inspect label",
      (raw) =>
        Object.assign(raw, {
          words: [{ id: "saved", term: "Saved", means: "Kept", where: ["Missing"] }],
        }),
      'words[0].where[0]: unknown inspect label "Missing"',
    ],
    ["null optional array", (raw) => Object.assign(raw, { questions: null }), "questions: expected array"],
    [
      "route without file",
      (raw) => (raw.decisions[0].views[0].file = "#only-a-route"),
      'decisions[0].views[0].file: path before "#" must not be empty',
    ],
  ];

  for (const [name, change, message] of cases) {
    const raw = minimalManifest();
    change(raw);
    assert.throws(() => normalizeManifest(raw), { message }, name);
  }
});

test("loadManifest reads explicit paths and distinguishes lookup failures", async (t) => {
  const root = await mkdtemp(join(repository, ".prismal-manifest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const explicit = join(root, "explicit.json");
  await writeFile(explicit, JSON.stringify(minimalManifest()));
  const loaded = await loadManifest(explicit);
  assert.equal(loaded.path, explicit);
  assert.equal(loaded.manifest.title, "Round one");

  await writeFile(explicit, "{");
  await assert.rejects(loadManifest(explicit), (error) =>
    error.message.startsWith(`Invalid JSON in manifest ${explicit}:`),
  );
  await writeFile(explicit, JSON.stringify({ title: "", round: 1, decisions: [] }));
  await assert.rejects(loadManifest(explicit), (error) =>
    error.message.startsWith(`Invalid manifest ${explicit}: title:`),
  );

  const nested = join(root, "prismal");
  await mkdir(nested);
  await writeFile(join(root, "prismal.json"), JSON.stringify({ title: "Root", round: 1, decisions: [] }));
  await writeFile(join(nested, "prismal.json"), JSON.stringify({ title: "Nested", round: 1, decisions: [] }));
  const previous = process.cwd();
  try {
    process.chdir(root);
    assert.equal((await loadManifest()).manifest.title, "Nested");
    await writeFile(join(nested, "prismal.json"), "{");
    await assert.rejects(loadManifest(), /^Error: Invalid JSON in manifest /);
    await unlink(join(nested, "prismal.json"));
    assert.equal((await loadManifest()).manifest.title, "Root");
    await unlink(join(root, "prismal.json"));
    await assert.rejects(loadManifest(), /^Error: Manifest not found\. Looked for /);
  } finally {
    process.chdir(previous);
  }
});
