import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import * as storage from "./storage.js";
import { captureScreenshot, getBrowserHealth } from "./browser.js";
import { runMonitorOnce } from "./monitor.js";
import { buildPriceKey, normalizePriceText, parsePriceText, toAmountObject, toIsoFileStamp } from "./price.js";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";


const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/data", express.static(storage.dataDir));
app.use("/screenshots", express.static(storage.screenshotsDir));

const demoProducts = new Map([
  [
    "alpha",
    {
      id: "alpha",
      name: "Demo espresso machine",
      selector: "#demo-price",
      priceText: "1 299,00 BGN",
      pageTitle: "Demo espresso machine",
      currency: "BGN",
    },
  ],
]);

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function makeScreenshotUrl(_req, fileName) {
  return `/data/screenshots/${fileName}`;
}

	function renderDashboardPage() {
	  return `<!doctype html>
	<html lang="bg">
	<head>
	  <meta charset="utf-8" />
	  <meta name="viewport" content="width=device-width, initial-scale=1" />
	  <title>pricePatrol dashboard</title>
	  <style>
	    :root { color-scheme: light; }
	    * { box-sizing: border-box; }
	    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; background: #f4f6fb; color: #0f1724; }
	    .container { max-width: 1100px; margin: 24px auto; padding: 0 20px; }
	    header { padding: 20px 0; display: flex; align-items: center; gap: 16px; }
	    .brand { background: #0f1724; color: #fff; padding: 14px 18px; border-radius: 10px; box-shadow: 0 4px 10px rgba(2,6,23,.45); }
	    header h1 { font-size: 18px; margin: 0; }
	    header .muted { color: #6b7280; font-size: 13px; }
	    main { margin-top: 12px; }
	    .card { background: white; border-radius: 12px; box-shadow: 0 6px 20px rgba(15,23,42,.06); padding: 18px; }
	    .card + .card { margin-top: 18px; }
	    h2 { margin: 0 0 8px; font-size: 16px; }
	    .muted { color: #6b7280; font-size: 13px; }
	
	    /* Table styles improved for readability and accessibility */
	    .table-wrap { overflow: auto; }
	    table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 12px; }
	    thead th { text-align: left; padding: 12px 10px; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
	    tbody td { padding: 14px 10px; vertical-align: top; border-top: 1px solid #edf2f7; }
	    tr:hover td { background: linear-gradient(90deg, rgba(37,99,235,.03), rgba(37,99,235,.01)); }
	    td small { color: #9aa0a6; word-break: break-all; }
	    a { color: #2563eb; text-decoration: none; }
	    a:hover { text-decoration: underline; }
	
	    .status { display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; text-transform: capitalize; }
	    .baseline, .changed { background: #ecfdf5; color: #047857; }
	    .unchanged { background: #eff6ff; color: #1d4ed8; }
	    .manual { background: #faf5ff; color: #7c3aed; }
	    .error { background: #fef2f2; color: #b91c1c; }
	
	    /* Screenshot link as button */
	    .screenshot-link { display: inline-block; margin-top: 4px; background: #eef2ff; color: #1d4ed8; padding: 6px 10px; border-radius: 8px; font-weight: 600; }
	
	    /* Responsive tweaks */
	    @media (max-width: 720px) {
	      header { flex-direction: column; align-items: flex-start; }
	      table { font-size: 13px; }
	      thead th:nth-child(3), tbody td:nth-child(3) { display: none; }
	    }
	  </style>
	</head>
	<body>
	  <div class="container">
	    <header>
	      <div class="brand">
	        <h1>pricePatrol</h1>
	      </div>
	      <div>
	        <div class="muted">product dashboard</div>
	      </div>
	    </header>
	
	    <main>
	      <section class="card" aria-labelledby="watch-targets-title">
	        <h2 id="watch-targets-title">Watch targets</h2>
	        <div class="muted">Current price, reference date, and screenshot appear here when the value changes.</div>
	        <div class="table-wrap" role="region" aria-live="polite">
	          <table>
	            <thead>
	              <tr>
	                <th>Target</th>
	                <th>Current price</th>
	                <th>Dates</th>
	                <th>Status</th>
	                <th>Screenshot</th>
	              </tr>
	            </thead>
	            <tbody id="targets-body"><tr><td colspan="5" class="muted">Loading...</td></tr></tbody>
	          </table>
	        </div>
	      </section>
	    </main>
	  </div>
	
	  <script>
	    const targetsBody = document.getElementById('targets-body');

	    function fmtDate(value) {
	      if (!value) return '—';
	      try { return new Date(value).toLocaleString('bg-BG'); } catch { return value; }
	    }

	    function statusBadge(status) {
	      return '<span class="status ' + (status || 'manual') + '">' + (status || 'manual') + '</span>';
	    }

	    function targetRow(target) {
	      const price = target.lastKnownPriceAmount !== null && target.lastKnownPriceAmount !== undefined
	        ? (target.lastKnownCurrency ? target.lastKnownPriceAmount + ' ' + target.lastKnownCurrency : String(target.lastKnownPriceAmount))
	        : (target.lastKnownPriceText || '—');
	      const screenshot = target.lastKnownScreenshotUrl
	        ? '<a class="screenshot-link" href="' + target.lastKnownScreenshotUrl + '" target="_blank" rel="noreferrer">Open</a>'
	        : '—';
	      const dashboardLink = '/dashboard/' + encodeURIComponent(target.id);
	      return '<tr>' +
	        '<td><a href="' + dashboardLink + '"><strong>' + (target.productName || 'Untitled') + '</strong></a><br /><small>' + (target.productUrl || '') + '</small></td>' +
	        '<td>' + price + '</td>' +
	        '<td><div>Last checked: ' + fmtDate(target.lastCheckedAt) + '</div><div>Last changed: ' + fmtDate(target.lastChangedAt) + '</div></td>' +
	        '<td>' + statusBadge(target.lastStatus || (target.active === false ? 'inactive' : 'manual')) + '</td>' +
	        '<td>' + screenshot + '</td>' +
	      '</tr>';
	    }

	    async function refresh() {
	      try {
	        const res = await fetch('/api/watch-targets');
	        if (!res.ok) throw new Error('Network response not ok');
	        const targets = await res.json();
	        targetsBody.innerHTML = targets.length
	          ? targets.map(targetRow).join('')
	          : '<tr><td colspan="5" class="muted">No watch targets yet.</td></tr>';
	      } catch (e) {
	        targetsBody.innerHTML = '<tr><td colspan="5" class="muted">Error loading targets</td></tr>';
	        console.error('Failed to refresh targets', e);
	      }
	    }

	    refresh();
	    setInterval(refresh, 5000);
	  </script>
	</body>
	</html>`;
	}

