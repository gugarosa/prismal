// @ts-check
function navigate() {
  const previous = current.page + current.id;
  const focusTab = document.activeElement?.getAttribute("role") === "tab";
  const [, page = "start", id = "", option = ""] = location.hash.split("/");
  const decision = manifest.decisions.find((entry) => entry.id === id);
  if (page === "d" && decision) {
    current = {
      page,
      id,
      option: decision.options.some((entry) => entry.id === option) ? option : "now",
    };
  } else {
    const journey =
      page === "journeys" ? manifest.journeys.find((entry) => entry.id === id) || manifest.journeys[0] : null;
    current = {
      page: reviewPages.some((entry) => entry.href === `#/${page}`) ? page : "start",
      id: journey?.id || "",
      option: "now",
    };
  }
  render();
  if (focusTab && current.page === "d") {
    const tab = stage.querySelector('[role="tab"][aria-selected="true"]');
    if (tab instanceof HTMLElement) tab.focus({ preventScroll: true });
  }
  if (previous !== current.page + current.id) window.scrollTo(0, 0);
  document.body.classList.remove("menu-open");
  updateMenuState();
}
function updateMenuState() {
  const open = document.body.classList.contains("menu-open");
  document.querySelector(".mobile-bar [data-action=rail]").setAttribute("aria-expanded", String(open));
}
function toggleRail() {
  if (matchMedia("(max-width: 899px)").matches) document.body.classList.toggle("menu-open");
  else document.body.classList.toggle("rail-hidden");
  updateMenuState();
}
/** @param {string} action @param {HTMLElement | null} target */
function act(action, target) {
  switch (action) {
    case "rail":
      toggleRail();
      break;
    case "export":
      downloadChoices();
      break;
    case "import":
      document.getElementById("import-file").click();
      break;
    case "reset":
    case "cancel-reset":
      resetConfirm = action === "reset";
      renderRail();
      break;
    case "confirm-reset":
      resetChoices();
      resetConfirm = false;
      save();
      render();
      toast("This round has been reset.");
      break;
    case "retry": {
      const record = frameRecords.get(target.dataset.key);
      const task = record?.pending || record?.active;
      if (record && task) requestFrame(record, task.plan);
      break;
    }
    case "inspect-route":
      setInspectRoute(Number(target.dataset.route));
      if (current.page === "inspect") render();
      else location.hash = "#/inspect";
      break;
    case "inspect-device":
      setInspectDevice(target.dataset.device);
      render();
      break;
    case "journey-device":
      journeyDevice = target.dataset.device;
      render();
      break;
    case "inspect-toggle":
      toggleInspection();
      render();
      break;
    case "close-selection":
      closeInspection();
      break;
    case "instance":
      stepInspectInstance(Number(target.dataset.delta));
      break;
    case "select-element":
      selectInspectElement(target.dataset.name);
      break;
    case "element-verdict": {
      const verdict = target.dataset.value;
      if (verdict !== "clear" && verdict !== "unclear" && verdict !== "change") {
        toast(`Unknown element verdict: ${verdict}`, true);
        break;
      }
      reviewInspectElement(verdict);
      save();
      renderRail();
      updateInspectorPanel();
      break;
    }
    case "journey-verdict": {
      const verdict = target.dataset.value;
      if (verdict !== "obvious" && verdict !== "unclear" && verdict !== "missing") {
        toast(`Unknown journey verdict: ${verdict}`, true);
        break;
      }
      toggleJourneyVerdict(target.dataset.id, Number(target.dataset.step), verdict);
      save();
      render();
      break;
    }
    case "answer":
      toggleAnswer(target.dataset.id, target.dataset.value);
      save();
      render();
      break;
    case "word":
      toggleWord(target.dataset.id, target.dataset.value);
      save();
      render();
      break;
    case "option":
      location.hash = `#/d/${current.id}/${target.dataset.option}`;
      break;
    case "pick":
    case "like":
    case "focus":
    case "beside": {
      if (!decisionState(current.id)) break;
      if (action === "pick") togglePick(current.id, current.option);
      else if (action === "like") toggleLike(current.id, current.option);
      else if (action === "focus") fullPage = !fullPage;
      else beside = !beside;
      if (action === "pick" || action === "like") save();
      render();
      const control = stage.querySelector(`[data-action="${action}"]`);
      if (control instanceof HTMLElement) control.focus({ preventScroll: true });
      break;
    }
  }
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest(".skip-link")) {
    event.preventDefault();
    stage.focus();
    return;
  }
  const target = event.target.closest("[data-action]");
  if (target instanceof HTMLElement) act(target.dataset.action, target);
});
document.addEventListener("input", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.dataset.other) {
    setWordChoice(target.dataset.other, target.value);
    for (const chip of target.closest(".word-card").querySelectorAll(".choice-chip"))
      chip.setAttribute("aria-pressed", "false");
    save();
    renderRail();
    return;
  }
  if (!(target instanceof HTMLTextAreaElement) || !target.dataset.note) return;
  const section = target.dataset.note;
  if (section === "elements") {
    if (!noteInspectElement(target.value)) return;
  } else if (
    section === "notes" ||
    section === "decisions" ||
    section === "questions" ||
    section === "words" ||
    section === "journeys"
  ) {
    setReviewNote(section, target.dataset.id, target.value, Number(target.dataset.step));
  } else return;
  save();
  renderRail();
  growNote(target);
});
document.addEventListener("change", (event) => {
  if (event.target instanceof HTMLSelectElement && event.target.id === "inspect-route") {
    setInspectRoute(Number(event.target.value));
    render();
  }
});
document.getElementById("import-file").addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const source = importChoices(JSON.parse(await file.text()));
    const mismatch = source.title !== manifest.title || source.round !== manifest.round;
    save();
    render();
    toast(
      mismatch
        ? `Imported matching items from "${source.title}", round ${source.round}. This is "${manifest.title}", round ${manifest.round}.`
        : "Choices imported.",
      mismatch,
    );
  } catch (error) {
    toast(`Import failed: ${error.message}`, true);
  }
  input.value = "";
});
document.addEventListener("keydown", (event) => {
  if (
    !(event.target instanceof Element) ||
    event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])') ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  const key = event.key.toLowerCase();
  if (["arrowup", "arrowdown"].includes(key)) {
    event.preventDefault();
    const links = pageLinks();
    const index = links.findIndex((link) =>
      link.decision
        ? current.page === "d" && link.decision === current.id
        : current.page === link.href.split("/")[1],
    );
    location.hash = links[(index + (key === "arrowdown" ? 1 : -1) + links.length) % links.length].href;
  } else if (["arrowleft", "arrowright"].includes(key) && current.page === "d") {
    event.preventDefault();
    const options = manifest.decisions.find((decision) => decision.id === current.id).options;
    const index = options.findIndex((option) => option.id === current.option);
    const next = (index + (key === "arrowright" ? 1 : -1) + options.length) % options.length;
    location.hash = `#/d/${current.id}/${options[next].id}`;
  } else if (["p", "l", "b", "f", "["].includes(key)) {
    event.preventDefault();
    act({ p: "pick", l: "like", b: "beside", f: "focus", "[": "rail" }[key], null);
  } else if (key === "i" && reviewPages.some((entry) => entry.href === "#/inspect")) {
    event.preventDefault();
    if (current.page === "inspect") act("inspect-toggle", null);
    else location.hash = "#/inspect";
  } else if (key === "escape") {
    if (current.page === "inspect" && selectedElement) act("close-selection", null);
    document.body.classList.remove("menu-open");
    resetConfirm = false;
    renderRail();
    updateMenuState();
  }
});

document.getElementById("mobile-title").textContent = manifest.title;
document.querySelector(".mobile-bar [data-action=rail]").innerHTML = icon("menu");
let restoreError = "";
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) importChoices(JSON.parse(saved));
} catch (error) {
  restoreError = `Could not restore saved choices: ${error.message}. Export to keep your work.`;
}
addEventListener("hashchange", navigate);
navigate();
if (restoreError) toast(restoreError, true);
