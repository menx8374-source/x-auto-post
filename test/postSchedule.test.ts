import { test } from "node:test";
import assert from "node:assert/strict";
import { POST_SLOTS, resolveCurrentSlot } from "../src/postSchedule.js";

test("F7: POST_SLOTSは朝07:30/昼12:15/夜21:00 JSTの3枠として1箇所で定義されている", () => {
  assert.equal(POST_SLOTS.length, 3);
  assert.deepEqual(
    POST_SLOTS.map((s) => ({ id: s.id, label: s.label, hourJst: s.hourJst, minuteJst: s.minuteJst })),
    [
      { id: "morning", label: "朝", hourJst: 7, minuteJst: 30 },
      { id: "noon", label: "昼", hourJst: 12, minuteJst: 15 },
      { id: "evening", label: "夜", hourJst: 21, minuteJst: 0 },
    ]
  );
});

test("F7: 朝枠07:30 JSTちょうどで実行するとmorningと判定される(境界値: elapsed=0)", () => {
  // 2026-07-16 07:30:00 JST = 2026-07-15 22:30:00 UTC
  const now = new Date("2026-07-15T22:30:00.000Z");
  const resolved = resolveCurrentSlot(now, 3);
  assert.ok(resolved);
  assert.equal(resolved?.slot, "morning");
  assert.equal(resolved?.label, "朝");
  assert.equal(resolved?.scheduledAt, "2026-07-15T22:30:00.000Z");
});

test("F7: 昼枠12:15 JSTちょうどで実行するとnoonと判定される", () => {
  // 2026-07-16 12:15:00 JST = 2026-07-16 03:15:00 UTC
  const now = new Date("2026-07-16T03:15:00.000Z");
  const resolved = resolveCurrentSlot(now, 3);
  assert.ok(resolved);
  assert.equal(resolved?.slot, "noon");
  assert.equal(resolved?.label, "昼");
});

test("F7: 夜枠21:00 JSTちょうどで実行するとeveningと判定される", () => {
  // 2026-07-16 21:00:00 JST = 2026-07-16 12:00:00 UTC
  const now = new Date("2026-07-16T12:00:00.000Z");
  const resolved = resolveCurrentSlot(now, 3);
  assert.ok(resolved);
  assert.equal(resolved?.slot, "evening");
  assert.equal(resolved?.label, "夜");
});

test("F7: 許容範囲ぴったり(toleranceHours経過)ならまだ枠として判定される(境界値: elapsed=toleranceMs)", () => {
  // 朝枠07:30 JST + 3時間 = 10:30 JST = 01:30 UTC
  const now = new Date("2026-07-16T01:30:00.000Z");
  const resolved = resolveCurrentSlot(now, 3);
  assert.ok(resolved);
  assert.equal(resolved?.slot, "morning");
});

test("F7: 許容範囲をわずかに超えると枠として判定されない(境界値: elapsed=toleranceMs+1秒)", () => {
  const now = new Date("2026-07-16T01:30:01.000Z"); // 10:30:01 JST
  const resolved = resolveCurrentSlot(now, 3);
  assert.equal(resolved, null);
});

test("F7: 枠の予定時刻より前(まだ来ていない)は判定されない(境界値: elapsed=-1秒)", () => {
  const now = new Date("2026-07-15T22:29:59.000Z"); // 07:29:59 JST、朝枠の1秒前
  const resolved = resolveCurrentSlot(now, 3);
  assert.equal(resolved, null);
});

test("F7(JST日境界): 夜枠21:00 JSTの許容範囲が日付をまたいでも(UTC日は変わらないがJST日が変わる場合含め)正しく判定される", () => {
  // 前日夜枠21:00 JST + 3時間 = 深夜0:00 JST(日付が変わる)。
  // 2026-07-17 00:00:00 JST = 2026-07-16 15:00:00 UTC。前日(2026-07-16)の夜枠(21:00 JST)からちょうど3時間後。
  const now = new Date("2026-07-16T15:00:00.000Z");
  const resolved = resolveCurrentSlot(now, 3);
  assert.ok(resolved);
  assert.equal(resolved?.slot, "evening");
  assert.equal(resolved?.scheduledAt, "2026-07-16T12:00:00.000Z"); // 前日21:00 JST = 12:00 UTC
});

test("F7: toleranceHoursを明示的に指定するとその値が使われる(既定値と異なる挙動を確認)", () => {
  const now = new Date("2026-07-16T02:00:00.000Z"); // 11:00 JST、朝枠から3時間30分経過
  assert.equal(resolveCurrentSlot(now, 3), null); // 既定的な3時間では範囲外
  const resolvedWithWiderTolerance = resolveCurrentSlot(now, 4);
  assert.ok(resolvedWithWiderTolerance);
  assert.equal(resolvedWithWiderTolerance?.slot, "morning");
});
