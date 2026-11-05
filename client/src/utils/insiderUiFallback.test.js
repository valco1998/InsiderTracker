import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTheme, fallbackPalette, currentTheme, shouldResetOnKeyChange, isInsiderPath,
} from "./insiderUiFallback.js";

test("normalizeTheme defaults to light", () => {
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme(undefined), "light");
  assert.equal(normalizeTheme("purple"), "light");
});

test("fallbackPalette mirrors insider tokens per theme", () => {
  assert.equal(fallbackPalette("light").bg, "#F8FAFC");
  assert.equal(fallbackPalette("dark").bg, "#0B1120");
  assert.equal(fallbackPalette(null).bg, "#F8FAFC");
  assert.notEqual(fallbackPalette("dark").text, fallbackPalette("light").text);
});

test("currentTheme is safe without a DOM", () => {
  assert.equal(currentTheme(), "light");
});

test("shouldResetOnKeyChange only resets an errored boundary on a real key change", () => {
  assert.equal(shouldResetOnKeyChange(true, "/insider/a", "/insider/b"), true);
  assert.equal(shouldResetOnKeyChange(true, "/insider/a", "/insider/a"), false);
  assert.equal(shouldResetOnKeyChange(false, "/insider/a", "/insider/b"), false);
  assert.equal(shouldResetOnKeyChange(true, undefined, undefined), false);
  assert.equal(shouldResetOnKeyChange(true, NaN, NaN), false);
});

test("isInsiderPath", () => {
  assert.equal(isInsiderPath("/insider"), true);
  assert.equal(isInsiderPath("/insider/companies"), true);
  assert.equal(isInsiderPath("/insiders"), false);
  assert.equal(isInsiderPath("/market"), false);
  assert.equal(isInsiderPath(undefined), false);
});
