(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  // Re-injection → just restart the picker
  if (window.__pricePatrol) { window.__pricePatrol.start(); return; }

  const CURRENCIES = ["BGN", "EUR", "USD"];

  let active = false;
  let hovered = null;
  let selectedElement = null;
  let currentDraft = null;
  let editor = null;

  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    pointerEvents: "none",
    zIndex: 2147483646,
    border: "2px solid #e11d48",
    background: "rgba(225,29,72,.12)",
    borderRadius: "3px",
    display: "none",
    boxSizing: "border-box",
  });

  const banner = document.createElement("div");
  banner.textContent = "pricePatrol: click the price · Esc to cancel";
  Object.assign(banner.style, {
    position: "fixed",
    top: "10px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 2147483647,
    background: "#111",
    color: "#fff",
    padding: "8px 14px",
    font: "14px system-ui, sans-serif",
    borderRadius: "6px",
    pointerEvents: "none",
  });

  function placeBox(el) {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: "block",
      left: r.left + "px",
      top: r.top + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
  }

  function showBox(el) {
    selectedElement = el;
    placeBox(el);
  }

  function hideBox() {
    box.style.display = "none";
  }

  function toast(text, ok = true) {
    const t = document.createElement("div");
    t.textContent = text;
    Object.assign(t.style, {
      position: "fixed",
      top: "10px",
      right: "10px",
      zIndex: 2147483647,
      background: ok ? "#16a34a" : "#dc2626",
      color: "#fff",
      padding: "10px 14px",
      font: "14px system-ui, sans-serif",
      borderRadius: "6px",
      maxWidth: "320px",
      boxShadow: "0 8px 24px rgba(0,0,0,.18)",
    });
    document.documentElement.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ---------- CSS selector ----------
  function cssPath(el) {
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
      return "#" + CSS.escape(el.id);
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id && document.querySelectorAll("#" + CSS.escape(node.id)).length === 1) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      const sameTag = [...node.parentElement.children].filter((c) => c.tagName === node.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  // ---------- Price parsing ----------
  // Supports "1 299,99 BGN", "1,299.99 €", "$49.90", "49,90"
  function parsePrice(text) {
    const m = text.match(/\d[\d\s\u00a0.,]*\d|\d/);
    if (!m) return null;
    let num = m[0].replace(/[\s\u00a0]/g, "");
    const lastDot = num.lastIndexOf(".");
    const lastComma = num.lastIndexOf(",");
    const sepIdx = Math.max(lastDot, lastComma);

    if (lastDot !== -1 && lastComma !== -1) {
      // both are present → the last one is the decimal separator
      const dec = num[sepIdx];
      const thousands = dec === "." ? "," : ".";
      num = num.split(thousands).join("").replace(dec, ".");
    } else if (sepIdx !== -1) {
      const digitsAfter = num.length - sepIdx - 1;
      const sepCount = (num.match(/[.,]/g) || []).length;
      num = (digitsAfter <= 2 && sepCount === 1)
        ? num.replace(",", ".")          // decimal separator
        : num.replace(/[.,]/g, "");      // thousands separator
    }
    const amount = parseFloat(num);
    if (Number.isNaN(amount)) return null;

    const cur = text.match(/(?:\u043b\u0432\.?|BGN|€|EUR|\$|USD|£|GBP|RON|lei)/i);
    return { amount, currency: cur ? cur[0] : null };
  }

  function guessCurrency(text) {
    if (/€|EUR/i.test(text)) return "EUR";
    if (/\$|USD/i.test(text)) return "USD";
    return "BGN";
  }

  function normalizeInputValue(text) {
    const parsed = parsePrice(text);
    if (parsed) {
      return String(parsed.amount);
    }
    return text.trim();
  }

  // ---------- Events ----------
  function onMove(e) {
    hovered = e.target;
    placeBox(hovered);
  }

  function stopSelectionMode({ keepBox = true } = {}) {
    active = false;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    banner.remove();
    document.documentElement.style.cursor = "";
    if (!keepBox) hideBox();
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    stopSelectionMode({ keepBox: true });
    openEditor(hovered);
  }

  function onKey(e) {
    if (e.key === "Escape") stopSelectionMode({ keepBox: false });
  }

  function closeEditor({ keepHighlight = false } = {}) {
    if (editor) editor.remove();
    editor = null;
    if (!keepHighlight) hideBox();
  }

  function openEditor(el, draftError = "") {
    selectedElement = el;

    const rawText = (el?.innerText || el?.textContent || "").trim().replace(/\s+/g, " ");
    const parsed = rawText ? parsePrice(rawText) : null;
    const initialValue = rawText ? normalizeInputValue(rawText) : "";
    const initialCurrency = rawText ? (parsed?.currency ? guessCurrency(parsed.currency) : guessCurrency(rawText)) : "BGN";

    currentDraft = {
      element: el,
      selector: cssPath(el),
      selectedText: rawText,
      initialValue,
      initialCurrency,
      productName: "",
      error: draftError,
    };

    closeEditor({ keepHighlight: false });
    showBox(el);

    editor = document.createElement("div");
    Object.assign(editor.style, {
      position: "fixed",
      inset: "0",
      zIndex: 2147483647,
      background: "rgba(17,24,39,.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
      boxSizing: "border-box",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      width: "min(420px, 100%)",
      background: "#fff",
      borderRadius: "12px",
      padding: "16px",
      boxShadow: "0 20px 60px rgba(0,0,0,.24)",
      font: "14px system-ui, sans-serif",
      color: "#111827",
    });

    const title = document.createElement("h2");
    title.textContent = rawText ? "Confirm the record" : "Enter the value manually";
    Object.assign(title.style, { margin: "0 0 8px", fontSize: "18px" });

    const note = document.createElement("p");
    note.textContent = rawText
      ? "Edit the value if needed, and add a product name."
      : "The element has no text. Enter a value, currency, and product name.";
    Object.assign(note.style, { margin: "0 0 12px", color: "#4b5563", lineHeight: "1.4" });

    const error = document.createElement("div");
    error.id = "pricepatrol-error";
    Object.assign(error.style, {
      display: draftError ? "block" : "none",
      marginBottom: "12px",
      color: "#b91c1c",
      background: "#fef2f2",
      border: "1px solid #fecaca",
      borderRadius: "8px",
      padding: "8px 10px",
    });
    error.textContent = draftError;

    const preview = document.createElement("div");
    Object.assign(preview.style, {
      marginBottom: "12px",
      padding: "10px",
      background: "#f9fafb",
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      color: "#374151",
      lineHeight: "1.35",
    });
    preview.innerHTML = rawText
      ? `<strong style="display:block;margin-bottom:4px;">Selected value</strong>`
      : `<strong style="display:block;margin-bottom:4px;">Manual entry</strong>`;
    const previewText = document.createElement("div");
    previewText.textContent = rawText || "No text on the element";
    preview.append(previewText);

    const fieldWrap = (labelText) => {
      const wrap = document.createElement("label");
      wrap.style.display = "block";
      wrap.style.marginBottom = "10px";

      const label = document.createElement("div");
      label.textContent = labelText;
      Object.assign(label.style, { fontSize: "12px", fontWeight: "600", marginBottom: "6px", color: "#374151" });
      wrap.append(label);
      return wrap;
    };

    const valueWrap = fieldWrap("Value");
    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.value = currentDraft.initialValue;
    Object.assign(valueInput.style, {
      width: "100%",
      boxSizing: "border-box",
      padding: "10px 12px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "14px",
    });
    valueWrap.append(valueInput);

    const currencyWrap = fieldWrap("Currency");
    const currencySelect = document.createElement("select");
    for (const currency of CURRENCIES) {
      const option = document.createElement("option");
      option.value = currency;
      option.textContent = currency;
      currencySelect.append(option);
    }
    currencySelect.value = currentDraft.initialCurrency;
    Object.assign(currencySelect.style, {
      width: "100%",
      boxSizing: "border-box",
      padding: "10px 12px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "14px",
      background: "#fff",
    });
    currencyWrap.append(currencySelect);

    const nameWrap = fieldWrap("Product name");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "e.g. Samsung Galaxy S24";
    Object.assign(nameInput.style, {
      width: "100%",
      boxSizing: "border-box",
      padding: "10px 12px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "14px",
    });
    nameWrap.append(nameInput);

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "8px",
      justifyContent: "flex-end",
      marginTop: "14px",
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    Object.assign(cancelBtn.style, {
      padding: "10px 14px",
      borderRadius: "8px",
      border: "1px solid #d1d5db",
      background: "#fff",
      color: "#374151",
    });

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    Object.assign(saveBtn.style, {
      padding: "10px 14px",
      borderRadius: "8px",
      border: "0",
      background: "#2563eb",
      color: "#fff",
      fontWeight: "600",
    });

    async function submit() {
      const value = valueInput.value.trim();
      const productName = nameInput.value.trim();
      const currency = currencySelect.value;

      if (!value) {
        error.textContent = "Enter a value.";
        error.style.display = "block";
        valueInput.focus();
        return;
      }

      const parsed = parsePrice(value);
      const payload = {
        productUrl: location.href,
        pageTitle: document.title,
        selector: currentDraft.selector,
        productName,
        priceText: value,
        selectedText: currentDraft.selectedText,
        currency,
        price: {
          amount: parsed ? parsed.amount : null,
          currency,
        },
        capturedAt: new Date().toISOString(),
        viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      };

      closeEditor({ keepHighlight: false });
      hideBox();

      // Give the DOM a moment to return to normal before the screenshot.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 80));

      let res;
      try {
        res = await api.runtime.sendMessage({ type: "PRICE_PICKED", payload });
      } catch (e) {
        res = { ok: false, error: e.message };
      }

      if (res?.ok) {
        toast(`Saved: ${value}`);
      } else {
        const errorMessage = res?.error || "unknown";
        toast("Error: " + errorMessage, false);
        openEditor(currentDraft.element, errorMessage);
        const reopenedValue = document.querySelector("#pricepatrol-editor-value");
        if (reopenedValue) reopenedValue.value = value;
        const reopenedName = document.querySelector("#pricepatrol-editor-name");
        if (reopenedName) reopenedName.value = productName;
        const reopenedCurrency = document.querySelector("#pricepatrol-editor-currency");
        if (reopenedCurrency) reopenedCurrency.value = currency;
      }
    }

    valueInput.id = "pricepatrol-editor-value";
    currencySelect.id = "pricepatrol-editor-currency";
    nameInput.id = "pricepatrol-editor-name";

    saveBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => {
      closeEditor({ keepHighlight: false });
      hideBox();
    });

    valueInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    actions.append(cancelBtn, saveBtn);
    panel.append(title, note, error, preview, valueWrap, currencyWrap, nameWrap, actions);
    editor.append(panel);
    document.documentElement.append(editor);
    valueInput.focus();
    valueInput.select();
  }

  function start() {
    if (active) return;
    active = true;
    hovered = null;
    document.documentElement.append(box, banner);
    document.documentElement.style.cursor = "crosshair";
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  window.__pricePatrol = { start };
  start();
})();
