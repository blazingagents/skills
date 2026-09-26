/** Fails when skills/**\/*.md uses internal dialect or wrong package names. */
import { markdownFiles } from "./markdown.mjs";

const banned = [
  "owns .* boundar",
  "belongs to",
  "learning category",
  "materializ",
  "settlement",
  "focused tests",
  "request serialization",
  "model conversion",
  "source build",
  "biome-ignore",
  "DBOS",
  "Supabase",
  "Durable Object",
  "agent-runner",
  "task-worker",
  "@blazing-agents/",
  " as unknown",
  "ba-platform",
].map((term) => ({ term, pattern: new RegExp(term, "i") }));

let failures = 0;
for (const { file, lines } of markdownFiles()) {
  lines.forEach((text, index) => {
    for (const { term, pattern } of banned) {
      const match = pattern.exec(text);
      if (!match) continue;
      failures++;
      console.error(`${file}:${index + 1}:${match.index + 1}: banned term "${term}": ${text.trim()}`);
    }
  });
}

if (failures) {
  console.error(`\n${failures} banned term(s) found.`);
  process.exit(1);
}
console.log("Banned terms: none found.");
