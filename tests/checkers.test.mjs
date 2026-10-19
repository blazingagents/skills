import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  fencedBlocks,
  fencedLines,
  markdownFiles,
} from "../scripts/markdown.mjs";

const root = resolve(import.meta.dirname, "..");
/** The wheel `rig run sdk:pin` pins in `scripts/check-snippets.mjs`. */
const pinnedWheel = readFileSync(
  join(root, "scripts/check-snippets.mjs"),
  "utf8"
).match(/"(vendor\/blazing_agents-[^"]+\.whl)"/)[1];
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "skills-checkers-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of ["skills/example", "snippets/node_modules/.bin", "bin"])
    mkdirSync(join(dir, path), { recursive: true });
  cpSync(join(root, "scripts"), join(dir, "scripts"), { recursive: true });
  cpSync(join(root, "package.json"), join(dir, "package.json"));
  return dir;
}
function file(dir, path, text) {
  writeFileSync(join(dir, path), text);
}
function executable(dir, path, text) {
  writeFileSync(join(dir, path), `#!/bin/sh\n${text}\n`, { mode: 0o755 });
}
function run(dir, script) {
  return spawnSync(process.execPath, [join(root, "scripts", script)], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` },
  });
}
function snippets(dir) {
  return spawnSync(process.execPath, ["scripts/check-snippets.mjs"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` },
  });
}

test("fences retain EOF code and require a matching closing fence", () => {
  assert.deepEqual(fencedBlocks(["intro", "```TS", "const answer = 42"]), [
    { lang: "ts", line: 2, code: "const answer = 42\n" },
  ]);
  assert.deepEqual(
    fencedBlocks([
      "~~~~python",
      "x = 1",
      "~~~",
      "```",
      "~~~~python",
      "~~~~",
      "outside",
    ]),
    [{ lang: "python", line: 1, code: "x = 1\n~~~\n```\n~~~~python\n" }],
  );
  assert.deepEqual(
    [...fencedLines(["```", "inside", "```", "outside"])],
    [1, 2, 3],
  );
  assert.deepEqual(fencedBlocks(["no fences"]), []);
  assert.deepEqual([...fencedLines(["```", "EOF"])], [1, 2]);
});

test("markdown discovery reads sorted markdown files only", (t) => {
  const dir = fixture(t);
  file(dir, "skills/example/z.md", "z\n");
  file(dir, "skills/example/a.md", "a");
  file(dir, "skills/example/ignored.txt", "ignored");
  assert.deepEqual(
    markdownFiles(join(dir, "skills")).map(({ lines }) => lines),
    [["a"], ["z", ""]],
  );
});

test("invalid TypeScript in an EOF fence fails the snippet command", (t) => {
  const dir = fixture(t);
  file(
    dir,
    "skills/example/SKILL.md",
    "# Example\n```ts\nconst answer: number = 'wrong';",
  );
  symlinkSync(
    join(root, "snippets/node_modules/.bin/tsc"),
    join(dir, "snippets/node_modules/.bin/tsc"),
  );
  symlinkSync(
    join(root, "snippets/node_modules/@types"),
    join(dir, "snippets/node_modules/@types"),
  );
  const result = snippets(dir);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /skills\/example\/SKILL.md:3:.*not assignable/);
});

