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
      message: /0 TypeScript and 0 Python/,
    },
    {
      name: "both compilers succeed",
      markdown: "```ts\nconst answer = 42;\n```\n```py\nanswer = 42\n```",
      outputs: [
        { status: 0, stdout: "", stderr: "" },
        {
          status: 0,
          stdout: JSON.stringify({
            generalDiagnostics: [{ severity: "warning" }],
          }),
          stderr: "",
        },
      ],
      status: 0,
      message: /1 TypeScript and 1 Python/,
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
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, (t) => {
      const dir = fixture(t);
      file(dir, "skills/example/SKILL.md", scenario.markdown);
      const code = `
        import { mock } from 'node:test';
        import assert from 'node:assert/strict';
        const outputs = ${JSON.stringify(scenario.outputs)};
        mock.module('node:child_process', { namedExports: { spawnSync: (command, args) => {
          assert.ok(command.endsWith('/tsc') || command === 'uv');
          assert.ok(args.some((arg) => /snippet\\d+\\.(ts|tsx|py)$/.test(arg)));
          assert.ok(outputs.length > 0, 'no unexpected compiler calls');
          return outputs.shift();
        } } });
        await import(${JSON.stringify(new URL("../scripts/check-snippets.mjs", import.meta.url).href)});
        assert.equal(outputs.length, 0, "every required compiler ran");
      `;
      const result = spawnSync(
        process.execPath,
        ["--experimental-test-module-mocks", "--input-type=module", "-e", code],
        { cwd: dir, encoding: "utf8" },
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
