import { buildRawScreenshotUrl, getProductDetailByUrl, getSettings } from "./github.js";

const titleEl = document.getElementById("title");
const subtitleEl = document.getElementById("subtitle");
const errorEl = document.getElementById("error");
const statsEl = document.getElementById("stats");
const linksEl = document.getElementById("links");
const timelineWrapEl = document.getElementById("timeline-wrap");
const timelineLoadingEl = document.getElementById("timeline-loading");
const timelineChartHostEl = document.getElementById("timeline-chart-host");
const timelineListEl = document.getElementById("timeline-list");
const timelineTooltipEl = document.getElementById("timeline-tooltip");
const timelineLegendEl = document.getElementById("timeline-legend");

const modalBackdropEl = document.getElementById("screenshot-modal");
const modalDialogEl = modalBackdropEl.querySelector(".modal");
const modalCloseEl = document.getElementById("modal-close");
const modalTitleEl = document.getElementById("modal-title");
const modalDescEl = document.getElementById("modal-desc");
const modalPreviewEl = document.getElementById("modal-preview");
const modalPriceEl = document.getElementById("modal-price");
const modalMetaEl = document.getElementById("modal-meta");
const modalHistoryEl = document.getElementById("modal-history");
const modalNoticeEl = document.getElementById("modal-notice");
const modalPrevEl = document.getElementById("modal-prev");
const modalNextEl = document.getElementById("modal-next");
const modalOpenScreenshotEl = document.getElementById("modal-open-screenshot");

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

let currentProduct = null;
let currentSettings = null;
let records = [];
let currentModalIndex = -1;
let lastFocusBeforeModal = null;
let modalKeydownHandler = null;

function parseProductUrl() {
  const params = new URLSearchParams(location.search);
  return params.get("product");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  try {
    return DATE_TIME_FORMAT.format(new Date(value));
  } catch {
    return String(value ?? "");
  }
}

function formatPriceValue(amount, currency) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  return currency ? `${amount} ${currency}` : String(amount);
}

function formatDelta(deltaAmount, deltaPercent) {
  if (!Number.isFinite(deltaAmount) || deltaPercent === null || deltaPercent === undefined) return "—";
  const sign = deltaAmount > 0 ? "+" : deltaAmount < 0 ? "−" : "";
  const absAmount = Math.abs(deltaAmount);
  const absPercent = Math.abs(deltaPercent).toFixed(1);
  return `${sign}${absAmount.toFixed(2)} (${sign}${absPercent}%)`;
}

function getNumericAmount(snapshot) {
  const amount = snapshot?.price?.amount;
  return Number.isFinite(amount) ? amount : null;
}

function getSnapshotKind(record) {
  if (record.status === "error") return "error";
  if (record.index === 0 || record.status === "baseline") return "baseline";
  if (record.deltaAmount > 0) return "increase";
  if (record.deltaAmount < 0) return "decrease";
  return "unchanged";
}

function getSnapshotIcon(kind) {
  switch (kind) {
    case "baseline":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
          <path d="M12 7v10M7 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>`;
    case "increase":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
          <path d="M12 17V7M8.5 10.5 12 7l3.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>`;
    case "decrease":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
          <path d="M12 7v10M8.5 13.5 12 17l3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>`;
    case "error":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
          <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
        </svg>`;
    case "unchanged":
    default:
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
          <path d="M7.5 12h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>`;
  }
}

function getMarkerShapePath(kind, x, y, size) {
  const half = size / 2;
  switch (kind) {
    case "baseline":
      return `M ${x - half} ${y} H ${x + half} M ${x} ${y - half} V ${y + half}`;
    case "increase":
      return `M ${x} ${y - half} L ${x + half} ${y + half} H ${x - half} Z`;
    case "decrease":
      return `M ${x} ${y + half} L ${x + half} ${y - half} H ${x - half} Z`;
    case "error":
      return `M ${x - half} ${y - half} L ${x + half} ${y + half} M ${x + half} ${y - half} L ${x - half} ${y + half}`;
    case "unchanged":
    default:
      return `M ${x} ${y - half} L ${x + half} ${y} L ${x} ${y + half} L ${x - half} ${y} Z`;
  }
}

