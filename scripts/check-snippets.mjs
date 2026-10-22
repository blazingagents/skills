/**
 * Type-checks every ts, tsx, python, rust, and go fenced block in skills/**\/*.md
 * as its own file. TypeScript uses the pinned deps in snippets/; Python uses
 * pyright with the pinned SDK via uv; Rust uses `cargo check --examples` with
 * the pinned SDK crate in snippets/rust; Go blocks must be gofmt-formatted and
 * use `go build` with the pinned SDK module in snippets/go, after goimports adds
 * each fragment's stdlib imports.
 *
 * To check against an unreleased SDK, point SNIPPETS_TYPESCRIPT_SDK at a tarball
 * or SNIPPETS_PYTHON_SDK at a wheel, such as one `just sdk-pack` in ba-platform built. The
 * tarball is installed without saving; the next `npm ci --prefix snippets`
 * restores the pin.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  go: "go",
};
const snippets = resolve(import.meta.dirname, "../snippets");
const out = join(snippets, ".out");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');
const examples = join(snippets, "rust/examples");
rmSync(examples, { recursive: true, force: true });
mkdirSync(examples, { recursive: true });
const goModule = join(snippets, "go");
const goExamples = join(goModule, "examples");
rmSync(goExamples, { recursive: true, force: true });
mkdirSync(goExamples, { recursive: true });

/** Wraps a Rust fragment in an async function that takes the client. */
const PRELUDE = `#[allow(unused, clippy::all)]
async fn snippet(client: blazing_agents::Client) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
`;
const offset = PRELUDE.split("\n").length - 1;

/**
 * Wraps a Go fragment, indented one tab so gofmt can check it, in a function
 * that takes the client and the IDs it names. goimports fills in the stdlib
 * imports the fragment uses, so the fragment's offset is read back from the
 * rewritten file.
 */
const GO_PRELUDE = `package main

import (
	"context"

	ba "github.com/blazingagents/golang-sdk"
)

func snippet(ctx context.Context, client *ba.Client, agentID ba.AgentID, sessionID ba.SessionID) error {
`;
const goOffset = GO_PRELUDE.split("\n").length - 1;

/** Absolute snippet path -> { file, line, offset } of its opening fence. */
const sources = new Map();
let rustCount = 0;
let goCount = 0;
/** Go fragments that goimports rewrites before the build. */
const goFragments = [];
for (const { file, lines } of markdownFiles()) {
  for (const block of fencedBlocks(lines)) {
    const extension = extensions[block.lang];
    if (!extension) continue;
    if (extension === "go") {
      const dir = join(goExamples, `snippet${goCount}`);
      goCount++;
      mkdirSync(dir);
      const path = join(dir, "main.go");
      if (/\bfunc\s+main\s*\(/.test(block.code)) {
        writeFileSync(path, block.code);
        sources.set(path, { file, line: block.line, offset: 0 });
      } else {
        const body = block.code.replace(/^(?=.)/gm, "\t");
        writeFileSync(path, `${GO_PRELUDE}${body}\treturn nil\n}\n\nfunc main() {}\n`);
        sources.set(path, { file, line: block.line, offset: goOffset });
        goFragments.push(path);
      }
      continue;
    }
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
  const sdk = process.env.SNIPPETS_TYPESCRIPT_SDK;
  if (sdk) {
    console.log(`TypeScript snippets use ${sdk}`);
    const install = spawnSync("npm", ["install", "--no-save", "--silent", "--prefix", snippets, resolve(sdk)], {
      stdio: "inherit",
    });
    if (install.status !== 0) throw new Error(`npm install --no-save ${sdk} failed`);
  }
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

/** The pinned wheel, which `just sdk-pin` moves, unless SNIPPETS_PYTHON_SDK names another. */
function pythonSdk() {
  const sdk = process.env.SNIPPETS_PYTHON_SDK;
  if (!sdk) return join(snippets, "vendor/blazing_agents-0.30.1-py3-none-any.whl");
  console.log(`Python snippets use ${sdk}`);
  return resolve(sdk);
}

const pyFiles = paths.filter((path) => path.endsWith(".py"));
if (pyFiles.length) {
  const pyright = spawnSync(
    "uv",
    [
      ...["run", "--no-project", "--python", "3.12"],
      ...["--with", pythonSdk(), "--with", "pyright==1.1.414", "--with", "fastapi==0.141.1"],
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

const goFiles = paths.filter((path) => path.endsWith(".go"));
let goFailures = 0;
const goDiagnostics = (text) => {
  for (const line of text.split("\n").filter(Boolean)) {
    const match = /examples\/(snippet\d+\/main\.go):(\d+):\d+: (.*)$/.exec(line);
    if (match) {
      failures++;
      goFailures++;
      console.error(`${where(join(goExamples, match[1]), Number(match[2]))}: ${match[3]}`);
    } else if (!line.startsWith("#") && !line.startsWith("go: downloading")) {
      console.error(line);
    }
  }
};
if (goFiles.length) {
  const gofmt = spawnSync("gofmt", ["-l", ...goFiles], { encoding: "utf8" });
  if (gofmt.error) {
    throw new Error(`Install Go first (https://go.dev/dl). ${gofmt.error.message}`);
  }
  for (const path of gofmt.stdout.split("\n").filter(Boolean)) {
    failures++;
    const { file, line } = sources.get(path);
    console.error(`${file}:${line}: Go block is not gofmt-formatted`);
  }
  const goimports = goFragments.length
    ? spawnSync("go", ["tool", "goimports", "-w", ...goFragments], { cwd: goModule, encoding: "utf8" })
    : { status: 0, stdout: "", stderr: "" };
  if (goimports.error) {
    throw new Error(`Install Go first (https://go.dev/dl). ${goimports.error.message}`);
  }
  goDiagnostics(`${goimports.stdout}${goimports.stderr}`);
  if (goimports.status) {
    if (!goFailures) failures++;
  } else {
    for (const path of goFragments) {
      const line = readFileSync(path, "utf8").split("\n").findIndex((text) => text.startsWith("func snippet("));
      sources.get(path).offset = line + 1;
    }
    const build = spawnSync("go", ["build", "-gcflags=-e", "./examples/..."], { cwd: goModule, encoding: "utf8" });
    if (build.error) throw build.error;
    goDiagnostics(`${build.stdout}${build.stderr}`);
    if (build.status && !goFailures) failures++;
  }
}

if (failures) {
  console.error(`\nSnippet type-check failed (${failures} error(s)).`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
rmSync(examples, { recursive: true, force: true });
rmSync(goExamples, { recursive: true, force: true });
console.log(`Snippets: ${tsFiles.length} TypeScript, ${pyFiles.length} Python, ${rsFiles.length} Rust, and ${goFiles.length} Go block(s) type-check.`);
