// @ts-check
/** @typedef {{href: string, label: string, icon?: string, decision?: string}} PageLink */
let beside = false;
let fullPage = false;
let resetConfirm = false;
let current = { page: "start", id: "", option: "now" };
let journeyDevice = "";
const reviewPages = [
  ...(manifest.questions.length ? [{ href: "#/questions", label: "Questions", icon: "book" }] : []),
  ...(manifest.words.length ? [{ href: "#/words", label: "Words", icon: "book" }] : []),
  ...(inspectRoutes.length || manifest.elements.length
    ? [{ href: "#/inspect", label: "Inspect", icon: "inspect" }]
    : []),
  ...(manifest.journeys.length ? [{ href: "#/journeys", label: "Journeys", icon: "route" }] : []),
  { href: "#/notes", label: "Notes", icon: "note" },
];

/** @returns {PageLink[]} */
function pageLinks() {
  return [
    { href: "#/start", label: "Start", icon: "layers" },
    ...manifest.decisions.map((decision) => ({
      href: `#/d/${decision.id}`,
      label: decision.title,
      decision: decision.id,
    })),
    ...reviewPages,
  ];
}
/** @param {string} id */
function marker(id) {
  const saved = decisionState(id);
  return saved.pick !== null
    ? escapeHTML(saved.pick === "now" ? "Now" : saved.pick.toUpperCase())
    : icon(saved.liked.length ? "heart" : "circle");
}
/** @param {string} label @param {number} done @param {number} total */
function progress(label, done, total) {
  if (!total) return "";
  return `
    <div class="progress-item">
      <div><span>${label}</span><span>${done} of ${total}</span></div>
      <progress value="${done}" max="${total}" aria-label="${label}">${done} of ${total}</progress>
    </div>`;
}
function renderRail() {
  const scroll = rail.querySelector(".rail-scroll")?.scrollTop || 0;
  let links = "";
  for (const link of pageLinks()) {
    if (link.decision && link.decision === manifest.decisions[0]?.id)
      links += '<h2 class="nav-label">Decisions</h2>';
    if (link.href === reviewPages.find((entry) => entry.href !== "#/notes")?.href)
      links += '<h2 class="nav-label">Review</h2>';
    const selected = link.decision
      ? current.page === "d" && current.id === link.decision
      : current.page === link.href.split("/")[1];
    const status = link.decision ? marker(link.decision) : icon(link.icon || "note");
    links +=
      `<a href="${link.href}" class="nav-link ${selected ? "selected" : ""}" ${selected ? 'aria-current="page"' : ""}>` +
      `<span class="nav-marker">${status}</span>${escapeHTML(link.label)}</a>`;
  }
  const progressList = [
    progress(
      "Decisions picked",
      choices.decisions.filter((decision) => decision.pick !== null).length,
      choices.decisions.length,
    ),
    progress(
      "Questions answered",
      choices.questions.filter((question) => question.answer !== null).length,
      choices.questions.length,
    ),
    progress(
      "Words reviewed",
      choices.words.filter((word) => word.choice !== null).length,
      choices.words.length,
    ),
    progress(
      "Journey steps",
      choices.journeys.filter((step) => step.verdict !== null).length,
      choices.journeys.length,
    ),
  ].join("");
  const reset = resetConfirm
    ? `<div class="reset-confirm">
        <span>Clear this round's choices?</span>
        ${button("Keep choices", "cancel-reset", "", "small")}
        ${button("Reset", "confirm-reset", "", "small danger")}
      </div>`
    : button("Reset round", "reset", "", "quiet small");
  rail.innerHTML = `
    <div class="rail-brand">
      <span class="brand-mark">${icon("layers")}</span>
      <div><strong>${escapeHTML(manifest.title)}</strong><span>Round ${manifest.round}</span></div>
      ${button(icon("close"), "rail", 'aria-label="Hide navigation"', "rail-close")}
    </div>
    <div class="rail-scroll">
      <div class="progress-list">${progressList}</div>
      <nav aria-label="Review pages">${links}</nav>
    </div>
    <footer class="rail-footer">
      ${button(`${icon("download")} Export choices`, "export", "", "primary export-button")}
      <div class="footer-row">
        ${button(`${icon("upload")} Import`, "import", "", "quiet")}
        <span class="autosave">${storageUnavailable ? "Export to save" : "Autosaved locally"}</span>
      </div>
      <div class="keyboard-hint"><kbd>P</kbd> Pick <kbd>L</kbd> Like <kbd>[</kbd> Hide rail</div>
      ${reset}
    </footer>`;
  rail.querySelector(".rail-scroll").scrollTop = scroll;
}
/** @param {string} title @param {string} text @param {string} [tools] */
function pageHead(title, text, tools = "") {
  return `
    <header class="page-head">
      <div><h1>${escapeHTML(title)}</h1>${text ? `<p>${escapeHTML(text)}</p>` : ""}</div>
      <div class="page-tools">
        ${button(icon("menu"), "rail", 'aria-label="Show navigation"', "show-rail")}${tools}
      </div>
    </header>`;
}
/** @param {string} value @param {string} scope @param {string} id @param {string} [label] @param {string} [extra] */
function noteField(value, scope, id, label = "Your notes", extra = "") {
  return `
    <label class="note-field">
      <span>${label}</span>
      <textarea rows="1" data-note="${scope}" data-id="${escapeHTML(id)}" ${extra} placeholder="Anything to carry forward?">${escapeHTML(value)}</textarea>
    </label>`;
}
function startPage() {
  const rows = manifest.decisions
    .map(
      (decision) => `
        <a class="decision-row" href="#/d/${decision.id}">
          <span class="decision-status">${marker(decision.id)}</span>
          <span><strong>${escapeHTML(decision.title)}</strong><span>${escapeHTML(decision.question)}</span></span>
          <span class="row-meta">${decision.options.length - 1} options</span>${icon("right")}
        </a>`,
    )
    .join("");
  return `${pageHead("A few decisions. Your point of view.", manifest.about || "Compare the live options, keep what works, and hand your choices back.")}
    <section class="start-guide" aria-label="How this round works">
      <div>${icon("layers")}<h2>Explore the options</h2><p>Same page. Different ideas. Try each one on laptop and phone.</p></div>
      <div>${icon("heart")}<h2>Keep what works</h2><p>Like ideas worth carrying forward. Pick one option per decision.</p></div>
      <div>${icon("download")}<h2>Hand it back</h2><p>Export one choices file for your agent. Notes travel with it.</p></div>
    </section>
    <section class="decision-list">
      <h2>This round</h2>
      ${rows || '<p class="muted">This round is for the review pages in the navigation.</p>'}
    </section>
    <section class="shortcuts">
      <h2>A little faster with keys</h2>
      <dl>
        <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Previous / next page</dd></div>
        <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Previous / next option</dd></div>
        <div><dt><kbd>P</kbd> <kbd>L</kbd></dt><dd>Pick / like</dd></div>
        <div><dt><kbd>B</kbd> <kbd>F</kbd></dt><dd>Beside Now / full page</dd></div>
        <div><dt><kbd>I</kbd> <kbd>[</kbd></dt><dd>Inspect / hide navigation</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>Close</dd></div>
      </dl>
    </section>`;
}
/** @param {import("../lib/manifest.js").ManifestOption} option @param {DecisionChoice} saved @param {boolean} selected */
function optionTab(option, saved, selected) {
  const letter = option.id === "now" ? "Now" : escapeHTML(option.id.toUpperCase());
  const kind = option.id === "now" ? "Current" : option.kind === "different" ? "Different" : "Close";
  const marks =
    (saved.pick === option.id ? icon("check") : "") + (saved.liked.includes(option.id) ? icon("heart") : "");
  return `
    <button type="button" role="tab" id="tab-${option.id}" aria-controls="decision-panel"
      aria-selected="${selected}" tabindex="${selected ? 0 : -1}"
      class="option-tab ${selected ? "active" : ""}" data-action="option" data-option="${option.id}">
      <span class="tab-top">
        <span class="letter ${option.kind === "different" ? "different" : ""}">${letter}</span>
        <span class="tab-kind">${kind}</span><span class="tab-marks">${marks}</span>
      </span>
      <strong>${escapeHTML(option.name)}</strong>
    </button>`;
}
function decisionPage() {
  const decision = manifest.decisions.find((entry) => entry.id === current.id);
  const option = decision.options.find((entry) => entry.id === current.option);
  const saved = decisionState(decision.id);
  const letter = option.id === "now" ? "Now" : option.id.toUpperCase();
  const tabs = decision.options.map((entry) => optionTab(entry, saved, entry.id === option.id)).join("");
  const liked = saved.liked.includes(option.id);
  const picked = saved.pick === option.id;
  const pickLabel = option.id === "now" ? "Keep Now" : `${picked ? "Picked" : "Pick"} ${escapeHTML(letter)}`;
  const actions =
    button(`${icon("heart")} ${liked ? "Liked" : "Like"}`, "like", `aria-pressed="${liked}"`) +
    button(`${picked ? icon("check") : ""}${pickLabel}`, "pick", `aria-pressed="${picked}"`, "primary");
  const paired = beside && option.id !== "now";
  const views = decision.views
    .map((view, index) => {
      const now = paired
        ? frameSlot(`${decision.id}:${index}:now`, view, "now", decision.id, {
            full: fullPage,
            label: "Now",
          })
        : "";
      const proposed = frameSlot(`${decision.id}:${index}:option`, view, option.id, decision.id, {
        full: fullPage,
        label: option.name,
      });
      return `<div class="view-unit"><div class="view-pair ${paired ? "paired" : ""}">${now}${proposed}</div></div>`;
    })
    .join("");
  const focusControl = decision.views.some((view) => view.focus)
    ? button(
        `${icon("focus")} ${fullPage ? "Full page" : "Focus"}`,
        "focus",
        `aria-pressed="${!fullPage}"`,
        "small",
      )
    : "";
  const compareControl = button(
    `${icon("columns")} Beside Now`,
    "beside",
    `aria-pressed="${beside}"`,
    "small",
  );
  const idea = option.idea || (option.id === "now" ? "The current design, without a variant applied." : "");
  return `${pageHead(decision.title, decision.question)}
    <div class="option-bar">
      <div role="tablist" aria-label="${escapeHTML(decision.title)} options" class="option-tabs">${tabs}</div>
      <div class="decision-actions">${actions}</div>
    </div>
    <section id="decision-panel" role="tabpanel" aria-labelledby="tab-${option.id}">
      <div class="option-context">
        <div>
          <p class="option-idea">${escapeHTML(idea)}</p>
          <div class="option-reasons">
            ${option.why ? `<span>${icon("book")}${escapeHTML(option.why)}</span>` : ""}
            ${option.tradeoff ? `<span>${icon("alert")}${escapeHTML(option.tradeoff)}</span>` : ""}
          </div>
        </div>
        <div class="view-tools">${focusControl}${compareControl}</div>
      </div>
      ${noteField(saved.note, "decisions", decision.id)}
      <div class="views ${beside ? "comparing" : ""} ${decision.views.length === 1 ? "single" : ""}">${views}</div>
    </section>`;
}
/** @template {{group?: string}} T @param {T[]} entries @param {(entry: T) => string} card */
function groupedCards(entries, card) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const entry of entries) {
    const group = entry.group || "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }
  return [...groups]
    .map(
      ([group, values]) => `
        <section class="review-group">
          ${group ? `<h2>${escapeHTML(group)}</h2>` : ""}
          <div class="review-grid">${values.map(card).join("")}</div>
        </section>`,
    )
    .join("");
}
/** @param {string[][]} values @param {string | null} selected @param {string} action @param {string} id @param {string} [extra] */
function choiceChips(values, selected, action, id, extra = "") {
  const chips = values
    .map(([value, label]) =>
      button(
        escapeHTML(label),
        action,
        `data-id="${escapeHTML(id)}" data-value="${escapeHTML(value)}" aria-pressed="${selected === value}" ${extra}`,
        "choice-chip",
      ),
    )
    .join("");
  return `<div class="choice-chips">${chips}</div>`;
}
function questionsPage() {
  return (
    pageHead("Questions", "A few details to settle before the next round.") +
    groupedCards(manifest.questions, (question) => {
      const saved = choices.questions.find((entry) => entry.id === question.id);
      const answers = choiceChips(
        question.choices.map((value) => [value, value]),
        saved.answer,
        "answer",
        question.id,
      );
      return `
        <article class="review-card">
          <h3>${escapeHTML(question.question)}</h3>
          ${question.why ? `<p>${escapeHTML(question.why)}</p>` : ""}
          ${answers}
          ${noteField(saved.note, "questions", question.id)}
        </article>`;
    })
  );
}
function wordsPage() {
  return (
    pageHead("Words", "Keep the language that makes sense. Change what gets in the way.") +
    groupedCards(manifest.words, (word) => {
      const saved = choices.words.find((entry) => entry.id === word.id);
      const alternatives = word.alternatives || [];
      const other =
        saved.choice !== null && saved.choice !== "keep" && !alternatives.includes(saved.choice)
          ? saved.choice
          : "";
      const routes = (word.where || [])
        .map((label) =>
          button(
            `${escapeHTML(label)} ${icon("external")}`,
            "inspect-route",
            `data-route="${inspectRoutes.findIndex((route) => route.label === label)}"`,
            "quiet small",
          ),
        )
        .join("");
      const options = choiceChips(
        [["keep", `Keep "${word.term}"`], ...alternatives.map((value) => [value, value])],
        saved.choice,
        "word",
        word.id,
      );
      return `
        <article class="review-card word-card">
          <h3>${escapeHTML(word.term)}</h3>
          <p>${escapeHTML(word.means)}</p>
          ${routes ? `<div class="word-where"><span>Seen in</span>${routes}</div>` : ""}
          ${options}
          <label class="other-word">
            <span>Other</span>
            <input data-other="${word.id}" aria-label="Other word for ${escapeHTML(word.term)}"
              value="${escapeHTML(other)}" placeholder="Your word" />
          </label>
          ${noteField(saved.note, "words", word.id)}
        </article>`;
    })
  );
}
function notesPage() {
  return `${pageHead("Notes", "Anything that crosses decisions, or deserves a little more space.")}
    <div class="general-notes">
      ${noteField(choices.notes, "notes", "", "General notes", 'aria-label="General notes"')}
    </div>`;
}
/** @param {string} device @param {string} action */
function deviceButtons(device, action) {
  const controls = ["laptop", "phone"]
    .map((value) =>
      button(
        value === "laptop" ? "Laptop" : "Phone",
        action,
        `data-device="${value}" aria-pressed="${device === value}"`,
        "small",
      ),
    )
    .join("");
  return `<div class="view-tools" aria-label="Preview device">${controls}</div>`;
}
function journeysPage() {
  const journey = manifest.journeys.find((entry) => entry.id === current.id) || manifest.journeys[0];
  const device = journeyDevice || journey.steps[0].device;
  const tabs = manifest.journeys
    .map(
      (entry) =>
        `<a href="#/journeys/${entry.id}" role="tab" aria-selected="${entry.id === journey.id}" class="button ${entry.id === journey.id ? "active" : ""}">${escapeHTML(entry.title)}</a>`,
    )
    .join("");
  const steps = journey.steps
    .map((step, index) => {
      const saved = journeyState(journey.id, index + 1);
      const view = {
        ...step,
        device: journeyDevice || step.device,
        caption: `Step ${index + 1}`,
        focus: step.selector,
      };
      const preview = frameSlot(`journey:${journey.id}:${index}`, view, "now", "", {
        highlight: { selector: step.selector, label: `Step ${index + 1}` },
        label: "Your picks",
      });
      const verdicts = choiceChips(
        ["obvious", "unclear", "missing"].map((value) => [value, value[0].toUpperCase() + value.slice(1)]),
        saved.verdict,
        "journey-verdict",
        journey.id,
        `data-step="${index + 1}"`,
      );
      return `
        <section class="journey-step">
          <div class="step-head">
            <span class="letter">${index + 1}</span>
            <div><h2>${escapeHTML(step.title)}</h2>${step.does ? `<p>${escapeHTML(step.does)}</p>` : ""}</div>
          </div>
          ${preview}
          ${step.ask ? `<p class="step-ask">${escapeHTML(step.ask)}</p>` : ""}
          ${verdicts}
          ${noteField(saved.note, "journeys", journey.id, "Your notes", `data-step="${index + 1}"`)}
        </section>`;
    })
    .join("");
  return `${pageHead("Journeys", "Follow the path. Flag the moments that need to be clearer.", deviceButtons(device, "journey-device"))}
    <div class="journey-tabs" role="tablist" aria-label="Journeys">${tabs}</div>
    <div class="journey-steps">${steps}</div>`;
}
function render() {
  framePlans = [];
  const next = document.createElement("template");
  next.innerHTML = (
    {
      d: decisionPage,
      questions: questionsPage,
      words: wordsPage,
      notes: notesPage,
      inspect: inspectPage,
      journeys: journeysPage,
    }[current.page] || startPage
  )();
  patchChildren(stage, next.content);
  syncFrames();
  renderRail();
  const activeTab = stage.querySelector(".option-tab.active");
  if (activeTab instanceof HTMLElement) {
    const tabs = activeTab.parentElement;
    if (
      activeTab.offsetLeft < tabs.scrollLeft ||
      activeTab.offsetLeft + activeTab.offsetWidth > tabs.scrollLeft + tabs.clientWidth
    )
      tabs.scrollLeft = activeTab.offsetLeft - (tabs.clientWidth - activeTab.offsetWidth) / 2;
  }
  for (const textarea of stage.querySelectorAll("textarea")) growNote(textarea);
}
/** @param {Node} parent @param {Node} next */
function patchChildren(parent, next) {
  let cursor = parent.firstChild;
  for (const fresh of next.childNodes) {
    const kept = fresh instanceof HTMLElement && frameRecords.get(fresh.dataset.frameKey)?.card;
    if (kept && kept.parentNode === parent) {
      // Detaching even an unchanged iframe reloads its browsing context.
      while (cursor && cursor !== kept) {
        const remove = cursor;
        cursor = cursor.nextSibling;
        remove.remove();
      }
      cursor = kept.nextSibling;
      continue;
    }
    if (
      cursor?.nodeType === fresh.nodeType &&
      (!(fresh instanceof Element) ||
        (cursor instanceof Element && cursor.tagName === fresh.tagName && !cursor.hasAttribute("data-key")))
    ) {
      if (cursor instanceof Element && fresh instanceof Element) {
        for (const attr of [...cursor.attributes])
          if (!fresh.hasAttribute(attr.name)) cursor.removeAttribute(attr.name);
        for (const attr of fresh.attributes)
          if (cursor.getAttribute(attr.name) !== attr.value) cursor.setAttribute(attr.name, attr.value);
        patchChildren(cursor, fresh);
        if (
          (cursor instanceof HTMLInputElement ||
            cursor instanceof HTMLTextAreaElement ||
            cursor instanceof HTMLSelectElement) &&
          "value" in fresh &&
          typeof fresh.value === "string" &&
          cursor.value !== fresh.value
        )
          cursor.value = fresh.value;
      } else if (cursor.nodeValue !== fresh.nodeValue) cursor.nodeValue = fresh.nodeValue;
      cursor = cursor.nextSibling;
    } else parent.insertBefore(fresh.cloneNode(true), cursor);
  }
  while (cursor) {
    const remove = cursor;
    cursor = cursor.nextSibling;
    remove.remove();
  }
}
/** @param {HTMLTextAreaElement} textarea */
function growNote(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}
