import { getExtensionUrl } from "./api.js";
import { buildRawScreenshotUrl, getProductDetailByUrl, getSettings } from "./github.js";

const titleEl = document.getElementById("title");
const subtitleEl = document.getElementById("subtitle");
const errorEl = document.getElementById("error");
const statsEl = document.getElementById("stats");
const linksEl = document.getElementById("links");
const chartWrapEl = document.getElementById("chart-wrap");
const refsEl = document.getElementById("references");

function formatDate(value) {
  return new Date(value).toLocaleString("bg-BG");
}

function formatDay(value) {
  return new Date(value).toLocaleDateString("bg-BG", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(snapshot) {
  const amount = snapshot?.price?.amount ?? null;
  const currency = snapshot?.price?.currency ?? snapshot?.currency ?? "";
  if (amount === null || amount === undefined || amount === "") {
    return snapshot?.priceText || "—";
  }
  return currency ? `${amount} ${currency}` : String(amount);
}

function formatCurrencyAmount(amount, currency) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  return currency ? `${amount} ${currency}` : String(amount);
}

function setError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function parseProductUrl() {
  const params = new URLSearchParams(location.search);
  return params.get("product");
}

function buildChartSvg(points) {
  const width = 1120;
  const height = 280;
  const padding = 32;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  if (!points.length) {
    return `<div class="empty">No numeric price history is available for this product yet.</div>`;
  }

  const min = Math.min(...points.map((p) => p.amount));
  const max = Math.max(...points.map((p) => p.amount));
  const span = Math.max(max - min, 1);
  const stepX = points.length === 1 ? 0 : chartWidth / (points.length - 1);

  const scaled = points.map((point, index) => {
    const x = padding + stepX * index;
    const y = padding + chartHeight - ((point.amount - min) / span) * chartHeight;
    return { ...point, x, y };
  });

  const line = scaled.map((p) => `${p.x},${p.y}`).join(" ");
  const labels = scaled.map((p) => {
    const isLast = p.index === points.length - 1;
    return `<circle cx="${p.x}" cy="${p.y}" r="5" fill="${isLast ? '#2563eb' : '#0f172a'}"></circle>`;
  }).join("");

  const minLabel = formatCurrencyAmount(min, points[0].currency);
  const maxLabel = formatCurrencyAmount(max, points[0].currency);

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Price history chart">
      <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="#f8fafc" stroke="#e2e8f0"></rect>
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#cbd5e1"></line>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#cbd5e1"></line>
      <polyline fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${line}"></polyline>
      ${labels}
      <text x="${padding}" y="18" font-size="12" fill="#64748b">High: ${maxLabel}</text>
      <text x="${padding}" y="${height - 10}" font-size="12" fill="#64748b">Low: ${minLabel}</text>
    </svg>
  `;
}

function renderStats(target, snapshots) {
  const latestSnapshot = snapshots[snapshots.length - 1] || null;
  const firstSnapshot = snapshots[0] || null;
  const currentAmount = target.lastKnownPriceAmount ?? latestSnapshot?.price?.amount ?? null;
  const currentCurrency = target.lastKnownCurrency ?? latestSnapshot?.price?.currency ?? target.currency ?? latestSnapshot?.currency ?? "";
  const lastChanged = target.lastChangedAt || latestSnapshot?.capturedAt || target.updatedAt;

  statsEl.innerHTML = [
    { label: "Current price", value: formatCurrencyAmount(currentAmount, currentCurrency) },
    { label: "Tracked since", value: firstSnapshot ? formatDay(firstSnapshot.capturedAt) : "—" },
    { label: "Last reference", value: lastChanged ? formatDay(lastChanged) : "—" },
    { label: "Snapshots", value: String(snapshots.length) },
  ].map((stat) => `
    <div class="stat">
      <span class="label">${stat.label}</span>
      <strong>${stat.value}</strong>
    </div>
  `).join("");
}

function renderLinks(target, settings) {
  const repoLink = settings.githubRepo ? `https://github.com/${settings.githubRepo}` : "";
  const dashboardLink = `${getExtensionUrl("dashboard.html")}?product=${encodeURIComponent(target.productUrl)}`;
  const screenshotLink = target.lastKnownScreenshotUrl ? buildRawScreenshotUrl(target.lastKnownScreenshotUrl, settings) : null;

  linksEl.innerHTML = `
    <a href="${escapeHtml(target.productUrl)}" target="_blank" rel="noreferrer">Open product page</a>
    ${repoLink ? `<a href="${escapeHtml(repoLink)}" target="_blank" rel="noreferrer">Open repository</a>` : ""}
    <a href="${escapeHtml(dashboardLink)}" target="_blank" rel="noreferrer">Open dashboard in a new tab</a>
    ${screenshotLink ? `<a href="${escapeHtml(screenshotLink)}" target="_blank" rel="noreferrer">Open latest screenshot</a>` : ""}
  `;
}

function renderChart(snapshots) {
  const points = snapshots
    .map((snapshot, index) => ({
      index,
      amount: snapshot.price?.amount,
      currency: snapshot.price?.currency ?? snapshot.currency ?? "",
      capturedAt: snapshot.capturedAt,
    }))
    .filter((point) => Number.isFinite(point.amount));

  chartWrapEl.innerHTML = buildChartSvg(points);
}

function snapshotBadge(snapshot, isLatest) {
  const status = snapshot.status || "reference";
  const classes = ["badge", status];
  if (isLatest) classes.push("changed");
  return `<span class="${classes.join(" ")}">${escapeHtml(isLatest ? "Latest" : status)}</span>`;
}

function renderReferences(snapshots, settings) {
  if (!snapshots.length) {
    refsEl.innerHTML = `<div class="empty">No reference snapshots were found for this product yet.</div>`;
    return;
  }

  refsEl.innerHTML = snapshots
    .map((snapshot, index) => {
      const screenshotUrl = buildRawScreenshotUrl(snapshot.screenshotUrl, settings);
      const date = formatDate(snapshot.capturedAt);
      const price = formatMoney(snapshot);
      const title = snapshot.pageTitle || snapshot.productName || snapshot.productUrl;
      const badge = snapshotBadge(snapshot, index === snapshots.length - 1);
      const screenshotBlock = screenshotUrl
        ? `<a href="${screenshotUrl}" target="_blank" rel="noreferrer"><img class="thumb" src="${screenshotUrl}" alt="Screenshot for ${title}"></a>`
        : `<div class="empty">No screenshot was stored for this reference.</div>`;

      return `
        <article class="ref-card">
          <div class="ref-head">
            <div>
              <div class="snapshot-date">${escapeHtml(date)}</div>
              <div class="snapshot-meta">${escapeHtml(title || "Untitled product")}</div>
            </div>
            ${badge}
          </div>
          <div class="snapshot-price">${escapeHtml(price)}</div>
          <div class="snapshot-meta">
            Selector: ${escapeHtml(snapshot.selector || "—")}<br />
            Captured at: ${escapeHtml(snapshot.capturedAt)}<br />
            Status: ${escapeHtml(snapshot.status || "reference")}
          </div>
          ${screenshotBlock}
          ${screenshotUrl ? `<div class="link-row"><a href="${escapeHtml(screenshotUrl)}" target="_blank" rel="noreferrer">Open screenshot in GitHub / raw</a></div>` : ""}
        </article>
      `;
    })
    .join("");
}

async function main() {
  const productUrl = parseProductUrl();
  if (!productUrl) {
    setError("Missing product URL. Open this dashboard from a product item in the popup.");
    titleEl.textContent = "Dashboard unavailable";
    subtitleEl.textContent = "No product was selected.";
    return;
  }

  try {
    clearError();
    const settings = await getSettings();
    const detail = await getProductDetailByUrl(productUrl);
    const { target, snapshots } = detail;
    const displayName = target.productName || target.pageTitle || target.hostname || productUrl;

    titleEl.textContent = displayName;
    subtitleEl.textContent = `Tracked product dashboard for ${target.productUrl}`;
    document.title = `${displayName} · pricePatrol`;

    renderStats(target, snapshots);
    renderLinks(target, settings);
    renderChart(snapshots);
    renderReferences(snapshots, settings);

    if (!snapshots.length && latestSnapshot) {
      refsEl.innerHTML = `<div class="empty">No historical snapshots exist yet, but the product is tracked.</div>`;
    }
  } catch (error) {
    setError(error?.message || String(error));
    titleEl.textContent = "Dashboard unavailable";
    subtitleEl.textContent = productUrl;
  }
}

main();
