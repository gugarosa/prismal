// @ts-check
/** @typedef {import("../client/protocol.d.ts").ClientEvent} ClientEvent */
/** @typedef {import("../client/protocol.d.ts").FrameRect} FrameRect */
/** @typedef {import("../client/protocol.d.ts").InventoryItem} InventoryItem */
/** @typedef {import("../lib/manifest.js").ManifestSource & {caption?: string, label?: string, focus?: string}} FrameView */
/** @typedef {{
 * full?: boolean, label?: string, inspect?: boolean,
 * highlight?: import("../client/protocol.d.ts").Highlight,
 * onMessage?: (task: FrameTask, event: ClientEvent) => void
 * }} FrameOptions */
/** @typedef {FrameOptions & {
 * key: string, slot: string, view: FrameView, option: string, choices: Record<string, string>
 * }} FramePlan */
/** @typedef {{
 * card: HTMLElement, caption: HTMLDivElement, body: HTMLDivElement, clip: HTMLDivElement,
 * status: HTMLDivElement, active: FrameTask | null, pending: FrameTask | null,
 * visible: boolean, signature?: string
 * }} FrameRecord */
/** @typedef {{
 * record: FrameRecord, plan: FramePlan, loading: boolean, ready: boolean, disposed: boolean,
 * height: number, frame?: HTMLIFrameElement, origin?: string, scale?: number, rect?: FrameRect,
 * error?: string, swapTimer?: number, failTimer?: number
 * }} FrameTask */

const FRAME_SWAP_DELAY = 3000;
const FRAME_READY_TIMEOUT = 8000;
const MAX_LOADING_FRAMES = 2;
const MAX_FRAME_HEIGHT = 30000;
/** @type {Map<string, FrameRecord>} */
const frameRecords = new Map();
/** @type {Set<FrameTask>} */
const ownedFrames = new Set();
/** @type {FramePlan[]} */
let framePlans = [];
let loadingFrames = 0;
const frameObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const record = frameRecords.get(entry.target.getAttribute("data-key"));
      if (record && entry.isIntersecting) record.visible = true;
    }
    pumpFrames();
  },
  { rootMargin: "240px" },
);
const frameResize = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const record = frameRecords.get(entry.target.getAttribute("data-key"));
    if (record) layoutFrame(record.active || record.pending);
  }
});

