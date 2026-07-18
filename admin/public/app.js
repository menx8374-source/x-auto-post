// アフィリエイト商品管理ページのフロントエンドロジック。
// フレームワーク不要の素のJS。ビルドステップなしでそのまま配信できることが要件のため、
// モジュールバンドラは使わずブラウザネイティブのESモジュール(<script type="module">)のみで完結させる。
import { slugifyProductName } from "./candidateSlug.js";
import { findConflictingProduct } from "./productConflict.js";

(() => {
  "use strict";

  const appEl = document.getElementById("app");
  const logoutButton = document.getElementById("logout-button");

  /** @type {{products: Array<object>, candidates: object, formOpen: boolean, pendingRender: boolean}} */
  const state = {
    products: [],
    candidates: { generatedAt: null, items: [] },
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

  /** http:/https:のURLのみ許可する(候補ヒントのurlは外部情報源由来のため、admin/functions/_lib/validate.tsのisHttpUrlと同じ検証をフロントにも複製する) */
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

    appEl.appendChild(
      el("section", { class: "card" }, [
        el("div", { class: "section-header" }, [
          el("h2", { text: "商品一覧" }),
          el("button", { class: "btn btn-primary", type: "button", onclick: () => openForm(null) }, ["+ 商品を追加"]),
        ]),
        renderProductList(),
      ])
    );

    appEl.appendChild(renderCandidatesSection());
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
   * - `product`がnullで`prefill`が指定された場合: 候補ヒントからの新規追加(下書き)。
   *   IDは変更可能(候補から自動生成したスラッグの手直しを許すため)、enabledは常にオフのまま、
   *   factsは空(公式サイトを確認してユーザー自身が入力する運用のため、ヒントプレースホルダのみ表示)。
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
      title.textContent = "商品を追加(候補ヒントから)";
      form.elements.id.value = prefill.id || "";
      form.elements.name.value = prefill.name || "";
      form.elements.officialUrl.value = prefill.officialUrl || "";
      form.elements.facts.value = "";
      form.elements.facts.placeholder = "公式サイトを確認し、事実ベースの特長を1行ずつ入力してください";
      form.elements.enabled.checked = false; // 下書き状態: ユーザーが内容を確認して保存するまで投稿対象にしない
    } else {
      title.textContent = "商品を追加";
    }

    form.addEventListener("submit", (event) => submitForm(event, form));
    fragment.querySelector("#cancel-form-button").addEventListener("click", () => {
      closeForm();
    });

    appEl.prepend(fragment);
    state.formOpen = true;
    form.elements.id.focus();
  }

  /** 候補ヒントの商品候補(productCandidate)から、商品追加フォームを事前入力した状態で開く */
  function addProductFromCandidate(item) {
    const pc = item.productCandidate;
    if (!pc) return;
    openForm(null, {
      id: slugifyProductName(pc.name),
      name: pc.name,
      officialUrl: pc.officialUrlGuess || "",
    });
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

    const payload = {
      id: form.elements.id.value.trim(),
      name: form.elements.name.value.trim(),
      officialUrl: form.elements.officialUrl.value.trim(),
      affiliateUrl: form.elements.affiliateUrl.value.trim(),
      facts,
      enabled: form.elements.enabled.checked,
    };
    const imageUrl = form.elements.imageUrl.value.trim();
    if (imageUrl) payload.imageUrl = imageUrl;
    const category = form.elements.category.value.trim();
    if (category) payload.category = category;

    // 新規追加(編集ではない)の場合のみ、既存商品との重複IDをブロックする(既存商品編集フローは
    // 意図的にid一致で更新するため対象外)。候補ヒントから自動生成されたidが偶然既存の有効な
    // 商品のidと一致した場合の無警告上書き・データ消失を防ぐ。
    if (form.dataset.editing !== "true") {
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

  function renderCandidatesSection() {
    const section = el("section", { class: "card" }, [
      el("h2", { text: "候補ヒント(参考情報)" }),
      el("p", {
        class: "hint-note",
        text: "最近話題のAI関連ニュースの参考一覧です。実際のアフィリエイトリンクの登録はご自身で行ってください。",
      }),
    ]);

    if (state.candidates.generatedAt) {
      section.appendChild(
        el("p", { class: "hint-generated-at", text: `生成日時: ${state.candidates.generatedAt}` })
      );
    }

    const items = state.candidates.items || [];
    if (items.length === 0) {
      section.appendChild(el("p", { class: "empty-state", text: "候補ヒントはまだ生成されていません。" }));
      return section;
    }

    const list = el("ol", { class: "candidate-list" });
    items.forEach((item) => {
      // 候補ヒントのurlは外部ニュースソース由来で、他のURLフィールド(officialUrl/affiliateUrl/imageUrl)と
      // 異なりサーバー側の型バリデーションを経ずにここへ届く。href注入前に必ずスキームを検証する。
      const titleNode = isHttpUrl(item.url)
        ? el("a", { href: item.url, target: "_blank", rel: "noopener noreferrer", text: item.title })
        : el("span", { text: `${item.title}(リンク無効)` });

      const children = [
        titleNode,
        el("div", { class: "candidate-meta", text: `${item.source} / score: ${item.score}` }),
      ];

      // 特定の名前を持つ商業的なAI製品・ツール・サービスが主題と判定された項目のみ、
      // バッジと「商品として追加」ボタンを表示する(src/generateCandidateHints.tsのproductCandidate)。
      if (item.productCandidate && item.productCandidate.name) {
        children.push(
          el("div", { class: "candidate-product" }, [
            el("span", { class: "badge badge-product", text: `商品候補: ${item.productCandidate.name}` }),
            el(
              "button",
              { class: "btn btn-secondary", type: "button", onclick: () => addProductFromCandidate(item) },
              ["商品として追加"]
            ),
          ])
        );
      }

      list.appendChild(el("li", { class: "candidate-item" }, children));
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

  async function loadCandidates() {
    const { res, data, networkError } = await fetchJSON("/api/candidates");
    if (networkError) {
      console.error("failed to load candidate hints", networkError);
      return; // 候補ヒント欄は商品一覧をブロックしないためログのみ
    }
    if (res.ok && data) {
      state.candidates = data;
      scheduleRender();
    }
    // 401/失敗時は候補ヒント欄を空のまま表示する(商品一覧は表示できているためブロックしない)
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
    loadCandidates();
  }

  init();
})();
