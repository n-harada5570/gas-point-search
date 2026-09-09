const DATA_KEY = "gas_customers_v2";
const META_KEY = "gas_customers_meta_v2";

const $ = id => document.getElementById(id);
const searchInput = $("searchInput");
const clearBtn = $("clearBtn");
const results = $("results");
const detail = $("detail");
const detailKana = $("detailKana");
const detailCode = $("detailCode");
const backBtn = $("backBtn");
const copyBtn = $("copyBtn");
const settingsBtn = $("settingsBtn");
const settingsModal = $("settingsModal");
const closeSettingsBtn = $("closeSettingsBtn");
const csvFile = $("csvFile");
const importMessage = $("importMessage");
const countLabel = $("countLabel");
const updatedLabel = $("updatedLabel");
const mappingPanel = $("mappingPanel");
const kanaColumn = $("kanaColumn");
const codeColumn = $("codeColumn");
const applyMappingBtn = $("applyMappingBtn");
const clearDataBtn = $("clearDataBtn");

let customers = [];
let pendingRows = null;
let pendingHeaders = null;

try {
  customers = JSON.parse(localStorage.getItem(DATA_KEY) || "[]");
} catch {
  customers = [];
}

function normalize(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateMeta() {
  countLabel.textContent = `登録 ${customers.length}件`;

  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY) || "{}");
    if (meta.updated) {
      const d = new Date(meta.updated);
      updatedLabel.textContent =
        `更新 ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    } else {
      updatedLabel.textContent = "未登録";
    }
  } catch {
    updatedLabel.textContent = "未登録";
  }
}

function saveCustomers(data) {
  customers = data;
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ updated: new Date().toISOString() })
  );
  updateMeta();
}

function renderResults() {
  const q = normalize(searchInput.value);

  if (!q) {
    results.innerHTML = "";
    detail.classList.add("hidden");
    results.classList.remove("hidden");
    return;
  }

  const hits = customers
    .filter(x => normalize(x.kana).includes(q))
    .slice(0, 100);

  if (!hits.length) {
    results.innerHTML = `<div class="empty">該当する客先がありません。</div>`;
    return;
  }

  results.innerHTML = hits.map((x, i) => `
    <button class="result-card" data-index="${i}">
      <div class="result-kana">${escapeHtml(x.kana)}</div>
      <div class="result-code">${escapeHtml(x.code)}</div>
    </button>
  `).join("");

  [...results.querySelectorAll(".result-card")].forEach((btn, i) => {
    btn.addEventListener("click", () => showDetail(hits[i]));
  });
}

function showDetail(item) {
  detailKana.textContent = item.kana;
  detailCode.textContent = item.code;
  results.classList.add("hidden");
  detail.classList.remove("hidden");
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        quoted = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

function detectColumn(headers, candidates) {
  const hn = headers.map(normalize);

  for (const c of candidates) {
    const target = normalize(c);
    const idx = hn.findIndex(h => h === target);
    if (idx >= 0) return idx;
  }

  for (const c of candidates) {
    const target = normalize(c);
    const idx = hn.findIndex(h => h.includes(target));
    if (idx >= 0) return idx;
  }

  return -1;
}

function buildData(rows, kanaIdx, codeIdx) {
  return rows.slice(1).map(r => ({
    kana: String(r[kanaIdx] ?? "").trim(),
    code: String(r[codeIdx] ?? "").trim()
  })).filter(x => x.kana && x.code);
}

function fillMapping(headers) {
  const opts = headers
    .map((h, i) =>
      `<option value="${i}">${escapeHtml(h || `列${i + 1}`)}</option>`
    )
    .join("");

  kanaColumn.innerHTML = opts;
  codeColumn.innerHTML = opts;
}

async function readFileWithFallback(file) {
  const buf = await file.arrayBuffer();

  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    if (!t.includes("�")) return t;
  } catch {}

  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch {
    return new TextDecoder().decode(buf);
  }
}

async function handleCSV(file) {
  importMessage.textContent = "読み込み中…";
  mappingPanel.classList.add("hidden");

  const text = await readFileWithFallback(file);
  const rows = parseCSV(text);

  if (rows.length < 2) {
    importMessage.textContent = "CSVにデータ行がありません。";
    return;
  }

  const headers = rows[0];

  const kanaIdx = detectColumn(headers, [
    "氏名カナ",
    "顧客名カナ",
    "需要家名カナ",
    "お客様名カナ",
    "カナ",
    "フリガナ",
    "ﾌﾘｶﾞﾅ"
  ]);

  const codeIdx = detectColumn(headers, [
    "地点コード",
    "地点CD",
    "地点ｺｰﾄﾞ",
    "地点番号",
    "地点No",
    "地点NO"
  ]);

  if (kanaIdx >= 0 && codeIdx >= 0) {
    const data = buildData(rows, kanaIdx, codeIdx);
    saveCustomers(data);
    importMessage.textContent = `${data.length}件を登録しました。`;
    searchInput.value = "";
    renderResults();
    return;
  }

  pendingRows = rows;
  pendingHeaders = headers;
  fillMapping(headers);
  mappingPanel.classList.remove("hidden");
  importMessage.textContent =
    "列名を自動判定できませんでした。下で列を選択してください。";
}

searchInput.addEventListener("input", renderResults);

clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchInput.focus();
  renderResults();
});

backBtn.addEventListener("click", () => {
  detail.classList.add("hidden");
  results.classList.remove("hidden");
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(detailCode.textContent);
    copyBtn.textContent = "コピーしました";
  } catch {
    copyBtn.textContent = "長押しでコピーしてください";
  }

  setTimeout(() => {
    copyBtn.textContent = "地点コードをコピー";
  }, 1200);
});

settingsBtn.addEventListener("click", () => {
  settingsModal.classList.remove("hidden");
});

closeSettingsBtn.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
});

csvFile.addEventListener("change", async () => {
  const file = csvFile.files?.[0];
  if (!file) return;

  try {
    await handleCSV(file);
  } catch {
    importMessage.textContent = "CSV読み込みでエラーが発生しました。";
  }
});

applyMappingBtn.addEventListener("click", () => {
  if (!pendingRows) return;

  const data = buildData(
    pendingRows,
    Number(kanaColumn.value),
    Number(codeColumn.value)
  );

  saveCustomers(data);
  importMessage.textContent = `${data.length}件を登録しました。`;
  mappingPanel.classList.add("hidden");
  searchInput.value = "";
  renderResults();
});

clearDataBtn.addEventListener("click", () => {
  if (!confirm("登録済みの客先データを削除しますか？")) return;

  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(META_KEY);
  customers = [];
  updateMeta();
  renderResults();
  importMessage.textContent = "データを削除しました。";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloading) {
        reloading = true;
        window.location.reload();
      }
    });

    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        updateViaCache: "none"
      });

      await registration.update();

      setInterval(
        () => registration.update().catch(() => {}),
        60 * 60 * 1000
      );
    } catch {}
  });
}

updateMeta();
renderResults();
