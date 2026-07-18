/**
 * fetch()レスポンスボディをサイズ上限つきで読み取る。
 * SSRF対策の一環(肥大なレスポンスによるメモリ膨張・後続のAI呼び出しでのトークン浪費を防ぐ)。
 * 上限に達した時点で読み取りを打ち切り、それまでに読んだテキストと`truncated`フラグを返す
 * (例外は投げない)。
 */
export interface LimitedReadResult {
  text: string;
  truncated: boolean;
}

export async function readTextWithLimit(response: Response, maxBytes: number): Promise<LimitedReadResult> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= maxBytes) return { text, truncated: false };
    return { text: new TextDecoder().decode(bytes.slice(0, maxBytes)), truncated: true };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      if (received + value.byteLength > maxBytes) {
        const allowed = Math.max(maxBytes - received, 0);
        text += decoder.decode(value.slice(0, allowed));
        truncated = true;
        break;
      }

      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ストリームが既に終了している等でcancelが失敗しても無視してよい
    }
  }

  return { text, truncated };
}
