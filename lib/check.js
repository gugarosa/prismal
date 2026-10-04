// @ts-check
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "./build.js";

/** @typedef {"error" | "warning"} ProblemLevel */
/** @typedef {{level: ProblemLevel, context: string, message: string}} Problem */
/** @typedef {import("./manifest.js").Manifest} Manifest */
/** @typedef {import("./build.js").BuildData} BuildData */
/** @typedef {import("./manifest.js").ManifestSource} Source */
const PLAYWRIGHT_MESSAGE = "check needs Playwright: npm i -D playwright && npx playwright install chromium";
const HARNESS = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: 100%; background: #fff; }
  iframe { display: block; border: 0; }
</style>
<script>
window.mount = (plan) => {
  const state = window.__prismalCheck = { ready: false, errors: [] };
  const frame = document.createElement("iframe");
  frame.name = JSON.stringify(plan.name);
  frame.width = String(plan.width);
  frame.height = String(plan.height);
  frame.style.width = plan.width + "px";
  frame.style.height = plan.height + "px";

  addEventListener("message", (event) => {
    const data = event.data;
    if (
      event.source !== frame.contentWindow ||
      event.origin !== plan.origin ||
      !data || typeof data !== "object" || data.prismal !== 1
    ) return;

    if (data.type === "ready") {
      state.ready = true;
      frame.contentWindow.postMessage({
        prismal: 1,
        type: "init",
        elements: plan.elements,
        inspect: false,
        focus: plan.focus,
        highlight: null
      }, plan.origin === "null" ? "*" : plan.origin);
    } else if (
      data.type === "size" && !plan.fixed &&
      Number.isFinite(data.height) && data.height > 0
    ) {
      frame.height = String(Math.max(plan.height, Math.min(30000, data.height)));
      frame.style.height = frame.height + "px";
    } else if (data.type === "error" && typeof data.message === "string") {
      state.errors.push(data.message);
    }
  });

  if (plan.html !== null) {
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.srcdoc = plan.html;
  } else {
    frame.src = plan.url;
  }
  document.body.append(frame);
};
</script>`;

/** @param {unknown} error */
const detail = (error) => (error instanceof Error ? error.message : String(error));

function resolveChromium() {
  const loaders = [createRequire(resolve(process.cwd(), "package.json")), createRequire(import.meta.url)];
  for (const name of ["playwright", "playwright-core"]) {
    for (const loader of loaders) {
      let path;
      try {
        path = loader.resolve(name);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "";
        const first = detail(error).split("\n")[0];
        const missing =
          (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") &&
          (first === `Cannot find module '${name}'` || first.startsWith(`Cannot find package '${name}'`));
        if (missing) continue;
        throw error;
      }
      const loaded = loader(path);
      if (!loaded.chromium || typeof loaded.chromium.launch !== "function")
        throw new Error(`${name} does not provide a Chromium launcher`);
      return { chromium: loaded.chromium, core: name === "playwright-core" };
    }
  }
  throw new Error(PLAYWRIGHT_MESSAGE);
}

/** @param {Manifest} manifest @param {BuildData} data @param {Source} view @param {string} option @param {string} focus */
function planFor(manifest, data, view, option, focus) {
  const device = view.device || "laptop";
  const [width, height] = manifest.devices[device];
  /** @type {import("../client/protocol.d.ts").FrameConfig} */
  const name = { prismal: 1, choices: { ...manifest.defaults }, state: view.state || {}, route: "" };
  let html = null;
  let url = "";
  let origin = "";
  if (view.file) {
    const expanded = view.file.replaceAll("{option}", option);
    const hash = expanded.indexOf("#");
    const file = hash < 0 ? expanded : expanded.slice(0, hash);
    name.route = hash < 0 ? "" : expanded.slice(hash);
    const id = data.fileIds[file];
    if (!Number.isInteger(id) || typeof data.files[id] !== "string")
      throw new Error(`Built source ${JSON.stringify(file)} is missing`);
    html = data.files[id];
    origin = "null";
  } else {
    const parsed = manifest.base ? new URL(view.url, manifest.base) : new URL(view.url);
    url = parsed.href;
    origin = parsed.origin;
  }
  const fixed = device === "phone";
  const elements = manifest.elements;
  return { width, height, fixed, name, html, url, origin, focus, elements };
}

/** @param {import("playwright").Frame} frame @param {string} focus @param {string[]} selectors */
async function inspectSource(frame, focus, selectors) {
  return frame.evaluate(
    async ({ focus: wanted, selectors: registered }) => {
      const style = document.createElement("style");
      style.textContent =
        "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}";
      (document.head || document.documentElement).append(style);
      await Promise.race([
        document.fonts.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Fonts did not finish loading within 3 seconds.")), 3000),
        ),
      ]);
      await Promise.race([
        Promise.all(
          [...document.images]
            .filter((image) => !image.complete)
            .map(
              (image) =>
                new Promise((done) => {
                  for (const type of ["load", "error"]) image.addEventListener(type, done, { once: true });
                }),
            ),
        ),
        new Promise((done) => setTimeout(done, 3000)),
      ]);
      dispatchEvent(new Event("resize"));
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const visible = (element) => {
        const { width, height } = element.getBoundingClientRect();
        return (
          width * height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        );
      };
      const body = document.body;
      const visual =
        body && [...body.querySelectorAll("img,svg,canvas,video,input,button,select,textarea")].some(visible);
      let focusResult = null;
      if (wanted) {
        try {
          const element = document.querySelector(wanted);
          focusResult = element ? (visible(element) ? "visible" : "hidden") : "missing";
        } catch (error) {
          focusResult = `invalid: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      const matches = registered.map((selector) => {
        try {
          return { count: document.querySelectorAll(selector).length, error: "" };
        } catch (error) {
          return { count: 0, error: error instanceof Error ? error.message : String(error) };
        }
      });
      return {
        empty: !body || (!(body.innerText || "").trim() && !visual),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        focus: focusResult,
        matches,
        images: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
      };
    },
    { focus, selectors },
  );
}

