(function () {
  "use strict";

  var STORAGE_KEY = "fanzaBookshelf.items.v1";
  var CORRUPTED_PREFIX = "fanzaBookshelf.corrupted.";
  var USER_FIELDS = ["status", "favorite", "memo"];
  var STATUSES = {
    unread: "未読",
    reading: "途中",
    completed: "読了"
  };

  var state = {
    items: [],
    filters: {
      query: "",
      status: "all",
      favoriteOnly: false,
      tag: "all",
      sort: "purchaseDateDesc",
      hideThumbnails: false
    }
  };

  var elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    elements = {
      importInput: document.getElementById("importInput"),
      importButton: document.getElementById("importButton"),
      exportButton: document.getElementById("exportButton"),
      searchInput: document.getElementById("searchInput"),
      statusFilter: document.getElementById("statusFilter"),
      favoriteOnly: document.getElementById("favoriteOnly"),
      tagFilter: document.getElementById("tagFilter"),
      sortSelect: document.getElementById("sortSelect"),
      hideThumbnails: document.getElementById("hideThumbnails"),
      booksGrid: document.getElementById("booksGrid"),
      emptyState: document.getElementById("emptyState"),
      message: document.getElementById("message"),
      summaryText: document.getElementById("summaryText")
    };

    state.items = storage.load();
    bindEvents();
    render();
  }

  var storage = {
    load: function () {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }

      try {
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          throw new Error("保存データが配列ではありません。");
        }
        return parsed.map(normalizeItem).filter(Boolean);
      } catch (error) {
        try {
          localStorage.setItem(CORRUPTED_PREFIX + new Date().toISOString(), raw);
          localStorage.removeItem(STORAGE_KEY);
        } catch (backupError) {
          // localStorage itself can fail in private windows. The UI can still recover in memory.
        }
        showMessage("保存データを読み込めなかったため、本棚を空の状態で復旧しました。バックアップキーをlocalStorageに退避しています。", true);
        return [];
      }
    },
    save: function (items) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        return true;
      } catch (error) {
        showMessage("localStorageへの保存に失敗しました。JSONエクスポートでバックアップしてください。", true);
        return false;
      }
    }
  };

  function bindEvents() {
    elements.importButton.addEventListener("click", function () {
      elements.importInput.click();
    });

    elements.importInput.addEventListener("change", function (event) {
      var file = event.target.files && event.target.files[0];
      if (file) {
        importJsonFile(file);
      }
      event.target.value = "";
    });

    elements.exportButton.addEventListener("click", exportJson);

    elements.searchInput.addEventListener("input", function (event) {
      state.filters.query = event.target.value.trim();
      render();
    });

    elements.statusFilter.addEventListener("change", function (event) {
      state.filters.status = event.target.value;
      render();
    });

    elements.favoriteOnly.addEventListener("change", function (event) {
      state.filters.favoriteOnly = event.target.checked;
      render();
    });

    elements.tagFilter.addEventListener("change", function (event) {
      state.filters.tag = event.target.value;
      render();
    });

    elements.sortSelect.addEventListener("change", function (event) {
      state.filters.sort = event.target.value;
      render();
    });

    elements.hideThumbnails.addEventListener("change", function (event) {
      state.filters.hideThumbnails = event.target.checked;
      render();
    });
  }

  function importJsonFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result || ""));
        if (!Array.isArray(parsed)) {
          throw new Error("JSONの最上位は配列にしてください。");
        }

        var normalized = parsed.map(normalizeItem).filter(Boolean);
        if (!normalized.length) {
          throw new Error("取り込める作品データがありません。");
        }

        var result = mergeItems(state.items, normalized);
        state.items = result.items;
        storage.save(state.items);
        render();
        showMessage(result.added + "件追加、" + result.updated + "件更新しました。重複は追加していません。", false);
      } catch (error) {
        showMessage("JSONインポートに失敗しました: " + error.message, true);
      }
    };
    reader.onerror = function () {
      showMessage("ファイルを読み込めませんでした。", true);
    };
    reader.readAsText(file);
  }

  function exportJson() {
    var date = new Date().toISOString().slice(0, 10);
    var blob = new Blob([JSON.stringify(state.items, null, 2)], {
      type: "application/json"
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "fanza-bookshelf-" + date + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMessage("JSONを書き出しました。", false);
  }

  function mergeItems(currentItems, incomingItems) {
    var items = currentItems.map(normalizeItem).filter(Boolean);
    var indexById = new Map();
    var indexByUrl = new Map();
    var added = 0;
    var updated = 0;

    items.forEach(function (item, index) {
      indexById.set(item.id, index);
      if (item.url) {
        indexByUrl.set(item.url, index);
      }
    });

    incomingItems.forEach(function (incoming) {
      var index = indexById.has(incoming.id) ? indexById.get(incoming.id) : indexByUrl.get(incoming.url);
      if (typeof index === "number") {
        items[index] = mergeExistingItem(items[index], incoming);
        updated += 1;
        return;
      }

      var newItem = normalizeItem(incoming);
      items.push(newItem);
      indexById.set(newItem.id, items.length - 1);
      if (newItem.url) {
        indexByUrl.set(newItem.url, items.length - 1);
      }
      added += 1;
    });

    return {
      items: items,
      added: added,
      updated: updated
    };
  }

  function mergeExistingItem(existing, incoming) {
    var merged = Object.assign({}, existing);
    var metadataFields = ["title", "url", "maker", "purchaseDate", "source"];

    metadataFields.forEach(function (field) {
      if (!merged[field] && incoming[field]) {
        merged[field] = incoming[field];
      }
    });

    if (incoming.thumbnail && imageQualityScore(incoming.thumbnail) > imageQualityScore(existing.thumbnail)) {
      merged.thumbnail = incoming.thumbnail;
    }

    merged.tags = uniqueTags([].concat(existing.tags || [], incoming.tags || []));
    USER_FIELDS.forEach(function (field) {
      merged[field] = existing[field];
    });
    merged.updatedAt = existing.updatedAt || incoming.updatedAt || new Date().toISOString();
    return normalizeItem(merged);
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    var url = toCleanString(raw.url);
    var title = toCleanString(raw.title) || "無題";
    var id = toCleanString(raw.id) || makeIdFromUrl(url) || makeIdFromTitle(title);

    return {
      id: id,
      title: title,
      url: url,
      thumbnail: toCleanString(raw.thumbnail),
      maker: toCleanString(raw.maker),
      purchaseDate: normalizeDate(raw.purchaseDate),
      tags: uniqueTags(Array.isArray(raw.tags) ? raw.tags : String(raw.tags || "").split(",")),
      status: STATUSES[raw.status] ? raw.status : "unread",
      favorite: Boolean(raw.favorite),
      memo: toCleanString(raw.memo),
      source: toCleanString(raw.source) || "fanza",
      updatedAt: toCleanString(raw.updatedAt) || new Date().toISOString()
    };
  }

  function render() {
    var tags = collectTags(state.items);
    renderTagOptions(tags);

    var visibleItems = applyFiltersAndSort(state.items);
    elements.booksGrid.textContent = "";
    visibleItems.forEach(function (item) {
      elements.booksGrid.appendChild(createBookCard(item));
    });

    elements.emptyState.classList.toggle("is-visible", visibleItems.length === 0);
    elements.summaryText.textContent = visibleItems.length + " / " + state.items.length + " items";
  }

  function renderTagOptions(tags) {
    var selected = state.filters.tag;
    elements.tagFilter.textContent = "";
    appendOption(elements.tagFilter, "all", "すべて");
    tags.forEach(function (tag) {
      appendOption(elements.tagFilter, tag, tag);
    });
    elements.tagFilter.value = tags.indexOf(selected) >= 0 ? selected : "all";
    state.filters.tag = elements.tagFilter.value;
  }

  function appendOption(select, value, label) {
    var option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function applyFiltersAndSort(items) {
    var query = state.filters.query.toLowerCase();
    var filtered = items.filter(function (item) {
      if (state.filters.status !== "all" && item.status !== state.filters.status) {
        return false;
      }
      if (state.filters.favoriteOnly && !item.favorite) {
        return false;
      }
      if (state.filters.tag !== "all" && item.tags.indexOf(state.filters.tag) === -1) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [item.title, item.maker, item.memo, item.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .indexOf(query) >= 0;
    });

    return filtered.sort(sorter(state.filters.sort));
  }

  function sorter(sortKey) {
    return function (a, b) {
      if (sortKey === "purchaseDateAsc") {
        return compareDate(a.purchaseDate, b.purchaseDate);
      }
      if (sortKey === "titleAsc") {
        return a.title.localeCompare(b.title, "ja");
      }
      if (sortKey === "updatedAtDesc") {
        return compareDateTime(b.updatedAt, a.updatedAt);
      }
      if (sortKey === "favoriteDesc") {
        return Number(b.favorite) - Number(a.favorite) || compareDate(b.purchaseDate, a.purchaseDate);
      }
      return compareDate(b.purchaseDate, a.purchaseDate);
    };
  }

  function createBookCard(item) {
    var card = document.createElement("article");
    card.className = "book-card";

    var coverWrap = document.createElement("div");
    coverWrap.className = "cover-wrap";
    coverWrap.classList.toggle("hidden-cover", state.filters.hideThumbnails);

    if (item.thumbnail) {
      var img = document.createElement("img");
      img.src = item.thumbnail;
      img.alt = item.title;
      img.loading = "lazy";
      img.addEventListener("error", function () {
        coverWrap.textContent = "";
        coverWrap.appendChild(createCoverPlaceholder());
      });
      coverWrap.appendChild(img);
    } else {
      coverWrap.appendChild(createCoverPlaceholder());
    }

    var favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = "favorite-button";
    favoriteButton.classList.toggle("is-active", item.favorite);
    favoriteButton.title = "お気に入り";
    favoriteButton.setAttribute("aria-label", "お気に入りを切り替え");
    favoriteButton.textContent = "★";
    favoriteButton.addEventListener("click", function () {
      updateItem(item.id, { favorite: !item.favorite });
    });
    coverWrap.appendChild(favoriteButton);

    var body = document.createElement("div");
    body.className = "card-body";

    var title = document.createElement("h2");
    title.className = "book-title";
    title.textContent = item.title;
    body.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "meta";
    appendMeta(meta, item.maker || "メーカー未設定");
    appendMeta(meta, item.purchaseDate || "購入日未設定");
    body.appendChild(meta);

    var badgeRow = document.createElement("div");
    badgeRow.className = "badge-row";
    badgeRow.appendChild(createStatusBadge(item.status));
    item.tags.slice(0, 8).forEach(function (tag) {
      var badge = document.createElement("span");
      badge.className = "tag-badge";
      badge.textContent = tag;
      badgeRow.appendChild(badge);
    });
    body.appendChild(badgeRow);

    body.appendChild(createCardActions(item));

    card.appendChild(coverWrap);
    card.appendChild(body);
    return card;
  }

  function createCoverPlaceholder() {
    var placeholder = document.createElement("div");
    placeholder.className = "cover-placeholder";
    placeholder.textContent = "No Image";
    return placeholder;
  }

  function appendMeta(parent, text) {
    var span = document.createElement("span");
    span.textContent = text;
    parent.appendChild(span);
  }

  function createStatusBadge(status) {
    var badge = document.createElement("span");
    badge.className = "status-badge status-" + status;
    badge.textContent = STATUSES[status] || STATUSES.unread;
    return badge;
  }

  function createCardActions(item) {
    var actions = document.createElement("div");
    actions.className = "card-actions";

    var favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = "button favorite-inline-button";
    favoriteButton.classList.toggle("is-active", item.favorite);
    favoriteButton.title = "お気に入り";
    favoriteButton.setAttribute("aria-label", "お気に入りを切り替え");
    favoriteButton.textContent = "★";
    favoriteButton.addEventListener("click", function () {
      updateItem(item.id, { favorite: !item.favorite });
    });
    actions.appendChild(favoriteButton);

    var statusSelect = document.createElement("select");
    statusSelect.className = "small-select";
    Object.keys(STATUSES).forEach(function (status) {
      appendOption(statusSelect, status, STATUSES[status]);
    });
    statusSelect.value = item.status;
    statusSelect.addEventListener("change", function () {
      updateItem(item.id, { status: statusSelect.value });
    });
    actions.appendChild(statusSelect);

    var link = document.createElement("a");
    link.className = "link-button";
    link.href = item.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "作品ページ";
    if (!item.url) {
      link.setAttribute("aria-disabled", "true");
      link.addEventListener("click", function (event) {
        event.preventDefault();
      });
    }
    actions.appendChild(link);

    return actions;
  }

  function updateItem(id, patch, silent) {
    state.items = state.items.map(function (item) {
      if (item.id !== id) {
        return item;
      }
      return normalizeItem(Object.assign({}, item, patch, {
        updatedAt: new Date().toISOString()
      }));
    });
    storage.save(state.items);
    if (!silent) {
      render();
    }
    if (!silent) {
      showMessage("変更を保存しました。", false);
    }
  }

  function showMessage(text, isError) {
    elements.message.textContent = text;
    elements.message.classList.toggle("error", Boolean(isError));
  }

  function collectTags(items) {
    return uniqueTags(items.reduce(function (acc, item) {
      return acc.concat(item.tags || []);
    }, [])).sort(function (a, b) {
      return a.localeCompare(b, "ja");
    });
  }

  function uniqueTags(tags) {
    var seen = new Set();
    return tags.map(toCleanString).filter(function (tag) {
      if (!tag || seen.has(tag)) {
        return false;
      }
      seen.add(tag);
      return true;
    });
  }

  function toCleanString(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function normalizeDate(value) {
    var text = toCleanString(value);
    if (!text) {
      return "";
    }
    var match = text.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
    if (!match) {
      return text;
    }
    return match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
  }

  function compareDate(a, b) {
    return dateValue(a) - dateValue(b);
  }

  function compareDateTime(a, b) {
    return dateTimeValue(a) - dateTimeValue(b);
  }

  function dateValue(value) {
    return value ? new Date(value + "T00:00:00").getTime() || 0 : 0;
  }

  function dateTimeValue(value) {
    return value ? new Date(value).getTime() || 0 : 0;
  }

  function makeIdFromUrl(url) {
    if (!url) {
      return "";
    }
    return "fanza_" + simpleHash(url);
  }

  function makeIdFromTitle(title) {
    return "fanza_" + simpleHash(title || String(Date.now()));
  }

  function simpleHash(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(36);
  }

  function imageQualityScore(url) {
    var text = toCleanString(url);
    if (!text) {
      return 0;
    }
    var score = 100;
    if (/navismithapis-cdn\.com|\/img\/.*\.svg/i.test(text)) {
      score -= 1000;
    }
    if (/p[lx](\.(?:jpg|jpeg|png|webp)(?:\?.*)?)$/i.test(text)) {
      score += 700;
    }
    if (/p[st](\.(?:jpg|jpeg|png|webp)(?:\?.*)?)$/i.test(text)) {
      score += 250;
    }
    if (/(large|original|master|package|jacket|cover)/i.test(text)) {
      score += 250;
    }
    if (/\.(?:svg|gif)(?:\?|$)/i.test(text)) {
      score -= 500;
    }
    return score;
  }

})();
