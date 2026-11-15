#!/usr/bin/env node
// Generate release sections from GitHub's PR notes and the Git history.
// Requires a full checkout, git, and an authenticated gh CLI.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const repo = "championswimmer/pi-checklist";
const stableTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const tags = git("tag", "--sort=version:refname").split("\n").filter(tag => stableTag.test(tag));
if (!tags.length) throw new Error("No stable version tags found; fetch the full history and tags first.");

const sections = new Map();
for (const [index, tag] of tags.entries()) {
  const previous = tags[index - 1];
  const args = ["api", "--method", "POST", `repos/${repo}/releases/generate-notes`, "-f", `tag_name=${tag}`];
  if (previous) args.push("-f", `previous_tag_name=${previous}`);
  const notes = JSON.parse(gh(...args)).body.trim().replace(/^## /gm, "### ");
  const range = previous ? `${previous}..${tag}` : tag;
  const commits = git("log", "--format=%H%x09%s", range).split("\n").filter(Boolean).map(line => {
    const [hash, ...subject] = line.split("\t");
    return `- ${subject.join(" ")} ([${hash.slice(0, 7)}](https://github.com/${repo}/commit/${hash}))`;
  }).join("\n");
  const date = git("log", "-1", "--format=%cs", tag);
  sections.set(tag, `## ${tag} (${date})\n\n${notes}\n\n### Commits\n\n${commits || "- No commits."}`);
}
writeFileSync("CHANGELOG.md", `# Changelog\n\n${[...sections.values()].reverse().join("\n\n")}\n`);

if (process.argv[2] === "--release") {
  const tag = process.argv[3];
  if (!sections.has(tag)) throw new Error(`Not a stable tag in this checkout: ${tag}`);
  // Avoid modifying an existing release (including manually curated notes).
  const releases = JSON.parse(gh("api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`)).flat();
  if (!releases.some(release => release.tag_name === tag)) {
    execFileSync("gh", ["release", "create", tag, "--repo", repo, "--verify-tag", "--title", tag, "--notes", sections.get(tag)], { stdio: "inherit" });
  }
} else if (process.argv.length > 2) {
  throw new Error("Usage: node scripts/changelog.mjs [--release vX.Y.Z]");
}