function renderTargetDashboardPage(targetId) {
  return `<!doctype html>
<html lang="bg">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>pricePatrol dashboard</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f6f7fb; color: #111827; }
    header { padding: 20px 24px; background: #111827; color: white; }
    main { padding: 24px; display: grid; gap: 20px; }
    .card { background: white; border-radius: 18px; box-shadow: 0 10px 30px rgba(17,24,39,.08); padding: 18px; }
    .muted { color: #6b7280; font-size: 13px; }
    .headline { display: grid; gap: 6px; margin-bottom: 10px; }
    .headline h1 { margin: 0; font-size: 26px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .stat { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px 14px; min-width: 180px; }
    .stat .label { display: block; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
    .stat strong { font-size: 18px; }
    a.button { font: inherit; padding: 10px 14px; border: 0; border-radius: 10px; cursor: pointer; background: #2563eb; color: white; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; }
    a.button.secondary { background: #e5e7eb; color: #111827; }
    .chart-wrap { margin-top: 14px; background: linear-gradient(180deg, #eff6ff 0%, #ffffff 80%); border: 1px solid #dbeafe; border-radius: 16px; padding: 14px; }
    .chart { width: 100%; height: 220px; display: block; }
    .refs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 14px; }
    .ref-card { display: block; border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px; text-decoration: none; color: inherit; background: #fff; }
    .ref-card:hover { border-color: #93c5fd; box-shadow: 0 10px 20px rgba(37,99,235,.08); }
    .ref-card .date { display: block; color: #6b7280; font-size: 12px; margin-bottom: 6px; }
    .ref-card .price { display: block; font-size: 20px; font-weight: 800; color: #111827; }
    .ref-card .status { display: inline-flex; margin-top: 8px; padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #ecfdf5; color: #047857; }
    .chart-legend { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 8px; color: #6b7280; font-size: 12px; }
    .empty { padding: 18px; color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <div class="muted">pricePatrol product dashboard</div>
    <div class="row" style="margin-top:8px;">
      <a class="button secondary" href="/">Back to overview</a>
    </div>
  </header>
  <main>
    <section class="card">
      <div class="headline">
        <div class="muted">Target</div>
        <h1 id="title">Loading…</h1>
        <div id="meta" class="muted"></div>
      </div>
      <div class="row" id="stats"></div>
      <div class="row" style="margin-top:12px;" id="actions"></div>
    </section>

    <section class="card">
      <div class="headline">
        <div class="muted">Reference days</div>
        <h2 style="margin:0; font-size:18px;">Price changes over time</h2>
      </div>
      <div id="chart-empty" class="empty" style="display:none;">No reference snapshots yet.</div>
      <div class="chart-wrap" id="chart-wrap" style="display:none;">
        <svg class="chart" id="chart" viewBox="0 0 800 220" preserveAspectRatio="none" aria-label="Price change chart"></svg>
        <div class="chart-legend" id="chart-legend"></div>
      </div>
      <div id="chart-note" class="muted" style="margin-top:8px">Click a reference point to open its screenshot.</div>
    </section>
  </main>

  <script>
    const targetId = ${JSON.stringify(targetId)};
    const titleEl = document.getElementById('title');
    const metaEl = document.getElementById('meta');
    const statsEl = document.getElementById('stats');
    const actionsEl = document.getElementById('actions');
    const refsGrid = document.getElementById('refs-grid');
    const chart = document.getElementById('chart');
    const chartWrap = document.getElementById('chart-wrap');
    const chartEmpty = document.getElementById('chart-empty');
    const chartLegend = document.getElementById('chart-legend');

    function fmtDate(value) {
      if (!value) return '—';
      try { return new Date(value).toLocaleString('bg-BG'); } catch { return value; }
    }

    function fmtDay(value) {
      if (!value) return '—';
      try { return new Date(value).toLocaleDateString('bg-BG', { day: '2-digit', month: 'short' }); } catch { return value; }
    }

    function priceText(snapshot) {
      if (snapshot.price && snapshot.price.amount !== null && snapshot.price.amount !== undefined) {
        return snapshot.price.currency ? snapshot.price.amount + ' ' + snapshot.price.currency : String(snapshot.price.amount);
      }
      return snapshot.priceText || '—';
    }

    function priceNumber(snapshot) {
      return snapshot.price && snapshot.price.amount !== null && snapshot.price.amount !== undefined
        ? Number(snapshot.price.amount)
        : null;
    }

    function statusBadge(status) {
      return '<span class="status">' + (status || 'reference') + '</span>';
    }

    function renderChart(items) {
      // sort by capturedAt ascending (oldest -> newest)
      const points = items
        .map((item) => ({ snapshot: item, y: priceNumber(item) }))
        .filter((item) => Number.isFinite(item.y))
        .sort((a, b) => new Date(a.snapshot.capturedAt) - new Date(b.snapshot.capturedAt));

      if (points.length < 1) {
        chartWrap.style.display = 'none';
        chartEmpty.style.display = 'block';
        chartLegend.innerHTML = '';
        chart.innerHTML = '';
        return;
      }

      chartEmpty.style.display = 'none';
      chartWrap.style.display = 'block';

      const values = points.map((p) => p.y);
      const min = Math.min.apply(null, values);
      const max = Math.max.apply(null, values);
      const pad = max === min ? 1 : (max - min) * 0.15;
      const left = 30;
      const right = 770;
      const top = 20;
      const bottom = 180;
      const span = Math.max(max - min + pad * 2, 1);
      const step = points.length === 1 ? 0 : (right - left) / (points.length - 1);

      const coords = points.map((p, index) => {
        const x = left + step * index;
        const y = bottom - ((p.y - (min - pad)) / span) * (bottom - top);
        return { x: x, y: y, value: p.y, snapshot: p.snapshot };
      });

      const path = coords.map((p, index) => (index === 0 ? 'M' : 'L') + ' ' + p.x + ' ' + p.y).join(' ');
      const firstPoint = coords[0];
      const lastPoint = coords[coords.length - 1];
      const fillPath = path + ' L ' + lastPoint.x + ' 200 L ' + firstPoint.x + ' 200 Z';

      // grid lines (4 rows)
      const gridLines = [0,1,2,3].map((i) => {
        const gy = top + (i / 3) * (bottom - top);
        return '<line x1="' + left + '" y1="' + gy + '" x2="' + right + '" y2="' + gy + '" stroke="#e6eefc" stroke-width="1"></line>';
      }).join('');

      const dots = coords.map((p) => {
        const title = fmtDate(p.snapshot.capturedAt) + ' — ' + p.value;
        if (p.snapshot.screenshotUrl) {
          return '<a href="' + p.snapshot.screenshotUrl + '" target="_blank" rel="noreferrer" class="pt" style="text-decoration:none;">' +
            '<circle cx="' + p.x + '" cy="' + p.y + '" r="6" fill="#2563eb" stroke="white" stroke-width="3"></circle>' +
            '<title>' + title + '</title>' +
          '</a>';
        }
        return '<g class="pt" style="cursor:default;">' +
          '<circle cx="' + p.x + '" cy="' + p.y + '" r="6" fill="#2563eb" stroke="white" stroke-width="3"></circle>' +
          '<title>' + title + '</title>' +
        '</g>';
      }).join('');
      const labels = coords.map((p) => '<text x="' + p.x + '" y="' + (p.y - 14) + '" text-anchor="middle" font-size="12" fill="#1d4ed8">' + p.value + '</text>').join('');

      // x-axis ticks and labels
      const ticks = coords.map((p) => '<text x="' + p.x + '" y="205" text-anchor="middle" font-size="11" fill="#6b7280">' + fmtDay(p.snapshot.capturedAt) + '</text>').join('');

      chart.innerHTML =
        '<defs>' +
          '<linearGradient id="area" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#93c5fd" stop-opacity="0.45" />' +
            '<stop offset="100%" stop-color="#93c5fd" stop-opacity="0.05" />' +
          '</linearGradient>' +
        '</defs>' +
        gridLines +
        '<path d="' + fillPath + '" fill="url(#area)"></path>' +
        '<path d="' + path + '" fill="none" stroke="#2563eb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>' +
        dots +
        labels +
        ticks;

      chartLegend.innerHTML = '';
    }

    function renderRefs(items) {
      if (!items.length) {
        refsGrid.innerHTML = '';
        return;
      }

      refsGrid.innerHTML = items.map((snapshot) => {
        const href = snapshot.screenshotUrl || '#';
        const disabled = snapshot.screenshotUrl ? '' : 'pointer-events:none;opacity:.55;';
        return '<a class="ref-card" href="' + href + '" target="_blank" rel="noreferrer" style="' + disabled + '">' +
          '<span class="date">' + fmtDate(snapshot.capturedAt) + '</span>' +
          '<span class="price">' + priceText(snapshot) + '</span>' +
          statusBadge(snapshot.status || 'reference') +
        '</a>';
      }).join('');
    }

    async function refresh() {
      const [targetRes, refsRes] = await Promise.all([
        fetch('/api/watch-targets/' + encodeURIComponent(targetId)),
        fetch('/api/snapshots?watchTargetId=' + encodeURIComponent(targetId)),
      ]);

      if (!targetRes.ok) {
        titleEl.textContent = 'Target not found';
        metaEl.textContent = 'This product is deleted or missing.';
        statsEl.innerHTML = '';
        actionsEl.innerHTML = '';
        refsGrid.innerHTML = '';
        chartWrap.style.display = 'none';
        chartEmpty.style.display = 'block';
        chartEmpty.textContent = 'No data.';
        return;
      }

      const target = await targetRes.json();
      const refs = await refsRes.json();

      titleEl.textContent = target.productName || 'Untitled';
      metaEl.textContent = target.productUrl + (target.hostname ? ' · ' + target.hostname : '');
      statsEl.innerHTML =
        '<div class="stat"><span class="label">Current price</span><strong>' + (target.lastKnownPriceAmount !== null && target.lastKnownPriceAmount !== undefined ? (target.lastKnownCurrency ? target.lastKnownPriceAmount + ' ' + target.lastKnownCurrency : String(target.lastKnownPriceAmount)) : (target.lastKnownPriceText || '—')) + '</strong></div>' +
        '<div class="stat"><span class="label">Last checked</span><strong>' + fmtDate(target.lastCheckedAt) + '</strong></div>' +
        '<div class="stat"><span class="label">Last changed</span><strong>' + fmtDate(target.lastChangedAt) + '</strong></div>';
      actionsEl.innerHTML =
        '<a class="button" href="' + (target.lastKnownScreenshotUrl || '#') + '" target="_blank" rel="noreferrer"' + (target.lastKnownScreenshotUrl ? '' : ' aria-disabled="true" style="pointer-events:none;opacity:.6;"') + '>Open latest screenshot</a>' +
        '<a class="button secondary" href="/">Overview</a>';

      const referenceItems = refs.filter((snapshot) => snapshot.changeType === 'baseline' || snapshot.changeType === 'changed' || snapshot.status === 'baseline' || snapshot.status === 'changed' || snapshot.status === 'reference' || snapshot.status === 'manual');
      renderChart(referenceItems);
      // reference cards removed: points on the chart are clickable and open the screenshot
      // renderRefs(referenceItems);
    }

    refresh();
  </script>
</body>
</html>`;
}