function normalizeRecords(snapshots) {
  const sorted = snapshots.slice().sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  const result = [];
  let previousNumeric = null;

  for (const [index, snapshot] of sorted.entries()) {
    const amount = getNumericAmount(snapshot);
    const deltaAmount = amount !== null && previousNumeric !== null ? amount - previousNumeric.amount : null;
    const deltaPercent = deltaAmount !== null && previousNumeric && previousNumeric.amount !== 0
      ? (deltaAmount / previousNumeric.amount) * 100
      : null;
    const kind = snapshot.status === "error"
      ? "error"
      : index === 0 || snapshot.status === "baseline"
        ? "baseline"
        : amount !== null && previousNumeric && deltaAmount < 0
          ? "decrease"
          : amount !== null && previousNumeric && deltaAmount > 0
            ? "increase"
            : "unchanged";

    const hasScreenshot = Boolean(snapshot.screenshotUrl);
    const screenshotUrl = hasScreenshot ? buildRawScreenshotUrl(snapshot.screenshotUrl, currentSettings) : null;
    const inactiveReason = snapshot.status === "error"
      ? snapshot.errorMessage || "The capture failed before a screenshot was generated."
      : !hasScreenshot
        ? "No screenshot is available for this reference."
        : null;

    const record = {
      ...snapshot,
      index,
      kind,
      amount,
      deltaAmount,
      deltaPercent,
      hasScreenshot,
      screenshotUrl,
      inactiveReason,
      prevRecordIndex: previousNumeric ? previousNumeric.index : null,
    };

    result.push(record);

    if (amount !== null) {
      previousNumeric = { amount, index };
    }
  }

  return result;
}

