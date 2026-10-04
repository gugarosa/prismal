// @ts-check
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ID = /^[a-z0-9-]+$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ROOT =
  "$schema title round about base devices defaults decisions questions words elements inspect journeys";
/** @typedef {null | boolean | number | string | JsonArray | JsonObject} JsonValue */
/** @typedef {Array<JsonValue>} JsonArray */
/** @typedef {{[key: string]: JsonValue}} JsonObject */
/** @typedef {{device: string, url?: string, file?: string, state?: JsonObject}} ManifestSource */
/** @typedef {ManifestSource & {caption: string, focus?: string}} ManifestView */
/** @typedef {{id: string, name: string, kind?: "close" | "different" | "current", idea?: string, why?: string, tradeoff?: string}} ManifestOption */
/** @typedef {{id: string, title: string, question: string, views: ManifestView[], options: ManifestOption[]}} ManifestDecision */
/** @typedef {ManifestSource & {label: string}} ManifestInspect */
/** @typedef {ManifestSource & {selector: string, title: string, does?: string, ask?: string}} ManifestJourneyStep */
/** @typedef {{id: string, title: string, steps: ManifestJourneyStep[]}} ManifestJourney */
/** @typedef {{
 * $schema?: string, title: string, round: number, about?: string, base?: string,
 * devices: {[key: string]: [number, number]}, defaults: {[key: string]: string},
 * decisions: ManifestDecision[], inspect: ManifestInspect[], journeys: ManifestJourney[],
 * questions: {id: string, group?: string, question: string, why?: string, choices: string[]}[],
 * words: {id: string, group?: string, term: string, means: string, where?: string[], alternatives?: string[]}[],
 * elements: {name: string, group?: string, selector: string, what?: string}[],
 * }} Manifest */

