import type { Finding, NavLink, PageReport, Report, Severity, WidthData } from "./types";

// ---------- small DOM helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badgeClass(sev: Severity): string {
  if (sev === "HIGH") return "badge badge-high";
  if (sev === "REVIEW") return "badge badge-review";
  return "badge badge-low";
}

// ---------- severity filter state ----------
//
// The three summary badges double as toggle buttons: clicking one shows or
// hides every finding of that severity, across every page's 指摘事項 list.
// State lives here (not per-render) so it survives report reloads.

const ALL_SEVERITIES: Severity[] = ["HIGH", "REVIEW", "LOW"];
const activeSeverities = new Set<Severity>(ALL_SEVERITIES);

function applyFindingsFilter(): void {
  const rows = document.querySelectorAll<HTMLElement>(".finding-row[data-severity]");
  rows.forEach((row) => {
    const sev = row.dataset["severity"] as Severity | undefined;
    const visible = sev === undefined || activeSeverities.has(sev);
    row.style.display = visible ? "" : "none";
  });
}

// ---------- lightbox ----------

let lightboxEl: HTMLDivElement | null = null;
let lightboxImg: HTMLImageElement | null = null;

function ensureLightbox(): { overlay: HTMLDivElement; img: HTMLImageElement } {
  if (lightboxEl && lightboxImg) {
    return { overlay: lightboxEl, img: lightboxImg };
  }
  const overlay = el("div", "lightbox hidden");
  const img = el("img");
  img.alt = "screenshot enlarged";
  overlay.appendChild(img);
  overlay.addEventListener("click", () => {
    overlay.classList.add("hidden");
  });
  document.body.appendChild(overlay);
  lightboxEl = overlay;
  lightboxImg = img;
  return { overlay, img };
}

function openLightbox(src: string): void {
  const { overlay, img } = ensureLightbox();
  img.src = src;
  overlay.classList.remove("hidden");
}

// ---------- summary bar ----------

