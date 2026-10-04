// @ts-check
/** @type {(import("../lib/manifest.js").ManifestSource & {label: string})[]} */
const inspectRoutes = manifest.inspect.length
  ? manifest.inspect
  : manifest.elements.length
    ? [
        ...new Map(
          manifest.decisions.map((decision) => [
            JSON.stringify([decision.views[0].file, decision.views[0].url, decision.views[0].state]),
            { ...decision.views[0], label: decision.title },
          ]),
        ).values(),
      ]
    : [];
let inspectIndex = 0;
let inspectDevice = inspectRoutes[0]?.device || "laptop";
let inspectOn = true;
/** @type {ElementSelection | null} */
let selectedElement = null;
/** @type {InventoryItem[]} */
let pageInventory = [];

function resetInspection() {
  selectedElement = null;
  pageInventory = [];
}
/** @param {number} index */
function setInspectRoute(index) {
  inspectIndex = index;
  resetInspection();
}
/** @param {string} device */
function setInspectDevice(device) {
  inspectDevice = device;
  resetInspection();
}
function toggleInspection() {
  inspectOn = !inspectOn;
}
function closeInspection() {
  selectedElement = null;
  const task = frameRecords.get("inspect")?.active;
  if (task) sendFrame(task, { type: "select", name: "", index: 0 });
  updateInspectorPanel();
}
/** @param {string} name @param {number} [index] */
function selectInspectElement(name, index = 0) {
  const task = frameRecords.get("inspect")?.active;
  if (task) sendFrame(task, { type: "select", name, index });
}
/** @param {number} delta */
function stepInspectInstance(delta) {
  if (selectedElement) selectInspectElement(selectedElement.name, selectedElement.index + delta);
}
/** @param {ElementVerdict} verdict */
function reviewInspectElement(verdict) {
  if (selectedElement) toggleElementVerdict(selectedElement, verdict);
}
/** @param {string} note */
function noteInspectElement(note) {
  if (!selectedElement) return false;
  setElementNote(selectedElement, note);
  return true;
}

/** @param {ElementSelection} selection @param {ElementChoice | null} saved @param {number} count */
function selectionDetails(selection, saved, count) {
  const verdicts = choiceChips(
    ["clear", "unclear", "change"].map((value) => [value, value[0].toUpperCase() + value.slice(1)]),
    saved?.verdict,
    "element-verdict",
    "",
  );
  const previous = button(
    `${icon("left")} Previous`,
    "instance",
    `data-delta="-1" ${selection.index === 0 ? "disabled" : ""}`,
    "small",
  );
  const next = button(
    `Next ${icon("right")}`,
    "instance",
    `data-delta="1" ${selection.index >= count - 1 ? "disabled" : ""}`,
    "small",
  );
  return `
    <div class="selection-head">
      <h2>${escapeHTML(selection.name)}</h2>
      ${button(icon("close"), "close-selection", 'aria-label="Close selection"', "quiet small")}
    </div>
    <p class="selection-meta">${escapeHTML(selection.group || "Page")} / <code>${escapeHTML(selection.route)}</code></p>
    ${selection.what ? `<p>${escapeHTML(selection.what)}</p>` : ""}
    <blockquote class="selected-text">${escapeHTML(selection.text || "No on-screen text.")}</blockquote>
    ${verdicts}
    ${noteField(saved?.note || "", "elements", "", "Your notes")}
    <div class="instance-controls">${previous}<span>${selection.index + 1} of ${count}</span>${next}</div>`;
}
function inspectorPanel() {
  const saved = elementState(selectedElement);
  const count = pageInventory.find((entry) => entry.name === selectedElement?.name)?.count || 1;
  const detail = selectedElement
    ? selectionDetails(selectedElement, saved, count)
    : "<h2>Pick an element</h2><p>Point at the page to see its name. Click to leave a note.</p>";
  const groups = [...new Set(pageInventory.map((entry) => entry.group || "Page"))];
  const inventory = groups
    .map((group) => {
      const entries = pageInventory
        .filter((entry) => (entry.group || "Page") === group)
        .map((entry) => {
          const label = `<span>${escapeHTML(entry.name)}</span><span class="muted">${entry.count}</span>`;
          const control = button(label, "select-element", `data-name="${escapeHTML(entry.name)}"`, "quiet");
          return `<li>${control}</li>`;
        })
        .join("");
      return `<h3>${escapeHTML(group)}</h3><ul>${entries}</ul>`;
    })
    .join("");
  return `${detail}
    <section class="inventory">
      <h2>On this page</h2>
      ${inventory || '<p class="muted">No registered elements on this page. You can still point and click to inspect.</p>'}
    </section>`;
}
function updateInspectorPanel() {
  const panel = document.getElementById("inspect-panel");
  if (!panel) return;
  const focused = document.activeElement;
  const ownedFocus = panel.contains(focused);
  const next = document.createElement("template");
  next.innerHTML = inspectorPanel();
  patchChildren(panel, next.content);
  if (
    ownedFocus &&
    (!(focused instanceof HTMLElement) || !focused.isConnected || focused.matches(":disabled"))
  ) {
    const fallback =
      panel.querySelector(".instance-controls button:not(:disabled), [data-action=select-element]") || stage;
    if (fallback instanceof HTMLElement) fallback.focus({ preventScroll: true });
  }
}
/** @param {FrameTask} task @param {ClientEvent} payload */
function inspectMessage(task, payload) {
  const record = frameRecords.get("inspect");
  if (current.page !== "inspect" || task !== (record?.pending || record?.active)) return;
  if (payload.type === "ready") {
    resetInspection();
    updateInspectorPanel();
  } else if (payload.type === "inventory") {
    pageInventory = payload.items;
    updateInspectorPanel();
  } else if (payload.type === "picked") {
    selectedElement = payload;
    updateInspectorPanel();
  } else if (payload.type === "rect" && selectedElement) {
    if (inspectDevice === "phone") record.card.scrollIntoView({ block: "center" });
    else {
      const scale = task.scale || 1;
      const top = record.clip.getBoundingClientRect().top + payload.top * scale;
      if (top < 80 || top + Math.min(payload.height * scale, 300) > innerHeight) scrollBy(0, top - 100);
    }
  }
}
function inspectPage() {
  const source = inspectRoutes[inspectIndex];
  const heading = pageHead("Inspect", "Review the details, one element at a time.");
  if (!source) return `${heading}<p>Add an inspect route or a decision view to preview a page.</p>`;
  const routes = inspectRoutes
    .map(
      (route, index) =>
        `<option value="${index}" ${index === inspectIndex ? "selected" : ""}>${escapeHTML(route.label)}</option>`,
    )
    .join("");
  const toggle = button(
    `${icon("inspect")} ${inspectOn ? "Inspect on" : "Inspect off"}`,
    "inspect-toggle",
    `aria-pressed="${inspectOn}"`,
    "small",
  );
  const preview = frameSlot(
    "inspect",
    { ...source, caption: inspectDevice === "phone" ? "Phone" : "Laptop", device: inspectDevice },
    "now",
    "",
    { full: true, label: "Your picks", inspect: inspectOn, onMessage: inspectMessage },
  );
  return `${heading}
    <div class="inspect-tools">
      <label>Page <select id="inspect-route" aria-label="Inspect route">${routes}</select></label>
      ${deviceButtons(inspectDevice, "inspect-device")}
      ${toggle}
    </div>
    <div class="inspect-layout">
      ${preview}
      <aside class="review-card inspector-panel" id="inspect-panel" aria-label="Element review">${inspectorPanel()}</aside>
    </div>`;
}
