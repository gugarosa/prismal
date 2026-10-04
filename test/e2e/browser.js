// @ts-check
import { chromium, firefox, webkit } from "playwright";

export function launchBrowser() {
  const engine = { chromium, firefox, webkit }[process.env.PRISMAL_BROWSER || "chromium"];
  if (!engine) throw new Error("Unknown PRISMAL_BROWSER");
  return engine.launch({
    ...(process.env.PRISMAL_CHANNEL ? { channel: process.env.PRISMAL_CHANNEL } : {}),
    ...(process.env.PRISMAL_EXECUTABLE ? { executablePath: process.env.PRISMAL_EXECUTABLE } : {}),
  });
}

/** Stable Chromium channels report unscaled frame locator boxes; use the real viewport transform. */
async function previewPoint(page, iframe, selector) {
  const target = iframe.contentFrame().locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await target.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const rect = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, viewport: innerWidth };
  });
  const box = await iframe.boundingBox();
  const scale = box.width / rect.viewport;
  return {
    x: box.x + (rect.x + rect.width / 2) * scale,
    y: box.y + (rect.y + rect.height / 2) * scale,
  };
}

export async function clickPreview(page, iframe, selector) {
  const point = await previewPoint(page, iframe, selector);
  await page.mouse.click(point.x, point.y);
}

export async function hoverPreview(page, iframe, selector) {
  const point = await previewPoint(page, iframe, selector);
  await page.mouse.move(point.x, point.y);
}
