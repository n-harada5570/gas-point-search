const DATA_KEY = "gas_customers_v7";
const META_KEY = "gas_customers_meta_v7";
const OLD_DATA_KEYS = ["gas_customers_v2", "gas_customers_v3", "gas_customers_v4", "gas_customers_v5", "gas_customers_v6"];

const $ = id => document.getElementById(id);
const searchInput = $("searchInput");
const clearBtn = $("clearBtn");
const results = $("results");
const detail = $("detail");
const detailName = $("detailName");
const detailKana = $("detailKana");
const detailCode = $("detailCode");
const backBtn = $("backBtn");
const copyBtn = $("copyBtn");
const dataCount = $("dataCount");
const updatedAt = $("updatedAt");
const settingsModal = $("settingsModal");
const settingsBtn = $("settingsBtn");
const closeSettingsBtn = $("closeSettingsBtn");
const csvFile = $("csvFile");
const importMessage = $("importMessage");
const mappingPanel = $("mappingPanel");
const nameColumn = $("nameColumn");
const kanaColumn = $("kanaColumn");
const codeColumn = $("codeColumn");
const applyMappingBtn = $("applyMappingBtn");
const clearDataBtn = $("clearDataBtn");

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalize(v) {
  return String(v ?? "")
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
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

function normalizeCustomer(c) {
  // v3以前の {kana, code} も壊さず読めるようにする
  const name = String(c?.name ?? c?.氏名 ?? "").trim();
  const kana = String(c?.kana ?? c?.氏名カナ ?? "").trim();
  const code = String(c?.code ?? c?.配送地点バーコード ?? c?.地点コード ?? "").trim();
  return { name, kana, code };
}

let customers = loadJSON(DATA_KEY, []).map(normalizeCustomer);
let pendingRows = null;

// v7: 旧データに氏名・カナ・コードが揃っていれば自動移行。
// 旧形式で氏名が欠ける場合は誤検索防止のため再取込を要求する。
if (!customers.length) {
  for (const key of OLD_DATA_KEYS) {
    const old = loadJSON(key, []);
    if (!Array.isArray(old) || !old.length) continue;
    const migrated = old.map(normalizeCustomer).filter(c => (c.name || c.kana) && c.code);
    const withName = migrated.filter(c => c.name).length;
    if (migrated.length && withName >= Math.max(1, Math.floor(migrated.length * 0.8))) {
      customers = migrated;
      localStorage.setItem(DATA_KEY, JSON.stringify(customers));
      localStorage.setItem(META_KEY, JSON.stringify({ updated: "旧データ移行", schema: 8 }));
      break;
    }
  }
}

function updateMeta() {
  dataCount.textContent = customers.length ? `登録 ${customers.length}件` : "データ未登録";
  const meta = loadJSON(META_KEY, {});
  updatedAt.textContent = meta.updated ? `更新 ${meta.updated}` : "";
}

function saveCustomers(data) {
  customers = data.map(normalizeCustomer);
  localStorage.setItem(DATA_KEY, JSON.stringify(customers));
  const d = new Date();
  const stamp = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  localStorage.setItem(META_KEY, JSON.stringify({ updated: stamp, schema: 8 }));
  updateMeta();
}

function renderResults() {
  detail.classList.add("hidden");
  results.classList.remove("hidden");
  results.innerHTML = "";

  if (!customers.length) {
    results.innerHTML = '<div class="empty">⚙︎ からCSVを取り込んでください。</div>';
    return;
  }

  const q = normalize(searchInput.value);
  if (!q) {
    results.innerHTML = '<div class="empty">氏名またはカナを入力してください。</div>';
    return;
  }

  const allMatched = customers.filter(c => {
    const name = normalize(c.name);
    const kana = normalize(c.kana);
    return name.includes(q) || kana.includes(q);
  });
  const matched = allMatched.slice(0, 100);

  if (!matched.length) {
    results.innerHTML = `<div class="empty">「${escapeHtml(searchInput.value)}」は該当なし</div>`;
    return;
  }

  const count = document.createElement("div");
  count.className = "hit-count";
  count.textContent = `${allMatched.length}件ヒット`;
  results.appendChild(count);

  for (const c of matched) {
    const b = document.createElement("button");
    b.className = "result-item";
    const title = c.name || c.kana || "(氏名なし)";
    const kanaLine = c.kana
      ? `<div class="result-kana-sub">${escapeHtml(c.kana)}</div>`
      : "";
    b.innerHTML = `<div class="result-kana">${escapeHtml(title)}</div>${kanaLine}<div class="result-code">${escapeHtml(c.code)}</div>`;
    b.addEventListener("click", () => showDetail(c));
    results.appendChild(b);
  }
}


// 実物写真を読み取り確認した結果：バーコード規格は CODABAR（NW-7）
const CODABAR = {
  "0":"101010011","1":"101011001","2":"101001011","3":"110010101",
  "4":"101101001","5":"110101001","6":"100101011","7":"100101101",
  "8":"100110101","9":"110100101","-":"101001101","$":"101100101",
  ":":"1101011011","/":"1101101011",".":"1101101101","+":"101100110011",
  "A":"1011001001","B":"1001001011","C":"1010010011","D":"1010011001"
};

function codabarImageData(text) {
  let raw = String(text ?? "").trim();
  if (!raw) return "";

  // CSVは a...b。NW-7のスタート/ストップ文字として A...B に正規化する。
  let s = raw.toUpperCase();
  if (!CODABAR[s[0]] || !CODABAR[s[s.length - 1]]) return "";
  if ([...s].some(ch => !CODABAR[ch])) return "";

  let bits = "0000000000";
  [...s].forEach((ch, i) => {
    bits += CODABAR[ch];
    if (i < s.length - 1) bits += "0";
  });
  bits += "0000000000";

  const module = 3;
  const barH = 92;
  const width = bits.length * module;
  let rects = "";
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") {
      rects += `<rect x="${i * module}" y="0" width="${module}" height="${barH}" fill="black"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="126" viewBox="0 0 ${width} 126">
    <rect width="100%" height="100%" fill="white"/>
    ${rects}
    <text x="50%" y="117" text-anchor="middle" font-family="monospace" font-size="18" letter-spacing="2" fill="black">${raw}</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function renderBarcode(text) {
  const img = $("barcodeImage");
  const src = codabarImageData(text);
  if (!src) {
    img.removeAttribute("src");
    img.alt = "バーコードを表示できません";
    return;
  }
  img.src = src;
  img.alt = String(text ?? "");
}

function showDetail(c) {
  detailName.textContent = c.name || "";
  detailKana.textContent = c.kana || "";
  detailCode.textContent = c.code || "";
  results.classList.add("hidden");
  detail.classList.remove("hidden");
  // 表示状態になってから描画。iPhone Safari/PWA対策。
  renderBarcode(c.code || "");
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
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

function buildData(rows, nameIdx, kanaIdx, codeIdx) {
  return rows.slice(1).map(r => ({
    name: nameIdx >= 0 ? String(r[nameIdx] ?? "").trim() : "",
    kana: kanaIdx >= 0 ? String(r[kanaIdx] ?? "").trim() : "",
    code: codeIdx >= 0 ? String(r[codeIdx] ?? "").trim() : ""
  })).filter(x => (x.name || x.kana) && x.code);
}

function fillMapping(headers) {
  const opts = headers.map((h, i) => `<option value="${i}">${escapeHtml(h || `列${i + 1}`)}</option>`).join("");
  nameColumn.innerHTML = '<option value="-1">使用しない</option>' + opts;
  kanaColumn.innerHTML = '<option value="-1">使用しない</option>' + opts;
  codeColumn.innerHTML = opts;
}

async function readFileWithFallback(file) {
  const buf = await file.arrayBuffer();
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
    if (!t.includes("�")) return t;
  } catch {}
  try {
    return new TextDecoder("shift_jis").decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder().decode(buf).replace(/^\uFEFF/, "");
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
  const nameIdx = detectColumn(headers, ["氏名", "顧客名", "需要家名", "お客様名", "客先名", "顧客氏名"]);
  const kanaIdx = detectColumn(headers, ["氏名カナ", "顧客名カナ", "需要家名カナ", "お客様名カナ", "客先名カナ", "カナ", "フリガナ", "ﾌﾘｶﾞﾅ"]);
  const codeIdx = detectColumn(headers, ["配送地点バーコード", "配送バーコード番号", "配送バーコード", "地点バーコード", "地点コード", "地点CD", "地点ｺｰﾄﾞ", "地点番号", "地点No", "地点NO"]);

  if ((nameIdx >= 0 || kanaIdx >= 0) && codeIdx >= 0) {
    const data = buildData(rows, nameIdx, kanaIdx, codeIdx);
    saveCustomers(data);
    importMessage.textContent = `${data.length}件を登録しました。`;
    searchInput.value = "";
    renderResults();
    return;
  }

  pendingRows = rows;
  fillMapping(headers);
  if (nameIdx >= 0) nameColumn.value = String(nameIdx);
  if (kanaIdx >= 0) kanaColumn.value = String(kanaIdx);
  if (codeIdx >= 0) codeColumn.value = String(codeIdx);
  mappingPanel.classList.remove("hidden");
  importMessage.textContent = "列名を自動判定できませんでした。下で列を選択してください。";
}

["input", "search", "change", "keyup", "compositionend"].forEach(ev =>
  searchInput.addEventListener(ev, renderResults)
);
const searchBtn = $("searchBtn");
searchBtn.addEventListener("click", renderResults);
clearBtn.addEventListener("click", () => { searchInput.value = ""; searchInput.focus(); renderResults(); });
backBtn.addEventListener("click", () => { detail.classList.add("hidden"); results.classList.remove("hidden"); });
copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(detailCode.textContent);
    copyBtn.textContent = "コピーしました";
  } catch {
    copyBtn.textContent = "長押しでコピーしてください";
  }
  setTimeout(() => copyBtn.textContent = "バーコード番号をコピー", 1200);
});

settingsBtn.addEventListener("click", () => settingsModal.classList.remove("hidden"));
closeSettingsBtn.addEventListener("click", () => settingsModal.classList.add("hidden"));

csvFile.addEventListener("change", async () => {
  const file = csvFile.files?.[0];
  if (!file) return;
  try {
    await handleCSV(file);
  } catch (e) {
    console.error(e);
    importMessage.textContent = "CSV読み込みでエラーが発生しました。";
  } finally {
    csvFile.value = "";
  }
});

applyMappingBtn.addEventListener("click", () => {
  if (!pendingRows) return;
  const nameIdx = Number(nameColumn.value);
  const kanaIdx = Number(kanaColumn.value);
  const codeIdx = Number(codeColumn.value);
  if (nameIdx < 0 && kanaIdx < 0) {
    importMessage.textContent = "氏名または氏名カナの列を選択してください。";
    return;
  }
  const data = buildData(pendingRows, nameIdx, kanaIdx, codeIdx);
  saveCustomers(data);
  importMessage.textContent = `${data.length}件を登録しました。`;
  mappingPanel.classList.add("hidden");
  pendingRows = null;
  searchInput.value = "";
  renderResults();
});

clearDataBtn.addEventListener("click", () => {
  if (!confirm("登録済みの客先データを削除しますか？")) return;
  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(META_KEY);
  OLD_DATA_KEYS.forEach(k => localStorage.removeItem(k));
  customers = [];
  updateMeta();
  renderResults();
  importMessage.textContent = "データを削除しました。";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
      await registration.update().catch(() => {});
    } catch {}
  });
}

updateMeta();
renderResults();