function renderDemoPage(product) {
  return `<!doctype html>
<html lang="bg">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${product.pageTitle}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 40px; background: #f6f7fb; color: #111827; }
    .card { max-width: 720px; margin: 0 auto; background: white; border-radius: 18px; padding: 24px; box-shadow: 0 10px 30px rgba(17,24,39,.08); }
    .price { font-size: 48px; font-weight: 800; color: #2563eb; }
    button { font: inherit; padding: 10px 14px; border: 0; border-radius: 10px; background: #111827; color: white; cursor: pointer; }
    code { background: #eef2ff; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <p class="muted">Demo page for local monitoring</p>
    <h1>${product.name}</h1>
    <div id="demo-price" class="price" data-price="${product.priceText}">${product.priceText}</div>
    <p>Selector for monitoring: <code>${product.selector}</code></p>
    <p>This page is intentionally simple so you can test the baseline/change flow locally.</p>
    <button id="change">Change price</button>
  </div>
  <script>
    document.getElementById('change').addEventListener('click', async () => {
      const next = prompt('Enter new price text', document.getElementById('demo-price').textContent);
      if (!next) return;
      const res = await fetch('/api/demo/product/${product.id}/price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceText: next }),
      });
      if (res.ok) location.reload();
    });
  </script>
</body>
</html>`;
}

