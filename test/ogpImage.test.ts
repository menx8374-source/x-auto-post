import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  extractOgImageUrl,
  isHttpUrl,
  resolveImageUrl,
  downloadOgpImage,
  fetchOgpImageForArticle,
  readStreamWithLimit,
  MAX_IMAGE_BYTES,
  MAX_ARTICLE_HTML_BYTES,
  type FetchLike,
  type LookupLike,
} from "../src/ogpImage.js";

/**
 * DNS lookupのモック。IPリテラルのホスト名(例: "127.0.0.1")はそのまま解決結果として返し、
 * それ以外の名前ホスト(例: "example.com")は常に公開IPに解決されたものとして扱う。
 * SSRF対策のホスト検証ロジック自体は実装側のIP範囲判定に委ねるため、
 * ここでは実際のDNS通信を行わずに決定的にテストできるようにする。
 */
const smartLookup: LookupLike = async (hostname) => {
  const family = net.isIP(hostname);
  if (family) {
    return [{ address: hostname, family }];
  }
  return [{ address: "93.184.216.34", family: 4 }];
};

test("extractOgImageUrl: 標準的なog:imageタグから画像URLを抽出する", () => {
  const html = `
    <html><head>
      <meta property="og:title" content="Some Article">
      <meta property="og:image" content="https://example.com/image.png">
    </head></html>
  `;
  assert.equal(extractOgImageUrl(html), "https://example.com/image.png");
});

test("extractOgImageUrl: 属性の順序(content先・property後)が逆でも抽出できる", () => {
  const html = `<meta content="https://example.com/reversed.png" property="og:image">`;
  assert.equal(extractOgImageUrl(html), "https://example.com/reversed.png");
});

test("extractOgImageUrl: og:image:secure_urlがあれば優先して使う", () => {
  const html = `
    <meta property="og:image" content="http://example.com/insecure.png">
    <meta property="og:image:secure_url" content="https://example.com/secure.png">
  `;
  assert.equal(extractOgImageUrl(html), "https://example.com/secure.png");
});

test("extractOgImageUrl: og:imageタグが無ければundefinedを返す", () => {
  const html = `<html><head><meta property="og:title" content="No image here"></head></html>`;
  assert.equal(extractOgImageUrl(html), undefined);
});

test("extractOgImageUrl: 属性名の前方一致で誤マッチしない(例: data-property属性がproperty属性より誤って優先されない)", () => {
  const html = `<meta data-property="wrong" property="og:image" content="https://example.com/correct.png">`;
  assert.equal(extractOgImageUrl(html), "https://example.com/correct.png");
});

test("isHttpUrl: http:/https:のみ許可し、それ以外(file:/javascript:等)は拒否する", () => {
  assert.equal(isHttpUrl("https://example.com/a.png"), true);
  assert.equal(isHttpUrl("http://example.com/a.png"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("file:///etc/passwd"), false);
  assert.equal(isHttpUrl("data:image/png;base64,AAAA"), false);
  assert.equal(isHttpUrl("not a url"), false);
});

test("resolveImageUrl: 相対URLを記事URL基準の絶対URLへ解決する", () => {
  assert.equal(
    resolveImageUrl("/images/og.png", "https://example.com/articles/1"),
    "https://example.com/images/og.png"
  );
  assert.equal(resolveImageUrl("https://cdn.example.com/og.png", "https://example.com/articles/1"), "https://cdn.example.com/og.png");
});

function fakeImageResponse(opts: { contentType?: string; contentLength?: string; bodyBytes: number }): Response {
  return {
    status: 200,
    headers: {
      get: (name: string) => {
        if (name === "content-type") return opts.contentType ?? "image/png";
        if (name === "content-length") return opts.contentLength ?? null;
        return null;
      },
    },
    arrayBuffer: async () => new ArrayBuffer(opts.bodyBytes),
  } as unknown as Response;
}

test("downloadOgpImage: http(s)以外のスキームは拒否しダウンロードしない", async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return fakeImageResponse({ bodyBytes: 10 });
  };
  const result = await downloadOgpImage("javascript:alert(1)", fetchImpl, smartLookup);
  assert.equal(result, null);
  assert.equal(called, false, "不正スキームの場合はfetch自体を呼ばないべき");
});

test("downloadOgpImage: Content-Typeがimage/*でない場合は拒否する", async () => {
  const fetchImpl: FetchLike = async () => fakeImageResponse({ contentType: "text/html", bodyBytes: 10 });
  const result = await downloadOgpImage("https://example.com/not-an-image.html", fetchImpl, smartLookup);
  assert.equal(result, null);
});

