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

// 現在表示中のレポート（sample / 解析結果 / D&D いずれも）を JSON で保存する。
// 保存したファイルはこのページに D&D すればそのまま読み戻せる。
let currentReport: Report | null = null;
const exportBtn = document.createElement("button");
exportBtn.type = "button";
exportBtn.className = "export-btn";
exportBtn.textContent = "レポートを JSON で保存";
exportBtn.disabled = true;
exportBtn.addEventListener("click", exportReport);
header.appendChild(exportBtn);

app.appendChild(header);

function exportReport(): void {
  if (!currentReport) return;
  const json = JSON.stringify(currentReport, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const label = currentReport.pages[0]?.label ?? "report";
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40) || "report";
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `qa-report-${safe}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

function setCurrentReport(report: Report): void {
  currentReport = report;
  exportBtn.disabled = false;
}

// ---------- analyze form / static-mode note root ----------
//
// Populated once the /api/health probe (below) resolves: a working form in
// backend mode, a short note in static mode. Sits above the report so a
// fresh analysis result replaces whatever report is currently shown.

const formRoot = document.createElement("div");
formRoot.id = "form-root";
app.appendChild(formRoot);

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
  setCurrentReport(data);
  renderReport(reportRoot, data, screenshotBase);
}

// ---------- backend-mode analyze form ----------

async function runAnalyze(
  url: string,
  widths: string,
  vlm: boolean,
  statusEl: HTMLElement,
  formEls: (HTMLInputElement | HTMLButtonElement)[],
): Promise<void> {
  formEls.forEach((el) => (el.disabled = true));
  statusEl.textContent = "解析中… headless Chrome で描画・計測しています";
  statusEl.className = "analyze-status analyze-status-loading";

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, widths, vlm }),
    });
    const data: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const msg =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `解析に失敗しました (HTTP ${res.status})`;
      statusEl.textContent = msg;
      statusEl.className = "analyze-status analyze-status-error";
      return;
    }

    if (!isReport(data)) {
      statusEl.textContent = "解析結果の形式が qa-report.json と一致しません。";
      statusEl.className = "analyze-status analyze-status-error";
      return;
    }

    statusEl.textContent = "";
    statusEl.className = "analyze-status";
    // Backend already rewrote nav_screenshot to absolute /api/screenshots/...
    // URLs, so the base is the empty string (a valid prefix), not null.
    setCurrentReport(data);
    renderReport(reportRoot, data, "");
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "解析リクエストに失敗しました。バックエンド（server/app.py）が起動しているか確認してください。";
    statusEl.className = "analyze-status analyze-status-error";
  } finally {
    formEls.forEach((el) => (el.disabled = false));
  }
}

function buildAnalyzeForm(): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "analyze-panel";

  const form = document.createElement("form");
  form.className = "analyze-form";

  const urlLabel = document.createElement("label");
  urlLabel.className = "analyze-field";
  urlLabel.appendChild(document.createTextNode("URL"));
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.name = "url";
  urlInput.className = "analyze-input analyze-input-url";
  urlInput.placeholder = "https://example.com";
  urlInput.required = true;
  urlLabel.appendChild(urlInput);

  const widthsLabel = document.createElement("label");
  widthsLabel.className = "analyze-field";
  widthsLabel.appendChild(document.createTextNode("検査幅"));
  const widthsInput = document.createElement("input");
  widthsInput.type = "text";
  widthsInput.name = "widths";
  widthsInput.className = "analyze-input analyze-input-widths";
  widthsInput.value = "360,390,768,1280";
  widthsLabel.appendChild(widthsInput);

  const vlmLabel = document.createElement("label");
  vlmLabel.className = "analyze-checkbox-field";
  const vlmInput = document.createElement("input");
  vlmInput.type = "checkbox";
  vlmInput.name = "vlm";
  vlmLabel.appendChild(vlmInput);
  vlmLabel.appendChild(document.createTextNode("VLM も使う（遅い）"));

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "analyze-submit";
  submitBtn.textContent = "解析";

  form.appendChild(urlLabel);
  form.appendChild(widthsLabel);
  form.appendChild(vlmLabel);
  form.appendChild(submitBtn);

  const statusEl = document.createElement("p");
  statusEl.className = "analyze-status";

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      statusEl.textContent = "URL は http:// または https:// から始めてください。";
      statusEl.className = "analyze-status analyze-status-error";
      return;
    }
    const widths = widthsInput.value.trim() || "360,390,768,1280";
    const vlm = vlmInput.checked;
    void runAnalyze(url, widths, vlm, statusEl, [urlInput, widthsInput, vlmInput, submitBtn]);
  });

  panel.appendChild(form);
  panel.appendChild(statusEl);
  return panel;
}

function buildStaticModeNote(): HTMLElement {
  const note = document.createElement("p");
  note.className = "analyze-static-note";
  note.textContent =
    "任意 URL の解析はローカルで動きます（server/app.py を起動）。このホスト版は静的デモです。";
  return note;
}

fetch("/api/health")
  .then((res) => {
    if (!res.ok) throw new Error(`health check failed: ${res.status}`);
    return res.json();
  })
  .then((data: unknown) => {
    const ok =
      typeof data === "object" && data !== null && (data as Record<string, unknown>)["ok"] === true;
    formRoot.appendChild(ok ? buildAnalyzeForm() : buildStaticModeNote());
  })
  .catch(() => {
    formRoot.appendChild(buildStaticModeNote());
  });

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
