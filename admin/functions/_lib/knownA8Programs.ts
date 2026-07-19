/**
 * A8.net公式の公開ページ(https://support.a8.net/as/HintOfProgram/selection.php、ログイン不要)に
 * 実際に掲載されている主要ブランド広告主の一覧(ハードコードされた静的配列)。
 * ネットワークアクセスは一切行わない(このファイルはこの配列の参照のみ)。
 *
 * 用途: `/api/applicationTracking` POST(新規作成)で、ユーザーがプログラム名を入力しなかった場合に、
 * `a8ProgramUrl`から抽出した`programId`がこの一覧に含まれていれば、プログラム名を自動的に補完する。
 *
 * 拡張方法: 新たに掲載されているブランドを見つけた場合、programId・programNameの組を追記するだけでよい。
 * 過剰な推測は行わず、実在確認済みのものだけを追加すること。
 */
export interface KnownA8Program {
  programId: string;
  programName: string;
}

export const KNOWN_A8_PROGRAMS: KnownA8Program[] = [
  { programId: "s00000011623", programName: "楽天市場" },
  { programId: "s00000009884", programName: "Amazon" },
  { programId: "s00000001618", programName: "アイリスプラザ" },
  { programId: "s00000022156", programName: "Qoo10" },
  { programId: "s00000013791", programName: "ダイレクトテレショップ" },
];

/** 指定されたprogramIdが既知の主要ブランド一覧に一致すればプログラム名を返す。一致しない・nullの場合はnullを返す。 */
export function lookupKnownProgramName(programId: string | null): string | null {
  if (!programId) return null;
  const found = KNOWN_A8_PROGRAMS.find((p) => p.programId === programId);
  return found ? found.programName : null;
}