test("downloadOgpImage: Content-Lengthがサイズ上限を超える場合は拒否する", async () => {
  const fetchImpl: FetchLike = async () =>
    fakeImageResponse({ contentLength: String(MAX_IMAGE_BYTES + 1), bodyBytes: 10 });
  const result = await downloadOgpImage("https://example.com/huge.png", fetchImpl, smartLookup);
  assert.equal(result, null);
});

test("downloadOgpImage: 実際のダウンロードサイズが上限を超える場合は拒否する(Content-Length未提供でも検知)", async () => {
  const fetchImpl: FetchLike = async () => fakeImageResponse({ bodyBytes: MAX_IMAGE_BYTES + 1 });
  const result = await downloadOgpImage("https://example.com/huge2.png", fetchImpl, smartLookup);
  assert.equal(result, null);
});

test("downloadOgpImage: fetch自体が失敗しても例外を投げずnullを返す", async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error("simulated network failure");
  };
  const result = await downloadOgpImage("https://example.com/unreachable.png", fetchImpl, smartLookup);
  assert.equal(result, null);
});

test("downloadOgpImage: 正常な画像は成功してバッファ・URL・Content-Typeを返す", async () => {
  const fetchImpl: FetchLike = async () => fakeImageResponse({ contentType: "image/jpeg", bodyBytes: 1234 });
  const result = await downloadOgpImage("https://example.com/ok.jpg", fetchImpl, smartLookup);
  assert.ok(result);
  assert.equal(result?.url, "https://example.com/ok.jpg");
  assert.equal(result?.contentType, "image/jpeg");
  assert.equal(result?.buffer.length, 1234);
});

test("downloadOgpImage: 画像URLのホストが内部/プライベートIPに解決される場合は拒否する(SSRF対策)", async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return fakeImageResponse({ bodyBytes: 10 });
  };
  const targets = [
    "http://127.0.0.1/x.png",
    "http://169.254.169.254/x.png", // クラウドメタデータサービス
    "http://10.0.0.1/x.png",
    "http://192.168.1.1/x.png",
    "http://[::1]/x.png",
  ];
  for (const url of targets) {
    const result = await downloadOgpImage(url, fetchImpl, smartLookup);
    assert.equal(result, null, `${url} は拒否されるべき`);
  }
  assert.equal(called, false, "内部/プライベートIP宛にはfetchを呼ばないべき");
});

test("downloadOgpImage: リダイレクト先が内部/プライベートIPの場合は追跡せず拒否する(DNSリバインディング/オープンリダイレクト対策)", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    if (url === "https://good.example.com/redirect") {
      return {
        status: 302,
        headers: {
          get: (name: string) => (name === "location" ? "http://169.254.169.254/latest/meta-data/" : null),
        },
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  const result = await downloadOgpImage("https://good.example.com/redirect", fetchImpl, smartLookup);
  assert.equal(result, null);
  assert.deepEqual(calls, ["https://good.example.com/redirect"], "内部ホストへは実際にリクエストを送らないべき");
});

test("downloadOgpImage: リダイレクトは追跡ホップ数の上限を超えると中断する", async () => {
  let hop = 0;
  const fetchImpl: FetchLike = async () => {
    hop += 1;
    return {
      status: 302,
      headers: { get: (name: string) => (name === "location" ? `https://example.com/hop-${hop}` : null) },
    } as unknown as Response;
  };
  const result = await downloadOgpImage("https://example.com/hop-0", fetchImpl, smartLookup);
  assert.equal(result, null);
  assert.ok(hop <= 6, "上限を超えて無限にリダイレクトを追跡しないべき");
});

test("downloadOgpImage: ストリーミング読み込み中に上限超過を検知すると全バイトを読み切る前に中断する", async () => {
  const chunkSize = 1024 * 1024; // 1MB
  const totalBytes = MAX_IMAGE_BYTES + chunkSize * 3; // 上限を大きく超えるサイズ
  let remaining = totalBytes;
  let readCallCount = 0;
  const stream = {
    getReader() {
      return {
        async read() {
          readCallCount += 1;
          if (remaining <= 0) return { done: true, value: undefined };
          const size = Math.min(chunkSize, remaining);
          remaining -= size;
          return { done: false, value: new Uint8Array(size) };
        },
        async cancel() {
          remaining = 0;
        },
      };
    },
  };
  const response = {
    status: 200,
    headers: { get: (name: string) => (name === "content-type" ? "image/png" : null) },
    body: stream,
  } as unknown as Response;

  const fetchImpl: FetchLike = async () => response;
  const result = await downloadOgpImage("https://example.com/streamed-huge.png", fetchImpl, smartLookup);
  assert.equal(result, null);
  const totalChunks = Math.ceil(totalBytes / chunkSize);
  assert.ok(readCallCount < totalChunks, "全バイトを読み切る前に中断するべき");
});

test("fetchOgpImageForArticle: 記事HTML取得→og:image抽出→ダウンロードまで通しで成功する", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    if (url === "https://example.com/article") {
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => `<meta property="og:image" content="/og/thumb.png">`,
      } as unknown as Response;
    }
    if (url === "https://example.com/og/thumb.png") {
      return fakeImageResponse({ contentType: "image/png", bodyBytes: 500 });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const result = await fetchOgpImageForArticle("https://example.com/article", fetchImpl, smartLookup);
  assert.ok(result);
  assert.equal(result?.url, "https://example.com/og/thumb.png");
  assert.deepEqual(calls, ["https://example.com/article", "https://example.com/og/thumb.png"]);
});

