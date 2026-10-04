// @ts-check
/** @typedef {{id: string, title: string, pick: string | null, pickName: string | null, liked: string[], note: string}} DecisionChoice */
/** @typedef {{id: string, answer: string | null, note: string}} QuestionChoice */
/** @typedef {{id: string, term: string, choice: string | null, note: string}} WordChoice */
/** @typedef {"clear" | "unclear" | "change"} ElementVerdict */
/** @typedef {"obvious" | "unclear" | "missing"} JourneyVerdict */
/** @typedef {{name: string, route: string, index: number, text: string, verdict: ElementVerdict | null, note: string}} ElementChoice */
/** @typedef {{journey: string, step: number, title: string, verdict: JourneyVerdict | null, note: string}} JourneyChoice */
/** @typedef {{
 * prismal: 1, title: string, round: number, exported: string,
 * decisions: DecisionChoice[], questions: QuestionChoice[], words: WordChoice[],
 * elements: ElementChoice[], journeys: JourneyChoice[], notes: string
 * }} Choices */
/** @typedef {Omit<Choices, "elements"> & {elements: (Omit<ElementChoice, "index"> & {index?: number})[]}} ImportedChoices */
/** @typedef {import("../client/protocol.d.ts").ElementSelection} ElementSelection */

/** @type {import("../lib/build.js").BuildData} */
const data = JSON.parse(document.getElementById("prismal-data").textContent);
const manifest = data.manifest;
const storageKey = `prismal:${manifest.title}:r${manifest.round}`;
const stage = document.getElementById("stage");
const rail = document.getElementById("rail");
/** @param {unknown} value */
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
/** @param {string} label @param {string} action @param {string} [extra] @param {string} [classes] */
const button = (label, action, extra = "", classes = "") =>
  `<button type="button" class="button ${classes}" data-action="${action}" ${extra}>${label}</button>`;
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

let toastTimer;
/** @param {string} text @param {boolean} [error] */
function toast(text, error = false) {
  const element = document.getElementById("toast");
  element.textContent = text;
  element.classList.toggle("error", error);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      element.hidden = true;
    },
    error ? 10000 : 4500,
  );
}

/** @returns {Choices} */
function freshChoices() {
  return {
    prismal: 1,
    title: manifest.title,
    round: manifest.round,
    exported: "",
    decisions: manifest.decisions.map((decision) => ({
      id: decision.id,
      title: decision.title,
      pick: null,
      pickName: null,
      liked: [],
      note: "",
    })),
    questions: manifest.questions.map((question) => ({ id: question.id, answer: null, note: "" })),
    words: manifest.words.map((word) => ({ id: word.id, term: word.term, choice: null, note: "" })),
    elements: [],
    journeys: manifest.journeys.flatMap((journey) =>
      journey.steps.map((step, index) => ({
        journey: journey.id,
        step: index + 1,
        title: step.title,
        verdict: null,
        note: "",
      })),
    ),
    notes: "",
  };
}
let choices = freshChoices();
let storageUnavailable = false;

function exportChoices() {
  return { ...choices, exported: new Date().toISOString() };
}
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(exportChoices()));
  } catch {
    if (!storageUnavailable)
      toast("Autosave is unavailable in this browser. Export to keep your choices.", true);
    storageUnavailable = true;
  }
}

/** @param {unknown} raw @returns {asserts raw is ImportedChoices} */
function validateChoices(raw) {
  if (
    !isRecord(raw) ||
    raw.prismal !== 1 ||
    typeof raw.title !== "string" ||
    !raw.title.trim() ||
    typeof raw.exported !== "string" ||
    Number.isNaN(Date.parse(raw.exported)) ||
    typeof raw.round !== "number" ||
    !Number.isInteger(raw.round) ||
    raw.round < 1
  )
    throw new Error("Not a Prismal choices file.");

  const nullableText = (value) => value === null || typeof value === "string";
  if (typeof raw.notes !== "string") throw new Error("Choices notes must be text.");
  const fields = {
    decisions: "id title note",
    questions: "id note",
    words: "id term note",
    elements: "name route text note",
    journeys: "journey title note",
  };
  /** @type {Record<string, (entry: Record<string, unknown>) => boolean>} */
  const valid = {
    decisions: (entry) =>
      nullableText(entry.pick) &&
      nullableText(entry.pickName) &&
      Array.isArray(entry.liked) &&
      entry.liked.every((id) => typeof id === "string"),
    questions: (entry) => nullableText(entry.answer),
    words: (entry) => nullableText(entry.choice),
    elements: (entry) =>
      (entry.verdict === null ||
        (typeof entry.verdict === "string" && ["clear", "unclear", "change"].includes(entry.verdict))) &&
      (entry.index === undefined ||
        (typeof entry.index === "number" && Number.isInteger(entry.index) && entry.index >= 0)),
    journeys: (entry) =>
      (entry.verdict === null ||
        (typeof entry.verdict === "string" && ["obvious", "unclear", "missing"].includes(entry.verdict))) &&
      typeof entry.step === "number" &&
      Number.isInteger(entry.step) &&
      entry.step > 0,
  };
  for (const [section, names] of Object.entries(fields)) {
    const entries = raw[section];
    if (!Array.isArray(entries)) throw new Error(`Choices ${section} must be a list.`);
    const seen = new Set();
    for (const entry of entries) {
      if (
        !isRecord(entry) ||
        names.split(" ").some((name) => typeof entry[name] !== "string") ||
        !valid[section](entry)
      )
        throw new Error(`Invalid ${section} choices.`);
      const identity = JSON.stringify(
        section === "elements"
          ? [entry.name, entry.route, entry.index || 0]
          : section === "journeys"
            ? [entry.journey, entry.step]
            : entry.id,
      );
      if (seen.has(identity)) throw new Error(`Duplicate ${section} choices.`);
      seen.add(identity);
    }
  }
}

