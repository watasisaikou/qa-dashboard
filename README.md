# qa-dashboard

A small single-page dashboard that visualizes the JSON report produced by
`qa.py --json`, a layout-QA CLI that checks a site across several viewport
widths (nav-link visibility, horizontal overflow, and optional VLM screenshot
review). The bundled `qa.py` (under `server/`) is a vendored copy of an
AI-written CLI from [namakoo-dev/tools](https://github.com/namakoo-dev/tools);
the dashboard itself is the TypeScript codebase in `src/`.

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
          "nav_screenshot": "index_html_360_nav.png",
          "hamburger": true,        // menu toggle detected at this width
          "hamburgerNamed": true    // toggle has an accessible name (a11y)
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
`public/sample/qa-report.json` for a real example — a `qa.py` run against
[namakoo-dev.github.io](https://namakoo-dev.github.io/) (`index.html` and
`about.html`, no `--vlm`, so screenshots/VLM fields are `null`).

## Deployment note

`vite.config.ts` sets `base: '/qa-dashboard/'` for GitHub Pages project-page
hosting.

## ローカルで任意 URL を解析する

`server/app.py` は stdlib のみの小さなバックエンドで、フォームに入力した URL に
対して `qa.py` を実行し、結果をそのままダッシュボードに表示します（ライブ配信は
無し — 1 回のリクエストで完走を待って結果を返すだけ）。

**前提:**

- Python 3 と `websocket-client`（`pip install websocket-client` — `qa.py` の
  CDP 制御に必須。無いとフォーム送信が 502 で失敗します）
- Chrome（または Edge）— `qa.py` が headless で使う
- `--vlm` を使う場合のみ: [ollama](https://ollama.com/) をローカルで起動し、
  `gemma4:e4b-it-qat` モデルを pull 済みであること

**(a) 本番相当（ビルド済みを配信）:**

```bash
npm run build
python server/app.py
# -> http://localhost:8000/qa-dashboard/ を開く
```

**(b) 開発時（Vite dev server + バックエンド）:**

```bash
python server/app.py       # ターミナル1
npm run dev                 # ターミナル2 -> http://localhost:5173/
```

`vite.config.ts` の `server.proxy` が `/api/*` を `http://localhost:8000` に
転送するので、`npm run dev` からもバックエンドの解析 API を呼べます。

`/api/health` が応答すればフォームが表示され（backend mode）、応答しなければ
サンプルレポートのみを表示する静的モードにフォールバックします（GitHub Pages
などバックエンドの無いホスティング向け）。

**注意:**

- バックエンドは `127.0.0.1` にのみバインドします（外部公開されません）。
- 解析は同時に 1 本まで（2 本目のリクエストは `409` を返します）。
- `--port` または環境変数 `QA_PORT` でポートを変更できます。
- headless Chrome をブロックするサイトや、読み込みが遅いサイトはタイムアウト
  （180 秒）になることがあります。
