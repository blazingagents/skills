/**
 * Type-checks every ts, tsx, python, and rust fenced block in skills/**\/*.md as
 * its own file. TypeScript uses the pinned deps in snippets/; Python uses
 * pyright with the pinned SDK via uv; Rust uses `cargo check --examples` with
 * the pinned SDK crate in snippets/rust.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fencedBlocks, markdownFiles } from "./markdown.mjs";

const extensions = {
  ts: "ts",
  typescript: "ts",
  tsx: "tsx",
  python: "py",
  py: "py",
  rust: "rs",
  rs: "rs",
};
const snippets = resolve(import.meta.dirname, "../snippets");
const out = join(snippets, ".out");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');
const examples = join(snippets, "rust/examples");
rmSync(examples, { recursive: true, force: true });
mkdirSync(examples, { recursive: true });

/** Wraps a Rust fragment in an async function that takes the client. */
const PRELUDE = `#[allow(unused, clippy::all)]
async fn snippet(client: blazing_agents::Client) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
`;
const offset = PRELUDE.split("\n").length - 1;

/** Absolute snippet path -> { file, line, offset } of its opening fence. */
const sources = new Map();
let rustCount = 0;
for (const { file, lines } of markdownFiles()) {
  for (const block of fencedBlocks(lines)) {
    const extension = extensions[block.lang];
    if (!extension) continue;
    if (extension === "rs") {
      const path = join(examples, `snippet${rustCount}.rs`);
      rustCount++;
      if (/\bfn\s+main\s*\(/.test(block.code)) {
        writeFileSync(path, block.code);
        sources.set(path, { file, line: block.line, offset: 0 });
      } else {
        writeFileSync(path, `${PRELUDE}${block.code}\nOk(())\n}\n\nfn main() {}\n`);
        sources.set(path, { file, line: block.line, offset });
      }
      continue;
    }
    const path = join(out, `snippet${sources.size}.${extension}`);
    writeFileSync(path, block.code);
    sources.set(path, { file, line: block.line, offset: 0 });
  }
}

const paths = [...sources.keys()];
const where = (path, line) => {
  const source = sources.get(path);
  return source
    ? `${source.file}:${source.line + line - source.offset}`
    : `${path}:${line}`;
};
let failures = 0;

const tsFiles = paths.filter(
  (path) => path.endsWith(".ts") || path.endsWith(".tsx"),
);
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
      ...["--with", join(snippets, "vendor/blazing_agents-0.22.0-py3-none-any.whl"), "--with", "pyright==1.1.414", "--with", "fastapi==0.141.1"],
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

const rsFiles = paths.filter((path) => path.endsWith(".rs"));
let rsFailures = 0;
if (rsFiles.length) {
  const cargo = spawnSync(
    "cargo",
    [
      ...["check", "--examples", "--locked", "--quiet"],
      ...["--message-format=short"],
      ...["--manifest-path", join(snippets, "rust/Cargo.toml")],
    ],
    { encoding: "utf8" },
  );
  if (cargo.error) {
    throw new Error(
      `Install the Rust toolchain first (https://rustup.rs). ${cargo.error.message}`,
    );
  }
  for (const text of `${cargo.stdout}${cargo.stderr}`.split("\n").filter(Boolean)) {
    const match = /examples\/(snippet\d+\.rs):(\d+):\d+: (error.*)$/.exec(text);
    if (match) {
      failures++;
      rsFailures++;
      console.error(`${where(join(examples, match[1]), Number(match[2]))}: ${match[3]}`);
    } else if (text.startsWith("error")) {
      console.error(text);
    }
  }
  if (cargo.status && !rsFailures) failures++;
}

if (failures) {
  console.error(`\nSnippet type-check failed (${failures} error(s)).`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
rmSync(examples, { recursive: true, force: true });
console.log(`Snippets: ${tsFiles.length} TypeScript, ${pyFiles.length} Python, and ${rsFiles.length} Rust block(s) type-check.`);
