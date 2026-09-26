/** Fails when a relative markdown link in skills/**\/*.md points at a missing file. */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fencedLines, markdownFiles } from "./markdown.mjs";

const inline = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g;
const reference = /^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/;

let failures = 0;
for (const { file, lines } of markdownFiles()) {
  const fenced = fencedLines(lines);
  lines.forEach((raw, index) => {
    if (fenced.has(index + 1)) return;
    const text = raw.replace(/`[^`]*`/g, "");
    const targets = [...text.matchAll(inline)].map((match) => match[1]);
    const definition = reference.exec(text);
    if (definition) targets.push(definition[1]);
    for (const target of targets) {
      if (/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(target)) continue;
      const path = decodeURIComponent(target.replace(/[#?].*$/, ""));
      if (existsSync(resolve(dirname(file), path))) continue;
      failures++;
      console.error(`${file}:${index + 1}: broken link "${target}"`);
    }
  });
}

if (failures) {
  console.error(`\n${failures} broken relative link(s).`);
  process.exit(1);
}
console.log("Relative links: all resolve.");
