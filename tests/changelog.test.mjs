import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../scripts/changelog.mjs", import.meta.url));

test("changelog covers stable tag ranges and creates only missing releases", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "checklist-changelog-"));
  try {
    mkdirSync(path.join(dir, "scripts"));
    mkdirSync(path.join(dir, "bin"));
    copyFileSync(source, path.join(dir, "scripts", "changelog.mjs"));
    const run = (cmd, args, extra = {}) => execFileSync(cmd, args, { cwd: dir, encoding: "utf8", ...extra });
    run("git", ["init", "-q"]);
    run("git", ["config", "user.name", "Test"]);
    run("git", ["config", "user.email", "test@example.com"]);
    const commit = (message) => {
      writeFileSync(path.join(dir, "file"), message);
      run("git", ["add", "file"]);
      run("git", ["commit", "-qm", message]);
    };
    commit("first commit");
    run("git", ["tag", "v1.0.0"]);
    commit("second commit");
    run("git", ["tag", "v1.1.0"]);
    run("git", ["tag", "v1.2.0-rc.1"]);
    writeFileSync(path.join(dir, "bin", "gh"), `#!/bin/sh\ncase "$*" in\n  *generate-notes*) printf '%s\\n' '{"body":"## What\\u0027s Changed\\n* PR example"}';;\n  *repos/championswimmer/pi-checklist/releases?per_page=100*) echo '[[{"tag_name":"v1.0.0"}]]';;\n  release\\ create*) echo "$*" >> "$RELEASE_LOG";;\n  *) exit 1;;\nesac\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, RELEASE_LOG: path.join(dir, "releases") };
    const generate = (...args) => run(process.execPath, ["scripts/changelog.mjs", ...args], { env });
    generate("--release", "v1.1.0");
    const changelog = readFileSync(path.join(dir, "CHANGELOG.md"), "utf8");
    assert.match(changelog, /## v1\.1\.0.*second commit/s);
    assert.match(changelog, /## v1\.0\.0.*first commit/s);
    assert.doesNotMatch(changelog, /v1\.2\.0-rc/);
    assert.match(changelog, /### What's Changed\n\* PR example/);
    assert.match(readFileSync(path.join(dir, "releases"), "utf8"), /release create v1\.1\.0/);
    const log = readFileSync(path.join(dir, "releases"), "utf8");
    generate("--release", "v1.0.0");
    assert.equal(readFileSync(path.join(dir, "releases"), "utf8"), log);
    assert.equal(readFileSync(path.join(dir, "CHANGELOG.md"), "utf8"), changelog);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
