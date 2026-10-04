// @ts-check
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "../lib/build.js";

const repository = fileURLToPath(new URL("..", import.meta.url));

/** @param {import("node:test").TestContext} t */
async function workspace(t) {
  const root = await mkdtemp(join(repository, ".prismal-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/** @param {string} path @param {object} manifest */
async function writeManifest(path, manifest) {
  await writeFile(path, JSON.stringify(manifest), "utf8");
}

function buildManifest() {
  return {
    title: "<Review> $& $`",
    round: 1,
    about: "</script><script>bad()</script>\u2028\u2029 $& $`",
    decisions: [
      {
        id: "navigation",
        title: "Navigation",
        question: "Which version?",
        views: [
          { caption: "Main", file: "pages/{option}.html#detail/{option}" },
          { caption: "Alias", file: "./pages/{option}.html#other" },
        ],
        options: [{ id: "quiet", name: "Quiet" }],
      },
    ],
    inspect: [{ label: "Current inbox", file: "pages/{option}.html#inspect" }],
    journeys: [
      {
        id: "capture",
        title: "Capture",
        steps: [
          {
            file: "./pages/{option}.html#journey",
            selector: 'button[aria-label="New note"]',
            title: "Start",
          },
        ],
      },
    ],
  };
}

test("build deduplicates expanded files and safely assembles the lab", async (t) => {
  const root = await workspace(t);
  const pages = join(root, "pages");
  await mkdir(pages);
  const nowPath = join(pages, "now.html");
  const quietPath = join(pages, "quiet.html");
  await writeFile(
    nowPath,
    '<!doctype html><html><head><base href="/old"><script>window.appStarted = true;</script></head><body>Now</body></html>',
  );
  await writeFile(
    quietPath,
    '<script>const literal = "<head><base href=\'literal\'>"; window.appStarted = true;</script><main data-copy="$& $`">\u2028\u2029 Quiet</main>',
  );
  const manifestPath = join(root, "prismal.json");
  await writeManifest(manifestPath, buildManifest());

  const result = await build(manifestPath);
  const html = await readFile(result.output, "utf8");
  assert.equal(result.output, join(root, "lab.html"));
  assert.equal(result.data.files.length, 2);
  assert.deepEqual(result.data.fileIds, {
    "pages/now.html": 0,
    "./pages/now.html": 0,
    "pages/quiet.html": 1,
    "./pages/quiet.html": 1,
  });
  assert.deepEqual(result.dependencies, [manifestPath, nowPath, quietPath]);
  assert.deepEqual(result.stats, {
    decisions: 1,
    options: 2,
    frames: 6,
    bytes: Buffer.byteLength(html),
  });

  const now = result.data.files[0];
  assert.ok(now.startsWith("<!doctype html>"));
  assert.equal(now.match(/<base\b/gi)?.length, 1);
  assert.ok(now.includes('<base href="about:srcdoc">'));
  assert.equal(now.includes('href="/old"'), false);
  assert.ok(now.indexOf("<base") < now.indexOf("const win = window"));
  assert.ok(now.indexOf("const win = window") < now.indexOf("window.appStarted"));
  assert.ok(result.data.files[1].startsWith('<head><base href="about:srcdoc">'));
  assert.ok(result.data.files[1].includes("const literal = \"<head><base href='literal'>\""));

  const dataMatch = html.match(/<script type="application\/json" id="prismal-data">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch);
  const encodedData = dataMatch[1];
  assert.equal(encodedData.includes("<"), false);
  assert.equal(encodedData.includes("\u2028"), false);
  assert.equal(encodedData.includes("\u2029"), false);
  assert.ok(encodedData.includes("\\u003c/script>"));
  assert.ok(encodedData.includes("\\u2028"));
  assert.ok(encodedData.includes("\\u2029"));
  assert.deepEqual(JSON.parse(encodedData), result.data);
  assert.ok(html.includes("<title>&lt;Review&gt; $&amp; $` · Prismal</title>"));
  assert.equal(html.includes("<!--PRISMAL_"), false);
});

test("build creates explicit output directories and protects every input", async (t) => {
  const root = await workspace(t);
  const sources = join(root, "sources");
  await mkdir(sources);
  const source = join(sources, "page.html");
  const manifestPath = join(root, "prismal.json");
  await writeFile(source, "<!doctype html><p>Page</p>");
  await writeManifest(manifestPath, {
    title: "Review",
    round: 1,
    decisions: [
      {
        id: "page",
        title: "Page",
        question: "Which page?",
        views: [{ caption: "Page", file: "sources/page.html#route" }],
        options: [{ id: "new", name: "New" }],
      },
    ],
  });

  await assert.rejects(build(manifestPath, { output: manifestPath }), {
    message: `Refusing to overwrite build input ${manifestPath}`,
  });
  await assert.rejects(build(manifestPath, { output: source }), {
    message: `Refusing to overwrite build input ${source}`,
  });
  const aliasDirectory = join(root, "source-alias");
  await symlink(sources, aliasDirectory, process.platform === "win32" ? "junction" : "dir");
  const alias = join(aliasDirectory, "page.html");
  await assert.rejects(build(manifestPath, { output: alias }), /Refusing to overwrite build input/);
  const output = join(root, "nested", "review", "lab.html");
  const result = await build(manifestPath, { output });
  assert.equal(result.output, output);
  assert.equal(Buffer.byteLength(await readFile(output, "utf8")), result.stats.bytes);
});

test("build gives source paths enough context to fix missing files", async (t) => {
  const root = await workspace(t);
  const manifestPath = join(root, "prismal.json");
  await writeManifest(manifestPath, {
    title: "Review",
    round: 1,
    decisions: [
      {
        id: "page",
        title: "Page",
        question: "Which page?",
        views: [{ caption: "Page", file: "missing/{option}.html" }],
        options: [{ id: "new", name: "New" }],
      },
    ],
  });
  await mkdir(join(root, "missing"));
  await writeFile(join(root, "missing", "new.html"), "<p>New</p>");
  await assert.rejects(
    build(manifestPath),
    /Could not read decisions\[0\]\.views\[0\] option "now" file "missing\/now\.html":/,
  );
});
