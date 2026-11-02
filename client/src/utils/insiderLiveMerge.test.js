// node --test src/utils/insiderLiveMerge.test.js   (runs under Node, not the browser)
/* global setImmediate */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { reconcileRows, newRowIds, appendUnique, versionChanged, createRefreshScheduler } from "./insiderLiveMerge.js";

const row = (id, extra = {}) => ({ id, acceptedAtET: "2026-11-02 09:00:00 ET", value: 100, ...extra });

test("reconcileRows: identical data keeps the SAME array (no re-render)", () => {
  const prev = [row("a"), row("b")];
  const next = [row("a"), row("b")]; // fresh objects from JSON
  assert.equal(reconcileRows(prev, next), prev);
});

test("reconcileRows: unchanged rows keep their objects, changed rows are replaced", () => {
  const prev = [row("a"), row("b"), row("c")];
  const next = [row("n"), row("a"), row("b", { amendment: { status: "superseded" } }), row("c")];
  const out = reconcileRows(prev, next);
  assert.notEqual(out, prev);
  assert.equal(out[1], prev[0]); // a reused
  assert.notEqual(out[2], prev[1]); // b changed (now superseded) → new object, label not stale
  assert.equal(out[2].amendment.status, "superseded");
  assert.equal(out[3], prev[2]);
  assert.deepEqual(out.map((r) => r.id), ["n", "a", "b", "c"]);
});

test("reconcileRows: a row regrouped away by the server disappears (no double count)", () => {
  const prev = [row("g1"), row("old-separate"), row("z")];
  const next = [row("g1", { reportedBy: [{ rowId: "g1" }, { rowId: "old-separate" }] }), row("z")];
  assert.deepEqual(reconcileRows(prev, next).map((r) => r.id), ["g1", "z"]);
});

test("reconcileRows: duplicate ids in a response are dropped", () => {
  const out = reconcileRows([], [row("a"), row("a"), row("b")]);
  assert.deepEqual(out.map((r) => r.id), ["a", "b"]);
});

test("newRowIds: only ids not shown before", () => {
  assert.deepEqual(newRowIds([row("a"), row("b")], [row("c"), row("a"), row("d")]), ["c", "d"]);
  assert.deepEqual(newRowIds([], [row("a")]), ["a"]);
});

test("appendUnique: Load More never duplicates; nothing new → same array", () => {
  const prev = [row("a"), row("b")];
  const out = appendUnique(prev, [row("b"), row("c"), row("c")]);
  assert.deepEqual(out.map((r) => r.id), ["a", "b", "c"]);
  assert.equal(appendUnique(prev, [row("a")]), prev);
});

test("versionChanged: different (incl. lower after restart) → refresh; same → no", () => {
  assert.equal(versionChanged(11, 10), true);
  assert.equal(versionChanged(3, 500), true); // restarted server counts from lower
  assert.equal(versionChanged(10, 10), false);
  assert.equal(versionChanged(10, null), true);
  assert.equal(versionChanged(undefined, 10), false);
  assert.equal(versionChanged(NaN, 10), false);
});

test("scheduler: a burst during a run collapses into ONE trailing run", async () => {
  let runs = 0;
  let release;
  const s = createRefreshScheduler(() => { runs++; return new Promise((r) => { release = r; }); }, { minGapMs: 0 });
  s.trigger();
  assert.equal(runs, 1);
  s.trigger(); s.trigger(); s.trigger(); // 3 versions while the first refresh is in flight
  assert.equal(runs, 1);
  release(); await new Promise((r) => setImmediate(r));
  assert.equal(runs, 2); // exactly one follow-up
  release(); await new Promise((r) => setImmediate(r));
  assert.equal(runs, 2);
  s.stop();
});

test("scheduler: runs are spaced by minGapMs (no request storm)", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let runs = 0;
  const s = createRefreshScheduler(async () => { runs++; }, { minGapMs: 1500 });
  await s.trigger();
  assert.equal(runs, 1);
  s.trigger(); s.trigger(); // within the gap → one deferred run
  assert.equal(runs, 1);
  mock.timers.tick(1499);
  assert.equal(runs, 1);
  mock.timers.tick(1);
  await new Promise((r) => setImmediate(r));
  assert.equal(runs, 2);
  s.stop();
  mock.timers.reset();
});

test("scheduler: stop cancels a deferred run", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let runs = 0;
  const s = createRefreshScheduler(async () => { runs++; }, { minGapMs: 1500 });
  s.trigger(); s.trigger();
  s.stop();
  mock.timers.tick(5000);
  assert.equal(runs, 1);
  mock.timers.reset();
});
