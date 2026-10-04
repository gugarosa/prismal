// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeManifest } from "../lib/manifest.js";
import { choicesSchema, manifestSchema, valid } from "./schema.js";

function manifest() {
  return {
    title: "Review",
    round: 1,
    decisions: [
      {
        id: "navigation",
        title: "Navigation",
        question: "Which version?",
        views: [{ caption: "Home", file: "home.html" }],
        options: [{ id: "quiet", name: "Quiet" }],
      },
    ],
  };
}

test("manifest schema mirrors representative hand-validator constraints", () => {
  const cases = [
    ["minimal", () => {}, true],
    ["review only", (raw) => (raw.decisions = []), true],
    [
      "relative URL with base",
      (raw) => {
        raw.base = "https://example.test/app/";
        raw.decisions[0].views = [{ caption: "Home", url: "../home" }];
      },
      true,
    ],
    ["unknown key", (raw) => (raw.extra = true), false],
    ["missing question", (raw) => delete raw.decisions[0].question, false],
    ["empty views", (raw) => (raw.decisions[0].views = []), false],
    ["missing source", (raw) => (raw.decisions[0].views = [{ caption: "Home" }]), false],
    ["two sources", (raw) => (raw.decisions[0].views[0].url = "https://example.test"), false],
    [
      "relative URL without base",
      (raw) => (raw.decisions[0].views = [{ caption: "Home", url: "/home" }]),
      false,
    ],
    [
      "non-http URL",
      (raw) => (raw.decisions[0].views = [{ caption: "Home", url: "data:text/html,x" }]),
      false,
    ],
    [
      "empty URL",
      (raw) => {
        raw.base = "https://example.test/";
        raw.decisions[0].views = [{ caption: "Home", url: "   " }];
      },
      false,
    ],
    ["reserved current kind", (raw) => (raw.decisions[0].options[0].kind = "current"), false],
    [
      "now with wrong kind",
      (raw) => raw.decisions[0].options.push({ id: "now", name: "Current", kind: "different" }),
      false,
    ],
    ["no proposal", (raw) => (raw.decisions[0].options = [{ id: "now", name: "Current" }]), false],
    ["null section", (raw) => (raw.questions = null), false],
    ["empty file before route", (raw) => (raw.decisions[0].views[0].file = "#route"), false],
  ];

  for (const [name, change, expected] of cases) {
    const raw = manifest();
    change(raw);
    let hand = true;
    try {
      normalizeManifest(raw);
    } catch {
      hand = false;
    }
    assert.equal(hand, expected, `${name}: hand validator`);
    assert.equal(valid(manifestSchema, raw), expected, `${name}: JSON schema`);
  }
});

test("schemas use draft 2020-12 definitions and reject undeclared fields", () => {
  for (const schema of [manifestSchema, choicesSchema]) {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.additionalProperties, false);
    assert.ok(schema.$defs);
  }
  assert.equal(manifestSchema.$defs.decision.additionalProperties, false);
  assert.equal(choicesSchema.$defs.element.additionalProperties, false);
});

test("choices schema mirrors the complete export contract", () => {
  const choices = {
    prismal: 1,
    title: "Review",
    round: 1,
    exported: "2026-10-02T01:38:32.632Z",
    decisions: [
      {
        id: "navigation",
        title: "Navigation",
        pick: "quiet",
        pickName: "Quiet",
        liked: ["quiet"],
        note: "",
      },
    ],
    questions: [{ id: "density", answer: null, note: "" }],
    words: [{ id: "saved", term: "Saved", choice: "Pinned", note: "" }],
    elements: [
      {
        name: "Primary note",
        route: "#inbox",
        verdict: "clear",
        text: "Saved",
        note: "",
        index: 0,
        group: "Content",
        what: "Main note card",
      },
    ],
    journeys: [
      {
        journey: "capture",
        step: 1,
        title: "Start",
        verdict: "obvious",
        note: "",
      },
    ],
    notes: "",
  };
  assert.equal(valid(choicesSchema, choices), true);
  assert.equal(valid(choicesSchema, { ...choices, prismal: 2 }), false);
  assert.equal(valid(choicesSchema, { ...choices, exported: "yesterday" }), false);
  assert.equal(valid(choicesSchema, { ...choices, extra: true }), false);
  assert.equal(
    valid(choicesSchema, {
      ...choices,
      elements: [{ ...choices.elements[0], verdict: "maybe" }],
    }),
    false,
  );
});