/** @param {string} key @param {FrameView} view @param {string} [option] @param {string} [decision] @param {FrameOptions} [extra] */
function frameSlot(key, view, option = "now", decision = "", extra = {}) {
  const slot = `frame-slot-${framePlans.length}`;
  framePlans.push({ key, slot, view, option, choices: frameChoices(decision, option), ...extra });
  return `<div id="${slot}" class="frame-slot" data-frame-key="${escapeHTML(key)}"></div>`;
}
/** @param {FrameView} view */
function frameRoute(view) {
  if (view.file) return view.file.includes("#") ? view.file.slice(view.file.indexOf("#")) : view.file;
  const url = new URL(view.url, manifest.base);
  return url.pathname + url.search + url.hash;
}
/** @param {FrameTask} task */
function finishLoading(task) {
  clearTimeout(task.swapTimer);
  clearTimeout(task.failTimer);
  if (task.loading) {
    task.loading = false;
    loadingFrames--;
  }
  queueMicrotask(pumpFrames);
}
/** @param {FrameTask | null} task */
function disposeFrame(task) {
  if (!task || task.disposed) return;
  task.disposed = true;
  finishLoading(task);
  ownedFrames.delete(task);
  task.frame?.remove();
}
/** @param {FrameTask} task */
function activateFrame(task) {
  const record = task.record;
  if (task.disposed || (record.pending !== task && record.active !== task)) return;
  if (record.active && record.active !== task) disposeFrame(record.active);
  record.active = task;
  task.frame.style.opacity = "1";
  task.frame.style.pointerEvents = "auto";
  record.status.hidden = task.ready && !task.error;
  layoutFrame(task);
}
/** @param {FrameTask} task @param {string} text */
function failFrame(task, text) {
  const record = task.record;
  if (task.disposed || (record.pending !== task && record.active !== task)) return;
  task.error = text;
  if ((record.pending || record.active) === task) record.card.setAttribute("aria-busy", "false");
  finishLoading(task);
  if (task.frame) activateFrame(task);
  record.status.hidden = false;
  record.status.innerHTML = `
    <strong>${escapeHTML(text)}</strong>
    <code>${escapeHTML(task.plan.view.url || task.plan.view.file)}</code>
    <ul>
      <li>Start the dev server for live pages.</li>
      <li>Include the Prismal client.</li>
      <li>Check the URL or file source.</li>
    </ul>
    ${button("Try again", "retry", `data-key="${escapeHTML(task.plan.key)}"`)}`;
  record.card.classList.add("frame-error");
}
/** @param {FrameTask | null} task */
function layoutFrame(task) {
  if (!task?.frame || task.disposed) return;
  const { view, full } = task.plan;
  const [width, viewportHeight] = manifest.devices[view.device];
  const phone = view.device === "phone";
  const focused = !full && Boolean(view.focus) && task.rect;
  const height = phone && !focused ? viewportHeight : Math.max(viewportHeight, task.height);
  let left = 0,
    top = 0,
    cropWidth = width,
    cropHeight = height;
  if (focused) {
    left = Math.max(0, task.rect.left - 24);
    top = Math.max(0, task.rect.top - 24);
    cropWidth = Math.min(width - left, task.rect.width + 48);
    cropHeight = Math.min(height - top, task.rect.height + 48);
  }
  const bezel = phone && !focused;
  const available = Math.max(1, task.record.body.clientWidth - 32 - (bezel ? 16 : 0));
  const scale = Math.min(1, available / Math.max(1, cropWidth));
  task.scale = scale;
  task.frame.style.width = `${width}px`;
  task.frame.style.height = `${height}px`;
  task.frame.style.transform = `translate(${-left * scale}px, ${-top * scale}px) scale(${scale})`;
  if (task.record.active && task.record.active !== task) return;
  task.record.clip.classList.toggle("bezel", Boolean(bezel));
  task.record.clip.style.width = `${cropWidth * scale}px`;
  task.record.clip.style.height = `${Math.max(1, cropHeight * scale)}px`;
}
/** @param {FrameTask} task @param {import("../client/protocol.d.ts").ShellCommand} command */
function sendFrame(task, command) {
  task.frame?.contentWindow?.postMessage(
    { prismal: 1, ...command },
    task.origin === "null" ? "*" : task.origin,
  );
}
/** @param {FrameTask} task */
function initFrame(task) {
  sendFrame(task, {
    type: "init",
    elements: manifest.elements,
    inspect: Boolean(task.plan.inspect),
    highlight: task.plan.highlight || null,
    focus: task.plan.full ? "" : task.plan.view.focus || "",
  });
}
/** @param {FrameTask} task */
function startFrame(task) {
  if (task.disposed || task.record.pending !== task) return;
  task.loading = true;
  loadingFrames++;
  const { view, option, choices: picks } = task.plan;
  const frame = document.createElement("iframe");
  task.frame = frame;
  frame.title = `${view.caption || view.label || "Page"} / ${option === "now" ? "Current" : option.toUpperCase()}`;
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  const file = view.file?.replaceAll("{option}", option);
  const split = file?.indexOf("#") ?? -1;
  /** @type {import("../client/protocol.d.ts").FrameConfig} */
  const config = {
    prismal: 1,
    choices: picks,
    state: view.state || {},
    route: split >= 0 ? file.slice(split) : "",
  };
  frame.name = JSON.stringify(config);
  ownedFrames.add(task);
  if (file) {
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    task.origin = "null";
    frame.srcdoc = data.files[data.fileIds[split >= 0 ? file.slice(0, split) : file]];
  } else {
    const url = new URL(view.url, manifest.base);
    task.origin = url.origin;
    frame.src = url.href;
  }
  task.record.clip.append(frame);
  layoutFrame(task);
  task.swapTimer = window.setTimeout(() => activateFrame(task), FRAME_SWAP_DELAY);
  task.failTimer = window.setTimeout(
    () => failFrame(task, "This page has not connected."),
    FRAME_READY_TIMEOUT,
  );
}
function pumpFrames() {
  for (const record of frameRecords.values()) {
    const task = record.pending;
    if (loadingFrames >= MAX_LOADING_FRAMES) break;
    if (record.visible && task && !task.frame && !task.disposed) startFrame(task);
  }
}
/** @param {FrameRecord} record @param {FramePlan} plan */
function requestFrame(record, plan) {
  disposeFrame(record.pending === record.active ? null : record.pending);
  record.card.classList.remove("frame-error");
  record.card.setAttribute("aria-busy", "true");
  record.status.innerHTML = `<span class="loading-line"></span><span>Loading the live page</span>`;
  record.status.hidden = Boolean(record.active);
  record.pending = { record, plan, loading: false, ready: false, disposed: false, height: 0 };
  if (record.active?.error) {
    disposeFrame(record.active);
    record.active = null;
    record.status.hidden = false;
  }
  pumpFrames();
}
/** @param {string} key @returns {FrameRecord} */
function createFrameRecord(key) {
  const card = document.createElement("section");
  card.className = "frame-card";
  card.dataset.key = key;
  const caption = document.createElement("div");
  caption.className = "frame-caption";
  const body = document.createElement("div");
  body.className = "frame-body";
  const clip = document.createElement("div");
  clip.className = "frame-viewport";
  const status = document.createElement("div");
  status.className = "frame-status";
  status.setAttribute("role", "status");
  body.append(clip, status);
  card.append(caption, body);
  return { card, caption, body, clip, status, active: null, pending: null, visible: false };
}
function syncFrames() {
  const wanted = new Set(framePlans.map((plan) => plan.key));
  for (const [key, record] of frameRecords) {
    if (wanted.has(key)) continue;
    frameObserver.unobserve(record.card);
    frameResize.unobserve(record.card);
    disposeFrame(record.pending);
    disposeFrame(record.active);
    frameRecords.delete(key);
  }
  for (const plan of framePlans) {
    let record = frameRecords.get(plan.key);
    if (!record) {
      record = createFrameRecord(plan.key);
      frameRecords.set(plan.key, record);
      frameObserver.observe(record.card);
      frameResize.observe(record.card);
    }
    document.getElementById(plan.slot)?.replaceWith(record.card);
    const label = plan.label || (plan.option === "now" ? "Current" : plan.option.toUpperCase());
    record.caption.innerHTML = `<span>${escapeHTML(plan.view.caption || plan.view.label || "Page")} <span class="muted">/ ${escapeHTML(label)}</span></span><code>${escapeHTML(frameRoute(plan.view))}</code>`;
    const signature = JSON.stringify({
      view: plan.view,
      option: plan.option,
      choices: plan.choices,
      full: plan.full,
    });
    if (signature !== record.signature) {
      record.signature = signature;
      requestFrame(record, plan);
    } else {
      const task = record.pending || record.active;
      const controlsChanged =
        task &&
        (task.plan.inspect !== plan.inspect ||
          JSON.stringify(task.plan.highlight) !== JSON.stringify(plan.highlight));
      if (record.active) record.active.plan = plan;
      if (record.pending) record.pending.plan = plan;
      if (controlsChanged && task.ready) initFrame(task);
      layoutFrame(record.active || record.pending);
    }
  }
  pumpFrames();
}