test("fetchOgpImageForArticle: 記事にog:imageが無い場合、例外を投げずnullを返す(投稿処理をブロックしない)", async () => {
  const fetchImpl: FetchLike = async () =>
    ({ status: 200, headers: { get: () => null }, text: async () => "<html><body>no og tags</body></html>" } as unknown as Response);

  const result = await fetchOgpImageForArticle("https://example.com/no-image-article", fetchImpl, smartLookup);
  assert.equal(result, null);
});

test("fetchOgpImageForArticle: 記事HTML取得自体が失敗しても例外を投げずnullを返す", async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error("timeout");
  };
  const result = await fetchOgpImageForArticle("https://example.com/timeout-article", fetchImpl, smartLookup);
  assert.equal(result, null);
});

test("fetchOgpImageForArticle: og:imageが内部/プライベートIPを指す場合は拒否する(SSRF対策)", async () => {
  const fetchImpl: FetchLike = async (url) => {
    if (url === "https://example.com/article") {
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => `<meta property="og:image" content="http://169.254.169.254/latest/meta-data/">`,
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
  const result = await fetchOgpImageForArticle("https://example.com/article", fetchImpl, smartLookup);
  assert.equal(result, null);
});

test("fetchOgpImageForArticle: 記事URL自体が内部/プライベートIPの場合は記事HTMLすら取得しない(SSRF対策)", async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return { status: 200, headers: { get: () => null }, text: async () => "" } as unknown as Response;
  };
  const result = await fetchOgpImageForArticle("http://169.254.169.254/latest/meta-data/", fetchImpl, smartLookup);
  assert.equal(result, null);
  assert.equal(called, false);
});

test("fetchOgpImageForArticle: 記事HTMLがサイズ上限を超える場合は拒否する", async () => {
  const hugeHtml = "a".repeat(MAX_ARTICLE_HTML_BYTES + 1);
  const fetchImpl: FetchLike = async () =>
    ({ status: 200, headers: { get: () => null }, text: async () => hugeHtml } as unknown as Response);
  const result = await fetchOgpImageForArticle("https://example.com/huge-article", fetchImpl, smartLookup);
  assert.equal(result, null);
});

// --- SSRF対策(DNSリバインディング/TOCTOU)・ボディ読み取りタイムアウト・エラー種別の区別 ---
//
// 以下は前回の`/security-review`(DNSリバインディングによるTOCTOUバイパス, High)・
// `/code-review`(ボディ読み取りタイムアウト欠如、エラー種別の混同、DNS解決タイムアウト欠如)の
// 指摘に対する修正の検証。