function getDemoProduct(id) {
  return demoProducts.get(id) ?? null;
}

function setDemoProductPrice(id, priceText) {
  const product = getDemoProduct(id);
  if (!product) return null;

  const next = normalizePriceText(priceText);
  product.priceText = next;
  return product;
}

function bumpDemoProductPrice(id) {
  const product = getDemoProduct(id);
  if (!product) return null;

  const parsed = parsePriceText(product.priceText);
  if (parsed) {
    const nextAmount = (parsed.amount + 10).toFixed(2).replace(".", ",");
    const currency = parsed.currency ? ` ${parsed.currency}` : "";
    product.priceText = `${nextAmount}${currency}`.replace(",00", ",00");
  } else {
    product.priceText = `${product.priceText} *`;
  }

  return product;
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/browser/health", async (_req, res) => {
  res.json(await getBrowserHealth());
});

app.get("/", (_req, res) => {
  res.type("html").send(renderDashboardPage());
});

app.get("/api/demo/products", (_req, res) => {
  res.json([...demoProducts.values()]);
});

app.get("/demo/product/:id", (req, res) => {
  const product = getDemoProduct(req.params.id);
  if (!product) return res.status(404).send("Demo product not found");
  res.type("html").send(renderDemoPage(product));
});

app.post("/api/demo/product/:id/price", (req, res) => {
  const product = setDemoProductPrice(req.params.id, req.body?.priceText);
  if (!product) return res.status(404).json({ error: "Demo product not found" });
  res.json({ ok: true, product });
});

