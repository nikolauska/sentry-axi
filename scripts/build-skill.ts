import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createSkillMarkdown } from "../src/skill.ts";

const target = new URL("../skills/sentry-axi/SKILL.md", import.meta.url);
const expected = createSkillMarkdown();

if (process.argv.includes("--check")) {
  let actual: string | null = null;
  try {
    actual = await readFile(target, "utf8");
  } catch {
    // A missing generated file is reported as drift below.
  }
  if (actual !== expected) {
    console.error("skills/sentry-axi/SKILL.md is out of date. Run `npm run build:skill`.");
    process.exitCode = 1;
  } else {
    console.log("skills/sentry-axi/SKILL.md is up to date.");
  }
} else {
  await mkdir(new URL("../skills/sentry-axi/", import.meta.url), { recursive: true });
  await writeFile(target, expected);
  console.log(`Wrote ${fileURLToPath(target)}`);
}
