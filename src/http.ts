/** タイムアウト付きfetch。情報源への通信が長時間ハングして全体処理を止めないためのガード */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}