function setError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function clearError() {
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

function renderStats(target, rows) {
  const latest = rows[rows.length - 1] || null;
  const first = rows[0] || null;
  const currentAmount = target.lastKnownPriceAmount ?? latest?.amount ?? null;
  const currentCurrency = target.lastKnownCurrency ?? latest?.price?.currency ?? target.currency ?? latest?.currency ?? "";
  const lastReference = latest?.capturedAt || target.lastChangedAt || target.updatedAt;

  statsEl.innerHTML = [
    { label: "Current price", value: formatPriceValue(currentAmount, currentCurrency) },
    { label: "Tracked since", value: first ? formatDateTime(first.capturedAt) : "—" },
    { label: "Last reference", value: lastReference ? formatDateTime(lastReference) : "—" },
    { label: "Snapshots", value: String(rows.length) },
  ].map((stat) => `
    <div class="stat">
      <span class="label">${escapeHtml(stat.label)}</span>
      <strong>${escapeHtml(stat.value)}</strong>
    </div>
  `).join("");
}

function renderLinks(target, settings) {
  const repoLink = settings.githubRepo ? `https://github.com/${settings.githubRepo}` : "";
  const screenshotLink = target.lastKnownScreenshotUrl ? buildRawScreenshotUrl(target.lastKnownScreenshotUrl, settings) : null;

  linksEl.innerHTML = `
    <a href="${escapeHtml(target.productUrl)}" target="_blank" rel="noreferrer">Open product page</a>
    ${repoLink ? `<a href="${escapeHtml(repoLink)}" target="_blank" rel="noreferrer">Open repository</a>` : ""}
    ${screenshotLink ? `<a href="${escapeHtml(screenshotLink)}" target="_blank" rel="noreferrer">Open latest screenshot</a>` : ""}
    <a href="popup.html" rel="noreferrer">Back to popup</a>
  `;
}

function drawChart(rows) {
  const points = rows.filter((record) => Number.isFinite(record.amount));
  if (!points.length) {
    timelineChartHostEl.innerHTML = `<div class="empty">No numeric price history is available yet.</div>`;
    timelineLegendEl.classList.add("hidden");
    return;
  }

  const width = 1120;
  const height = 320;
  const paddingX = 44;
  const paddingY = 34;
  const innerW = width - paddingX * 2;
  const innerH = height - paddingY * 2;
  const min = Math.min(...points.map((point) => point.amount));
  const max = Math.max(...points.map((point) => point.amount));
  const span = Math.max(max - min, 1);
  const stepX = points.length === 1 ? 0 : innerW / (points.length - 1);

  const scaled = points.map((point, index) => {
    const x = paddingX + index * stepX;
    const y = paddingY + innerH - ((point.amount - min) / span) * innerH;
    return { ...point, x, y };
  });

  const stepPath = [];
  scaled.forEach((point, index) => {
    if (index === 0) {
      stepPath.push(`M ${point.x} ${point.y}`);
      return;
    }
    const prev = scaled[index - 1];
    stepPath.push(`L ${point.x} ${prev.y}`);
    stepPath.push(`L ${point.x} ${point.y}`);
  });

  const pointsMarkup = scaled.map((point) => {
    const kind = point.kind;
    const label = `${formatDateTime(point.capturedAt)} · ${formatPriceValue(point.amount, point.price?.currency ?? point.currency ?? "")}`;
    const disabled = !point.hasScreenshot ? "aria-disabled=\"true\"" : "";
    const ariaLabel = point.hasScreenshot
      ? `${label}. ${point.kind}. Click to open screenshot.`
      : `${label}. ${point.kind}. ${point.inactiveReason}`;

    return `
      <g class="timeline-marker kind-${kind}" tabindex="0" role="button" ${disabled} data-index="${point.index}" data-kind="${kind}" data-x="${point.x}" data-y="${point.y}" aria-label="${escapeHtml(ariaLabel)}">
        <circle cx="${point.x}" cy="${point.y}" r="10"></circle>
        <path d="${getMarkerShapePath(kind, point.x, point.y, 7)}"></path>
      </g>
    `;
  }).join("");

  const ticks = [0, 25, 50, 75, 100].map((pct) => {
    const y = paddingY + innerH - (pct / 100) * innerH;
    return `<line x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}" class="grid-line"></line>`;
  }).join("");

  const labels = [
    `<text x="${paddingX}" y="18" class="axis-label">High: ${formatPriceValue(max, points[0].price?.currency ?? points[0].currency ?? "")}</text>`,
    `<text x="${paddingX}" y="${height - 10}" class="axis-label">Low: ${formatPriceValue(min, points[0].price?.currency ?? points[0].currency ?? "")}</text>`,
  ].join("");

  timelineChartHostEl.innerHTML = `
    <svg class="timeline-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Price timeline chart" role="img">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.16"></feDropShadow>
        </filter>
      </defs>
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="18" class="chart-frame"></rect>
      ${ticks}
      <line x1="${paddingX}" y1="${paddingY}" x2="${paddingX}" y2="${height - paddingY}" class="axis-line"></line>
      <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" class="axis-line"></line>
      <path d="${stepPath.join(" ")}" class="step-line"></path>
      ${pointsMarkup}
      ${labels}
    </svg>
  `;

  timelineLegendEl.innerHTML = `
    <span class="legend-chip"><span class="legend-icon" style="color: var(--purple);"></span>Baseline</span>
    <span class="legend-chip"><span class="legend-icon" style="color: var(--danger);"></span>Price increased</span>
    <span class="legend-chip"><span class="legend-icon" style="color: var(--success);"></span>Price decreased</span>
    <span class="legend-chip"><span class="legend-icon" style="color: var(--primary-text);"></span>Unchanged</span>
    <span class="legend-chip"><span class="legend-icon" style="color: var(--danger);"></span>Error / no screenshot</span>
  `;
  timelineLegendEl.classList.remove("hidden");

  const svg = timelineChartHostEl.querySelector("svg");
  const rect = svg.getBoundingClientRect();
  const chartGroup = svg;

  const markers = svg.querySelectorAll("g[data-index]");
  markers.forEach((marker) => {
    const index = Number(marker.dataset.index);
    const record = rows[index];
    const onEnter = (event) => {
      showTooltip(record, marker, svg, event);
    };
    const onMove = (event) => {
      moveTooltip(record, marker, svg, event);
    };
    const onLeave = () => hideTooltip();
    const onActivate = () => openRecord(index, marker);

    marker.addEventListener("pointerenter", onEnter);
    marker.addEventListener("pointermove", onMove);
    marker.addEventListener("pointerleave", onLeave);
    marker.addEventListener("focus", onEnter);
    marker.addEventListener("blur", onLeave);
    marker.addEventListener("click", onActivate);
    marker.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
      }
    });
  });

  function recordByEventTarget(target) {
    const marker = target.closest ? target.closest("g[data-index]") : null;
    if (!marker) return null;
    const index = Number(marker.dataset.index);
    return rows[index] || null;
  }

  chartGroup.addEventListener("pointerleave", (event) => {
    if (!event.relatedTarget || !timelineChartHostEl.contains(event.relatedTarget)) {
      hideTooltip();
    }
  });

  if (rect.width === 0) {
    timelineChartHostEl.innerHTML = `<div class="empty">Chart is unavailable right now.</div>`;
  }
}

