const api = globalThis.browser ?? globalThis.chrome;
const API = "http://127.0.0.1:3001";

const btn = document.getElementById("save");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
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
  link.href = `${API}/dashboard/${encodeURIComponent(item.id)}`;
  link.target = "_blank";
  link.rel = "noreferrer";

  const title = document.createElement("strong");
  title.className = "item-title";
  title.textContent = item.productName || item.pageTitle || item.productUrl || "Untitled";

  const meta = document.createElement("small");
  meta.className = "item-meta";
  const date = new Date(item.lastChangedAt || item.lastCheckedAt || item.updatedAt || Date.now()).toLocaleString("bg-BG");
  const value = formatMoney(item);
  const source = item.hostname || item.productUrl || "";
  meta.textContent = `${date}${value ? ` · ${value}` : ""}${source ? ` · ${source}` : ""}`;

  link.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "actions";

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete-btn";
  del.dataset.deleteId = item.id;
  // include productUrl so the UI can also remove any orphan snapshots by URL
  if (item.productUrl) del.dataset.productUrl = item.productUrl;
  del.textContent = "Delete";

  actions.append(del);
  li.append(link, actions);
  return li;
}

async function loadList() {
  listEl.textContent = "";
  try {
    const res = await fetch(`${API}/api/watch-targets`);
    const items = await res.json();

    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No products yet.";
      listEl.append(empty);
      return;
    }

    for (const it of items.slice(0, 50)) {
      listEl.append(renderItem(it));
    }
  } catch {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Backend is unavailable (is it running on :3001?)";
    listEl.append(empty);
  }
}

btn.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    window.close(); // free the page for element selection
  } catch (e) {
    statusEl.textContent = "Cannot start on this page: " + e.message;
  }
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
    const res = await fetch(`${API}/api/watch-targets/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());

    // Also attempt to remove any orphan snapshots that reference the same product URL
    const productUrl = delBtn.dataset.productUrl;
    if (productUrl) {
      try {
        const qs = new URLSearchParams({ url: productUrl }).toString();
        const snapsRes = await fetch(`${API}/api/prices?${qs}`);
        if (snapsRes.ok) {
          const snaps = await snapsRes.json();
          for (const snap of snaps) {
            try {
              await fetch(`${API}/api/prices/${encodeURIComponent(snap.id)}`, { method: "DELETE" });
            } catch (e) {
              // ignore individual snapshot deletion errors
              console.error('Failed deleting snapshot', snap.id, e);
            }
          }
        }
      } catch (e) {
        console.error('Failed to clean up snapshots for product', productUrl, e);
      }
    }

    await loadList();
  } catch (err) {
    statusEl.textContent = "Delete failed: " + (err.message || String(err));
  } finally {
    delBtn.disabled = false;
  }
});

loadList();