/** @param {string} path @param {string} message @returns {never} */
function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}
/** @param {unknown} value @param {string} path @param {string} [keys] */
function record(value, path, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "expected object");
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, "expected plain object");
  if (keys)
    for (const key of Object.keys(value))
      if (!keys.split(" ").includes(key)) fail(path, `unknown key "${key}"`);
  return /** @type {Record<string, unknown>} */ (value);
}
/** @param {unknown} value @param {string} path @param {boolean} [nonempty] */
function text(value, path, nonempty = false) {
  if (typeof value !== "string" || (nonempty && !value.trim()))
    fail(path, nonempty ? "expected nonempty string" : "expected string");
  return value;
}
/** @param {unknown} value @param {string} path */
function id(value, path) {
  const result = text(value, path, true);
  if (!ID.test(result)) fail(path, "must match /^[a-z0-9-]+$/");
  return result;
}
/** @param {unknown} value @param {string} path */
function list(value, path) {
  if (!Array.isArray(value)) fail(path, "expected array");
  return value;
}
/** @param {Record<string, unknown>} value @param {string} path @param {string} required @param {string} [optional] */
function strings(value, path, required, optional = "") {
  const result = {};
  for (const key of required.split(" ").filter(Boolean))
    result[key] = text(value[key], `${path}.${key}`, true);
  for (const key of optional.split(" "))
    if (Object.hasOwn(value, key)) result[key] = text(value[key], `${path}.${key}`);
  return result;
}
/** @param {unknown} raw @param {string} path @param {string} keys @param {string} [identity] @returns {[Record<string, unknown>, string][]} */
function entries(raw, path, keys, identity = "id") {
  const seen = new Set();
  return list(raw, path).map((item, index) => {
    const at = `${path}[${index}]`;
    const value = record(item, at, keys);
    if (identity) {
      const name =
        identity === "id"
          ? id(value[identity], `${at}.${identity}`)
          : text(value[identity], `${at}.${identity}`, true);
      if (seen.has(name)) fail(`${at}.${identity}`, `duplicate ${identity} "${name}"`);
      seen.add(name);
    }
    return [value, at];
  });
}
/** @param {unknown} value @param {string} path @param {Set<unknown>} [seen] @returns {JsonValue} */
function json(value, path, seen = new Set()) {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "expected finite JSON number");
    return value;
  }
  if (typeof value !== "object") fail(path, "expected JSON value");
  if (seen.has(value)) fail(path, "must not contain cycles");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (value.length !== Object.keys(value).length) fail(path, "must not contain sparse arrays");
    result = value.map((item, i) => json(item, `${path}[${i}]`, seen));
  } else {
    const object = record(value, path);
    if (Object.getOwnPropertySymbols(object).length) fail(path, "expected string keys");
    result = Object.fromEntries(
      Object.entries(object).map(([key, item]) => [key, json(item, `${path}.${key}`, seen)]),
    );
  }
  seen.delete(value);
  return result;
}
/** @param {string} value @param {string} path */
function absoluteHttp(value, path) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(path, "expected absolute http(s) URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) fail(path, "expected absolute http(s) URL");
  return value;
}
/** @param {Record<string, unknown>} value @param {string} path @param {string | undefined} base @param {Manifest["devices"]} devices */
function source(value, path, base, devices) {
  const device = Object.hasOwn(value, "device") ? text(value.device, `${path}.device`, true) : "laptop";
  if (!Object.hasOwn(devices, device)) fail(`${path}.device`, `unknown device "${device}"`);
  const hasFile = Object.hasOwn(value, "file"),
    hasUrl = Object.hasOwn(value, "url");
  if (!hasFile && !hasUrl) fail(path, 'needs "url" or "file"');
  if (hasFile && hasUrl) fail(path, 'cannot have both "url" and "file"');
  /** @type {ManifestSource} */
  const result = { device };
  if (hasFile) {
    result.file = text(value.file, `${path}.file`, true);
    if (!result.file.split("#")[0].trim()) fail(`${path}.file`, 'path before "#" must not be empty');
  } else {
    result.url = text(value.url, `${path}.url`, true);
    if (SCHEME.test(result.url)) absoluteHttp(result.url, `${path}.url`);
    else {
      if (!base) fail(`${path}.url`, 'relative URL needs "base"');
      let resolved;
      try {
        resolved = new URL(result.url, base);
      } catch {
        fail(`${path}.url`, "expected URL path");
      }
      if (!["http:", "https:"].includes(resolved.protocol)) fail(`${path}.url`, "expected http(s) URL");
    }
  }
  if (Object.hasOwn(value, "state")) {
    record(value.state, `${path}.state`);
    result.state = /** @type {JsonObject} */ (json(value.state, `${path}.state`));
  }
  return result;
}
/** Strict validation, with normalized defaults and an unchanged input. @param {unknown} raw @returns {Manifest} */
export function normalizeManifest(raw) {
  const value = record(raw, "manifest", ROOT);
  const section = (key) => (Object.hasOwn(value, key) ? value[key] : []);
  const stringList = (values, at) => list(values, at).map((item, i) => text(item, `${at}[${i}]`, true));
  const base = Object.hasOwn(value, "base")
    ? absoluteHttp(text(value.base, "base", true), "base")
    : undefined;
  /** @type {Manifest["devices"]} */
  const devices = { laptop: [1440, 900], phone: [390, 844] };
  for (const [name, size] of Object.entries(
    Object.hasOwn(value, "devices") ? record(value.devices, "devices") : {},
  )) {
    if (!name.trim()) fail("devices", "device names must be nonempty");
    if (!Array.isArray(size) || size.length !== 2 || size.some((n) => !Number.isInteger(n) || n < 1))
      fail(`devices.${name}`, "expected [positive width, positive height]");
    Object.defineProperty(devices, name, {
      value: [size[0], size[1]],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  const defaults = Object.fromEntries(
    Object.entries(Object.hasOwn(value, "defaults") ? record(value.defaults, "defaults") : {}).map(
      ([key, option]) => [id(key, `defaults.${key}`), id(option, `defaults.${key}`)],
    ),
  );
  const decisions = entries(value.decisions, "decisions", "id title question views options").map(
    ([d, at]) => {
      const views = list(d.views, `${at}.views`);
      if (!views.length) fail(`${at}.views`, "must not be empty");
      const options = entries(d.options, `${at}.options`, "id name kind idea why tradeoff").map(([o, op]) => {
        const kind = Object.hasOwn(o, "kind")
          ? text(o.kind, `${op}.kind`)
          : o.id === "now"
            ? "current"
            : "close";
        if (!["close", "different", "current"].includes(kind))
          fail(`${op}.kind`, 'expected "close", "different", or "current"');
        if (o.id === "now" && kind !== "current") fail(`${op}.kind`, '"now" must use kind "current"');
        if (o.id !== "now" && kind === "current") fail(`${op}.kind`, 'kind "current" is reserved for "now"');
        return {
          id: String(o.id),
          name: text(o.name, `${op}.name`, true),
          ...strings(o, op, "", "idea why tradeoff"),
          kind,
        };
      });
      const proposals = options.filter((o) => o.id !== "now").length;
      if (proposals < 1 || proposals > 6) fail(`${at}.options`, "needs 1 to 6 non-now options");
      if (!options.some((o) => o.id === "now"))
        options.unshift({ id: "now", name: "Current", kind: "current" });
      options.sort((a, b) => Number(b.id === "now") - Number(a.id === "now"));
      return {
        ...strings(d, at, "id title question"),
        options,
        views: views.map((v, i) => {
          const vp = `${at}.views[${i}]`,
            view = record(v, vp, "caption device url file focus state");
          /** @type {ManifestView} */
          const result = {
            caption: text(view.caption, `${vp}.caption`, true),
            ...source(view, vp, base, devices),
          };
          if (Object.hasOwn(view, "focus")) result.focus = text(view.focus, `${vp}.focus`, true);
          return result;
        }),
      };
    },
  );
  const inspect = entries(section("inspect"), "inspect", "label device url file state", "label").map(
    ([v, at]) => ({ label: String(v.label), ...source(v, at, base, devices) }),
  );
  const questions = entries(section("questions"), "questions", "id group question why choices").map(
    ([q, at]) => {
      const choices = stringList(q.choices, `${at}.choices`);
      if (!choices.length) fail(`${at}.choices`, "must not be empty");
      return { ...strings(q, at, "id question", "group why"), choices };
    },
  );
  const words = entries(section("words"), "words", "id group term means where alternatives").map(
    ([w, at]) => {
      const result = strings(w, at, "id term means", "group");
      if (Object.hasOwn(w, "where"))
        result.where = stringList(w.where, `${at}.where`).map((label, i) => {
          if (!inspect.some((route) => route.label === label))
            fail(`${at}.where[${i}]`, `unknown inspect label "${label}"`);
          return label;
        });
      if (Object.hasOwn(w, "alternatives"))
        result.alternatives = stringList(w.alternatives, `${at}.alternatives`);
      return result;
    },
  );
  const elements = entries(section("elements"), "elements", "name group selector what", "name").map(
    ([e, at]) => strings(e, at, "name selector", "group what"),
  );
  const journeys = entries(section("journeys"), "journeys", "id title steps").map(([j, at]) => {
    const steps = list(j.steps, `${at}.steps`);
    if (!steps.length) fail(`${at}.steps`, "must not be empty");
    return {
      ...strings(j, at, "id title"),
      steps: entries(steps, `${at}.steps`, "url file state selector title does ask device", "").map(
        ([step, st]) => ({
          ...strings(step, st, "selector title", "does ask"),
          ...source(step, st, base, devices),
        }),
      ),
    };
  });
  if (!Number.isInteger(value.round) || Number(value.round) < 1) fail("round", "expected positive integer");
  return /** @type {Manifest} */ ({
    ...strings(value, "manifest", "", "$schema about"),
    title: text(value.title, "title", true),
    round: value.round,
    devices,
    defaults,
    decisions,
    inspect,
    questions,
    words,
    elements,
    journeys,
    ...(base ? { base } : {}),
  });
}

/** Loads an explicit manifest or the standard lookup locations. @param {string} [inputPath] */
export async function loadManifest(inputPath) {
  const paths =
    inputPath === undefined
      ? [resolve("prismal/prismal.json"), resolve("prismal.json")]
      : [resolve(inputPath)];
  for (const path of paths) {
    let source;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if (inputPath === undefined && error.code === "ENOENT") continue;
      throw new Error(`Could not read manifest ${path}: ${error.message}`, { cause: error });
    }
    let raw;
    try {
      raw = JSON.parse(source);
    } catch (error) {
      throw new Error(`Invalid JSON in manifest ${path}: ${error.message}`, { cause: error });
    }
    try {
      return { manifest: normalizeManifest(raw), path };
    } catch (error) {
      throw new Error(`Invalid manifest ${path}: ${error.message}`, { cause: error });
    }
  }
  throw new Error(`Manifest not found. Looked for ${paths.join(" and ")}`);
}
