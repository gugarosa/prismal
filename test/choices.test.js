// @ts-check
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { normalizeManifest } from "../lib/manifest.js";
import { choicesSchema, valid } from "./schema.js";

const source = await readFile(new URL("../shell/state.js", import.meta.url), "utf8");
const manifest = normalizeManifest({
  title: "Review",
  round: 1,
  defaults: { settled: "approved", navigation: "quiet" },
  decisions: [
    {
      id: "navigation",
      title: "Navigation",
      question: "Which version?",
      views: [{ caption: "Home", file: "home.html" }],
      options: [{ id: "quiet", name: "Quiet" }],
    },
  ],
  questions: [{ id: "density", question: "Which density?", choices: ["Compact", "Roomy"] }],
  words: [{ id: "saved", term: "Saved", means: "Stored items", alternatives: ["Pinned"] }],
  journeys: [
    { id: "capture", title: "Capture", steps: [{ title: "Start", file: "home.html", selector: "button" }] },
  ],
});

function state(unavailable = false) {
  const stored = new Map();
  const toast = { textContent: "", hidden: true, classList: { toggle() {} } };
  const api = runInNewContext(
    `${source}
    ({
      exportChoices, save, importChoices, resetChoices, frameChoices,
      togglePick, toggleLike, toggleAnswer, toggleWord, setWordChoice,
      toggleElementVerdict, setElementNote, toggleJourneyVerdict, setReviewNote
    })`,
    {
      document: {
        getElementById(id) {
          if (id === "prismal-data")
            return { textContent: JSON.stringify({ manifest, files: [], fileIds: {} }) };
          return id === "toast" ? toast : {};
        },
      },
      localStorage: {
        setItem(key, value) {
          if (unavailable) throw new Error("Storage unavailable");
          stored.set(key, value);
        },
      },
      setTimeout: () => 1,
      clearTimeout() {},
    },
  );
  return { api, stored, toast, read: () => JSON.parse(JSON.stringify(api.exportChoices())) };
}

test("choice operations preserve undecided, Now, likes and frame precedence", () => {
  const { api, read } = state();
  assert.equal(read().decisions[0].pick, null);
  assert.equal(api.frameChoices("", "now").navigation, "quiet");
  api.togglePick("navigation", "now");
  assert.equal(read().decisions[0].pick, "now");
  assert.equal(read().decisions[0].pickName, "Current");
  api.toggleLike("navigation", "quiet");
  assert.deepEqual(read().decisions[0].liked, ["quiet"]);
  assert.equal(api.frameChoices("", "now").navigation, "now");
  assert.equal(api.frameChoices("navigation", "quiet").navigation, "quiet");
  assert.equal(api.frameChoices("navigation", "quiet").settled, "approved");
  api.togglePick("navigation", "now");
  api.toggleLike("navigation", "quiet");
  assert.equal(read().decisions[0].pick, null);
  assert.equal(read().decisions[0].pickName, null);
  assert.deepEqual(read().decisions[0].liked, []);
});

test("all review operations produce schema-valid choices without invoking a renderer", () => {
  const { api, read, stored } = state();
  api.togglePick("navigation", "quiet");
  api.toggleAnswer("density", "Roomy");
  api.toggleWord("saved", "keep");
  api.setWordChoice("saved", "Archive");
  api.setReviewNote("notes", "", "Keep this direction.");
  api.setReviewNote("decisions", "navigation", "More room.");
  api.setReviewNote("questions", "density", "Keep the spacing.");
  api.setReviewNote("words", "saved", "Use a verb.");
  const selection = { name: "Action", route: "#/home", index: 0, text: "Create" };
  api.toggleElementVerdict(selection, "change");
  api.setElementNote({ ...selection, text: "Create item" }, "Clarify this action.");
  api.toggleElementVerdict({ ...selection, index: 1 }, "clear");
  api.toggleElementVerdict({ ...selection, route: "#/other" }, "unclear");
  api.toggleJourneyVerdict("capture", 1, "obvious");
  api.setReviewNote("journeys", "capture", "Easy to find.", 1);
  const exported = read();
  assert.equal(valid(choicesSchema, exported), true);
  assert.equal(exported.elements.length, 3);
  assert.equal(exported.elements[0].text, "Create item");
  assert.equal(exported.elements[0].note, "Clarify this action.");
  assert.equal(exported.journeys[0].note, "Easy to find.");
  api.save();
  assert.equal(valid(choicesSchema, JSON.parse(stored.get("prismal:Review:r1"))), true);
  api.resetChoices();
  assert.equal(read().notes, "");
  assert.equal(read().elements.length, 0);
  assert.equal(read().journeys[0].verdict, null);
});

test("import validates and reconciles before replacing any current choices", () => {
  const { api, read } = state();
  api.togglePick("navigation", "quiet");
  const before = read();
  const cases = [
    ["invalid header", (value) => (value.round = 0), /Not a Prismal choices file/],
    ["invalid section", (value) => (value.words = null), /Choices words must be a list/],
    ["unknown pick", (value) => (value.decisions[0].pick = "missing"), /Unknown pick/],
    ["unknown like", (value) => value.decisions[0].liked.push("missing"), /Unknown liked option/],
    ["unknown answer", (value) => (value.questions[0].answer = "missing"), /Unknown answer/],
    [
      "duplicate decision",
      (value) => value.decisions.push({ ...value.decisions[0] }),
      /Duplicate decisions choices/,
    ],
    [
      "duplicate element identity",
      (value) => {
        const element = { name: "Action", route: "#/home", text: "", note: "", verdict: null };
        value.elements = [element, { ...element, index: 0 }];
      },
      /Duplicate elements choices/,
    ],
    ["invalid verdict", (value) => (value.journeys[0].verdict = "maybe"), /Invalid journeys choices/],
  ];
  for (const [name, change, error] of cases) {
    const incoming = structuredClone(before);
    change(incoming);
    assert.throws(() => api.importChoices(incoming), error, name);
    const after = read();
    assert.deepEqual({ ...after, exported: before.exported }, before, name);
  }
});

test("import reconciles matching records and keeps canonical manifest metadata", () => {
  const { api, read } = state();
  const incoming = read();
  incoming.title = "Earlier review";
  incoming.round = 3;
  incoming.decisions[0] = {
    ...incoming.decisions[0],
    title: "Old title",
    pick: "quiet",
    pickName: "Old name",
    liked: ["quiet", "quiet"],
  };
  incoming.decisions.push({
    id: "removed",
    title: "Removed",
    pick: "old",
    pickName: "Old",
    liked: [],
    note: "",
  });
  incoming.elements = [{ name: "Action", route: "#/home", text: "Create", verdict: "clear", note: "" }];
  const imported = api.importChoices(incoming);
  assert.equal(imported.title, "Earlier review");
  assert.equal(imported.round, 3);
  const result = read();
  assert.equal(result.title, "Review");
  assert.equal(result.round, 1);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].title, "Navigation");
  assert.equal(result.decisions[0].pickName, "Quiet");
  assert.deepEqual(result.decisions[0].liked, ["quiet"]);
  assert.equal(result.elements[0].index, 0);
  assert.equal(valid(choicesSchema, result), true);
});

test("unavailable storage reports the recovery path without discarding choices", () => {
  const { api, read, toast, stored } = state(true);
  api.togglePick("navigation", "quiet");
  api.save();
  assert.equal(read().decisions[0].pick, "quiet");
  assert.equal(stored.size, 0);
  assert.equal(toast.hidden, false);
  assert.match(toast.textContent, /Export to keep your choices/);
});
