// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { runNpm } from "./npm.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtimeOwners = ["bin", "lib", "shell", "client"];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    }),
  );
  return lists.flat();
}

function moduleReferences(source) {
  const references = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      references.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.ok(ts.isStringLiteral(node.arguments[0]), "Runtime imports must have a static owner.");
      references.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ts.createSourceFile("source.js", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS));
  return references;
}

test("runtime imports preserve direct ownership and the dependency-free browser boundary", async () => {
  const paths = (await Promise.all(runtimeOwners.map((owner) => filesUnder(join(root, owner))))).flat();
  const graph = new Map();
  for (const path of paths.filter((file) => file.endsWith(".js"))) {
    const name = relative(root, path).replaceAll("\\", "/");
    const owner = name.split("/")[0];
    assert.match(name.split("/").at(-1), /^[a-z][a-z0-9-]*\.js$/);
    const source = await readFile(path, "utf8");
    assert.match(source, /^(?:#![^\n]*\n)?\/\/ @ts-check\n/);
    const imports = moduleReferences(source);
    if (owner === "shell" || owner === "client") assert.deepEqual(imports, [], name);
    const dependencies = [];
    for (const specifier of imports) {
      if (specifier.startsWith("node:")) continue;
      assert.ok(specifier.startsWith(".") && specifier.endsWith(".js"), `${name}: ${specifier}`);
      const target = resolve(dirname(path), specifier);
      assert.equal(dirname(target), join(root, "lib"), `${name}: ${specifier}`);
      assert.notEqual(target, join(root, "lib/index.js"), "Internal imports use the defining module.");
      assert.ok(paths.includes(target), `${name}: ${specifier}`);
      dependencies.push(target);
    }
    graph.set(path, dependencies);
  }
  function visit(path, ancestors = []) {
    assert.ok(!ancestors.includes(path), `Circular dependency: ${relative(root, path)}`);
    for (const next of graph.get(path)) visit(next, [...ancestors, path]);
  }
  for (const path of graph.keys()) visit(path);
  assert.deepEqual(
    moduleReferences('const label = "import fake"; // import "fake"\nimport { x } from "./x.js";'),
    ["./x.js"],
  );
});

test("documentation has a single policy owner and durable implementation anchors", async () => {
  for (const adapter of ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"]) {
    const text = await readFile(join(root, adapter), "utf8");
    assert.match(text, /\]\((?:\.\.\/)?CONVENTIONS\.md\)/);
    if (adapter !== "AGENTS.md") {
      assert.ok(text.split("\n").length <= 8);
      assert.match(text, /\]\((?:\.\.\/)?AGENTS\.md\)/);
    }
  }
  for (const path of (await filesUnder(join(root, "docs"))).filter((file) => file.endsWith(".md"))) {
    const text = await readFile(path, "utf8");
    assert.match(text, /^# .+\n\nStatus: (Living|Snapshot \(\d{4}-\d{2}\)|Superseded by .+)\n\n\S/);
    assert.match(text, /\]\(\.\.\/(?:bin|lib|shell|client|schema)\//);
  }
});

test("lint distinguishes browser, Node and shared-shell scopes", async () => {
  const linter = new ESLint({ cwd: root });
  const [browser] = await linter.lintText("process.exit(0);", { filePath: join(root, "client/probe.js") });
  assert.ok(browser.messages.some((message) => message.ruleId === "no-restricted-globals"));
  const [shell] = await linter.lintText("let choices = [];", { filePath: join(root, "shell/probe.js") });
  assert.equal(shell.errorCount, 0);
  const [node] = await linter.lintText("document.title = 'wrong owner';", {
    filePath: join(root, "lib/probe.js"),
  });
  assert.ok(node.messages.some((message) => message.ruleId === "no-undef"));
});

test("Markdown verification rejects broken local paths and heading fragments", async (t) => {
  const directory = await mkdtemp(join(root, ".prismal-docs-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "probe.md");
  await writeFile(file, "# Probe\n\n[Missing](missing.md)\n\n[Wrong section](#unknown)\n");
  await assert.rejects(
    runNpm(["run", "lint:docs", "--", "--no-globs", file], { cwd: root }),
    (error) =>
      error.code === 1 &&
      /relative-links/.test(error.stderr + error.stdout) &&
      /MD051/.test(error.stderr + error.stdout),
  );
});