function positionTooltip(marker, svg, tooltip) {
  const markerX = Number(marker.dataset.x);
  const markerY = Number(marker.dataset.y);
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const scaleX = rect.width / viewBox.width;
  const scaleY = rect.height / viewBox.height;
  const x = (markerX * scaleX) + rect.left - timelineWrapEl.getBoundingClientRect().left;
  const y = (markerY * scaleY) + rect.top - timelineWrapEl.getBoundingClientRect().top;

  tooltip.style.left = `${Math.min(Math.max(x + 16, 12), rect.width - 250)}px`;
  tooltip.style.top = `${Math.min(Math.max(y - 8, 12), rect.height - 100)}px`;
}

function showTooltip(record, marker, svg, event) {
  if (!record) return;

  const statusLabel = record.kind === "baseline"
    ? "Baseline"
    : record.kind === "increase"
      ? "Price increased"
      : record.kind === "decrease"
        ? "Price decreased"
        : record.kind === "error"
          ? "Error"
          : "Unchanged";

  timelineTooltipEl.innerHTML = `
    <div class="tooltip-title">${escapeHtml(formatDateTime(record.capturedAt))}</div>
    <div class="tooltip-price">${escapeHtml(formatPriceValue(record.amount, record.price?.currency ?? record.currency ?? ""))}</div>
    <div class="tooltip-meta">
      ${record.deltaAmount === null ? "First reference" : `Change: ${escapeHtml(formatDelta(record.deltaAmount, record.deltaPercent))}`}<br />
      Status: ${escapeHtml(record.status || "reference")}
    </div>
    <div class="tooltip-status">${escapeHtml(statusLabel)}</div>
  `;
  timelineTooltipEl.classList.add("show");
  timelineTooltipEl.setAttribute("aria-hidden", "false");
  positionTooltip(marker, svg, timelineTooltipEl);
}

function moveTooltip(record, marker, svg, event) {
  if (!timelineTooltipEl.classList.contains("show")) return;
  positionTooltip(marker, svg, timelineTooltipEl);
}

function hideTooltip() {
  timelineTooltipEl.classList.remove("show");
  timelineTooltipEl.setAttribute("aria-hidden", "true");
}

