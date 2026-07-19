import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupKnownProgramName, KNOWN_A8_PROGRAMS } from "../functions/_lib/knownA8Programs";

test("lookupKnownProgramNameは既知のprogramIdに一致すればプログラム名を返す", () => {
  assert.equal(lookupKnownProgramName("s00000011623"), "楽天市場");
  assert.equal(lookupKnownProgramName("s00000009884"), "Amazon");
});

test("lookupKnownProgramNameは既知一覧に一致しないprogramIdの場合nullを返す", () => {
  assert.equal(lookupKnownProgramName("s00000000000"), null);
});

test("lookupKnownProgramNameはprogramIdがnullの場合nullを返す", () => {
  assert.equal(lookupKnownProgramName(null), null);
});

test("KNOWN_A8_PROGRAMSは空でない配列で、各要素がprogramId/programNameを持つ", () => {
  assert.ok(KNOWN_A8_PROGRAMS.length > 0);
  for (const entry of KNOWN_A8_PROGRAMS) {
    assert.equal(typeof entry.programId, "string");
    assert.equal(typeof entry.programName, "string");
    assert.ok(entry.programId.length > 0);
    assert.ok(entry.programName.length > 0);
  }
});
