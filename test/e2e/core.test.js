// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { clickPreview, launchBrowser } from "./browser.js";
import { build } from "../../lib/build.js";
import { choicesSchema, valid } from "../schema.js";

let browser, directory, lab;
before(async () => {
  browser = await launchBrowser();
  directory = await mkdtemp(join(tmpdir(), "prismal-e2e-"));
  const result = await build(resolve("examples/lumen/prismal.json"), {
    output: join(directory, "lab.html"),
  });
  lab = pathToFileURL(result.output).href;
});
after(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function settled(page, count) {
  await page.waitForFunction((n) => {
    const cards = [...document.querySelectorAll(".frame-card")];
    return (
      cards.length === n &&
      cards.every(
        (card) =>
          card.getAttribute("aria-busy") === "false" &&
          card.querySelector("iframe")?.style.opacity === "1" &&
          card.querySelector(".frame-status")?.hidden,
      )
    );
  }, count);
}
test("offline decisions: real variants, keys, comparison, notes, export, import and autosave", async () => {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${lab}#/d/hero/b`);
  await settled(page, 2);
  assert.equal(await page.title(), "Lumen · Prismal");
  assert.equal(await page.locator("h1").textContent(), "The first impression");
  assert.equal(await page.frames()[1].locator("html").getAttribute("data-prismal-hero"), "b");
  assert.match(await page.frames()[1].locator(".hero h1").textContent(), /room to think/);
  await page.locator("#tab-b").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.locator("#tab-b").evaluate((element) => getComputedStyle(element).outlineWidth),
    "2px",
  );
  await page.locator('[data-action="pick"]').click();
  await page.locator('[data-action="like"]').click();
  await page.locator("textarea").fill("Keep the calm notebook, and borrow A's examples.");
  await page.locator("textarea").press("ArrowRight");
  assert.match(page.url(), /\/hero\/b$/);
  const downloadEvent = page.waitForEvent("download");
  await page.locator(".rail [data-action=export]").click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "prismal-choices-r1.json");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(valid(choicesSchema, exported), true);
  assert.equal(exported.prismal, 1);
  assert.equal(exported.decisions[0].pick, "b");
  assert.deepEqual(exported.decisions[0].liked, ["b"]);
  assert.match(exported.decisions[0].note, /borrow A/);
  await page.reload();
  await settled(page, 2);
  assert.equal(await page.locator('[data-action="pick"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('[data-action="like"]').getAttribute("aria-pressed"), "true");
  await page.locator('[data-action="beside"]').click();
  await settled(page, 4);
  assert.deepEqual(
    (
      await Promise.all(
        page
          .frames()
          .slice(1)
          .map((frame) => frame.locator("html").getAttribute("data-prismal-hero")),
      )
    ).sort(),
    ["b", "b", "now", "now"],
  );
  await page.locator('[data-action="focus"]').click();
  await page.locator(".frame-card").last().scrollIntoViewIfNeeded();
  await settled(page, 4);
  assert.equal(await page.locator(".bezel").count(), 2);
  await page.locator('[data-action="beside"]').click();
  await page.locator('[data-action="option"][data-option="now"]').click();
  await page.getByRole("button", { name: "Keep Now", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Keep Now", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("h1").click();
  await page.keyboard.press("ArrowRight");
  await page.waitForURL(/\/hero\/a$/);
  await page.locator('#tab-a[aria-selected="true"]').waitFor();
  await page.keyboard.press("l");
  assert.equal(await page.locator('[data-action="like"]').getAttribute("aria-pressed"), "true");
  await page.locator("#import-file").setInputFiles({
    name: "choices.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.waitForFunction(() => document.getElementById("toast").textContent === "Choices imported.");
  await page.locator('[data-action="option"][data-option="b"]').click();
  await page.locator('#tab-b[aria-selected="true"]').waitFor();
  assert.equal(await page.locator('[data-action="pick"]').getAttribute("aria-pressed"), "true");
  await page.locator("#import-file").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"prismal":1}'),
  });
  await page.waitForFunction(() => document.getElementById("toast").textContent.startsWith("Import failed:"));
  assert.equal(await page.locator('[data-action="pick"]').getAttribute("aria-pressed"), "true");
  await page.goto(`${lab}#/start`);
  assert.equal(await page.locator(".decision-row").count(), 3);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.locator(".mobile-bar [data-action=rail]").click();
  assert.equal(await page.locator(".mobile-bar [data-action=rail]").getAttribute("aria-expanded"), "true");
  await page.goto(`${lab}#/d/hero/e`);
  await page.locator('#tab-e[aria-selected="true"]').waitFor();
  assert.equal(
    await page.locator("#tab-e").evaluate((element) => {
      const tab = element.getBoundingClientRect(),
        strip = element.parentElement.getBoundingClientRect();
      return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
    }),
    true,
  );
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#stage").evaluate((element) => element === document.activeElement), true);
  assert.match(page.url(), /\/hero\/e$/);
  assert.deepEqual(errors, []);
  await context.close();
});
test("the first application script sees choices, state and its srcdoc hash route", async () => {
  const source =
    '<!doctype html><html><head><script>window.first={choice:prismal.choice("hero"),state:prismal.state,route:location.hash};</script></head><body><h1>First script</h1><a href="#/next">Next route</a></body></html>';
  await writeFile(join(directory, "first.html"), source);
  const file = join(directory, "first.json");
  await writeFile(
    file,
    JSON.stringify({
      title: "Bootstrap",
      round: 1,
      decisions: [
        {
          id: "hero",
          title: "Hero",
          question: "Which?",
          views: [{ caption: "Laptop", file: "first.html#/pricing", state: { menu: "open" } }],
          options: [{ id: "a", name: "A" }],
        },
      ],
    }),
  );
  const result = await build(file, { output: join(directory, "first-lab.html") });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${pathToFileURL(result.output).href}#/d/hero/a`);
  await settled(page, 1);
  const frame = page.frames()[1];
  assert.deepEqual(await frame.evaluate(() => window.first), {
    choice: "a",
    state: { menu: "open" },
    route: "#/pricing",
  });
  await clickPreview(page, page.locator(".frame-card iframe"), "a");
  await frame.waitForFunction(() => location.hash === "#/next");
  assert.equal(await frame.evaluate(() => prismal.choice("hero")), "a");
  assert.equal(await page.locator("h1").textContent(), "Hero");
  assert.equal(
    await frame.evaluate(() => {
      try {
        return Boolean(parent.document.body);
      } catch {
        return false;
      }
    }),
    false,
  );
  await context.close();
});
