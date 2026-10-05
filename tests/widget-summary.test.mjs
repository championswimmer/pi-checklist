import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { createOrAppend, applyUpdates } from "../dist/store.js";
import { footerText, paintWidget, widgetLines } from "../dist/render.js";

const theme = {
  fg: (_name, text) => text,
  bg: (_name, text) => text,
  bold: (text) => text,
};

function mixedChecklist() {
  const { checklist } = createOrAppend(null, {
    tasks: [
      { id: "don", title: "Finished" },
      { id: "run", title: "Working" },
      { id: "rdy", title: "Ready" },
      { id: "blk", title: "Waiting", dependsOn: ["run"] },
      { id: "drp", title: "Dropped" },
    ],
  }, 1);
  return applyUpdates(checklist, [
    { id: "don", status: "done" },
    { id: "run", status: "ongoing" },
    { id: "drp", status: "cancelled" },
  ], 2).checklist;
}

for (const [style, iconSet, expected] of [
  ["color", "nerd-font", "\uED7A 1/4 \uF4A4 1 \uF46A 1 \uF500 1 \uF479 1 \uF530 1"],
  ["pill", "emoji", "☑️ 1/4 ✅ 1 🔄 1 ▶️ 1 ⛔ 1 ❌ 1"],
  ["icon", "nerd-font", "\uED7A 1/4 \uF4A4 1 \uF46A 1 \uF500 1 \uF479 1 \uF530 1"],
  ["icon", "emoji", "☑️ 1/4 ✅ 1 🔄 1 ▶️ 1 ⛔ 1 ❌ 1"],
]) {
  test(`widget summary uses compact counts for ${style}/${iconSet}`, () => {
    const checklist = mixedChecklist();
    const opts = { style, iconSet };
    const header = widgetLines(checklist, opts)[0];
    assert.equal(header.kind, "header");
    assert.equal(header.text, expected);
    assert.equal(footerText(checklist, opts), expected);
    assert.equal(paintWidget(checklist, theme, 80, opts)[0], header.text);
    for (const width of [1, 10, 20]) {
      assert.ok(visibleWidth(paintWidget(checklist, theme, width, opts)[0]) <= width);
    }
  });
}

test("summary hides zero states with selected artwork in every style", () => {
  const { checklist } = createOrAppend(null, { tasks: [{ id: "don", title: "Finished" }] }, 1);
  const completed = applyUpdates(checklist, [{ id: "don", status: "done" }], 2).checklist;
  for (const style of ["color", "pill", "icon"]) {
    for (const [iconSet, expected] of [["emoji", "☑️ 1/1 ✅ 1"], ["nerd-font", "\uED7A 1/1 \uF4A4 1"]]) {
      const opts = { style, iconSet };
      assert.equal(footerText(completed, opts), expected);
      assert.equal(widgetLines(completed, opts)[0].text, expected);
    }
  }
});

test("footer is cleared for missing or empty checklists", () => {
  assert.equal(footerText(null), undefined);
  assert.equal(footerText({ tasks: [], updatedAt: 1 }), undefined);
});

test("all-cancelled summary keeps zero progress denominator", () => {
  const { checklist } = createOrAppend(null, { tasks: [{ id: "drp", title: "Dropped" }] }, 1);
  const cancelled = applyUpdates(checklist, [{ id: "drp", status: "cancelled" }], 2).checklist;
  const opts = { style: "pill", iconSet: "emoji" };
  assert.equal(footerText(cancelled, opts), "☑️ 0/0 ❌ 1");
});

test("widget summary preserves title and hides zero counts", () => {
  const { checklist } = createOrAppend(null, {
    title: "Release",
    tasks: [{ title: "Ship it" }],
  }, 1);
  const opts = { style: "color", iconSet: "emoji" };
  assert.equal(widgetLines(checklist, opts)[0].text, "☑️ Release 0/1 ▶️ 1");
  assert.equal(footerText(checklist, opts), "☑️ 0/1 ▶️ 1");
});

test("widget summary reports totals for all ten tasks, not just visible rows", () => {
  const { checklist } = createOrAppend(null, {
    tasks: Array.from({ length: 10 }, (_, i) => ({ title: `Task ${i}` })),
  }, 1);
  assert.equal(widgetLines(checklist, { style: "pill", iconSet: "emoji" })[0].text, "☑️ 0/10 ▶️ 10");
});