/** @param {unknown} value @returns {value is InventoryItem} */
function isInventoryItem(value) {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.group === "string" &&
    typeof value.count === "number" &&
    Number.isInteger(value.count) &&
    value.count > 0
  );
}
/** @param {Record<string, unknown>} payload @returns {ClientEvent | null} */
function readClientEvent(payload) {
  switch (payload.type) {
    case "ready":
      if (typeof payload.title === "string" && typeof payload.route === "string")
        return { type: "ready", title: payload.title, route: payload.route };
      break;
    case "size":
      if (
        typeof payload.width === "number" &&
        Number.isFinite(payload.width) &&
        typeof payload.height === "number" &&
        Number.isFinite(payload.height) &&
        payload.height > 0
      )
        return { type: "size", width: payload.width, height: payload.height };
      break;
    case "rect": {
      const dimensions = [payload.top, payload.left, payload.width, payload.height];
      if (
        dimensions.every((value) => typeof value === "number") &&
        dimensions.every((value) => Number.isFinite(value) && value >= 0)
      ) {
        const [top, left, width, height] = dimensions;
        return { type: "rect", top, left, width, height };
      }
      break;
    }
    case "error":
      if (typeof payload.message === "string") return { type: "error", message: payload.message };
      break;
    case "inventory":
      if (Array.isArray(payload.items) && typeof payload.route === "string")
        return {
          type: "inventory",
          items: payload.items.filter(isInventoryItem),
          route: payload.route,
        };
      break;
    case "picked":
      if (
        typeof payload.name === "string" &&
        typeof payload.route === "string" &&
        typeof payload.text === "string" &&
        typeof payload.index === "number" &&
        Number.isInteger(payload.index) &&
        payload.index >= 0
      )
        return {
          type: "picked",
          name: payload.name,
          route: payload.route,
          text: payload.text,
          index: payload.index,
          group: typeof payload.group === "string" ? payload.group : "",
          what: typeof payload.what === "string" ? payload.what : "",
        };
  }
  return null;
}

addEventListener("message", (event) => {
  if (!isRecord(event.data) || event.data.prismal !== 1) return;
  const task = [...ownedFrames].find((entry) => entry.frame.contentWindow === event.source);
  if (!task || task.disposed || event.origin !== task.origin) return;
  const record = task.record;
  if (record.pending !== task && record.active !== task) return;
  const payload = readClientEvent(event.data);
  if (!payload) return;
  if (payload.type === "ready" && !task.error) {
    task.ready = true;
    if ((record.pending || record.active) === task) record.card.setAttribute("aria-busy", "false");
    finishLoading(task);
    initFrame(task);
    record.caption.querySelector("code").textContent = payload.route;
    activateFrame(task);
    if (record.pending === task) record.pending = null;
  } else if (payload.type === "size") {
    task.height = Math.min(MAX_FRAME_HEIGHT, payload.height);
    layoutFrame(task);
  } else if (payload.type === "rect") {
    task.rect = payload;
    layoutFrame(task);
  } else if (payload.type === "error") {
    failFrame(task, payload.message);
  }
  task.plan.onMessage?.(task, payload);
});