function renderTimelineList(rows) {
  if (!rows.length) {
    timelineListEl.innerHTML = `<div class="empty">No reference snapshots were found for this product yet.</div>`;
    return;
  }

  timelineListEl.innerHTML = rows.map((record, index) => {
    const kind = record.kind;
    const statusClass = kind === "increase" ? "changed" : kind === "decrease" ? "good" : kind === "error" ? "error" : kind === "baseline" ? "baseline" : "unchanged";
    const deltaText = record.deltaAmount === null ? "First reference" : formatDelta(record.deltaAmount, record.deltaPercent);
    const subtitle = record.inactiveReason || "Click to open the screenshot lightbox.";
    const disabled = record.hasScreenshot ? "" : "disabled";
    return `
      <button class="timeline-row kind-${kind}" type="button" data-index="${index}" ${disabled} aria-label="${escapeHtml(formatDateTime(record.capturedAt))}, ${escapeHtml(formatPriceValue(record.amount, record.price?.currency ?? record.currency ?? ""))}. ${escapeHtml(subtitle)}">
        <span class="icon-spot" aria-hidden="true">${getSnapshotIcon(kind)}</span>
        <span class="row-main">
          <span class="row-date">${escapeHtml(formatDateTime(record.capturedAt))}</span>
          <span class="row-subtitle">${escapeHtml(subtitle)}</span>
        </span>
        <span class="row-meta">
          <span class="row-price">${escapeHtml(formatPriceValue(record.amount, record.price?.currency ?? record.currency ?? ""))}</span>
          <span class="chip ${statusClass}">${escapeHtml(deltaText)}</span>
        </span>
      </button>
    `;
  }).join("");

  timelineListEl.querySelectorAll("button.timeline-row").forEach((button) => {
    button.addEventListener("click", () => openRecord(Number(button.dataset.index), button));
  });
}

function renderModal(record, index) {
  const statusLabel = record.kind === "baseline"
    ? "Baseline"
    : record.kind === "increase"
      ? "Price increased"
      : record.kind === "decrease"
        ? "Price decreased"
        : record.kind === "error"
          ? "Error"
          : "Unchanged";

  modalTitleEl.textContent = `${formatDateTime(record.capturedAt)}`;
  modalDescEl.textContent = `${statusLabel} · ${currentProduct?.productName || currentProduct?.pageTitle || currentProduct?.hostname || "Product"}`;
  modalPriceEl.textContent = formatPriceValue(record.amount, record.price?.currency ?? record.currency ?? currentProduct?.currency ?? "");
  modalMetaEl.innerHTML = [
    `Captured at: ${escapeHtml(formatDateTime(record.capturedAt))}`,
    `Status: ${escapeHtml(record.status || "reference")}`,
    record.deltaAmount === null ? "First reference" : `Change: ${escapeHtml(formatDelta(record.deltaAmount, record.deltaPercent))}`,
    `Selector: ${escapeHtml(record.selector || "—")}`,
  ].join("<br />");
  modalHistoryEl.innerHTML = [
    `Timeline position: ${index + 1} of ${records.length}`,
    record.prevRecordIndex === null ? "No previous record." : `Previous record: ${formatDateTime(records[record.prevRecordIndex].capturedAt)}`,
  ].join("<br />");

  const hasScreenshot = Boolean(record.screenshotUrl);
  modalOpenScreenshotEl.href = hasScreenshot ? record.screenshotUrl : "#";
  modalOpenScreenshotEl.classList.toggle("hidden", !hasScreenshot);
  modalOpenScreenshotEl.tabIndex = hasScreenshot ? 0 : -1;

  modalNoticeEl.classList.toggle("hidden", hasScreenshot);
  modalNoticeEl.textContent = hasScreenshot
    ? ""
    : (record.inactiveReason || "No screenshot is available for this reference.");

  modalPreviewEl.innerHTML = "";
  if (hasScreenshot) {
    const img = document.createElement("img");
    img.alt = `Screenshot for ${currentProduct?.productName || currentProduct?.pageTitle || currentProduct?.hostname || "product"} on ${formatDateTime(record.capturedAt)}`;
    img.loading = "lazy";
    img.src = record.screenshotUrl;
    modalPreviewEl.append(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "modal-placeholder";
    placeholder.innerHTML = `
      <div style="font-size:42px;line-height:1;margin-bottom:10px;">🖼️</div>
      <div>No screenshot available</div>
      <div style="margin-top:8px;">${escapeHtml(record.inactiveReason || "The capture failed or the screenshot is missing.")}</div>
    `;
    modalPreviewEl.append(placeholder);
  }

  modalPrevEl.disabled = index <= 0;
  modalNextEl.disabled = index >= records.length - 1;

  modalOpenScreenshotEl.setAttribute("aria-disabled", String(!hasScreenshot));
  modalOpenScreenshotEl.setAttribute("target", hasScreenshot ? "_blank" : "_self");
}

function focusableElements() {
  return modalDialogEl.querySelectorAll(
    'button:not([disabled]), a[href]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])'
  );
}

function trapFocus(event) {
  if (event.key !== "Tab") return;
  const items = Array.from(focusableElements());
  if (!items.length) return;

  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function closeModal() {
  modalBackdropEl.classList.remove("open");
  modalBackdropEl.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", modalKeydownHandler);
  modalKeydownHandler = null;
  hideTooltip();

  const returnFocus = lastFocusBeforeModal;
  lastFocusBeforeModal = null;
  currentModalIndex = -1;
  if (returnFocus && typeof returnFocus.focus === "function") {
    returnFocus.focus();
  }
}

function openRecord(index, triggerEl) {
  const record = records[index];
  if (!record) return;

  lastFocusBeforeModal = triggerEl || document.activeElement;
  currentModalIndex = index;
  renderModal(record, index);
  modalBackdropEl.classList.add("open");
  modalBackdropEl.setAttribute("aria-hidden", "false");

  modalKeydownHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goToRecord(index - 1, triggerEl);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goToRecord(index + 1, triggerEl);
      return;
    }
    trapFocus(event);
  };

  document.addEventListener("keydown", modalKeydownHandler);
  requestAnimationFrame(() => {
    const focusTarget = modalCloseEl;
    focusTarget.focus();
  });
}

