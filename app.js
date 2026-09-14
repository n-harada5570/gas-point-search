const DATA_KEY = "gas_customers_v2";
const META_KEY = "gas_customers_meta_v2";

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

let customers = loadJSON(DATA_KEY, []);
let pendingRows = null;

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function normalize(v) {
  return String(v ?? "")
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .toUpperCase();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function updateMeta() {
  dataCount.textContent = customers.length ? `登録 ${customers.length}件` : "データ未登録";
  const meta = loadJSON(META_KEY, {});
  updatedAt.textContent = meta.updated ? `更新 ${meta.updated}` : "";
}

function saveCustomers(data) {
  customers = data;
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  const d = new Date();
  const stamp = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  localStorage.setItem(META_KEY, JSON.stringify({updated: stamp}));
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

  const matched = customers.filter(c => {
    const name = normalize(c.name);
    const kana = normalize(c.kana);
    return name.includes(q) || kana.includes(q);
  }).slice(0, 100);

  if (!matched.length) {
    results.innerHTML = '<div class="empty">該当なし</div>';
    return;
  }

  matched.forEach(c => {
    const b = document.createElement("button");
    b.className = "result-item";
    const name = c.name || c.kana || "";
    const kanaLine = c.kana && normalize(c.kana) !== normalize(name)
      ? `<div class="result-kana-sub">${escapeHtml(c.kana)}</div>` : "";
    b.innerHTML = `<div class="result-kana">${escapeHtml(name)}</div>
                   ${kanaLine}
                   <div class="result-code">${escapeHtml(c.code)}</div>`;
    b.addEventListener("click", () => showDetail(c));
    results.appendChild(b);
  });
}

function showDetail(c) {
  detailName.textContent = c.name || "";
  detailKana.textContent = c.kana || "";
  detailCode.textContent = c.code || "";
  results.classList.add("hidden");
  detail.classList.remove("hidden");
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field.replace(/\r$/,"")); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/,"")); rows.push(row); }
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
    code: String(r[codeIdx] ?? "").trim()
  })).filter(x => (x.name || x.kana) && x.code);
}

function fillMapping(headers) {
  const opts = headers.map((h,i)=>`<option value="${i}">${escapeHtml(h || `列${i+1}`)}</option>`).join("");
  nameColumn.innerHTML = '<option value="-1">使用しない</option>' + opts;
  kanaColumn.innerHTML = '<option value="-1">使用しない</option>' + opts;
  codeColumn.innerHTML = opts;
}

async function readFileWithFallback(file) {
  const buf = await file.arrayBuffer();
  try {
    const t = new TextDecoder("utf-8", {fatal:true}).decode(buf).replace(/^\uFEFF/, "");
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
  const nameIdx = detectColumn(headers, [
    "氏名","顧客名","需要家名","お客様名","客先名","顧客氏名"
  ]);
  const kanaIdx = detectColumn(headers, [
    "氏名カナ","顧客名カナ","需要家名カナ","お客様名カナ","客先名カナ","カナ","フリガナ","ﾌﾘｶﾞﾅ"
  ]);
  const codeIdx = detectColumn(headers, [
    "配送地点バーコード","配送バーコード番号","配送バーコード","地点バーコード",
    "地点コード","地点CD","地点ｺｰﾄﾞ","地点番号","地点No","地点NO"
  ]);

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

searchInput.addEventListener("input", renderResults);
clearBtn.addEventListener("click", ()=>{ searchInput.value = ""; searchInput.focus(); renderResults(); });
backBtn.addEventListener("click", ()=>{ detail.classList.add("hidden"); results.classList.remove("hidden"); });
copyBtn.addEventListener("click", async ()=>{
  try {
    await navigator.clipboard.writeText(detailCode.textContent);
    copyBtn.textContent = "コピーしました";
  } catch {
    copyBtn.textContent = "長押しでコピーしてください";
  }
  setTimeout(()=>copyBtn.textContent="バーコード番号をコピー",1200);
});

settingsBtn.addEventListener("click", ()=>settingsModal.classList.remove("hidden"));
closeSettingsBtn.addEventListener("click", ()=>settingsModal.classList.add("hidden"));

csvFile.addEventListener("change", async ()=>{
  const file = csvFile.files?.[0];
  if (!file) return;
  try { await handleCSV(file); }
  catch (e) {
    console.error(e);
    importMessage.textContent = "CSV読み込みでエラーが発生しました。";
  } finally {
    csvFile.value = "";
  }
});

applyMappingBtn.addEventListener("click", ()=>{
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

clearDataBtn.addEventListener("click", ()=>{
  if (!confirm("登録済みの客先データを削除しますか？")) return;
  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(META_KEY);
  customers = [];
  updateMeta();
  renderResults();
  importMessage.textContent = "データを削除しました。";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async ()=>{
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
      registration.update().catch(()=>{});
    } catch {}
  });
}

updateMeta();
renderResults();
