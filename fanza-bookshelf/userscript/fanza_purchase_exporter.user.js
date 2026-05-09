// ==UserScript==
// @name         FANZA Purchase Bookshelf Exporter
// @namespace    https://github.com/local/fanza-bookshelf
// @version      1.0.3
// @description  FANZA/DMMブックスの一覧で、画面に表示されている作品メタ情報だけを本棚用JSONとして出力します。
// @match        https://*.dmm.co.jp/*
// @match        https://*.dmm.com/*
// @match        https://*.fanza.co.jp/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  var BUTTON_ID = "fanza-bookshelf-export-button";
  var MODAL_ID = "fanza-bookshelf-export-modal";
  var STYLE_ID = "fanza-bookshelf-export-style";
  var BLOCKED_URL_RE = /\/(?:bookmark|basket|favorite|settings)(?:\/|$)|accounts\.dmm\.co\.jp|payment\.dmm\.co\.jp|pointclub\.dmm\.co\.jp|premium\.dmm\.co\.jp|support\.dmm\.co\.jp|mail-information\.dmm\.co\.jp|catch\.dmm\.co\.jp|chara-chat\.dmm\.co\.jp|\/service\/-\/exchange/i;
  var BLOCKED_IMAGE_RE = /navismithapis-cdn\.com|\/img\/(?:pc_arrow|login|premium|payment|point|point_exchange|notification)\.svg/i;

  init();

  function init() {
    try {
      injectStyle();
      addExportButton();
    } catch (error) {
      console.warn("[FANZA Bookshelf Exporter]", error);
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + BUTTON_ID + "{position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:999px;background:#2563eb;color:#fff;padding:12px 16px;font:700 14px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer;}",
      "#" + BUTTON_ID + ":hover{background:#1d4ed8;}",
      "#" + MODAL_ID + "{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(0,0,0,.62);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#eef2f8;}",
      "#" + MODAL_ID + " .fbx-panel{width:min(920px,calc(100vw - 28px));max-height:calc(100vh - 28px);display:grid;gap:12px;border:1px solid #374151;border-radius:10px;background:#111827;padding:16px;box-shadow:0 24px 80px rgba(0,0,0,.5);}",
      "#" + MODAL_ID + " .fbx-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}",
      "#" + MODAL_ID + " h2{margin:0;font-size:18px;}",
      "#" + MODAL_ID + " p{margin:0;color:#cbd5e1;font-size:13px;}",
      "#" + MODAL_ID + " textarea{width:100%;height:min(58vh,520px);box-sizing:border-box;border:1px solid #374151;border-radius:8px;background:#0b1020;color:#e5e7eb;padding:10px;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
      "#" + MODAL_ID + " .fbx-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;}",
      "#" + MODAL_ID + " button{border:1px solid #475569;border-radius:7px;background:#1f2937;color:#f8fafc;padding:8px 11px;font:700 13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;}",
      "#" + MODAL_ID + " button.fbx-primary{border-color:#60a5fa;background:#2563eb;}"
    ].join("");
    document.documentElement.appendChild(style);
  }

  function addExportButton() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }
    var button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "本棚JSON出力";
    button.addEventListener("click", function () {
      try {
        showExportModal(extractItemsFromPage());
      } catch (error) {
        console.warn("[FANZA Bookshelf Exporter]", error);
        showExportModal([]);
      }
    });
    document.body.appendChild(button);
  }

  function extractItemsFromPage() {
    var cards = getCandidateCards();
    var items = [];
    var seen = new Set();

    cards.forEach(function (card) {
      var item = extractItem(card);
      if (!item || seen.has(item.id)) {
        return;
      }
      seen.add(item.id);
      items.push(item);
    });

    return items;
  }

  function getCandidateCards() {
    var selectors = [
      ".m-boxListProductProduct",
      ".productList__item",
      ".d-item",
      "[data-product-id]",
      "[data-content-id]",
      "[data-item-id]",
      "li[class*='Product']",
      "div[class*='Product']",
      "li[class*='product']",
      "div[class*='product']",
      "li[class*='Book']",
      "div[class*='Book']",
      "li[class*='book']",
      "div[class*='book']",
      "article",
      "li[class*='item']",
      "div[class*='item']"
    ];
    var cards = [];
    var seen = new Set();

    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        addIfProductLike(node, cards, seen);
      });
    });

    if (cards.length) {
      return cards;
    }

    document.querySelectorAll("a[href]").forEach(function (anchor) {
      if (!isProductUrl(anchor.href)) {
        return;
      }
      var card = findProductCard(anchor);
      addIfProductLike(card, cards, seen);
    });

    return cards;
  }

  function addIfProductLike(node, cards, seen) {
    if (!node || seen.has(node)) {
      return;
    }
    var anchor = findProductAnchor(node);
    var thumbnail = findThumbnailUrl(node);
    var productHrefs = unique(Array.prototype.slice.call(node.querySelectorAll("a[href]")).map(function (anchorNode) {
      return isProductUrl(anchorNode.href) ? anchorNode.href : "";
    }));
    var title = getTitleCandidate(node, anchor);
    if (!anchor || (!thumbnail && !title)) {
      return;
    }
    if (productHrefs.length > 3) {
      return;
    }
    if (!title && (node.textContent || "").trim().length < 2) {
      return;
    }
    seen.add(node);
    cards.push(node);
  }

  function extractItem(card) {
    var anchor = findProductAnchor(card);
    if (!anchor) {
      return null;
    }

    var url = absoluteUrl(anchor.getAttribute("href"));
    var title = getTitleCandidate(card, anchor);

    if (!title) {
      return null;
    }

    var maker = firstText(card, [
      "[class*='maker']",
      "[class*='circle']",
      "[class*='author']",
      "[class*='Author']",
      "[class*='writer']",
      "[class*='publisher']",
      "[class*='brand']",
      "[class*='label']"
    ]);
    var purchaseDate = findDate(card.textContent || "");
    var thumbnail = findThumbnailUrl(card);
    if (thumbnail && BLOCKED_IMAGE_RE.test(thumbnail)) {
      thumbnail = "";
    }
    var tags = extractTags(card);
    var id = extractId(url) || ("fanza_" + hashString(url || title)) || ("fanza_" + slugify(title));

    return {
      id: id,
      title: title,
      url: url,
      thumbnail: thumbnail,
      maker: maker,
      purchaseDate: purchaseDate,
      tags: tags,
      status: "unread",
      favorite: false,
      memo: "",
      source: isDmmBooksUrl(url) ? "dmm_books" : "fanza"
    };
  }

  function findProductAnchor(root) {
    var anchors = Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll("a[href]") : []);
    if (root.matches && root.matches("a[href]")) {
      anchors.unshift(root);
    }
    return anchors.find(function (anchor) {
      return isProductUrl(anchor.href);
    }) || null;
  }

  function isProductUrl(url) {
    var text = url || "";
    if (!text || BLOCKED_URL_RE.test(text)) {
      return false;
    }
    return /[?&](?:cid|product_id|content_id)=|\/(?:detail|product)\//i.test(text);
  }

  function isDmmBooksUrl(url) {
    return /book\.dmm\.(?:co\.jp|com)\/(?:product|detail|shelf)/i.test(url || "");
  }

  function findProductCard(anchor) {
    var current = anchor;
    for (var depth = 0; current && depth < 8; depth += 1) {
      if (current.nodeType !== 1) {
        current = current.parentElement;
        continue;
      }
      var productLinks = unique(Array.prototype.slice.call(current.querySelectorAll("a[href]")).map(function (link) {
        return isProductUrl(link.href) ? link.href : "";
      }));
      if (productLinks.length >= 1 && productLinks.length <= 3 && (findThumbnailUrl(current) || getTitleCandidate(current, anchor))) {
        return current;
      }
      current = current.parentElement;
    }
    return anchor.closest("li, article, div") || anchor;
  }

  function isBlockedImage(img) {
    return BLOCKED_IMAGE_RE.test(imageUrl(img));
  }

  function getTitleCandidate(card, anchor) {
    var img = findImageElement(card);
    return firstText(card, [
      "[class*='title']",
      "[class*='Title']",
      "[class*='ttl']",
      "[class*='Ttl']",
      "[data-title]",
      "[aria-label]",
      "h1",
      "h2",
      "h3",
      "a[title]",
      "a"
    ]) ||
      clean(anchor && anchor.getAttribute("title")) ||
      clean(anchor && anchor.getAttribute("aria-label")) ||
      clean(anchor && anchor.getAttribute("data-title")) ||
      clean(card && card.getAttribute("data-title")) ||
      clean(img && img.getAttribute("alt"));
  }

  function firstText(root, selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var node = root.querySelector(selectors[i]);
      if (!node) {
        continue;
      }
      var value = clean(node.getAttribute("title")) ||
        clean(node.getAttribute("aria-label")) ||
        clean(node.getAttribute("data-title")) ||
        clean(node.textContent);
      if (value && value.length <= 160) {
        return value;
      }
    }
    return "";
  }

  function extractTags(card) {
    var selectors = [
      "[class*='tag']",
      "[class*='genre']",
      "[class*='category']",
      "a[href*='genre']",
      "a[href*='keyword']"
    ];
    var tags = [];
    selectors.forEach(function (selector) {
      card.querySelectorAll(selector).forEach(function (node) {
        var text = clean(node.textContent);
        if (text && text.length <= 24 && !/^\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}$/.test(text)) {
          tags.push(text);
        }
      });
    });
    return unique(tags).slice(0, 16);
  }

  function findDate(text) {
    var match = clean(text).match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
    if (!match) {
      return "";
    }
    return match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
  }

  function imageUrl(img) {
    if (!img) {
      return "";
    }
    var candidates = [];
    addImageCandidate(candidates, img.getAttribute("data-original"), 900);
    addImageCandidate(candidates, img.getAttribute("data-master"), 850);
    addImageCandidate(candidates, img.getAttribute("data-large"), 820);
    addImageCandidate(candidates, img.getAttribute("data-src"), 700);
    addImageCandidate(candidates, img.getAttribute("data-lazy"), 650);
    addSrcsetCandidates(candidates, img.getAttribute("data-srcset"));
    addSrcsetCandidates(candidates, img.getAttribute("srcset"));
    addPictureSourceCandidates(candidates, img);
    addImageCandidate(candidates, img.currentSrc, 500);
    addImageCandidate(candidates, img.getAttribute("src"), 300);

    var best = candidates
      .filter(function (candidate) {
        return candidate.url && !BLOCKED_IMAGE_RE.test(candidate.url);
      })
      .sort(function (a, b) {
        return imageScore(b) - imageScore(a);
      })[0];

    return best ? best.url : "";
  }

  function findThumbnailUrl(root) {
    var img = findImageElement(root);
    var candidates = [];
    if (img) {
      addImageCandidate(candidates, imageUrl(img), 900);
    }

    Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll("[style], [data-bg], [data-background], [data-background-image], [data-original], [data-src]") : []).forEach(function (node) {
      addImageCandidate(candidates, node.getAttribute("data-bg"), 760);
      addImageCandidate(candidates, node.getAttribute("data-background"), 760);
      addImageCandidate(candidates, node.getAttribute("data-background-image"), 760);
      addImageCandidate(candidates, backgroundImageUrl(node), 700);
    });

    addImageCandidate(candidates, backgroundImageUrl(root), 650);

    var best = candidates
      .filter(function (candidate) {
        return candidate.url && !BLOCKED_IMAGE_RE.test(candidate.url);
      })
      .sort(function (a, b) {
        return imageScore(b) - imageScore(a);
      })[0];

    return best ? best.url : "";
  }

  function findImageElement(root) {
    if (!root) {
      return null;
    }
    if (root.matches && root.matches("img") && !isBlockedImage(root)) {
      return root;
    }
    return Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll("img") : []).find(function (img) {
      return !isBlockedImage(img);
    }) || null;
  }

  function backgroundImageUrl(node) {
    if (!node || !window.getComputedStyle) {
      return "";
    }
    var styleValue = clean(node.getAttribute("style"));
    var computedValue = "";
    try {
      computedValue = window.getComputedStyle(node).backgroundImage;
    } catch (error) {
      computedValue = "";
    }
    var match = (styleValue + " " + computedValue).match(/url\((['"]?)(.*?)\1\)/i);
    return match ? absoluteUrl(match[2]) : "";
  }

  function addPictureSourceCandidates(candidates, img) {
    var picture = img.closest && img.closest("picture");
    if (!picture) {
      return;
    }
    picture.querySelectorAll("source").forEach(function (source) {
      addSrcsetCandidates(candidates, source.getAttribute("srcset"));
      addSrcsetCandidates(candidates, source.getAttribute("data-srcset"));
    });
  }

  function addSrcsetCandidates(candidates, srcset) {
    clean(srcset).split(",").forEach(function (part) {
      var tokens = clean(part).split(/\s+/);
      var url = tokens[0];
      var descriptor = tokens[1] || "";
      var weight = 450;
      var widthMatch = descriptor.match(/^(\d+)w$/);
      var densityMatch = descriptor.match(/^([\d.]+)x$/);
      if (widthMatch) {
        weight = Number(widthMatch[1]);
      } else if (densityMatch) {
        weight = Math.round(Number(densityMatch[1]) * 500);
      }
      addImageCandidate(candidates, url, weight);
    });
  }

  function addImageCandidate(candidates, value, weight) {
    var url = improveImageUrl(absoluteUrl(value));
    if (!url) {
      return;
    }
    candidates.push({
      url: url,
      weight: weight || 0
    });
  }

  function improveImageUrl(url) {
    if (!url || !/dmm|fanza|pics|doujin-assets/i.test(url)) {
      return url;
    }
    // DMM/FANZA package thumbnails often use ps/pt suffixes. pl is the larger package image.
    return url.replace(/p[st](\.(?:jpg|jpeg|png|webp)(?:\?.*)?)$/i, "pl$1");
  }

  function imageScore(candidate) {
    var url = candidate.url || "";
    var score = candidate.weight || 0;
    if (/p[lx](\.(?:jpg|jpeg|png|webp)(?:\?.*)?)$/i.test(url)) {
      score += 700;
    }
    if (/(large|original|master|package|jacket|cover)/i.test(url)) {
      score += 250;
    }
    if (/\.(?:svg|gif)(?:\?|$)/i.test(url)) {
      score -= 1000;
    }
    return score;
  }

  function extractId(url) {
    var decoded = "";
    try {
      decoded = decodeURIComponent(url || "");
    } catch (error) {
      decoded = url || "";
    }

    var patterns = [
      /[?&](?:cid|product_id)=([A-Za-z0-9_-]+)/i,
      /[?&]content_id=([A-Za-z0-9_-]+)/i,
      /\/(?:cid|product_id)\/([A-Za-z0-9_-]+)/i,
      /\/product\/([^/?#]+)\/([^/?#]+)/i,
      /\b(RJ\d{5,}|VJ\d{5,}|BJ\d{5,}|d_\d{5,}|[a-z]{2,}_\d{3,}|[a-z]{3,}\d{3,})\b/i
    ];
    for (var i = 0; i < patterns.length; i += 1) {
      var match = decoded.match(patterns[i]);
      if (match) {
        return "fanza_" + (match[2] ? match[1] + "_" + match[2] : match[1]).toLowerCase();
      }
    }
    return url ? "fanza_" + hashString(url) : "";
  }

  function showExportModal(items) {
    closeModal();

    var json = JSON.stringify(items, null, 2);
    var modal = document.createElement("div");
    modal.id = MODAL_ID;

    var panel = document.createElement("div");
    panel.className = "fbx-panel";

    var head = document.createElement("div");
    head.className = "fbx-head";
    var title = document.createElement("h2");
    title.textContent = "本棚用JSON";
    var count = document.createElement("p");
    count.textContent = items.length + "件を抽出しました。表示中のページだけが対象です。";
    head.appendChild(title);
    head.appendChild(count);

    var textarea = document.createElement("textarea");
    textarea.value = json;
    textarea.setAttribute("readonly", "readonly");

    var actions = document.createElement("div");
    actions.className = "fbx-actions";
    actions.appendChild(createModalButton("コピー", true, function () {
      copyText(json, textarea);
    }));
    actions.appendChild(createModalButton("JSONダウンロード", false, function () {
      downloadJson(json);
    }));
    actions.appendChild(createModalButton("閉じる", false, closeModal));

    panel.appendChild(head);
    panel.appendChild(textarea);
    panel.appendChild(actions);
    modal.appendChild(panel);
    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        closeModal();
      }
    });
    document.body.appendChild(modal);
    textarea.focus();
    textarea.select();
  }

  function createModalButton(label, primary, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (primary) {
      button.className = "fbx-primary";
    }
    button.addEventListener("click", onClick);
    return button;
  }

  function closeModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) {
      existing.remove();
    }
  }

  function copyText(text, textarea) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(function () {
        fallbackCopy(textarea);
      });
      return;
    }
    fallbackCopy(textarea);
  }

  function fallbackCopy(textarea) {
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (error) {
      console.warn("[FANZA Bookshelf Exporter] copy failed", error);
    }
  }

  function downloadJson(json) {
    var date = new Date().toISOString().slice(0, 10);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "fanza-purchase-export-" + date + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function absoluteUrl(value) {
    var text = clean(value);
    if (!text) {
      return "";
    }
    try {
      return new URL(text, location.href).href;
    } catch (error) {
      return text;
    }
  }

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function unique(values) {
    var seen = new Set();
    return values.map(clean).filter(function (value) {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }

  function slugify(text) {
    return clean(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || hashString(text);
  }

  function hashString(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(36);
  }
})();