test("skill validation propagates failure and requires at least one skill", (t) => {
  const dir = fixture(t);
  const command = JSON.parse(readFileSync(join(root, "package.json"))).scripts[
    "check:skills"
  ];
  for (const exit of [7, 0]) {
    executable(dir, "bin/uvx", `exit ${exit}`);
    const result = spawnSync("/bin/sh", ["-c", command], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` },
    });
    assert.equal(result.status === 0, exit === 0);
  }
  rmSync(join(dir, "skills/example"), { recursive: true });
  const result = spawnSync("/bin/sh", ["-c", command], { cwd: dir });
  assert.notEqual(result.status, 0);
});

test("link validation ignores code and external links but reports missing relative targets", (t) => {
  const dir = fixture(t);
  file(dir, "skills/example/target file.md", "target");
  file(
    dir,
    "skills/example/SKILL.md",
    "[ok](target%20file.md#anchor)\n[web](https://example.com) [root](/root) [anchor](#anchor)\n`[inline](missing)`\n```md\n[fenced](missing)\n```\n[ref]: <target%20file.md>\n",
  );
  assert.equal(run(dir, "check-links.mjs").status, 0);
  file(
    dir,
    "skills/example/SKILL.md",
    "```\ncode\n```\n[broken](missing.md)\n[ref]: absent.md",
  );
  const result = run(dir, "check-links.mjs");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SKILL.md:4: broken link "missing.md"/);
  assert.match(result.stderr, /2 broken relative link/);
});

test("terms validation reports banned terms with location and accepts clean prose", (t) => {
  const dir = fixture(t);
  file(dir, "skills/example/SKILL.md", "Use a Workspace.");
  assert.equal(run(dir, "check-terms.mjs").status, 0);
  file(dir, "skills/example/SKILL.md", "Use Supabase.");
  const result = run(dir, "check-terms.mjs");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SKILL.md:1:5: banned term "Supabase"/);
  assert.match(result.stderr, /1 banned term/);
});

test("snippet checker maps diagnostics and rejects compiler failures", async (t) => {
  const cases = [
    {
      name: "empty input",
      markdown: "```sh\necho hello\n```",
      outputs: [],
      status: 0,
      message: /0 TypeScript, 0 Python, 0 Rust, and 0 Go/,
    },
    {
      name: "all four compilers succeed",
      markdown:
        "```ts\nconst answer = 42;\n```\n```py\nanswer = 42\n```\n```rust\nlet answer: u8 = 42;\n```\n```rust\nfn main() { println!(\"hi\"); }\n```\n```go\nx := 1\n_ = x\n```\n```go\npackage main\nfunc main() {}\n```",
      outputs: [
        { status: 0, stdout: "", stderr: "" },
        {
          status: 0,
          stdout: JSON.stringify({
            generalDiagnostics: [{ severity: "warning" }],
          }),
          stderr: "",
        },
        { status: 0, stdout: "warning: unused", stderr: "" },
        { status: 0, stdout: "", stderr: "" },
        { status: 0, stdout: "", stderr: "" },
        { status: 0, stdout: "", stderr: "go: downloading example.com/dep v1\n" },
      ],
      status: 0,
      message: /1 TypeScript, 1 Python, 2 Rust, and 2 Go/,
      rust: { wrapped: ["snippet0.rs"], plain: ["snippet1.rs"] },
      go: { wrapped: ["snippet0"], plain: ["snippet1"] },
    },
    {
      name: "TypeScript failure without diagnostics",
      markdown: "```tsx\nwrong\n```",
      outputs: [{ status: 2, stdout: "compiler failed", stderr: "" }],
      status: 1,
      message: /Snippet type-check failed \(1 error/,
    },
    {
      name: "TypeScript located diagnostics",
      markdown: "```typescript\nwrong\n```",
      outputs: [
        { status: 2, stdout: "snippet0.ts(1,1): incorrect type", stderr: "" },
      ],
      status: 1,
      message: /SKILL.md:2: incorrect type/,
    },
    {
      name: "external TypeScript diagnostic",
      markdown: "```ts\nwrong\n```",
      outputs: [
        {
          status: 2,
          stdout: "/external.ts(3,1): dependency error",
          stderr: "",
        },
      ],
      status: 1,
      message: /external.ts:3: dependency error/,
    },
    {
      name: "missing TypeScript executable",
      markdown: "```ts\nx\n```",
      outputs: [{ error: { message: "ENOENT" } }],
      status: 1,
      message: /npm ci --prefix snippets/,
    },
    {
      name: "Python located diagnostics",
      markdown: "```python\nwrong\n```",
      outputs: [
        {
          status: 1,
          stdout: JSON.stringify({
            generalDiagnostics: [
              {
                severity: "error",
                file: join(root, "snippets/.out/snippet0.py"),
                range: { start: { line: 0 } },
                message: "bad Python",
              },
            ],
          }),
          stderr: "",
        },
      ],
      status: 1,
      message: /SKILL.md:2: bad Python/,
    },
    {
      name: "missing Python executable",
      markdown: "```py\nx\n```",
      outputs: [{ error: { message: "ENOENT" } }],
      status: 1,
      message: /ENOENT/,
    },
    {
      name: "invalid Python response",
      markdown: "```py\nx\n```",
      outputs: [
        { status: 1, stdout: "invalid report", stderr: "backend failed" },
      ],
      status: 1,
      message: /pyright failed:[\s\S]*invalid reportbackend failed/,
    },
    {
      name: "Rust located fragment diagnostic",
      markdown: '```rust\nlet x: u8 = "no";\n```',
      outputs: [
        {
          status: 101,
          stdout:
            "examples/snippet0.rs:3:13: error[E0308]: mismatched types\nerror: could not compile `skills-rust-snippets` (example \"snippet0\") due to 1 previous error\n",
          stderr: "",
        },
      ],
      status: 1,
      message: /SKILL\.md:2: error\[E0308\]: mismatched types/,
      rust: { wrapped: ["snippet0.rs"] },
    },
    {
      name: "Rust located program diagnostic",
      markdown: '```rust\nfn main() {\nlet x: u8 = "no";\n}\n```',
      outputs: [
        {
          status: 101,
          stdout:
            "examples/snippet0.rs:2:13: error[E0308]: mismatched types\n",
          stderr: "",
        },
      ],
      status: 1,
      message: /SKILL\.md:3: error\[E0308\]: mismatched types/,
      rust: { plain: ["snippet0.rs"] },
    },
    {
      name: "Rust unlocated error line is printed",
      markdown: "```rust\nlet x = 1;\n```",
      outputs: [
        {
          status: 0,
          stdout: "",
          stderr: "error: could not compile `skills-rust-snippets`\n",
        },
      ],
      status: 0,
      message: /error: could not compile `skills-rust-snippets`/,
      rust: { wrapped: ["snippet0.rs"] },
    },
    {
      name: "Rust failure without diagnostics",
      markdown: "```rust\nlet x = 1;\n```",
      outputs: [{ status: 101, stdout: "", stderr: "linker blew up" }],
      status: 1,
      message: /Snippet type-check failed \(1 error/,
      rust: { wrapped: ["snippet0.rs"] },
    },
    {
      name: "missing cargo executable",
      markdown: "```rust\nlet x = 1;\n```",
      outputs: [{ error: { message: "ENOENT" } }],
      status: 1,
      message: /Install the Rust toolchain/,
      rust: { wrapped: ["snippet0.rs"] },
    },
    {
      name: "Go located fragment diagnostic",
      markdown: '```go\nvar x int = "no"\n```',
      outputs: [
        { status: 0, stdout: "", stderr: "" },
        { status: 0, stdout: "", stderr: "" },
        {
          status: 1,
          stdout: "",
          stderr: '# skills-go-snippets/examples/snippet0\nexamples/snippet0/main.go:10:13: cannot use "no" (untyped string constant) as int value\n',
        },
      ],
      status: 1,
      message: /SKILL\.md:2: cannot use "no"/,
      go: { wrapped: ["snippet0"] },
    },
    {
      name: "Go located program diagnostic",
      markdown: '```go\npackage main\nfunc main() {\nvar x int = "no"\n}\n```',
      outputs: [
        { status: 0, stdout: "", stderr: "" },
        {
          status: 1,
          stdout: "",
          stderr: 'examples/snippet0/main.go:3:13: cannot use "no" (untyped string constant) as int value\n',
        },
      ],
      status: 1,
      message: /SKILL\.md:4: cannot use "no"/,
      go: { plain: ["snippet0"] },
    },
    {
      name: "Go fragment that goimports cannot parse",
      markdown: "```go\nif {\n```",
      outputs: [
        { status: 0, stdout: "", stderr: "" },
        { status: 2, stdout: "", stderr: "examples/snippet0/main.go:10:4: expected operand\n" },
      ],
      status: 1,
      message: /SKILL\.md:2: expected operand/,
      go: { wrapped: ["snippet0"] },
    },
    {
      name: "Go goimports failure without diagnostics",
      markdown: "```go\nx := 1\n```",
      outputs: [
        { status: 0, stdout: "", stderr: "" },
        { status: 2, stdout: "", stderr: "goimports blew up" },
      ],
      status: 1,
      message: /goimports blew up[\s\S]*Snippet type-check failed \(1 error/,
      go: { wrapped: ["snippet0"] },
    },
    {
      name: "Go build failure without diagnostics",
      markdown: "```go\nx := 1\n```",
      outputs: [
        { status: 0, stdout: "", stderr: "" },
        { status: 0, stdout: "", stderr: "" },
        { status: 1, stdout: "", stderr: "# skills-go-snippets/examples/snippet0\n" },
      ],
      status: 1,
      message: /Snippet type-check failed \(1 error/,
      go: { wrapped: ["snippet0"] },
    },
    {
      name: "Go block that is not gofmt-formatted",
      markdown: "```go\nx  :=  1\n_ = x\n```",
      outputs: [
        { status: 0, stdout: "{files}\n", stderr: "" },
        { status: 0, stdout: "", stderr: "" },
        { status: 0, stdout: "", stderr: "" },
      ],
      status: 1,
      message: /SKILL\.md:1: Go block is not gofmt-formatted[\s\S]*Snippet type-check failed \(1 error/,
      go: { wrapped: ["snippet0"] },
    },
    {
      name: "TypeScript against a packed SDK",
      markdown: "```ts\nconst answer = 42;\n```",
      env: { SNIPPETS_TYPESCRIPT_SDK: "/packs/sdk.tgz" },
      outputs: [
        { status: 0, stdout: "", stderr: "" },
        { status: 0, stdout: "", stderr: "" },
      ],
      status: 0,
      message: /TypeScript snippets use \/packs\/sdk\.tgz/,
    },
    {
      name: "a packed SDK that fails to install",
      markdown: "```ts\nconst answer = 42;\n```",
      env: { SNIPPETS_TYPESCRIPT_SDK: "/packs/sdk.tgz" },
      outputs: [{ status: 1, stdout: "", stderr: "" }],
      status: 1,
      message: /npm install --no-save \/packs\/sdk\.tgz failed/,
    },
    {
      name: "Python against a packed wheel",
      markdown: "```py\nanswer = 42\n```",
      env: { SNIPPETS_PYTHON_SDK: "/packs/sdk.whl" },
      outputs: [
        {
          status: 0,
          stdout: JSON.stringify({ generalDiagnostics: [] }),
          stderr: "",
        },
      ],
      status: 0,
      message: /Python snippets use \/packs\/sdk\.whl/,
    },
    {
      name: "missing gofmt executable",
      markdown: "```go\nx := 1\n```",
      outputs: [{ error: { message: "ENOENT" } }],
      status: 1,
      message: /Install Go first/,
      go: { wrapped: ["snippet0"] },
    },
    {
      name: "missing go executable",
      markdown: "```go\nx := 1\n```",
      outputs: [{ status: 0, stdout: "", stderr: "" }, { error: { message: "ENOENT" } }],
      status: 1,
      message: /Install Go first/,
      go: { wrapped: ["snippet0"] },
    },
    {
      name: "missing go executable for a program",
      markdown: "```go\npackage main\nfunc main() {}\n```",
      outputs: [{ status: 0, stdout: "", stderr: "" }, { error: { message: "ENOENT" } }],
      status: 1,
      message: /ENOENT/,
      go: { plain: ["snippet0"] },
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, (t) => {
      const dir = fixture(t);
      file(dir, "skills/example/SKILL.md", scenario.markdown);
      const code = `
        import { mock } from 'node:test';
        import assert from 'node:assert/strict';
        import { readFileSync, readdirSync } from 'node:fs';
        import { dirname, join } from 'node:path';
        const outputs = ${JSON.stringify(scenario.outputs)};
        const rust = ${JSON.stringify(scenario.rust ?? null)};
        const go = ${JSON.stringify(scenario.go ?? null)};
        mock.module('node:child_process', { namedExports: { spawnSync: (command, args, options) => {
          assert.ok(outputs.length > 0, 'no unexpected compiler calls');
          if (command === 'gofmt') {
            assert.equal(args[0], '-l');
            assert.equal(args.length - 1, (go?.wrapped?.length ?? 0) + (go?.plain?.length ?? 0));
            for (const path of args.slice(1)) {
              const text = readFileSync(path, 'utf8');
              if (/func snippet\\(/.test(text)) assert.match(text, /\\) error \\{\\n\\t\\S/, 'fragment indented');
            }
            const output = outputs.shift();
            return output.stdout ? { ...output, stdout: output.stdout.replace('{files}', args.slice(1).join('\\n')) } : output;
          }
          if (command === 'go') {
            const dir = join(options.cwd, 'examples');
            const wrapper = /func snippet\\(ctx context\\.Context, client \\*ba\\.Client, agentID ba\\.AgentID, sessionID ba\\.SessionID\\) error/;
            if (args[0] === 'tool') {
              assert.deepEqual(args.slice(0, 3), ['tool', 'goimports', '-w']);
              assert.deepEqual(args.slice(3), (go?.wrapped ?? []).map((name) => join(dir, name, 'main.go')));
            } else {
              assert.deepEqual(args, ['build', '-gcflags=-e', './examples/...']);
            }
            for (const name of go?.wrapped ?? []) {
              assert.match(readFileSync(join(dir, name, 'main.go'), 'utf8'), wrapper);
            }
            for (const name of go?.plain ?? []) {
              assert.doesNotMatch(readFileSync(join(dir, name, 'main.go'), 'utf8'), wrapper);
            }
            assert.equal(readdirSync(dir).length, (go?.wrapped?.length ?? 0) + (go?.plain?.length ?? 0));
            return outputs.shift();
          }
          if (command === 'cargo') {
            assert.ok(args.includes('--examples'));
            assert.ok(args.includes('--locked'));
            assert.ok(args.includes('--manifest-path'));
            const manifest = args[args.indexOf('--manifest-path') + 1];
            const dir = join(dirname(manifest), 'examples');
            for (const name of rust?.wrapped ?? []) {
              assert.match(readFileSync(join(dir, name), 'utf8'), /async fn snippet\\(client: blazing_agents::Client\\)/);
            }
            for (const name of rust?.plain ?? []) {
              assert.doesNotMatch(readFileSync(join(dir, name), 'utf8'), /async fn snippet\\(client: blazing_agents::Client\\)/);
            }
            assert.equal(readdirSync(dir).length, (rust?.wrapped?.length ?? 0) + (rust?.plain?.length ?? 0));
            return outputs.shift();
          }
          if (command === 'npm') {
            assert.deepEqual(args.slice(0, 3), ['install', '--no-save', '--silent']);
            assert.equal(args.at(-1), process.env.SNIPPETS_TYPESCRIPT_SDK);
            return outputs.shift();
          }
          if (command === 'uv') {
            assert.ok(args.includes(process.env.SNIPPETS_PYTHON_SDK ?? join(dirname(options.cwd), ${JSON.stringify(pinnedWheel)})), 'the pinned or packed wheel');
          }
          assert.ok(command.endsWith('/tsc') || command === 'uv');
          assert.ok(args.some((arg) => /snippet\\d+\\.(ts|tsx|py)$/.test(arg)));
          return outputs.shift();
        } } });
        await import(${JSON.stringify(new URL("../scripts/check-snippets.mjs", import.meta.url).href)});
        assert.equal(outputs.length, 0, "every required compiler ran");
      `;
      const result = spawnSync(
        process.execPath,
        ["--experimental-test-module-mocks", "--input-type=module", "-e", code],
        { cwd: dir, encoding: "utf8", env: { ...process.env, ...scenario.env } },
      );
      assert.equal(
        result.status,
        scenario.status,
        result.stdout + result.stderr,
      );
      assert.match(result.stdout + result.stderr, scenario.message);
    });
  }
});