app.post("/api/demo/product/:id/bump", (_req, res) => {
  const product = bumpDemoProductPrice(req.params.id);
  if (!product) return res.status(404).json({ error: "Demo product not found" });
  res.json({ ok: true, product });
});

app.get("/api/watch-targets", async (req, res) => {
  const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";
  res.json(await storage.listWatchTargets({ includeInactive }));
});

app.get("/api/watch-targets/:id", async (req, res) => {
  const target = await storage.getWatchTargetById(req.params.id);
  if (!target) return res.status(404).json({ error: "Watch target not found" });
  res.json(target);
});

app.delete("/api/watch-targets/:id", async (req, res) => {
  try {
    const deleted = await storage.deleteWatchTarget(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Watch target not found" });
    res.json({ ok: true, deleted: deleted.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  }
});

app.get("/dashboard/:id", async (req, res) => {
  const target = await storage.getWatchTargetById(req.params.id);
  if (!target) return res.status(404).send("Target not found");
  res.type("html").send(renderTargetDashboardPage(target.id));
});

app.post("/api/watch-targets", async (req, res) => {
  try {
    const {
      productUrl,
      selector,
      selectorBackup,
      fallbackSelectors,
      priceText,
      price,
      pageTitle,
      productName,
      currency,
      active,
      checkIntervalMinutes,
    } = req.body ?? {};

    if (!productUrl) {
      return res.status(400).json({ error: "productUrl is required" });
    }

    let hostname;
    try {
      hostname = new URL(productUrl).hostname;
    } catch {
      return res.status(400).json({ error: "Invalid productUrl" });
    }

    const existing = await storage.getWatchTargetByUrl(productUrl);
    const now = new Date().toISOString();
    const snapshotPrice = price ?? toAmountObject(priceText ?? "", currency ?? null);

    const doc = await storage.upsertWatchTarget({
      id: existing?.id ?? crypto.randomUUID(),
      productUrl,
      hostname,
      pageTitle: pageTitle ?? existing?.pageTitle ?? "",
      productName: productName ?? existing?.productName ?? "",
      selector: selector ?? existing?.selector ?? "",
      selectorBackup: selectorBackup ?? existing?.selectorBackup ?? null,
      fallbackSelectors: Array.isArray(fallbackSelectors) ? fallbackSelectors : existing?.fallbackSelectors ?? [],
      currency: currency ?? existing?.currency ?? snapshotPrice?.currency ?? null,
      active: active ?? existing?.active ?? true,
      checkIntervalMinutes: checkIntervalMinutes ?? existing?.checkIntervalMinutes ?? 5,
      lastKnownPriceText: priceText ?? existing?.lastKnownPriceText ?? null,
      lastKnownPriceKey: priceText ? buildPriceKey(priceText, currency ?? snapshotPrice?.currency ?? null) : existing?.lastKnownPriceKey ?? null,
      lastKnownPriceAmount: snapshotPrice?.amount ?? existing?.lastKnownPriceAmount ?? null,
      lastKnownCurrency: snapshotPrice?.currency ?? existing?.lastKnownCurrency ?? currency ?? null,
      lastKnownScreenshotUrl: existing?.lastKnownScreenshotUrl ?? null,
      lastCheckedAt: existing?.lastCheckedAt ?? now,
      lastChangedAt: existing?.lastChangedAt ?? now,
      lastStatus: existing?.lastStatus ?? "manual",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    // If this is a newly created target, capture an initial baseline screenshot via Playwright Firefox
    if (!existing) {
      try {
        const timestamp = new Date();
        const pad = (n) => String(n).padStart(2,'0');
        const stamp = `${timestamp.getUTCFullYear()}${pad(timestamp.getUTCMonth()+1)}${pad(timestamp.getUTCDate())}_${pad(timestamp.getUTCHours())}${pad(timestamp.getUTCMinutes())}${pad(timestamp.getUTCSeconds())}`;
        const shortId = String(doc.id || '').slice(0,8);
        const fileName = `${shortId}-${stamp}.png`;
        const screenshotPath = `${storage.screenshotsDir}/${fileName}`;
        await captureScreenshot({ url: doc.productUrl, screenshotPath, selector: [doc.selector, doc.selectorBackup].filter(Boolean) });
        const screenshotUrl = makeScreenshotUrl(req, fileName);

        await storage.insertSnapshot({
          id: crypto.randomUUID(),
          watchTargetId: doc.id,
          productUrl: doc.productUrl,
          hostname: doc.hostname,
          pageTitle: doc.pageTitle,
          productName: doc.productName,
          selector: doc.selector,
          selectorBackup: doc.selectorBackup ?? null,
          priceText: doc.lastKnownPriceText,
          selectedText: doc.lastKnownPriceText,
          currency: doc.lastKnownCurrency,
          price: doc.lastKnownPriceAmount !== null && doc.lastKnownPriceAmount !== undefined ? { amount: doc.lastKnownPriceAmount, currency: doc.lastKnownCurrency } : null,
          capturedAt: timestamp,
          viewport: null,
          screenshotUrl,
          status: "baseline",
          errorMessage: null,
          changeType: "baseline",
          priceKey: doc.lastKnownPriceKey,
        });

        await storage.updateWatchTarget(doc.id, { lastKnownScreenshotUrl: screenshotUrl, lastCheckedAt: timestamp, lastChangedAt: timestamp });
      } catch (err) {
        console.error("Baseline screenshot failed:", err);
        await storage.updateWatchTarget(doc.id, { lastStatus: "error", lastCheckedAt: new Date().toISOString() });
      }
    }

    res.status(existing ? 200 : 201).json(doc);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  }
});

app.patch("/api/watch-targets/:id", async (req, res) => {
  try {
    const updated = await storage.updateWatchTarget(req.params.id, req.body ?? {});
    if (!updated) return res.status(404).json({ error: "Watch target not found" });
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  }
});

app.get("/api/snapshots", async (req, res) => {
  const { watchTargetId, url, hostname, status, limit } = req.query;
  res.json(await storage.listSnapshots({ watchTargetId, url, hostname, status, limit }));
});

app.delete("/api/snapshots", async (_req, res) => {
  try {
    const deleted = await storage.deleteAllSnapshots();
    res.json({ ok: true, deleted });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  }
});

app.get("/api/prices", async (req, res) => {
  const { url, hostname } = req.query;
  res.json(await storage.listPrices({ url, hostname }));
});

app.post("/api/monitor/run", async (_req, res) => {
  try {
    const results = await runMonitorOnce();
    res.json({ ok: true, count: results.length, results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  }
});

app.post("/api/prices", async (req, res) => {
  try {
    const {
      productUrl,
      selector,
      selectorBackup,
      priceText,
      price,
      pageTitle,
      productName,
      selectedText,
      capturedAt,
      viewport,
      currency,
    } = req.body ?? {};

    if (!productUrl || !priceText || !selector) {
      return res.status(400).json({ error: "productUrl, selector, and priceText are required" });
    }

    let hostname;
    try {
      hostname = new URL(productUrl).hostname;
    } catch {
      return res.status(400).json({ error: "Invalid productUrl" });
    }

    const id = crypto.randomUUID();
    const timestamp = new Date(capturedAt ?? new Date().toISOString());
    const pad = (n) => String(n).padStart(2,'0');
    const stamp = `${timestamp.getUTCFullYear()}${pad(timestamp.getUTCMonth()+1)}${pad(timestamp.getUTCDate())}_${pad(timestamp.getUTCHours())}${pad(timestamp.getUTCMinutes())}${pad(timestamp.getUTCSeconds())}`;
    const shortId = String(id).slice(0,8);
    const fileName = `manual_${shortId}-${stamp}.png`;
    const screenshotPath = `${storage.screenshotsDir}/${fileName}`;
    await captureScreenshot({
      url: productUrl,
      screenshotPath,
      selector: [selector, selectorBackup].filter(Boolean),
      viewport: viewport ?? { width: 1440, height: 1800 },
    });

    const doc = await storage.insertSnapshot({
      id,
      watchTargetId: null,
      hostname,
      productUrl,
      pageTitle: pageTitle ?? "",
      productName: productName ?? "",
      selector,
      selectorBackup: selectorBackup ?? null,
      priceText,
      selectedText: selectedText ?? "",
      currency: currency ?? price?.currency ?? null,
      price: price ?? null,
      capturedAt: capturedAt ?? new Date().toISOString(),
      viewport: viewport ?? null,
      screenshotUrl: makeScreenshotUrl(req, fileName),
      status: "manual",
      errorMessage: null,
      changeType: "manual",
      priceKey: buildPriceKey(priceText, currency ?? price?.currency ?? null),
    });

    await storage.upsertWatchTarget({
      id: (await storage.getWatchTargetByUrl(productUrl))?.id ?? crypto.randomUUID(),
      productUrl,
      hostname,
      pageTitle: pageTitle ?? "",
      productName: productName ?? "",
      selector,
      selectorBackup: selectorBackup ?? null,
      fallbackSelectors: [],
      currency: currency ?? price?.currency ?? null,
      active: true,
      checkIntervalMinutes: 5,
      lastKnownPriceText: priceText,
      lastKnownPriceKey: buildPriceKey(priceText, currency ?? price?.currency ?? null),
      lastKnownPriceAmount: price?.amount ?? null,
      lastKnownCurrency: currency ?? price?.currency ?? null,
      lastKnownScreenshotUrl: makeScreenshotUrl(req, fileName),
      lastCheckedAt: doc.capturedAt,
      lastChangedAt: doc.capturedAt,
      lastStatus: "manual",
      createdAt: doc.capturedAt,
      updatedAt: doc.capturedAt,
    });

    res.status(201).json(doc);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  }
});

app.delete("/api/prices/:id", async (req, res) => {
  try {
    const removed = await storage.deletePrice(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.json({ ok: true, deleted: removed.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  }
});

await storage.init();

app.listen(PORT, HOST, () => console.log(`pricePatrol backend: http://${HOST}:${PORT}`));