/** @param {ImportedChoices} incoming */
function reconcileChoices(incoming) {
  const next = freshChoices();
  for (const decision of next.decisions) {
    const saved = incoming.decisions.find((entry) => entry.id === decision.id);
    const definition = manifest.decisions.find((entry) => entry.id === decision.id);
    if (!saved) continue;
    if (saved.pick !== null && !definition.options.some((option) => option.id === saved.pick))
      throw new Error(`Unknown pick for ${decision.id}: ${saved.pick}`);
    if (saved.liked.some((id) => !definition.options.some((option) => option.id === id)))
      throw new Error(`Unknown liked option for ${decision.id}.`);
    decision.pick = saved.pick;
    decision.pickName = definition.options.find((option) => option.id === saved.pick)?.name ?? null;
    decision.liked = [...new Set(saved.liked)];
    decision.note = saved.note;
  }
  for (const question of next.questions) {
    const saved = incoming.questions.find((entry) => entry.id === question.id);
    if (!saved) continue;
    const definition = manifest.questions.find((entry) => entry.id === question.id);
    if (saved.answer !== null && !definition.choices.includes(saved.answer))
      throw new Error(`Unknown answer for ${question.id}.`);
    question.answer = saved.answer;
    question.note = saved.note;
  }
  for (const word of next.words) {
    const saved = incoming.words.find((entry) => entry.id === word.id);
    if (!saved) continue;
    word.choice = saved.choice;
    word.note = saved.note;
  }
  next.elements = incoming.elements.map(({ name, route, text, verdict, note, index = 0 }) => ({
    name,
    route,
    text,
    verdict,
    note,
    index,
  }));
  for (const step of next.journeys) {
    const saved = incoming.journeys.find(
      (entry) => entry.journey === step.journey && entry.step === step.step,
    );
    if (!saved) continue;
    step.verdict = saved.verdict;
    step.note = saved.note;
  }
  next.notes = incoming.notes;
  return next;
}

/** Replaces state only after validation and reconciliation succeed. @param {unknown} raw */
function importChoices(raw) {
  validateChoices(raw);
  const next = reconcileChoices(raw);
  choices = next;
  return { title: raw.title, round: raw.round };
}
function resetChoices() {
  choices = freshChoices();
}
/** @param {string} id */
function decisionState(id) {
  return choices.decisions.find((decision) => decision.id === id);
}
/** @param {string} id @param {number} step */
function journeyState(id, step) {
  return choices.journeys.find((entry) => entry.journey === id && entry.step === step);
}
/** @param {string} id @param {string} option */
function togglePick(id, option) {
  const saved = decisionState(id);
  saved.pick = saved.pick === option ? null : option;
  const decision = manifest.decisions.find((entry) => entry.id === id);
  saved.pickName = decision.options.find((entry) => entry.id === saved.pick)?.name ?? null;
}
/** @param {string} id @param {string} option */
function toggleLike(id, option) {
  const saved = decisionState(id);
  saved.liked = saved.liked.includes(option)
    ? saved.liked.filter((liked) => liked !== option)
    : [...saved.liked, option];
}
/** @param {string} id @param {string} answer */
function toggleAnswer(id, answer) {
  const saved = choices.questions.find((question) => question.id === id);
  saved.answer = saved.answer === answer ? null : answer;
}
/** @param {string} id @param {string} value */
function toggleWord(id, value) {
  const saved = choices.words.find((word) => word.id === id);
  saved.choice = saved.choice === value ? null : value;
}
/** @param {string} id @param {string} value */
function setWordChoice(id, value) {
  choices.words.find((word) => word.id === id).choice = value || null;
}
/** @param {ElementSelection | null} selection @param {boolean} [create] */
function elementState(selection, create = false) {
  if (!selection) return null;
  let entry = choices.elements.find(
    (element) =>
      element.name === selection.name &&
      element.route === selection.route &&
      element.index === selection.index,
  );
  if (!entry && create) {
    entry = {
      name: selection.name,
      route: selection.route,
      index: selection.index,
      text: selection.text,
      verdict: null,
      note: "",
    };
    choices.elements.push(entry);
  }
  if (entry && create) entry.text = selection.text;
  return entry;
}
/** @param {ElementSelection} selection @param {ElementVerdict} verdict */
function toggleElementVerdict(selection, verdict) {
  const saved = elementState(selection, true);
  saved.verdict = saved.verdict === verdict ? null : verdict;
}
/** @param {ElementSelection} selection @param {string} note */
function setElementNote(selection, note) {
  elementState(selection, true).note = note;
}
/** @param {string} id @param {number} step @param {JourneyVerdict} verdict */
function toggleJourneyVerdict(id, step, verdict) {
  const saved = journeyState(id, step);
  saved.verdict = saved.verdict === verdict ? null : verdict;
}
/** @param {"notes" | "decisions" | "questions" | "words" | "journeys"} section @param {string} id @param {string} note @param {number} [step] */
function setReviewNote(section, id, note, step = 0) {
  if (section === "notes") choices.notes = note;
  else if (section === "journeys") journeyState(id, step).note = note;
  else choices[section].find((entry) => entry.id === id).note = note;
}
/** @param {string} id @param {string} option */
function frameChoices(id, option) {
  const result = { ...manifest.defaults };
  for (const decision of choices.decisions) {
    if (decision.pick !== null) result[decision.id] = decision.pick;
  }
  if (id) result[id] = option;
  return result;
}
function downloadChoices() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(exportChoices(), null, 2) + "\n"], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `prismal-choices-r${manifest.round}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Choices exported. Hand the JSON file back to your agent.");
}
