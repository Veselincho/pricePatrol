import { getExtensionUrl, openOptionsPage } from "./api.js";
import { deleteWatchTargetById, listProducts, getSettings } from "./github.js";

const api = globalThis.browser ?? globalThis.chrome;
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const repoEl = document.getElementById("repo");
const settingsBtn = document.getElementById("settings");
const refreshBtn = document.getElementById("refresh");

let renderedItems = [];

async function activeTab() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function formatMoney(item) {
  const currency = item.lastKnownCurrency || item.currency || "";
  const amount = item.lastKnownPriceAmount;
  if (amount === null || amount === undefined || amount === "") {
    return item.lastKnownPriceText || item.priceText || "";
  }
  return currency ? `${amount} ${currency}` : String(amount);
}

function renderItem(item) {
  const li = document.createElement("li");

  const link = document.createElement("a");
  link.className = "item-link";
  const dashboardUrl = new URL(getExtensionUrl("dashboard.html"));
  dashboardUrl.searchParams.set("product", item.productUrl || "");
  link.href = dashboardUrl.toString();
  link.target = "_blank";
  link.rel = "noreferrer";
  link.title = "Open product dashboard";

  const title = document.createElement("strong");
  title.className = "item-title";
  title.textContent = item.productName || item.pageTitle || item.productUrl || "Untitled";

  const meta = document.createElement("small");
  meta.className = "item-meta";
  const date = new Date(item.lastChangedAt || item.lastCheckedAt || item.updatedAt || Date.now()).toLocaleString("bg-BG");
  const value = formatMoney(item);
  const source = item.hostname || item.productUrl || "";
  const baseline = item.baselineRequested ? " · baseline queued" : "";
  meta.textContent = `${date}${value ? ` · ${value}` : ""}${source ? ` · ${source}` : ""}${baseline}`;

  link.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "actions";

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete-btn";
  del.dataset.deleteId = item.id;
  del.textContent = "Delete";

  actions.append(del);
  li.append(link, actions);
  return li;
}

async function loadSettingsLine() {
  try {
    const settings = await getSettings();
    repoEl.textContent = settings.githubRepo ? `Connected to ${settings.githubRepo}` : "Repository not configured";
  } catch {
    repoEl.textContent = "Repository not configured";
  }
}

function renderList(items) {
  listEl.textContent = "";

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No products yet. Open settings first, then save a price from a page.";
    listEl.append(empty);
    return;
  }

  for (const it of items.slice(0, 50)) {
    listEl.append(renderItem(it));
  }
}

async function loadList() {
  try {
    renderedItems = await listProducts();
    renderList(renderedItems);
  } catch (error) {
    renderedItems = [];
    listEl.textContent = "";
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = error?.message || "Could not load GitHub data.";
    listEl.append(empty);
  }
}

saveBtn.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    window.close();
  } catch (error) {
    statusEl.textContent = "Cannot start on this page: " + error.message;
  }
});

settingsBtn.addEventListener("click", () => {
  openOptionsPage();
});

refreshBtn.addEventListener("click", async () => {
  statusEl.textContent = "";
  await loadSettingsLine();
  await loadList();
});

listEl.addEventListener("click", async (e) => {
  const delBtn = e.target.closest("button[data-delete-id]");
  if (!delBtn) return;

  e.preventDefault();
  e.stopPropagation();

  const id = delBtn.dataset.deleteId;
  if (!confirm("Delete this product?")) return;

  delBtn.disabled = true;
  try {
    const nextState = await deleteWatchTargetById(id);
    renderedItems = Array.isArray(nextState?.watchTargets) ? nextState.watchTargets : renderedItems.filter((item) => item.id !== id);
    renderList(renderedItems);
    statusEl.textContent = "Product deleted.";
  } catch (error) {
    statusEl.textContent = "Delete failed: " + (error?.message || String(error));
  } finally {
    delBtn.disabled = false;
  }
});

loadSettingsLine();
loadList();