function goToRecord(nextIndex, triggerEl) {
  const bounded = Math.max(0, Math.min(records.length - 1, nextIndex));
  currentModalIndex = bounded;
  renderModal(records[bounded], bounded);
  const activeButton = timelineListEl.querySelector(`button[data-index="${bounded}"]`) || triggerEl;
  if (activeButton) activeButton.focus();
}

async function main() {
  const productUrl = parseProductUrl();
  if (!productUrl) {
    setError("Missing product URL. Open this dashboard from a product item in the popup.");
    titleEl.textContent = "Dashboard unavailable";
    subtitleEl.textContent = "No product was selected.";
    timelineLoadingEl.classList.add("hidden");
    return;
  }

  try {
    clearError();
    timelineLoadingEl.classList.remove("hidden");
    const settings = await getSettings();
    currentSettings = settings;
    const detail = await getProductDetailByUrl(productUrl);
    currentProduct = detail.target;
    records = normalizeRecords(detail.snapshots || []);

    const displayName = currentProduct.productName || currentProduct.pageTitle || currentProduct.hostname || productUrl;
    titleEl.textContent = displayName;
    subtitleEl.textContent = `Tracked product dashboard for ${currentProduct.productUrl}`;
    document.title = `${displayName} · pricePatrol`;

    renderStats(currentProduct, records);
    renderLinks(currentProduct, settings);

    if (!records.length) {
      timelineChartHostEl.innerHTML = `<div class="empty">No reference snapshots are available for this product yet.</div>`;
      timelineListEl.innerHTML = `<div class="empty">No reference snapshots are available for this product yet.</div>`;
      timelineLegendEl.classList.add("hidden");
      return;
    }

    drawChart(records);
    renderTimelineList(records);
  } catch (error) {
    setError(error?.message || String(error));
    titleEl.textContent = "Dashboard unavailable";
    subtitleEl.textContent = productUrl;
    timelineChartHostEl.innerHTML = `<div class="empty">Unable to load the product history.</div>`;
    timelineListEl.innerHTML = `<div class="empty">Unable to load the product history.</div>`;
  } finally {
    timelineLoadingEl.classList.add("hidden");
  }
}

modalCloseEl.addEventListener("click", closeModal);
modalBackdropEl.addEventListener("click", (event) => {
  if (event.target === modalBackdropEl) {
    closeModal();
  }
});
modalPrevEl.addEventListener("click", () => {
  if (currentModalIndex > 0) goToRecord(currentModalIndex - 1);
});
modalNextEl.addEventListener("click", () => {
  if (currentModalIndex < records.length - 1) goToRecord(currentModalIndex + 1);
});

main();
