import { test } from "node:test";
import assert from "node:assert/strict";
import { compactUsd } from "./insiderFormat.js";

test("compactUsd: no '1000.0K' / '1000.00M' at rounding boundaries", () => {
  assert.equal(compactUsd(999_990), "$1.00M");
  assert.equal(compactUsd(999_949), "$999.9K");
  assert.equal(compactUsd(18_000_000), "$18.00M");
  assert.equal(compactUsd(999_996_000), "$1.00B");
  assert.equal(compactUsd(999_994_000), "$999.99M");
  assert.equal(compactUsd(-3_140_000_000), "$-3.14B");
  assert.equal(compactUsd(null), "—");
});