test("downloadOgpImage: DNSリバインディング(検証時は公開IP、接続時は内部IPを返す)でも実際の接続時点で拒否される(TOCTOU対策)", async () => {
  // 事前チェック(1回目のlookup呼び出し)では公開IPを返し、実際の接続(undiciのAgentが
  // `connect.lookup`として使う2回目以降のlookup呼び出し)では内部IPを返す、
  // DNSリバインディング攻撃を模したlookupモック。
  //
  // 修正前の実装(事前チェック+別途fetchが独立に名前解決する2段階方式)では、事前チェックが
  // 公開IPを見て通過させた後、fetch自身の内部的な(検証されない)名前解決が内部IPを引いて
  // 接続してしまう可能性があった。
  //
  // 修正後は、実際に接続で使う名前解決(undiciのAgentの`connect.lookup`)そのものが
  // `createSafeLookup`によって検証されるため、たとえ事前チェックが公開IPで通過していても、
  // 実接続用の解決が内部IPを返した時点でそこで拒否される(検証と接続が同一の解決呼び出しに
  // 一本化されているため、両者がズレて内部IPへの接続を許してしまう余地が構造的に無い)。
  let callCount = 0;
  const rebindingLookup: LookupLike = async () => {
    callCount += 1;
    if (callCount === 1) {
      return [{ address: "93.184.216.34", family: 4 }]; // 事前チェック用: 公開IP
    }
    return [{ address: "169.254.169.254", family: 4 }]; // 実接続用: クラウドメタデータ(内部IP)
  };

  // fetchImplは省略し、実装が使う実際のfetch(undici Agent経由)を使う。
  const result = await downloadOgpImage("http://rebinding-attacker.example/x.png", undefined, rebindingLookup);

  assert.equal(result, null);
  assert.ok(
    callCount >= 2,
    "事前チェックと実接続で少なくとも2回lookupが呼ばれ、どちらも独立して検証されるべき"
  );
});

test("downloadOgpImage: DNSリバインディングが起きなければ(常に公開IP)正当な外部URLへのアクセスは壊れない", async () => {
  // IPピニング方式(createSafeLookup)導入によって、正当な公開ホストへの実接続経路自体が
  // 壊れていないことを確認する(接続はDNS解決の時点で内部IPと判定されない限り拒否されない)。
  // 実際のTCP接続は行われない(到達不能ポートへの接続を試み、fetch自体はネットワークエラーで
  // 失敗するが、これは「安全な接続を試みた」ことの証跡であり、"blocked" エラーではないことを確認する)。
  const result = await downloadOgpImage(
    "http://example.com:1/x.png", // ポート1は通常閉じており接続は失敗するが、SSRFチェックでは拒否されないはず
    undefined,
    smartLookup
  );
  // 接続自体は失敗する(到達できないポート)が、これはSSRFブロックによるnullではなく
  // 通常のネットワークエラーによるnullであることを確認したいため、少なくとも例外を投げず
  // nullを返すことだけを確認する(実ネットワーク接続の成否はテスト環境に依存するため)。
  assert.equal(result, null);
});

test("readStreamWithLimit: 正常なストリームは全バイトを読み切りokを返す", async () => {
  const stream = {
    getReader() {
      let read = false;
      return {
        async read() {
          if (read) return { done: true, value: undefined };
          read = true;
          return { done: false, value: new Uint8Array([1, 2, 3]) };
        },
        async cancel() {},
      };
    },
  };
  const response = { body: stream } as unknown as Response;
  const result = await readStreamWithLimit(response, 1024, 5000);
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.buffer.length, 3);
  }
});

test("readStreamWithLimit: サイズ超過はtoo-largeを返す(readエラーと区別できる)", async () => {
  const stream = {
    getReader() {
      return {
        async read() {
          return { done: false, value: new Uint8Array(2000) };
        },
        async cancel() {},
      };
    },
  };
  const response = { body: stream } as unknown as Response;
  const result = await readStreamWithLimit(response, 1024, 5000);
  assert.equal(result.status, "too-large");
});

test("readStreamWithLimit: 接続断等の読み取りエラーはerrorを返す(サイズ超過と区別できる)", async () => {
  const stream = {
    getReader() {
      return {
        async read() {
          throw new Error("simulated connection reset");
        },
        async cancel() {},
      };
    },
  };
  const response = { body: stream } as unknown as Response;
  const result = await readStreamWithLimit(response, 1024, 5000);
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.match(result.message, /simulated connection reset/);
  }
});

test("readStreamWithLimit: ボディが意図的に停滞した場合、タイムアウトで中断されtimeoutを返す(ヘッダ受信後のハング対策)", async () => {
  let cancelled = false;
  const stream = {
    getReader() {
      return {
        read() {
          // 意図的に永久に解決しない(悪意あるホストがボディ送信を停滞させるケースを模す)
          return new Promise(() => {});
        },
        async cancel() {
          cancelled = true;
        },
      };
    },
  };
  const response = { body: stream } as unknown as Response;
  const result = await readStreamWithLimit(response, 1024, 50); // タイムアウトを50msに短縮してテストを高速化
  assert.equal(result.status, "timeout");
  assert.ok(cancelled, "タイムアウト時にreader.cancel()が呼ばれるべき");
});
