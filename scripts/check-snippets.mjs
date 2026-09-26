/**
 * Type-checks every ts, tsx, and python fenced block in skills/**\/*.md as its own file.
 * TypeScript uses the pinned deps in snippets/; Python uses pyright with the pinned SDK via uv.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fencedBlocks, markdownFiles } from "./markdown.mjs";

const extensions = { ts: "ts", typescript: "ts", tsx: "tsx", python: "py", py: "py" };
const snippets = resolve(import.meta.dirname, "../snippets");
const out = join(snippets, ".out");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');

/** Absolute snippet path -> { file, line } of its opening fence. */
const sources = new Map();
for (const { file, lines } of markdownFiles()) {
  for (const block of fencedBlocks(lines)) {
    const extension = extensions[block.lang];
    if (!extension) continue;
    const path = join(out, `snippet${sources.size}.${extension}`);
    writeFileSync(path, block.code);
    sources.set(path, { file, line: block.line });
  }
}

const paths = [...sources.keys()];
const where = (path, line) => {
  const source = sources.get(path);
  return source ? `${source.file}:${source.line + line}` : `${path}:${line}`;
};
let failures = 0;

const tsFiles = paths.filter((path) => !path.endsWith(".py"));
if (tsFiles.length) {
  const tsc = spawnSync(
    join(snippets, "node_modules/.bin/tsc"),
    [
      ...["--noEmit", "--strict", "--skipLibCheck", "--pretty", "false"],
      ...["--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022"],
      ...["--jsx", "react-jsx", "--moduleDetection", "force", "--types", "node"],
      ...tsFiles,
    ],
    { cwd: out, encoding: "utf8" },
  );
  if (tsc.error) throw new Error(`Run "npm ci --prefix snippets" first. ${tsc.error.message}`);
  for (const text of `${tsc.stdout}${tsc.stderr}`.split("\n").filter(Boolean)) {
    const match = /^(.+?)\((\d+),\d+\): (.*)$/.exec(text);
    if (match) {
      failures++;
      console.error(`${where(resolve(out, match[1]), Number(match[2]))}: ${match[3]}`);
    } else console.error(text);
  }
  if (tsc.status && !failures) failures++;
}

const pyFiles = paths.filter((path) => path.endsWith(".py"));
if (pyFiles.length) {
  const pyright = spawnSync(
    "uv",
    [
      ...["run", "--no-project", "--python", "3.12"],
      ...["--with", "blazing-agents==0.8.0", "--with", "pyright==1.1.414", "--with", "fastapi==0.141.1"],
      ...["pyright", "--outputjson", ...pyFiles],
    ],
    { cwd: out, encoding: "utf8" },
  );
  if (pyright.error) throw pyright.error;
  let report;
  try {
    report = JSON.parse(pyright.stdout);
  } catch {
    throw new Error(`pyright failed:\n${pyright.stdout}${pyright.stderr}`);
  }
  for (const diagnostic of report.generalDiagnostics) {
    if (diagnostic.severity !== "error") continue;
    failures++;
    console.error(`${where(diagnostic.file, diagnostic.range.start.line + 1)}: ${diagnostic.message}`);
  }
}

if (failures) {
  console.error(`\nSnippet type-check failed (${failures} error(s)).`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
console.log(`Snippets: ${tsFiles.length} TypeScript and ${pyFiles.length} Python block(s) type-check.`);
