const DATA_KEY="gas_customers_v2", META_KEY="gas_customers_meta_v2";
const $=id=>document.getElementById(id);
let customers=load(DATA_KEY,[]), pending=null;
function load(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):f}catch{return f}}
function norm(s){return String(s??"").normalize("NFKC").replace(/\s/g,"").toUpperCase()}
function updateMeta(){ $("dataCount").textContent=customers.length?`登録 ${customers.length}件`:"データ未登録"; const m=load(META_KEY,{}); $("updatedAt").textContent=m.updated?`更新 ${m.updated}`:""; }
function save(data){customers=data;localStorage.setItem(DATA_KEY,JSON.stringify(data));const d=new Date();localStorage.setItem(META_KEY,JSON.stringify({updated:`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`}));updateMeta()}
function parseCSV(text){
 const rows=[];let row=[],cell="",q=false;
 for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];
  if(c=='"'){if(q&&n=='"'){cell+='"';i++}else q=!q}
  else if(c==","&&!q){row.push(cell);cell=""}
  else if((c=="\n"||c=="\r")&&!q){if(c=="\r"&&n=="\n")i++;row.push(cell);cell="";if(row.some(x=>x!==""))rows.push(row);row=[]}
  else cell+=c;
 }
 row.push(cell);if(row.some(x=>x!==""))rows.push(row);return rows;
}
function findCol(h,names){const a=h.map(norm);for(const n of names){const x=a.indexOf(norm(n));if(x>=0)return x}return -1}
async function readFile(file){
 const buf=await file.arrayBuffer();
 try{return new TextDecoder("utf-8",{fatal:true}).decode(buf).replace(/^\uFEFF/,"")}
 catch{try{return new TextDecoder("shift_jis").decode(buf).replace(/^\uFEFF/,"")}catch{return new TextDecoder().decode(buf)}}
}
function build(rows,k,c){return rows.slice(1).map(r=>({kana:String(r[k]??"").trim(),code:String(r[c]??"").trim()})).filter(x=>x.kana&&x.code)}
async function importCSV(file){
 $("importMessage").textContent="読み込み中…";$("mappingPanel").classList.add("hidden");
 const rows=parseCSV(await readFile(file)); if(rows.length<2)throw Error("no rows");
 const h=rows[0];
 let k=findCol(h,["氏名カナ","顧客名カナ","需要家名カナ","お客様名カナ","カナ","フリガナ","ﾌﾘｶﾞﾅ"]);
 let c=findCol(h,["地点コード","地点ｺｰﾄﾞ","地点CD","地点ＣＤ"]);
 if(k<0||c<0){pending=rows; const opts=h.map((x,i)=>`<option value="${i}">${x||`列${i+1}`}</option>`).join("");$("kanaColumn").innerHTML=opts;$("codeColumn").innerHTML=opts;$("mappingPanel").classList.remove("hidden");$("importMessage").textContent="列を選択してください。";return}
 const data=build(rows,k,c); if(!data.length)throw Error("no data");save(data);$("importMessage").textContent=`${data.length}件を登録しました。`;render();
}
function render(){
 const q=norm($("searchInput").value), el=$("results");el.innerHTML="";
 if(!q)return;
 customers.filter(x=>norm(x.kana).includes(q)).slice(0,100).forEach(x=>{const b=document.createElement("button");b.className="result";b.textContent=x.kana;b.onclick=()=>show(x);el.appendChild(b)});
}
function show(x){$("results").classList.add("hidden");$("detail").classList.remove("hidden");$("detailKana").textContent=x.kana;$("detailCode").textContent=x.code}
$("searchInput").oninput=render;$("clearBtn").onclick=()=>{$("searchInput").value="";render()};
$("backBtn").onclick=()=>{$("detail").classList.add("hidden");$("results").classList.remove("hidden")};
$("copyBtn").onclick=async()=>{await navigator.clipboard.writeText($("detailCode").textContent);$("copyBtn").textContent="コピーしました";setTimeout(()=>$("copyBtn").textContent="地点コードをコピー",1200)};
$("settingsBtn").onclick=()=>$("settingsModal").classList.remove("hidden");
$("closeSettingsBtn").onclick=()=>$("settingsModal").classList.add("hidden");
$("csvFile").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importCSV(f)}catch(err){console.error(err);$("importMessage").textContent="CSV読み込みでエラーが発生しました。"}finally{e.target.value=""}};
$("applyMappingBtn").onclick=()=>{if(!pending)return;const d=build(pending,+$("kanaColumn").value,+$("codeColumn").value);if(!d.length){$("importMessage").textContent="登録できるデータがありません。";return}save(d);pending=null;$("mappingPanel").classList.add("hidden");$("importMessage").textContent=`${d.length}件を登録しました。`;render()};
$("clearDataBtn").onclick=()=>{if(!confirm("登録済みの客先データを削除しますか？"))return;localStorage.removeItem(DATA_KEY);localStorage.removeItem(META_KEY);customers=[];updateMeta();render();$("importMessage").textContent="データを削除しました。"};
if("serviceWorker"in navigator)addEventListener("load",async()=>{try{const r=await navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});r.update().catch(()=>{})}catch{}});
updateMeta();render();