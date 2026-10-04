// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "../../lib/build.js";
import { check } from "../../lib/check.js";
import { launchBrowser } from "./browser.js";

test("shell and checker share bootstrap, source, device and isolation contracts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "prismal-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = await readFile(new URL("../../client/prismal.js", import.meta.url), "utf8");
  const captures = [];
  const pixel = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
  const server = createServer((request, response) => {
    const url = new URL(request.url, origin);
    if (url.pathname === "/record") {
      captures.push(JSON.parse(url.searchParams.get("data")));
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(pixel);
    } else if (url.pathname === "/client.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(client);
    } else {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(source(null, `<script src="${origin}/client.js"></script>`));
    }
  });
  t.after(() => new Promise((done) => server.close(done)));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  function source(option, clientTag = "") {
    return `<!doctype html>
      <html><head>${clientTag}
        <style>
          body { margin: 0; background: white; }
          html[data-prismal-layout="quiet"] body { background: #ddd; }
        </style>
      </head><body><h1>Contract page</h1><script>
        let parentAccessible = false;
        try { parentAccessible = Boolean(parent.document.documentElement); } catch {}
        const snapshot = {
          config: JSON.parse(window.name),
          choice: prismal.choice("layout"),
          state: prismal.state,
          route: location.hash,
          width: innerWidth,
          height: innerHeight,
          sourceOption: ${JSON.stringify(option)},
          parentAccessible
        };
        const report = document.createElement("img");
        report.alt = "";
        report.src = ${JSON.stringify(`${origin}/record?data=`)} + encodeURIComponent(JSON.stringify(snapshot));
        document.body.append(report);
      </script></body></html>`;
  }

  const cases = [
    {
      caption: "Bundled route",
      file: "{option}.html#/file",
      device: "laptop",
      state: { menu: "file", nested: { enabled: true } },
      route: "#/file",
    },
    {
      caption: "Relative live route",
      url: "/preview?prismal.layout=wrong&prismal.state.menu=debug#/relative",
      device: "phone",
      state: { menu: "relative" },
      route: "#/relative",
    },
    {
      caption: "Absolute live route",
      url: `${origin}/preview#/absolute`,
      device: "tablet",
      state: { menu: "absolute", count: 2 },
      route: "#/absolute",
    },
  ];
  const devices = { laptop: [720, 500], phone: [390, 480], tablet: [600, 420] };
  const path = join(directory, "prismal.json");
  await writeFile(
    path,
    JSON.stringify({
      title: "Frame contract",
      round: 1,
      base: origin,
      devices,
      defaults: { settled: "approved", layout: "quiet" },
      decisions: [
        {
          id: "layout",
          title: "Layout",
          question: "Which layout?",
          views: cases.map(({ route: _route, ...view }) => view),
          options: [{ id: "quiet", name: "Quiet" }],
        },
      ],
    }),
  );
  for (const option of ["now", "quiet"]) await writeFile(join(directory, `${option}.html`), source(option));

  function assertCaptures(owner) {
    const seen = new Set();
    for (const snapshot of captures) {
      const example = cases.find((entry) => entry.route === snapshot.route);
      assert.ok(example, `${owner}: unexpected route ${snapshot.route}`);
      assert.ok(["now", "quiet"].includes(snapshot.choice), owner);
      assert.deepEqual(
        snapshot.config,
        {
          prismal: 1,
          choices: { settled: "approved", layout: snapshot.choice },
          state: example.state,
          route: example.file ? example.route : "",
        },
        owner,
      );
      assert.deepEqual(snapshot.state, example.state, owner);
      assert.deepEqual([snapshot.width, snapshot.height], devices[example.device], owner);
      assert.equal(snapshot.sourceOption, example.file ? snapshot.choice : null, owner);
      assert.equal(snapshot.parentAccessible, false, owner);
      seen.add(`${snapshot.route}/${snapshot.choice}`);
    }
    assert.equal(seen.size, cases.length * 2, owner);
  }

  const built = await build(path);
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  for (const option of ["now", "quiet"]) {
    await page.goto(`${pathToFileURL(built.output).href}#/d/layout/${option}`);
    const cards = page.locator(".frame-card");
    assert.equal(await cards.count(), cases.length);
    for (const [index, example] of cases.entries()) {
      const card = cards.nth(index);
      await card.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        (element) => element.getAttribute("aria-busy") === "false",
        await card.elementHandle(),
      );
      assert.equal(await card.locator(".frame-status").isHidden(), true);
      const iframe = card.locator("iframe");
      assert.equal(await iframe.getAttribute("sandbox"), example.file ? "allow-scripts allow-forms" : null);
      await iframe
        .contentFrame()
        .locator("img")
        .evaluate((image) => image.decode());
    }
  }
  assertCaptures("shell");
  await page.close();
  captures.length = 0;
  const report = await check(path, { log() {} });
  assert.equal(report.failures, 0, JSON.stringify(report.problems));
  assert.equal(report.frames, cases.length * 2);
  assertCaptures("checker");
});
