/**
 * F7: 1日3回・固定時刻でのスケジュール投稿。
 *
 * 投稿枠(朝/昼/夜)の目安時刻を1箇所(src/config.tsの`getPostSlots()`、F12: 設定管理)で管理し、
 * 現在時刻(または注入した時刻)からどの枠に該当するかを判定する(resolveCurrentSlot)。
 *
 * 時刻は必ずJST(UTC+9固定オフセット)基準で判定する。日本にサマータイムは無いため固定オフセットで
 * よい(Sprint 7でtoDateKeyがUTC基準になっていたことによる日境界バグが見つかった教訓を踏襲)。
 */
import { DEFAULT_RECOVERY_WINDOW_HOURS, getConfiguredRecoveryWindowHours } from "./postHistory.js";
import { getPostSlots, getAffiliatePostSlot } from "./config.js";

/** JSTとUTCの固定オフセット(ミリ秒) */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface PostSlotDefinition {
  /** 投稿枠の識別子。投稿履歴のslotフィールド・冪等性判定のキーとして使う */
  id: string;
  /** 人間可読なラベル(ログ・通知用) */
  label: string;
  /** 目安時刻(JST)の時 */
  hourJst: number;
  /** 目安時刻(JST)の分 */
  minuteJst: number;
}

/**
 * F7/F12: 投稿枠の目安時刻。既定は07:30(朝)/12:15(昼)/21:00(夜) JST(通勤/始業前・昼休み・夜のピーク帯を狙う)。
 * Sprint 10より、実際の値の取得元はsrc/config.tsの`getPostSlots()`に一元化した
 * (`POST_SLOT_MORNING_TIME`等の環境変数で上書き可能)。この定数はモジュール読み込み時点の値
 * (主に後方互換・表示用)であり、`resolveCurrentSlot()`は呼び出しのたびに`getPostSlots()`を
 * 読み直すため`.env`の変更が実行に反映される。
 */
export const POST_SLOTS: PostSlotDefinition[] = getPostSlots();

export interface ResolvedSlot {
  /** 該当した投稿枠の識別子(POST_SLOTS[].id) */
  slot: string;
  /** 該当した投稿枠のラベル */
  label: string;
  /** その枠の本来の予定時刻(ISO8601、UTC) */
  scheduledAt: string;
}

/** 指定した時刻(UTC)をJSTの年月日に変換する(postHistory.tsのtoDateKeyと同じ+9時間シフト方式) */
function jstDateParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** JSTのある暦日+枠の目安時刻を、実際のUTC時刻(Date)に変換する */
function scheduledAtForJstDate(
  slot: PostSlotDefinition,
  parts: { year: number; month: number; day: number }
): Date {
  const utcMs =
    Date.UTC(parts.year, parts.month - 1, parts.day, slot.hourJst, slot.minuteJst, 0) - JST_OFFSET_MS;
  return new Date(utcMs);
}

/**
 * 現在時刻(または注入した時刻)から、どの投稿枠に該当するかを判定する。
 *
 * 判定ロジック: 各枠のJST基準の目安時刻(当日・前日の両方を候補にする。夜枠21:00からの
 * 許容範囲が日付をまたいで翌日未明まで及ぶケースに対応するため)について、
 * 「now >= scheduledAt かつ (now - scheduledAt) <= toleranceHours」を満たすものを候補とし、
 * 最も直近に予定時刻を迎えた枠を返す。該当する枠が無ければnullを返す(現在どの枠の
 * 実行タイミングでもない)。
 *
 * toleranceHoursの既定値はSprint 7で導入した不発リカバリ許容範囲
 * (getConfiguredRecoveryWindowHours、環境変数POST_RECOVERY_WINDOW_HOURSで上書き可)と共通化し、
 * 「枠の判定」と「不発リカバリの許容範囲」で矛盾しない挙動にする。
 */
export function resolveCurrentSlot(
  now: Date = new Date(),
  toleranceHours: number = getConfiguredRecoveryWindowHours()
): ResolvedSlot | null {
  // F12: POST_SLOTS(モジュール読み込み時点の値)ではなく、呼び出しのたびにgetPostSlots()を
  // 読み直すことで、`.env`側の投稿時刻設定の変更を実行のたびに反映する。
  const slots = getPostSlots();
  const todayParts = jstDateParts(now);
  const yesterdayParts = jstDateParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const toleranceMs = toleranceHours * 60 * 60 * 1000;

  let best: { slot: PostSlotDefinition; scheduledAt: Date; elapsedMs: number } | undefined;

  for (const parts of [todayParts, yesterdayParts]) {
    for (const slot of slots) {
      const scheduledAt = scheduledAtForJstDate(slot, parts);
      const elapsedMs = now.getTime() - scheduledAt.getTime();
      if (elapsedMs < 0 || elapsedMs > toleranceMs) {
        continue;
      }
      if (!best || elapsedMs < best.elapsedMs) {
        best = { slot, scheduledAt, elapsedMs };
      }
    }
  }

  if (!best) {
    return null;
  }

  return {
    slot: best.slot.id,
    label: best.slot.label,
    scheduledAt: best.scheduledAt.toISOString(),
  };
}

export interface ResolvedAffiliateSlot {
  /** アフィリエイト投稿枠の識別子(常に"affiliate") */
  slot: string;
  /** 枠のラベル */
  label: string;
  /** その枠の本来の予定時刻(ISO8601、UTC) */
  scheduledAt: string;
}

/**
 * アフィリエイト投稿枠(既定19:00 JST、1日1枠。AIニュース3枠とは完全に独立)の判定。
 * `resolveCurrentSlot`と同じJST基準・日境界セーフなロジック(jstDateParts/scheduledAtForJstDate)を
 * 再利用しつつ、AIニュース枠(POST_SLOTS)とは独立した専用の判定関数として実装する
 * (両者の投稿履歴ファイルが別なので、冪等性判定も自然に分離される)。
 */
export function resolveCurrentAffiliateSlot(
  now: Date = new Date(),
  toleranceHours: number = getConfiguredRecoveryWindowHours()
): ResolvedAffiliateSlot | null {
  const slot = getAffiliatePostSlot();
  const todayParts = jstDateParts(now);
  const yesterdayParts = jstDateParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const toleranceMs = toleranceHours * 60 * 60 * 1000;

  let best: { scheduledAt: Date; elapsedMs: number } | undefined;

  for (const parts of [todayParts, yesterdayParts]) {
    const scheduledAt = scheduledAtForJstDate(slot, parts);
    const elapsedMs = now.getTime() - scheduledAt.getTime();
    if (elapsedMs < 0 || elapsedMs > toleranceMs) {
      continue;
    }
    if (!best || elapsedMs < best.elapsedMs) {
      best = { scheduledAt, elapsedMs };
    }
  }

  if (!best) {
    return null;
  }

  return { slot: slot.id, label: slot.label, scheduledAt: best.scheduledAt.toISOString() };
}

// re-export for callers that only need the default tolerance without importing postHistory directly
export { DEFAULT_RECOVERY_WINDOW_HOURS };