/** @param {import("playwright").BrowserContext} context @param {string} harnessUrl @param {ReturnType<typeof planFor>} plan @param {string} label @param {(level: ProblemLevel, context: string, message: string) => void} problem @param {{focusName?: string, selectors?: string[], capture?: {path?: string, fullPage: boolean}}} [options] */
async function runSource(context, harnessUrl, plan, label, problem, options = {}) {
  const page = await context.newPage();
  /** @type {{kind: string, message: string}[]} */
  const signals = [];
  const signal = (kind, message) => signals.push({ kind, message });
  page.on("pageerror", (error) => signal("Page error", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") signal("Console error", message.text());
  });
  page.on("requestfailed", (request) =>
    signal("Network request failed", `${request.url()} (${request.failure()?.errorText || "unknown error"})`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) signal("HTTP resource failed", `${response.status()} ${response.url()}`);
  });
  /** @type {Buffer | undefined} */
  let screenshot;
  /** @type {{count: number, error: string}[]} */
  let matches = [];
  try {
    await page.setViewportSize({ width: plan.width, height: plan.height });
    await page.goto(harnessUrl);
    await page.evaluate((value) => Reflect.get(globalThis, "mount")(JSON.parse(value)), JSON.stringify(plan));
    try {
      await page.waitForFunction(() => Reflect.get(globalThis, "__prismalCheck")?.ready, null, {
        timeout: 8000,
      });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
      problem("error", label, "Page did not connect within 8 seconds.");
    }
    const source = page.frames().find((frame) => frame.parentFrame() === page.mainFrame());
    if (!source) {
      problem("error", label, "Source frame did not load.");
    } else {
      const finding = await inspectSource(source, plan.focus, options.selectors || []);
      matches = finding.matches;
      if (finding.empty) problem("error", label, "Rendered body is empty.");
      if (finding.images)
        problem("error", label, `${finding.images} images failed to load or are still pending.`);
      if (finding.overflow > 1)
        problem("error", label, `Horizontal overflow is ${Math.ceil(finding.overflow)}px.`);
      if (finding.focus && finding.focus !== "visible") {
        const name = options.focusName || "Focus selector";
        problem("error", label, `${name} ${JSON.stringify(plan.focus)} is ${finding.focus}.`);
      }
      await page.waitForTimeout(30);
      if (options.capture) {
        screenshot = await page.screenshot({
          fullPage: options.capture.fullPage,
          animations: "disabled",
          caret: "hide",
          ...(options.capture.path ? { path: options.capture.path } : {}),
        });
      }
    }
  } catch (error) {
    problem("error", label, `Could not check page: ${detail(error)}`);
  } finally {
    try {
      const state = await page.evaluate(() => Reflect.get(globalThis, "__prismalCheck"));
      for (const message of state?.errors || []) problem("error", label, `Client error: ${message}`);
    } catch (error) {
      problem("error", label, `Could not read client diagnostics: ${detail(error)}`);
    }
    const seen = new Set();
    for (const signal of signals) {
      const key = `${signal.kind}\0${signal.message}`;
      if (!seen.has(key)) problem("error", label, `${signal.kind}: ${signal.message}`);
      seen.add(key);
    }
    await page.close();
  }
  return { screenshot, matches };
}

/** @param {import("playwright").BrowserContext} context @param {string} labUrl @param {(level: ProblemLevel, context: string, message: string) => void} problem */
async function smokeLab(context, labUrl, problem) {
  const page = await context.newPage();
  let current = "lab";
  page.on("pageerror", (error) => problem("error", current, `Page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problem("error", current, `Console error: ${message.text()}`);
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${labUrl}#/start`);
    const routes = await page
      .locator(".rail a.nav-link")
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")).filter((href) => href?.startsWith("#/")),
      );
    for (const route of [...new Set(routes)]) {
      current = `lab/${route.slice(2) || "start"}`;
      try {
        await page.goto(`${labUrl}${route}`);
        await page.waitForFunction(() => {
          const stage = document.getElementById("stage");
          const heading = stage?.querySelector("h1");
          if (!stage || !heading || !heading.getClientRects().length) return false;
          const copy = stage.cloneNode(true);
          if (copy instanceof Element)
            copy
              .querySelectorAll(".frame-status,.loading-line,script,style")
              .forEach((node) => node.remove());
          return Boolean(copy.textContent?.trim());
        });
        for (const card of await page.locator(".frame-card").all()) {
          await card.scrollIntoViewIfNeeded();
          await page.waitForFunction(
            (element) => element?.getAttribute("aria-busy") === "false",
            await card.elementHandle(),
            { timeout: 9000 },
          );
          await card.locator(".frame-status").waitFor({ state: "hidden", timeout: 9000 });
        }
      } catch (error) {
        problem("error", current, `Lab route failed: ${detail(error)}`);
      }
    }
  } finally {
    await page.close();
  }
}

