import "./styles.css";
import type { Report } from "./types";
import { renderReport } from "./render";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app root element not found");
}

// ---------- header ----------

const header = document.createElement("header");
header.className = "app-header";

const title = document.createElement("h1");
title.textContent = "qa-dashboard — レイアウト QA レポートビューア";
header.appendChild(title);

const lede = document.createElement("p");
lede.className = "lede";
lede.textContent =
  "複数の画面幅でナビゲーションリンクの可視性・横はみ出し・スクリーンショットを一覧します。";
header.appendChild(lede);

const note = document.createElement("p");
note.className = "note";
note.textContent = "AI が書いたツール qa.py の出力を表示します。";
header.appendChild(note);

const dropHint = document.createElement("p");
dropHint.className = "drop-hint";
dropHint.innerHTML =
  '<strong>qa-report.json</strong> をこのページのどこかにドラッグ&ドロップすると読み込めます。';
header.appendChild(dropHint);

app.appendChild(header);

// ---------- report root ----------

const reportRoot = document.createElement("div");
reportRoot.id = "report-root";
app.appendChild(reportRoot);

function showError(message: string): void {
  reportRoot.innerHTML = "";
  const box = document.createElement("div");
  box.className = "empty-state";
  box.textContent = message;
  reportRoot.appendChild(box);
}

function isReport(data: unknown): data is Report {
  if (typeof data !== "object" || data === null) return false;
  const r = data as Record<string, unknown>;
  return (
    Array.isArray(r["widths"]) &&
    Array.isArray(r["pages"]) &&
    Array.isArray(r["findings"]) &&
    typeof r["summary"] === "object" &&
    r["summary"] !== null
  );
}

function loadReport(data: unknown, screenshotBase: string | null): void {
  if (!isReport(data)) {
    showError("読み込んだファイルは qa-report.json の形式と一致しません。");
    return;
  }
  renderReport(reportRoot, data, screenshotBase);
}

// ---------- default: fetch bundled sample ----------

const sampleUrl = `${import.meta.env.BASE_URL}sample/qa-report.json`;
const sampleScreenshotBase = `${import.meta.env.BASE_URL}sample/`;

fetch(sampleUrl)
  .then((res) => {
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    return res.json();
  })
  .then((data: unknown) => loadReport(data, sampleScreenshotBase))
  .catch((err: unknown) => {
    console.error(err);
    showError("サンプルレポートの読み込みに失敗しました。");
  });

// ---------- drag & drop ----------

let dragDepth = 0;

document.body.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth += 1;
  document.body.classList.add("drag-active");
});

document.body.addEventListener("dragover", (e) => {
  e.preventDefault();
});

document.body.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    document.body.classList.remove("drag-active");
  }
});

document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("drag-active");

  const file = e.dataTransfer?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = typeof reader.result === "string" ? reader.result : "";
      const data: unknown = JSON.parse(text);
      // Dropped reports come without their screenshot files alongside them,
      // so thumbnails fall back to placeholders.
      loadReport(data, null);
    } catch (err) {
      console.error(err);
      showError("JSON の解析に失敗しました。qa-report.json を確認してください。");
    }
  };
  reader.onerror = () => {
    showError("ファイルの読み込みに失敗しました。");
  };
  reader.readAsText(file);
});