function makeSeverityToggle(sev: Severity, count: number): HTMLButtonElement {
  const btn = el("button", `${badgeClass(sev)} badge-toggle`);
  btn.type = "button";
  btn.textContent = `${sev} ${count}`;
  btn.dataset["severity"] = sev;
  btn.title = "クリックで表示/非表示を切り替え";

  const syncState = (): void => {
    const isActive = activeSeverities.has(sev);
    btn.classList.toggle("badge-inactive", !isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  };
  syncState();

  btn.addEventListener("click", () => {
    if (activeSeverities.has(sev)) {
      activeSeverities.delete(sev);
    } else {
      activeSeverities.add(sev);
    }
    syncState();
    applyFindingsFilter();
  });

  return btn;
}

function renderSummary(report: Report): HTMLElement {
  const bar = el("section", "summary-bar");

  const pagesStat = el("div", "summary-stat");
  pagesStat.appendChild(el("span", "label", "ページ数"));
  pagesStat.appendChild(el("span", "value", String(report.summary.pages)));
  bar.appendChild(pagesStat);

  const widthsStat = el("div", "summary-stat");
  widthsStat.appendChild(el("span", "label", "検査幅"));
  widthsStat.appendChild(
    el("span", "value", report.widths.map((w) => `${w}px`).join(" / ")),
  );
  bar.appendChild(widthsStat);

  const badgeRow = el("div", "badge-row");
  badgeRow.appendChild(makeSeverityToggle("HIGH", report.summary.HIGH));
  badgeRow.appendChild(makeSeverityToggle("REVIEW", report.summary.REVIEW));
  badgeRow.appendChild(makeSeverityToggle("LOW", report.summary.LOW));
  bar.appendChild(badgeRow);

  return bar;
}

// ---------- breakpoint matrix ----------

function renderMatrix(page: PageReport, widths: number[]): HTMLElement {
  const scroll = el("div", "matrix-scroll");
  const table = el("table", "matrix-table");

  // header row
  const thead = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", undefined, ""));
  for (const w of widths) {
    headRow.appendChild(el("th", undefined, `${w}px`));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");

  // overflow row
  const overflowRow = el("tr", "row-overflow");
  overflowRow.appendChild(el("td", undefined, "はみ出し"));
  for (const w of widths) {
    const wd: WidthData | undefined = page.widths[String(w)];
    const td = el("td");
    if (!wd) {
      td.textContent = "—";
    } else if (wd.overflow === 0) {
      td.className = "cell-ok";
      td.textContent = "OK";
    } else {
      td.className = "cell-bad";
      td.textContent = `${wd.overflow}px`;
    }
    overflowRow.appendChild(td);
  }
  tbody.appendChild(overflowRow);

  // unique nav links, keyed by href, in first-seen order
  const linkOrder: string[] = [];
  const linkLabel = new Map<string, string>();
  for (const w of widths) {
    const wd = page.widths[String(w)];
    if (!wd) continue;
    for (const link of wd.links) {
      if (!linkLabel.has(link.href)) {
        linkLabel.set(link.href, link.text);
        linkOrder.push(link.href);
      }
    }
  }

  for (const href of linkOrder) {
    const row = el("tr");
    row.appendChild(el("td", undefined, linkLabel.get(href) ?? href));
    for (const w of widths) {
      const wd = page.widths[String(w)];
      const td = el("td");
      const link: NavLink | undefined = wd?.links.find((l) => l.href === href);
      if (!link) {
        td.className = "cell-hidden";
        td.textContent = "—";
      } else if (link.visible) {
        td.className = "cell-visible";
        td.textContent = "✓";
      } else {
        td.className = "cell-hidden";
        td.textContent = "✕";
      }
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }

  // VLM issues row (only if any width has a non-"none" issue)
  const hasVlmIssue = widths.some((w) => {
    const wd = page.widths[String(w)];
    return wd?.vlm && wd.vlm.issues !== "none";
  });
  if (hasVlmIssue) {
    const row = el("tr");
    row.appendChild(el("td", undefined, "VLM"));
    for (const w of widths) {
      const wd = page.widths[String(w)];
      const td = el("td");
      if (wd?.vlm && wd.vlm.issues !== "none") {
        td.className = "vlm-note";
        td.textContent = wd.vlm.issues;
      } else {
        td.textContent = "—";
      }
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  scroll.appendChild(table);
  return scroll;
}

// ---------- findings ----------

function renderFindings(findings: Finding[]): HTMLElement {
  const list = el("ul", "findings-list");
  if (findings.length === 0) {
    list.classList.add("empty");
    list.appendChild(el("li", undefined, "指摘なし"));
    return list;
  }
  for (const f of findings) {
    const row = el("li", "finding-row");
    row.dataset["severity"] = f.severity;
    row.appendChild(el("span", badgeClass(f.severity), f.severity));
    row.appendChild(el("span", "message", f.message));
    list.appendChild(row);
  }
  return list;
}

// ---------- screenshots ----------

function renderScreenshots(
  page: PageReport,
  widths: number[],
  screenshotBase: string | null,
): HTMLElement {
  const row = el("div", "shot-row");
  for (const w of widths) {
    const wd = page.widths[String(w)];
    const item = el("div", "shot-item");
    const filename = wd?.nav_screenshot ?? null;
    if (filename && screenshotBase) {
      const img = el("img", "shot-thumb");
      img.src = `${screenshotBase}${filename}`;
      img.alt = `${page.label} @ ${w}px nav screenshot`;
      img.loading = "lazy";
      img.addEventListener("click", () => openLightbox(img.src));
      item.appendChild(img);
    } else {
      const placeholder = el("div", "shot-placeholder", "screenshot なし");
      item.appendChild(placeholder);
    }
    item.appendChild(el("span", "shot-label", `${w}px`));
    row.appendChild(item);
  }
  return row;
}

// ---------- page card ----------

function renderPageCard(
  page: PageReport,
  widths: number[],
  screenshotBase: string | null,
): HTMLElement {
  const card = el("article", "page-card");
  card.appendChild(el("h2", undefined, page.label));
  card.appendChild(el("p", "page-url", page.url));

  card.appendChild(el("h3", undefined, "ブレークポイント表"));
  card.appendChild(renderMatrix(page, widths));

  card.appendChild(el("h3", undefined, "指摘事項"));
  card.appendChild(renderFindings(page.findings));

  card.appendChild(el("h3", undefined, "スクリーンショット"));
  card.appendChild(renderScreenshots(page, widths, screenshotBase));

  return card;
}

// ---------- top-level render ----------

export function renderReport(
  container: HTMLElement,
  report: Report,
  screenshotBase: string | null,
): void {
  container.innerHTML = "";

  container.appendChild(renderSummary(report));

  if (report.pages.length === 0) {
    container.appendChild(el("div", "empty-state", "ページがありません"));
    return;
  }

  for (const page of report.pages) {
    container.appendChild(renderPageCard(page, report.widths, screenshotBase));
  }

  // Newly rendered finding rows start visible; sync them with whatever
  // severity filter state is currently active (e.g. after a report reload).
  applyFindingsFilter();
}
