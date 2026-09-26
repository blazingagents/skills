import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Every `.md` file under `root`, with its text split into lines. */
export function markdownFiles(root = process.argv[2] ?? "skills") {
  return readdirSync(root, { recursive: true })
    .filter((path) => path.endsWith(".md"))
    .sort()
    .map((path) => {
      const file = join(root, path);
      return { file, lines: readFileSync(file, "utf8").split("\n") };
    });
}

/** Fenced code blocks; `line` is the 1-based line of the opening fence. */
export function fencedBlocks(lines) {
  const blocks = [];
  let open;
  lines.forEach((text, index) => {
    const match = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(text);
    if (!open) {
      if (match) open = { fence: match[1], lang: match[2].toLowerCase(), line: index + 1, body: [] };
    } else if (match && match[1][0] === open.fence[0] && match[1].length >= open.fence.length && !match[2]) {
      blocks.push({ lang: open.lang, line: open.line, code: open.body.join("\n") + "\n" });
      open = undefined;
    } else {
      open.body.push(text);
    }
  });
  return blocks;
}

/** 1-based line numbers inside fenced blocks, including the fences. */
export function fencedLines(lines) {
  const inside = new Set();
  for (const block of fencedBlocks(lines)) {
    const end = block.line + block.code.split("\n").length;
    for (let line = block.line; line <= end; line++) inside.add(line);
  }
  return inside;
}
