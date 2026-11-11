// Inline editing on the record page. Each change is saved, re-checked on the server,
// and the server returns freshly rendered fragments that replace the affected parts.
(function () {
  const root = document.querySelector("[data-cert-id]");
  if (!root) return;
  const id = root.getAttribute("data-cert-id");
  const toastEl = document.getElementById("toast");

  function toast(msg, isErr) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.toggle("err", !!isErr);
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove("show"), isErr ? 4500 : 2600);
  }

  function apply(resp) {
    const f = resp.fragments || {};
    for (const [key, html] of Object.entries(f)) {
      const el = document.getElementById("frag-" + key);
      if (el) el.outerHTML = html;
    }
    const cells = resp.cells || {};
    for (const [field, c] of Object.entries(cells)) {
      const lim = document.getElementById("lim-" + field);
      const st = document.getElementById("st-" + field);
      const val = document.getElementById("val-" + field);
      if (lim) lim.innerHTML = c.limit;
      if (st) st.innerHTML = c.status;
      if (val && c.value !== undefined) val.innerHTML = c.value;
      if (c.changed) {
        const row = (st || lim) && (st || lim).closest("tr");
        if (row) { row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); }
      }
    }
    bindDecision();
  }

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({ error: "Unexpected server response." }));
    if (!r.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  async function save(input) {
    const field = input.getAttribute("data-field");
    const value = input.value;
    if (value === input.getAttribute("data-saved")) return;
    input.classList.remove("error", "saved");
    input.classList.add("saving");
    try {
      const reasonEl = document.getElementById("edit-reason");
      const resp = await post(`/api/certificates/${id}/fields`, { field, value, reason: reasonEl ? reasonEl.value : "" });
      input.setAttribute("data-saved", resp.value ?? "");
      input.value = resp.value ?? "";
      input.classList.remove("saving");
      input.classList.add("saved");
      apply(resp);
      toast(resp.message);
    } catch (e) {
      input.classList.remove("saving");
      input.classList.add("error");
      toast(e.message, true);
    }
  }

  document.querySelectorAll(".cell-input").forEach((input) => {
    input.setAttribute("data-saved", input.value);
    input.addEventListener("change", () => save(input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { input.value = input.getAttribute("data-saved"); input.classList.remove("error"); input.blur(); }
    });
  });

  function bindDecision() {
    document.querySelectorAll("[data-decision]").forEach((btn) => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", async () => {
        const decision = btn.getAttribute("data-decision");
        const noteEl = document.getElementById("decision-note");
        btn.disabled = true;
        try {
          const resp = await post(`/api/certificates/${id}/decision`, { decision, note: noteEl ? noteEl.value : "" });
          apply(resp);
          toast(resp.message);
        } catch (e) {
          btn.disabled = false;
          toast(e.message, true);
        }
      });
    });
    document.querySelectorAll("[data-copy]").forEach((btn) => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", async () => {
        const target = document.getElementById(btn.getAttribute("data-copy"));
        try { await navigator.clipboard.writeText(target.value); toast("Link copied"); }
        catch { target.select(); toast("Press Ctrl+C to copy"); }
      });
    });
  }
  bindDecision();
})();
