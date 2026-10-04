// @ts-check
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadManifest } from "./manifest.js";

const SHELL_ASSETS = [
  "shell/lab.html",
  "shell/lab.css",
  "client/prismal.js",
  "shell/icons.js",
  "shell/state.js",
  "shell/frames.js",
  "shell/inspect.js",
  "shell/pages.js",
  "shell/main.js",
];

/** @typedef {{key: string, absolute: string, context: string}} LocalReference */
/** @typedef {{manifest: import("./manifest.js").Manifest, files: string[], fileIds: Record<string, number>}} BuildData */

/** @param {string} relative */
async function readAsset(relative) {
  try {
    return await readFile(new URL(`../${relative}`, import.meta.url), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read build asset ${relative}: ${detail}`, { cause: error });
  }
}
/** @param {string} source */
function escapeEmbeddedScript(source) {
  return source.replace(/<\/script/gi, "<\\/script");
}
/** @param {string} html @param {string} client */
function inlineSource(html, client) {
  const tokens =
    /<!--[\s\S]*?-->|<(script|style|textarea|title)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const withoutBases = html.replace(tokens, (tag) => (/^<base\b/i.test(tag) ? "" : tag));
  const tags = [...withoutBases.matchAll(tokens)];
  const injection = `<base href="about:srcdoc">\n<script>${escapeEmbeddedScript(client)}</script>`;
  const head = tags.find((tag) => /^<head\b/i.test(tag[0]));
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return `${withoutBases.slice(0, at)}\n${injection}${withoutBases.slice(at)}`;
  }
  const htmlTag = tags.find((tag) => /^<html\b/i.test(tag[0]));
  if (htmlTag?.index !== undefined) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${withoutBases.slice(0, at)}\n<head>${injection}</head>${withoutBases.slice(at)}`;
  }
  const doctype = /^(\uFEFF?\s*<!doctype\b[^>]*>)/i.exec(withoutBases);
  if (doctype) {
    return `${doctype[0]}\n<head>${injection}</head>${withoutBases.slice(doctype[0].length)}`;
  }
  return `<head>${injection}</head>\n${withoutBases}`;
}
/** @param {string} shell @param {string} marker @param {string} replacement */
function replacePlaceholder(shell, marker, replacement) {
  const first = shell.indexOf(marker);
  if (first < 0 || first !== shell.lastIndexOf(marker)) {
    throw new Error(`Build shell must contain exactly one ${marker} placeholder`);
  }
  return shell.replace(marker, () => replacement);
}
/** @param {string} file @param {string} option @param {string} root @param {string} context */
function localReference(file, option, root, context) {
  const expanded = file.replaceAll("{option}", option);
  const hash = expanded.indexOf("#");
  const key = hash < 0 ? expanded : expanded.slice(0, hash);
  if (key.trim() === "") throw new Error(`${context}: file path before "#" must not be empty`);
  return { key, absolute: resolve(root, key), context };
}
/** @param {ReturnType<typeof import("./manifest.js").normalizeManifest>} manifest @param {string} root */
function collectReferences(manifest, root) {
  /** @type {LocalReference[]} */
  const references = [];
  /** @param {string | undefined} file @param {string} option @param {string} context */
  const add = (file, option, context) => {
    if (file) references.push(localReference(file, option, root, context));
  };
  manifest.decisions.forEach((decision, decisionIndex) => {
    decision.options.forEach((option) => {
      decision.views.forEach((view, viewIndex) => {
        add(view.file, option.id, `decisions[${decisionIndex}].views[${viewIndex}] option "${option.id}"`);
      });
    });
  });
  manifest.inspect.forEach((route, index) => add(route.file, "now", `inspect[${index}]`));
  manifest.journeys.forEach((journey, journeyIndex) =>
    journey.steps.forEach((step, stepIndex) =>
      add(step.file, "now", `journeys[${journeyIndex}].steps[${stepIndex}]`),
    ),
  );
  return references;
}
/** @param {LocalReference} reference */
async function readSource(reference) {
  try {
    return await readFile(reference.absolute, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${reference.context} file ${JSON.stringify(reference.key)}: ${detail}`, {
      cause: error,
    });
  }
}

/**
 * Builds a self-contained review lab.
 * @param {string} [inputPath]
 * @param {{output?: string}} [options]
 */
export async function build(inputPath, options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("build options: expected object");
  }
  if (options.output !== undefined && typeof options.output !== "string") {
    throw new TypeError("build output: expected string");
  }

  const { manifest, path } = await loadManifest(inputPath);
  const root = dirname(path);
  const output = options.output === undefined ? resolve(root, "lab.html") : resolve(options.output);
  const references = collectReferences(manifest, root);
  /** @type {Map<string, {index: number, reference: LocalReference}>} */
  const unique = new Map();
  for (const reference of references) {
    if (!unique.has(reference.absolute)) {
      unique.set(reference.absolute, { index: unique.size, reference });
    }
  }
  let outputTarget = output;
  try {
    outputTarget = await realpath(output);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const inputTargets = await Promise.all(
    [path, ...unique.keys()].map(async (file) => {
      try {
        return await realpath(file);
      } catch (error) {
        if (error.code === "ENOENT") return file;
        throw error;
      }
    }),
  );
  if (inputTargets.includes(outputTarget)) {
    throw new Error(`Refusing to overwrite build input ${output}`);
  }

  const entries = [...unique.values()];
  const [assets, rawFiles] = await Promise.all([
    Promise.all(SHELL_ASSETS.map(readAsset)),
    Promise.all(entries.map(({ reference }) => readSource(reference))),
  ]);
  const [shell, style, client, ...scripts] = assets;
  const files = rawFiles.map((file) => inlineSource(file, client));
  const fileIds = Object.fromEntries(
    references.map((reference) => [reference.key, unique.get(reference.absolute)?.index]),
  );
  /** @type {BuildData} */
  const data = { manifest, files, fileIds };
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const title = manifest.title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  let html = shell;
  html = replacePlaceholder(html, "<!--PRISMAL_TITLE-->", title);
  html = replacePlaceholder(html, "<!--PRISMAL_STYLE-->", `<style>${style}</style>`);
  html = replacePlaceholder(
    html,
    "<!--PRISMAL_DATA-->",
    `<script type="application/json" id="prismal-data">${json}</script>`,
  );
  html = replacePlaceholder(
    html,
    "<!--PRISMAL_SCRIPT-->",
    `<script>(() => {\n${escapeEmbeddedScript(scripts.join("\n;\n"))}\n})();</script>`,
  );

  try {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, html, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not write build output ${output}: ${detail}`, { cause: error });
  }

  const dependencies = [path, ...entries.map(({ reference }) => reference.absolute)].filter(
    (dependency, index, all) => all.indexOf(dependency) === index,
  );
  const optionsCount = manifest.decisions.reduce((total, decision) => total + decision.options.length, 0);
  const decisionFrames = manifest.decisions.reduce(
    (total, decision) => total + decision.views.length * decision.options.length,
    0,
  );
  const journeyFrames = manifest.journeys.reduce((total, journey) => total + journey.steps.length, 0);
  const stats = {
    decisions: manifest.decisions.length,
    options: optionsCount,
    frames: decisionFrames + manifest.inspect.length + journeyFrames,
    bytes: Buffer.byteLength(html),
  };
  return { output, manifest, data, dependencies, stats };
}
