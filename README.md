# qa-dashboard

A small single-page dashboard that visualizes the JSON report produced by
`qa.py --json`, a layout-QA CLI that checks a site across several viewport
widths (nav-link visibility, horizontal overflow, and optional VLM screenshot
review).

Built with **Vite + vanilla TypeScript** (strict mode) — no UI framework, no
runtime dependencies beyond what Vite needs.

## What it shows

For each page in the report:

- A **breakpoint matrix** — one column per tested width, one row per nav
  link (green `✓` = visible, muted `✕` = hidden at that width) plus an
  overflow row (`OK` in green, or the overflow in px in red).
- The page's **findings** (HIGH / REVIEW / LOW), color-coded.
- **Screenshot thumbnails** per width, click to enlarge.

A summary bar at the top shows page count, tested widths, and total
HIGH/REVIEW/LOW counts.

## Run it

```bash
npm install
npm run dev       # dev server, opens the bundled sample report
npm run build     # type-checks (tsc --strict) then builds to dist/
npm run preview   # serve the built dist/ locally
```

## Loading your own report

Drag and drop a `qa-report.json` file anywhere on the page to render it
instead of the bundled sample. Dropped reports won't have their screenshot
files alongside them, so thumbnails fall back to a placeholder box.

## Expected JSON shape

```jsonc
{
  "widths": [360, 390, 768, 1280],
  "vlm": true,
  "summary": { "pages": 2, "HIGH": 3, "REVIEW": 0, "LOW": 24 },
  "pages": [
    {
      "url": "http://127.0.0.1:8899/index.html",
      "label": "index.html",
      "widths": {
        "360": {
          "vw": 360,
          "scrollW": 360,
          "overflow": 0,
          "links": [{ "text": "About", "href": "about.html", "visible": true }],
          "vlm": { "items": ["..."], "issues": "none" },
          "nav_screenshot": "index_html_360_nav.png"
        }
        // ...390, 768, 1280
      },
      "findings": [{ "severity": "HIGH", "message": "..." }]
    }
  ],
  "findings": [{ "severity": "HIGH", "message": "..." }]
}
```

See `src/types.ts` for the full TypeScript interfaces, and
`public/sample/qa-report.json` for a real example.

## Deployment note

`vite.config.ts` sets `base: '/qa-dashboard/'` for GitHub Pages project-page
hosting.
