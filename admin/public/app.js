// アフィリエイト商品管理ページのフロントエンドロジック。
// フレームワーク不要の素のJS。ビルドステップなしでそのまま配信できることが要件のため、
// モジュールバンドラは使わずブラウザネイティブのESモジュール(<script type="module">)のみで完結させる。
import { slugifyProductName } from "./candidateSlug.js";
import { findConflictingProduct } from "./productConflict.js";
import { buildA8SearchUrl, copyTextSafely, buildA8GuideMessage } from "./a8Search.js";
import { resolveEnabledOnSubmit } from "./productEnabled.js";

(() => {
  "use strict";

  const appEl = document.getElementById("app");
  const logoutButton = document.getElementById("logout-button");

  /** @type {{products: Array<object>, tracking: Array<object>, formOpen: boolean, pendingRender: boolean}} */
  const state = {
    products: [],
    // 提携申請の進捗(A8.netプログラム詳細ページURLの貼り付けから記録したトラッキングエントリ一覧)。
    tracking: [],
    // 編集/追加フォームが開いている間は、バックグラウンドの再描画(renderApp)で
    // 入力内容が消えてしまわないようscheduleRender()経由で再描画を保留する。
    formOpen: false,
    pendingRender: false,
  };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2), value);
        } else if (value !== undefined && value !== null) {
          node.setAttribute(key, value);
        }
      }
    }
    (children || []).forEach((child) => {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  /** http:/https:のURLのみ許可する(外部情報源由来のURLがあるため、admin/functions/_lib/validate.tsのisHttpUrlと同じ検証をフロントにも複製する) */
  function isHttpUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  /**
   * fetch()自体の例外(オフライン・DNS失敗等)・レスポンスがJSONでない場合のいずれも
   * 呼び出し元が同じ形(`networkError`の有無)で判定できるようにする。
   * fetch()が例外を投げるケースをここで必ず捕捉し、呼び出し元でのtry/catch漏れによる
   * 未処理のPromise rejection(画面が固まりエラー表示もされない状態)を防ぐ。
   */
  async function fetchJSON(url, options) {
    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options && options.headers) },
      });
    } catch (err) {
      return { res: null, data: null, networkError: err instanceof Error ? err.message : String(err) };
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      // レスポンスがJSONでない場合はdata=nullのまま扱う(res.okで判定する)
    }
    return { res, data, networkError: null };
  }

  function showError(message) {
    appEl.innerHTML = "";
    appEl.appendChild(el("p", { class: "error-banner", text: message }));
  }

  function renderLogin() {
    logoutButton.hidden = true;
    appEl.innerHTML = "";
    const tpl = document.getElementById("tpl-login");
    appEl.appendChild(tpl.content.cloneNode(true));
  }

  /** フォームが開いている間は再描画を保留し、閉じたタイミングで実際に描画する */
  function scheduleRender() {
    if (state.formOpen) {
      state.pendingRender = true;
      return;
    }
    renderApp();
  }

  function renderApp() {
    logoutButton.hidden = false;
    appEl.innerHTML = "";

    appEl.appendChild(renderAffiliateQuickAddSection());

    appEl.appendChild(
      el("section", { class: "card" }, [
        el("div", { class: "section-header" }, [
          el("h2", { text: "商品一覧" }),
          el("button", { class: "btn btn-primary", type: "button", onclick: () => openForm(null) }, ["+ 商品を追加"]),
        ]),
        renderProductList(),
      ])
    );

    appEl.appendChild(renderCategorySearchSection());
    appEl.appendChild(renderTrackingFormSection());
    appEl.appendChild(renderTrackingSection());
  }

  /** カテゴリからA8.netを探す際の固定キーワード一覧 */
  const CATEGORY_SEARCHES = [
    { label: "技術系(プログラミング・ITツール)", keyword: "プログラミング" },
    { label: "転職系(転職エージェント・求人)", keyword: "転職" },
    { label: "学習・スキルアップ系(オンライン講座)", keyword: "オンライン講座" },
    { label: "ビジネスツール系(SaaS・サブスク)", keyword: "ビジネスツール" },
    { label: "電子製品系(イヤホン・ガジェット)", keyword: "イヤホン" },
  ];

  /**
   * 「カテゴリからA8.netを探す」セクション。固定キーワードのボタンを押すと、既存の
   * buildA8SearchUrl(keyword)でA8.netの検索結果ページを新しいタブで開くだけ(既存のA8.net
   * ショートカット機能と同じ挙動)。A8.netへの自動ログイン・自動検索・自動提携申請は行わない。
   */
  function renderCategorySearchSection() {
    const buttons = CATEGORY_SEARCHES.map((entry) =>
      el(
        "button",
        { class: "btn btn-secondary", type: "button", onclick: () => openA8CategorySearch(entry.keyword) },
        [entry.label]
      )
    );
    return el("section", { class: "card" }, [
      el("h2", { text: "カテゴリからA8.netを探す" }),
      el("p", {
        class: "hint-note",
        text: "カテゴリを選ぶとA8.netの検索結果ページを新しいタブで開きます(未ログインの場合はログイン画面が表示されます)。",
      }),
      el("div", { class: "category-search-list" }, buttons),
    ]);
  }

  /**
   * カテゴリ検索キーワードでA8.netの検索結果ページを新しいタブで開く(自動ログイン・自動検索・
   * 自動提携申請は行わない)。念のためキーワードもクリップボードにコピーする。
   * @param {string} keyword
   */
  async function openA8CategorySearch(keyword) {
    window.open(buildA8SearchUrl(keyword), "_blank", "noopener,noreferrer");
    const copied = await copyTextSafely(keyword, window.navigator && window.navigator.clipboard);
    window.alert(
      copied
        ? `A8.netの検索結果ページを新しいタブで開きました(検索キーワード「${keyword}」はコピー済みです)。`
        : `A8.netの検索結果ページを新しいタブで開きました。クリップボードへのコピーには失敗したため、検索キーワード「${keyword}」をご自身で検索欄に入力してください。`
    );
  }

  /**
   * 「アフィリエイトリンクを貼るだけで追加」セクションを描画する。
   * A8.netの広告リンク作成画面で取得できる「リンク先URLをコピー」のリンク1つだけから、
   * `POST /api/resolveAffiliateLink`でリダイレクト先(officialUrl)・商品名・画像・事実情報を
   * 自動解決し、商品追加フォームを事前入力した状態で開く(商品ID・商品名は必須入力にしない)。
   */
  function renderAffiliateQuickAddSection() {
    const tpl = document.getElementById("tpl-affiliate-quick-add");
    const fragment = tpl.content.cloneNode(true);
    const section = fragment.querySelector(".affiliate-quick-add");
    const input = fragment.querySelector("#affiliate-quick-add-input");
    const button = fragment.querySelector("#affiliate-quick-add-button");
    const statusEl = fragment.querySelector("#affiliate-quick-add-status");

    button.addEventListener("click", () => resolveAffiliateLinkAndOpenForm(input, statusEl, button));

    return section;
  }

  /**
   * アフィリエイトリンクを解決し、商品追加フォームを事前入力した状態で開く。
   * 【重要】ユーザーが入力欄に貼り付けた元のaffiliateUrl(`affiliateUrl`変数)は、A8.netの
   * 成果計測トラッキングパラメータ(a8mat=等)を含むため、サーバーのレスポンスではなく
   * この変数の値をそのままフォームのaffiliateUrl欄に設定する(書き換え厳禁)。
   * 失敗時はエラーメッセージを表示するのみで、フォームは開かない
   * (ユーザーが手動で「+ 商品を追加」から入力できる状態を維持する)。
   * @param {HTMLInputElement} input
   * @param {HTMLElement} statusEl
   * @param {HTMLButtonElement} button
   */
  async function resolveAffiliateLinkAndOpenForm(input, statusEl, button) {
    const affiliateUrl = input.value.trim();
    statusEl.hidden = false;

    if (!affiliateUrl || !isHttpUrl(affiliateUrl)) {
      statusEl.textContent = "アフィリエイトリンク(http:またはhttps:)を入力してから実行してください。";
      return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "解析中...";
    statusEl.textContent = "リンク先を確認しています...(数秒かかることがあります)";

    const { res, data, networkError } = await fetchJSON("/api/resolveAffiliateLink", {
      method: "POST",
      body: JSON.stringify({ affiliateUrl }),
    });

    button.disabled = false;
    button.textContent = originalLabel;

    if (networkError) {
      statusEl.textContent = `通信エラーが発生しました: ${networkError}`;
      return;
    }
    if (!res.ok) {
      statusEl.textContent = (data && data.error) || "リンクの解析に失敗しました。";
      return;
    }

    const name = (data && data.name) || "";
    const officialUrl = (data && data.officialUrl) || "";
    const imageUrl = (data && data.imageUrl) || "";
    const facts = data && Array.isArray(data.facts) ? data.facts : [];

    statusEl.textContent = "";
    statusEl.hidden = true;
    input.value = "";

    openForm(null, {
      id: name ? slugifyProductName(name) : "",
      name,
      officialUrl,
      imageUrl,
      facts: facts.join("\n"),
      // サーバーのレスポンスにはaffiliateUrlを含めない設計のため、ユーザーが入力した元の値を使う
      affiliateUrl,
    });
  }

  function renderProductList() {
    if (state.products.length === 0) {
      return el("p", { class: "empty-state", text: "登録済みの商品はまだありません。" });
    }
    const list = el("ul", { class: "product-list" });
    state.products.forEach((product) => {
      list.appendChild(renderProductCard(product));
    });
    return list;
  }

  function renderProductCard(product) {
    const statusLabel = product.enabled ? "有効" : "無効";
    const statusClass = product.enabled ? "badge badge-on" : "badge badge-off";

    const checkbox = el("input", {
      type: "checkbox",
      onchange: (e) => toggleEnabled(product, e.target.checked),
    });
    checkbox.checked = Boolean(product.enabled);

    return el("li", { class: "product-card" }, [
      el("div", { class: "product-card-header" }, [
        el("span", { class: "product-name", text: product.name }),
        el("span", { class: statusClass, text: statusLabel }),
      ]),
      product.category ? el("p", { class: "product-category", text: product.category }) : null,
      el("p", { class: "product-id", text: `ID: ${product.id}` }),
      el("div", { class: "product-card-actions" }, [
        el("label", { class: "toggle-label" }, [checkbox, " 投稿対象"]),
        el("button", { class: "btn btn-secondary", type: "button", onclick: () => openForm(product) }, ["編集"]),
      ]),
    ]);
  }

  /** リダイレクトページ再生成ワークフローの起動が失敗した場合、商品保存自体は成功していても利用者に伝える */
  function warnIfRedirectsNotRegenerated(data) {
    if (data && data.redirectsRegenerated === false) {
      window.alert(
        "商品データは保存されましたが、リンクページ(docs/go/)の再生成ワークフロー起動に失敗しました。" +
          "GitHub Actionsの「regenerate-redirects」を手動実行してください。"
      );
    }
  }

  /**
   * 機能1: A8.netへのショートカット(申請リンク)。
   * A8.net公式ページ(support.a8.net/as/HintOfProgram/selection.php)のHTMLソースに
   * 実際に埋め込まれているhref値から抽出したURLパターンを用いて、商品名を付与した
   * プログラム検索結果ページを新しいタブで開く(未ログイン時はログイン再認証画面が
   * 表示される)。商品名はクリップボードにもコピーし、貼り付け直しの保険とする。
   * @param {string} name
   */
  async function openA8Search(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) {
      window.alert("商品名が未入力のため、A8.netでの検索を開けません。商品名を入力してから実行してください。");
      return;
    }
    window.open(buildA8SearchUrl(trimmed), "_blank", "noopener,noreferrer");
    const copied = await copyTextSafely(trimmed, window.navigator && window.navigator.clipboard);
    window.alert(buildA8GuideMessage(trimmed, copied));
  }

  /**
   * 機能2: 公式サイトURLから事実情報(facts)を自動提案。
   * `POST /api/suggestFacts`の結果を、現在のfacts欄に「追記」する(既存の入力は上書きしない)。
   * あくまで下書き候補であり、ユーザーが確認・編集した上で保存する運用(自動保存はしない)。
   * @param {HTMLFormElement} form
   */
  async function suggestFactsFromOfficialUrl(form) {
    const statusEl = form.querySelector("#suggest-facts-status");
    const button = form.querySelector("#suggest-facts-button");
    const officialUrl = form.elements.officialUrl.value.trim();

    statusEl.hidden = false;

    if (!officialUrl || !isHttpUrl(officialUrl)) {
      statusEl.textContent = "公式サイトURL(http:またはhttps:)を入力してから実行してください。";
      return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "提案を取得中...";
    statusEl.textContent = "公式サイトの内容を確認しています...(数秒かかることがあります)";

    const { res, data, networkError } = await fetchJSON("/api/suggestFacts", {
      method: "POST",
      body: JSON.stringify({ officialUrl }),
    });

    button.disabled = false;
    button.textContent = originalLabel;

    if (networkError) {
      statusEl.textContent = `通信エラーが発生しました: ${networkError}`;
      return;
    }
    if (!res.ok) {
      statusEl.textContent = (data && data.error) || "事実情報の提案取得に失敗しました。";
      return;
    }

    const facts = data && Array.isArray(data.facts) ? data.facts : [];
    if (facts.length === 0) {
      statusEl.textContent = "公式サイトから事実情報を抽出できませんでした。手動で入力してください。";
      return;
    }

    const factsField = form.elements.facts;
    const existing = factsField.value.trim();
    factsField.value = existing ? `${existing}\n${facts.join("\n")}` : facts.join("\n");
    statusEl.textContent = `${facts.length}件の候補をfacts欄に追記しました。内容を確認・編集してから保存してください。`;
  }

  async function toggleEnabled(product, enabled) {
    const updated = { ...product, enabled };
    const { res, data, networkError } = await fetchJSON("/api/products", {
      method: "POST",
      body: JSON.stringify(updated),
    });
    if (networkError) {
      window.alert(`通信エラーが発生しました: ${networkError}`);
      scheduleRender(); // チェックボックスの見た目をstate.products(未変更)に基づいて元に戻す
      return;
    }
    if (!res.ok) {
      window.alert(`更新に失敗しました: ${(data && data.error) || res.status}`);
      scheduleRender();
      return;
    }
    warnIfRedirectsNotRegenerated(data);
    await reloadProducts();
  }

  /**
   * 商品追加/編集フォームを開く。
   * - `product`が指定された場合: 既存商品の編集(IDは変更不可)。
   * - `product`がnullで`prefill`が指定された場合: アフィリエイトリンク自動解決・提携申請の
   *   進捗記録からの新規追加(下書き)。IDは変更可能(自動生成したスラッグの手直しを許すため)、
   *   enabledは常にオフのまま、factsは空(公式サイトを確認してユーザー自身が入力する運用のため、
   *   ヒントプレースホルダのみ表示)。
   * - どちらも未指定: 通常の空フォーム。
   */
  function openForm(product, prefill) {
    const tpl = document.getElementById("tpl-product-form");
    const existing = document.getElementById("product-form");
    if (existing) existing.remove();

    const fragment = tpl.content.cloneNode(true);
    const form = fragment.querySelector("#product-form");
    const title = fragment.querySelector(".form-title");

    // 新規追加(product===null)か既存編集かをsubmitForm側で判定できるようにする(重複ID検知のため。
    // /api/products のPOSTはidが一致すると既存商品を無条件に上書きする「更新」として扱われるため、
    // 新規追加のつもりで既存の有効な商品のidと衝突すると、警告なくfacts等が空のドラフトで
    // 上書き・データ消失してしまう。新規追加時のみクライアント側で衝突を検知しブロックする)。
    form.dataset.editing = product ? "true" : "false";

    if (product) {
      title.textContent = `商品を編集: ${product.name}`;
      form.elements.id.value = product.id;
      form.elements.id.readOnly = true; // 既存商品のIDは変更不可(別商品として重複登録されるのを防ぐ)
      form.elements.name.value = product.name;
      form.elements.officialUrl.value = product.officialUrl;
      form.elements.imageUrl.value = product.imageUrl || "";
      form.elements.affiliateUrl.value = product.affiliateUrl;
      form.elements.facts.value = (product.facts || []).join("\n");
      form.elements.category.value = product.category || "";
      form.elements.enabled.checked = Boolean(product.enabled);
    } else if (prefill) {
      title.textContent = prefill.affiliateUrl
        ? "商品を追加(アフィリエイトリンクから)"
        : "商品を追加";
      form.elements.id.value = prefill.id || "";
      form.elements.name.value = prefill.name || "";
      form.elements.officialUrl.value = prefill.officialUrl || "";
      form.elements.imageUrl.value = prefill.imageUrl || "";
      if (prefill.affiliateUrl) {
        // ユーザーが入力欄に貼り付けた元の値をそのまま使う(A8.netのトラッキングパラメータを保持するため書き換え厳禁)
        form.elements.affiliateUrl.value = prefill.affiliateUrl;
      }
      form.elements.facts.value = prefill.facts || "";
      if (!prefill.facts) {
        form.elements.facts.placeholder = "公式サイトを確認し、事実ベースの特長を1行ずつ入力してください";
      }
      form.elements.enabled.checked = false; // 下書き状態: 保存時のresolveEnabledOnSubmitにより、affiliateUrlが有効なら自動でtrueになる
    } else {
      title.textContent = "商品を追加";
    }

    form.addEventListener("submit", (event) => submitForm(event, form));
    fragment.querySelector("#cancel-form-button").addEventListener("click", () => {
      closeForm();
    });
    fragment.querySelector("#a8-search-button").addEventListener("click", () => {
      openA8Search(form.elements.name.value);
    });
    fragment.querySelector("#suggest-facts-button").addEventListener("click", () => {
      suggestFactsFromOfficialUrl(form);
    });

    appEl.prepend(fragment);
    state.formOpen = true;
    form.elements.id.focus();
  }

  /** フォームを閉じ、開いている間に保留していた再描画があれば実行する */
  function closeForm() {
    const existing = document.getElementById("product-form");
    if (existing) existing.remove();
    state.formOpen = false;
    if (state.pendingRender) {
      state.pendingRender = false;
      renderApp();
    }
  }

  async function submitForm(event, form) {
    event.preventDefault();
    const errorEl = form.querySelector("#form-error");
    errorEl.hidden = true;

    const facts = form.elements.facts.value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const isEditing = form.dataset.editing === "true";
    const affiliateUrl = form.elements.affiliateUrl.value.trim();

    const payload = {
      id: form.elements.id.value.trim(),
      name: form.elements.name.value.trim(),
      officialUrl: form.elements.officialUrl.value.trim(),
      affiliateUrl,
      facts,
      // 新規追加時のみ、有効なアフィリエイトリンクがあればチェックボックスの値に関わらず自動的に
      // 投稿対象(enabled)にする(ワンボタンでの追加に近づけるため)。編集時は自動有効化しない
      // (ユーザーが意図的に無効化した商品を編集保存のたびに勝手に有効化する事故を防ぐ)。
      enabled: resolveEnabledOnSubmit({
        isEditing,
        checkboxEnabled: form.elements.enabled.checked,
        affiliateUrlValid: isHttpUrl(affiliateUrl),
      }),
    };
    const imageUrl = form.elements.imageUrl.value.trim();
    if (imageUrl) payload.imageUrl = imageUrl;
    const category = form.elements.category.value.trim();
    if (category) payload.category = category;

    // 「アフィリエイトリンクを貼るだけで追加」機能は、商品名やfactsが自動抽出できなかった
    // 場合に、id/name/facts欄が空欄のままフォームを開くことがある(意図的な仕様)。これらの
    // 欄からHTML5のrequired属性を外しているため、ここで明示的にチェックし、わかりやすい
    // エラーメッセージを表示する(ブラウザのネイティブバリデーションによる無言のブロックに
    // しない。なお1つでもrequired属性が残る欄が空だとブラウザは submit イベント自体を
    // 発火させずこのJSに到達できないため、id/name同様factsのrequiredも外した上でここで検証する)。
    const missingFields = [];
    if (!payload.id) missingFields.push("商品ID");
    if (!payload.name) missingFields.push("商品名");
    if (facts.length === 0) missingFields.push("特長(facts)");
    if (missingFields.length > 0) {
      errorEl.textContent = `${missingFields.join("・")}を入力してください。`;
      errorEl.hidden = false;
      return;
    }

    // 新規追加(編集ではない)の場合のみ、既存商品との重複IDをブロックする(既存商品編集フローは
    // 意図的にid一致で更新するため対象外)。自動生成されたidが偶然既存の有効な
    // 商品のidと一致した場合の無警告上書き・データ消失を防ぐ。
    if (!isEditing) {
      const conflict = findConflictingProduct(state.products, payload.id);
      if (conflict) {
        errorEl.textContent =
          `このID「${payload.id}」は既存の商品「${conflict.name}」と重複しています。` +
          "このまま保存すると既存商品が上書きされます。新規追加のため、IDを変更してください。";
        errorEl.hidden = false;
        return;
      }
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "保存中...";

    const { res, data, networkError } = await fetchJSON("/api/products", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (networkError) {
      errorEl.textContent = `通信エラーが発生しました: ${networkError}`;
      errorEl.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = "保存";
      return;
    }

    if (!res.ok) {
      const details = data && Array.isArray(data.details) ? data.details.join(" / ") : "";
      errorEl.textContent = `${(data && data.error) || "保存に失敗しました"}${details ? `: ${details}` : ""}`;
      errorEl.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = "保存";
      return;
    }

    warnIfRedirectsNotRegenerated(data);
    closeForm();
    await reloadProducts();
  }

  /**
   * 「A8.netプログラム詳細ページURLから申請を記録」フォームを描画する。
   * 送信すると POST /api/applicationTracking(新形式: {productName, a8ProgramUrl})を呼び、
   * 成功したら一覧を再読み込みする。
   */
  function renderTrackingFormSection() {
    const tpl = document.getElementById("tpl-tracking-form");
    const fragment = tpl.content.cloneNode(true);
    const form = fragment.querySelector("#tracking-form");
    form.addEventListener("submit", (event) => submitTrackingForm(event, form));
    return fragment.querySelector(".tracking-form");
  }

  async function submitTrackingForm(event, form) {
    event.preventDefault();
    const errorEl = form.querySelector("#tracking-form-error");
    errorEl.hidden = true;

    const productName = form.elements.productName.value.trim();
    const a8ProgramUrl = form.elements.a8ProgramUrl.value.trim();

    if (!productName || !a8ProgramUrl) {
      errorEl.textContent = "商品名とA8.netプログラム詳細ページURLの両方を入力してください。";
      errorEl.hidden = false;
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "登録中...";

    const { res, data, networkError } = await fetchJSON("/api/applicationTracking", {
      method: "POST",
      body: JSON.stringify({ productName, a8ProgramUrl }),
    });

    submitButton.disabled = false;
    submitButton.textContent = "申請中として登録";

    if (networkError) {
      errorEl.textContent = `通信エラーが発生しました: ${networkError}`;
      errorEl.hidden = false;
      return;
    }
    if (!res.ok) {
      const details = data && Array.isArray(data.details) ? data.details.join(" / ") : "";
      errorEl.textContent = `${(data && data.error) || "登録に失敗しました"}${details ? `: ${details}` : ""}`;
      errorEl.hidden = false;
      return;
    }

    form.reset();
    await loadTracking();
  }

  function trackingStatusLabel(status) {
    return status === "approved" ? "提携済み" : "申請中";
  }

  function trackingStatusBadgeClass(status) {
    return status === "approved" ? "badge badge-tracking-approved" : "badge badge-tracking-applying";
  }

  /** 「提携済みにする」ボタン: POST /api/applicationTrackingで{id, status:"approved"}に更新する */
  async function markTrackingApproved(entry) {
    const { res, data, networkError } = await fetchJSON("/api/applicationTracking", {
      method: "POST",
      body: JSON.stringify({ id: entry.id, status: "approved" }),
    });
    if (networkError) {
      window.alert(`通信エラーが発生しました: ${networkError}`);
      return;
    }
    if (!res.ok) {
      window.alert(`更新に失敗しました: ${(data && data.error) || res.status}`);
      return;
    }
    await loadTracking();
  }

  /**
   * 「商品を追加」ボタン(status:"approved"のエントリのみ): 既存の商品追加フォームを
   * productNameのみ事前入力で開く(officialUrlは不明なので空欄のまま)。実際のアフィリエイト
   * リンクはユーザーがA8.netで作成後に貼り付ける(このボタン自体はリンクを生成・自動入力しない)。
   */
  function openFormFromTrackingEntry(entry) {
    openForm(null, {
      id: slugifyProductName(entry.productName),
      name: entry.productName,
    });
  }

  function renderTrackingSection() {
    const section = el("section", { class: "card" }, [
      el("h2", { text: "提携申請の進捗" }),
      el("p", {
        class: "hint-note",
        text:
          "A8.netプログラム詳細ページURLから記録した提携申請の進捗です。提携申請の受理状況はA8.net側で" +
          "ご自身で確認し、下記のステータスを手動で切り替えてください(自動検知は行いません)。",
      }),
    ]);

    const entries = state.tracking || [];
    if (entries.length === 0) {
      section.appendChild(el("p", { class: "empty-state", text: "提携申請の記録はまだありません。" }));
      return section;
    }

    const list = el("ul", { class: "tracking-list" });
    entries.forEach((entry) => {
      const actions = [];
      if (entry.status === "applying") {
        actions.push(
          el(
            "button",
            { class: "btn btn-secondary", type: "button", onclick: () => markTrackingApproved(entry) },
            ["提携済みにする"]
          )
        );
      } else if (entry.status === "approved") {
        actions.push(
          el(
            "button",
            { class: "btn btn-primary", type: "button", onclick: () => openFormFromTrackingEntry(entry) },
            ["商品を追加"]
          )
        );
      }

      // a8ProgramUrlは外部から入力されたURL文字列で、他のURLフィールドと異なりサーバー側の
      // 型バリデーションを経ずにここへ届く可能性があるため、href注入前に必ずスキームを検証する。
      const metaChildren = [];
      if (entry.a8ProgramId) {
        metaChildren.push(el("p", { class: "tracking-item-meta", text: `プログラムID: ${entry.a8ProgramId}` }));
      }
      if (entry.a8ProgramUrl && isHttpUrl(entry.a8ProgramUrl)) {
        metaChildren.push(
          el("p", { class: "tracking-item-meta" }, [
            el("a", { href: entry.a8ProgramUrl, target: "_blank", rel: "noopener noreferrer", text: "プログラム詳細ページを開く" }),
          ])
        );
      }
      if (metaChildren.length === 0) {
        metaChildren.push(el("p", { class: "tracking-item-meta", text: "プログラムID: 不明" }));
      }

      list.appendChild(
        el("li", { class: "tracking-item" }, [
          el("div", { class: "tracking-item-header" }, [
            el("span", { class: "product-name", text: entry.productName }),
            el("span", { class: trackingStatusBadgeClass(entry.status), text: trackingStatusLabel(entry.status) }),
          ]),
          ...metaChildren,
          el("div", { class: "tracking-item-actions" }, actions),
        ])
      );
    });
    section.appendChild(list);
    return section;
  }

  async function reloadProducts() {
    const { res, data, networkError } = await fetchJSON("/api/products");
    if (networkError) {
      showError(`通信エラーが発生しました: ${networkError}`);
      return;
    }
    if (res.status === 401) {
      renderLogin();
      return;
    }
    if (!res.ok) {
      showError(`商品データの取得に失敗しました: ${(data && data.error) || res.status}`);
      return;
    }
    state.products = (data && data.products) || [];
    scheduleRender();
  }

  async function loadTracking() {
    const { res, data, networkError } = await fetchJSON("/api/applicationTracking");
    if (networkError) {
      console.error("failed to load application tracking entries", networkError);
      return; // 提携申請の進捗欄は商品一覧をブロックしないためログのみ
    }
    if (res.ok && data) {
      state.tracking = data.entries || [];
      scheduleRender();
    }
    // 401/失敗時は提携申請の進捗欄を空のまま表示する(商品一覧は表示できているためブロックしない)
  }

  async function init() {
    logoutButton.addEventListener("click", async () => {
      const { networkError } = await fetchJSON("/api/auth/logout", { method: "POST" });
      if (networkError) {
        console.error("logout request failed", networkError);
      }
      window.location.reload();
    });

    const { res, data, networkError } = await fetchJSON("/api/products");
    if (networkError) {
      showError(`通信エラーが発生しました: ${networkError}`);
      return;
    }
    if (res.status === 401) {
      renderLogin();
      return;
    }
    if (!res.ok) {
      showError(`商品データの取得に失敗しました: ${(data && data.error) || res.status}`);
      return;
    }
    state.products = (data && data.products) || [];
    renderApp();
    loadTracking();
  }

  init();
})();
