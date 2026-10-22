/**
 * Fails when a Python, Rust, or Go fenced block in skills/**\/*.md sits outside
 * that language's own file (`<name>.<language>.md` or `sdk-<language>.md`), so
 * a coding agent on one language never has to read the other languages' code.
 */
import { basename } from "node:path";
import { fencedBlocks, markdownFiles } from "./markdown.mjs";

const languages = { python: "python", py: "python", rust: "rust", rs: "rust", go: "go" };

let failures = 0;
for (const { file, lines } of markdownFiles()) {
  const name = basename(file);
  for (const block of fencedBlocks(lines)) {
    const language = languages[block.lang];
    if (!language || name.endsWith(`.${language}.md`) || name === `sdk-${language}.md`) continue;
    failures++;
    console.error(
      `${file}:${block.line}: ${language} code belongs in ${name.replace(/\.md$/, `.${language}.md`)}`,
    );
  }
}

if (failures) {
  console.error(`\n${failures} block(s) outside their language file.`);
  process.exit(1);
}
console.log("Language files: every Python, Rust, and Go block is in its own file.");