/** Builds and browser-checks a Prismal round. @param {string} [inputPath] @param {{shots?: string, log?: (line: string) => void}} [options] @returns {Promise<{failures: number, warnings: number, frames: number, problems: Problem[]}>} */
export async function check(inputPath, options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("check options: expected object");
  if (options.shots !== undefined && typeof options.shots !== "string")
    throw new TypeError("check shots: expected string");
  if (options.log !== undefined && typeof options.log !== "function")
    throw new TypeError("check log: expected function");
  const log = options.log || console.log;
  const built = await build(inputPath);
  const shots = options.shots === undefined ? null : resolve(options.shots);
  if (shots) await mkdir(shots, { recursive: true });
  /** @type {Problem[]} */
  const problems = [];
  const problemKeys = new Set();
  const problem = (level, context, message) => {
    const key = `${level}\0${context}\0${message}`;
    if (problemKeys.has(key)) return;
    problemKeys.add(key);
    problems.push({ level, context, message });
    log(`${level.toUpperCase()} ${context}: ${message}`);
  };
  const harness = resolve(dirname(built.output), `.prismal-check-${process.pid}-${randomUUID()}.html`);
  const { chromium, core } = resolveChromium();
  let browser;
  let context;
  let frames = 0;
  try {
    await writeFile(harness, HARNESS, "utf8");
    try {
      browser = core ? await chromium.launch({ channel: "chrome" }) : await chromium.launch();
    } catch (error) {
      const message = `check could not launch Chromium: ${detail(error)}. Install a browser with npx playwright install chromium.`;
      throw new Error(message, { cause: error });
    }
    context = await browser.newContext({ reducedMotion: "reduce" });
    const harnessUrl = pathToFileURL(harness).href;
    for (const decision of built.manifest.decisions) {
      /** @type {(Buffer | undefined)[]} */
      const baselines = [];
      for (const option of decision.options) {
        for (const [index, view] of decision.views.entries()) {
          frames++;
          const label = `${decision.id}/${option.id}/${view.caption}`;
          const plan = planFor(built.manifest, built.data, view, option.id, view.focus || "");
          plan.name.choices[decision.id] = option.id;
          const path = shots ? resolve(shots, `${decision.id}-${option.id}-${index + 1}.png`) : undefined;
          const result = await runSource(context, harnessUrl, plan, label, problem, {
            focusName: "Focus selector",
            capture: { path, fullPage: !plan.fixed },
          });
          if (option.id === "now") baselines[index] = result.screenshot;
          else if (result.screenshot && baselines[index]?.equals(result.screenshot)) {
            problem("error", label, "Option screenshot is byte-identical to Now.");
          }
        }
      }
    }
    const elementMatches = built.manifest.elements.map(() => 0);
    for (const route of built.manifest.inspect) {
      frames++;
      const label = `inspect/${route.label}/${route.device}`;
      const plan = planFor(built.manifest, built.data, route, "now", "");
      const result = await runSource(context, harnessUrl, plan, label, problem, {
        selectors: built.manifest.elements.map((element) => element.selector),
      });
      result.matches.forEach((match, index) => {
        elementMatches[index] += match.count;
        if (match.error)
          problem(
            "error",
            label,
            `Element selector ${JSON.stringify(built.manifest.elements[index].selector)} is invalid: ${match.error}`,
          );
      });
    }
    if (built.manifest.inspect.length)
      built.manifest.elements.forEach((element, index) => {
        if (!elementMatches[index])
          problem("warning", `element/${element.name}`, "No inspect route matches its selector.");
      });
    for (const journey of built.manifest.journeys) {
      for (const [index, step] of journey.steps.entries()) {
        frames++;
        const label = `journey/${journey.id}/${index + 1}`;
        const plan = planFor(built.manifest, built.data, step, "now", step.selector);
        await runSource(context, harnessUrl, plan, label, problem, {
          focusName: "Journey selector",
        });
      }
    }
    await smokeLab(context, pathToFileURL(built.output).href, problem);
  } finally {
    try {
      await context?.close();
    } finally {
      try {
        await browser?.close();
      } finally {
        await rm(harness, { force: true });
      }
    }
  }
  const failures = problems.filter((entry) => entry.level === "error").length;
  const warnings = problems.length - failures;
  log(`Checked ${frames} frames: ${failures} failures, ${warnings} warnings.`);
  return { failures, warnings, frames, problems };
}
