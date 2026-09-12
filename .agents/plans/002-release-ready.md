# 002 — Release-ready packaging (npm `pi-checklist` v0.1.0)

Status: done.

## Goal

Publishable npm package named `pi-checklist` (unscoped) at 0.1.0 that
distributes **built JS**, not raw TS (pi loads `.js` directly; jiti
transpile of `.ts` on every startup is slower).

## Decisions

1. **Build with `tsc`** (`tsconfig.json`: `module`/`moduleResolution`
   `NodeNext`, `rootDir` src, `outDir` dist, `declaration: true`).
   `npm run build`, `npm run clean`, `prepublishOnly` rebuilds on publish.
2. **Manifest points at dist**: `main`, `types`, `exports`, and the
   `pi.extensions` entry all reference `./dist/index.js`.
3. **npm tarball = built output only**: `files: ["dist", "README.md",
   "LICENSE"]` whitelist + `.npmignore` blacklisting `src/`,
   `tsconfig.json`, `.agents/` as backup. Verified with
   `npm pack --dry-run` (15 files, no `.ts` sources).
4. **`dist/` is committed to git** (documented in `.gitignore` header):
   pi installs git packages via `npm install --omit=dev` with no build
   step, so `pi install git:github.com/championswimmer/pi-checklist`
   needs `./dist/index.js` present in the clone. Rule: rebuild before
   every commit that touches `src/`.
5. **Unscoped name** `pi-checklist`, `publishConfig.access = "public"`
   kept (harmless for unscoped names).

## Gotcha fixed

Exported tool param schemas in `src/tools.ts` are explicitly annotated
`: TSchema` (type-only import from `typebox`). Without annotations,
declaration emit fails with TS2742: `StringEnum` (from
`@earendil-works/pi-ai`) types values with pi's *nested* typebox copy,
which is not nameable/portable from our package. The annotation names
only the top-level (peer) `typebox`, which is portable.

## Verification

- `npm run build` exits 0, emits `dist/*.js` + `*.d.ts`.
- `npm pack --dry-run` lists only `dist/`, `README.md`, `LICENSE`,
  `package.json`.
- `pi -e ./dist/index.js -p "..."` print-mode round-trip: create +
  update tools work from built output.

## Left for the human

- `npm publish` (steps in the session handoff) + `git tag v0.1.0`.
- Eyeball the TUI widget/footer/overlay in an interactive session.
