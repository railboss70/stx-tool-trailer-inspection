(function () {
  "use strict";

  const APP_VERSION = "v2.1";
  const DRAFT_KEY = "stx-tool-trailer-draft-v1";
  const HISTORY_KEY = "stx-tool-trailer-history-v1";
  const SETTINGS_KEY = "stx-tool-trailer-settings-v1";
  const MAX_OTHERS = 10;
  const SECTIONS = window.STX_SECTIONS;
  const METHODS = window.STX_METHODS;

  const STEPS = ["info", "inventory", "requests", "photos", "sign"];
  const TITLES = {
    home: "Tool Trailer Inspection",
    info: "Trailer & Inspector",
    inventory: "Inventory",
    requests: "Other Requests",
    photos: "Trailer Photos",
    sign: "Review & Sign",
    done: "PDF Ready",
    settings: "Settings",
  };

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isFlagged = (r) => !!r && (r.status === "REPAIR" || r.status === "NEED");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function todayISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).split("-");
    return `${m}/${d}/${y}`;
  }
  function readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  // Standard items, in paper-form order.
  const ITEMS = [];
  SECTIONS.forEach((sec) => sec.items.forEach((name) => ITEMS.push({ id: slug(name), name, section: sec.title })));

  // ---------- state ----------
  function blankState() {
    return {
      started: false,
      step: "info",
      trailerId: "",
      job: "",
      inspector: "",
      date: todayISO(),
      items: {}, // id -> { status, method, urgency, repeat, ordered, eta, etaUnknown, qty, notes }
      others: [
        { id: "other-1", name: "" },
        { id: "other-2", name: "" },
      ],
      requests: "",
      photos: [null, null], // { dataUrl, takenAt, w, h }
      signature: null,
    };
  }

  let state = Object.assign(blankState(), readJSON(DRAFT_KEY, {}));
  let settings = Object.assign({ name: "" }, readJSON(SETTINGS_KEY, {}));
  let lastImported = null; // payload of a PDF loaded on the home screen
  let lastPdf = null;

  let saveTimer = null;
  function save() {
    // Once errors are showing, keep them live while the user fixes things.
    const screenEl = $(`.screen[data-screen="${current}"]`);
    const errBox = screenEl && $(".screen-errors", screenEl);
    if (errBox && !errBox.hidden) showStepErrors(current, validateStep(current));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 250);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    if (!writeJSON(DRAFT_KEY, state)) {
      // Storage full (usually the photos) — keep everything else.
      writeJSON(DRAFT_KEY, { ...state, photos: [null, null] });
    }
  }
  // Save immediately when the app is backgrounded / closed.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSave(); });
  window.addEventListener("pagehide", flushSave);

  function rec(id) {
    if (!state.items[id]) state.items[id] = { status: "" };
    return state.items[id];
  }
  function checkedCount() {
    return ITEMS.filter((i) => state.items[i.id] && state.items[i.id].status).length;
  }
  function hasDraft() {
    return state.started;
  }

  // ---------- navigation ----------
  let current = "home";
  const scrollPos = {};

  function show(screen, { restoreScroll = true } = {}) {
    if (screen === "done" && !lastPdf) screen = "home";          // stale history entry
    if (STEPS.includes(screen) && !state.started) screen = "home"; // inspection was discarded
    if (screen !== current) { $("#toast").hidden = true; clearTimeout(toastTimer); }
    scrollPos[current] = window.scrollY;
    current = screen;
    $$(".screen").forEach((el) => el.classList.toggle("active", el.dataset.screen === screen));

    const i = STEPS.indexOf(screen);
    $("#nav-back").hidden = screen === "home";
    $("#nav-settings").classList.toggle("placeholder", screen === "settings");
    $("#appbar-title").textContent = TITLES[screen];
    $("#appbar-sub").textContent = i >= 0
      ? `Step ${i + 1} of ${STEPS.length}${state.trailerId.trim() ? " · " + state.trailerId.trim() : ""}`
      : "";
    $("#stepbar").hidden = i < 0;
    $("#stepbar-fill").style.width = i >= 0 ? `${((i + 1) / STEPS.length) * 100}%` : "0";
    $("#bottombar").hidden = i < 0;
    if (i >= 0) {
      $("#btn-next").textContent = i === STEPS.length - 1 ? "Finish & create PDF" : `Next: ${TITLES[STEPS[i + 1]]}`;
      state.step = screen;
      save();
    }

    if (screen === "home") renderHome();
    if (screen === "info") renderLastWeek();
    if (screen === "inventory") updateProgress();
    if (screen === "sign") { renderReview(); requestAnimationFrame(() => sig.resize()); }
    if (screen === "settings") renderSettings();

    window.scrollTo(0, restoreScroll ? scrollPos[screen] || 0 : 0);
  }

  function go(screen) {
    const idx = ((history.state && history.state.idx) || 0) + 1;
    history.pushState({ screen, idx }, "", "#" + screen);
    scrollPos[screen] = 0;
    show(screen, { restoreScroll: false });
  }
  function goHome() {
    const idx = (history.state && history.state.idx) || 0;
    if (idx > 0) history.go(-idx); // popstate shows home
    else show("home");
  }
  window.addEventListener("popstate", (e) => show((e.state && e.state.screen) || "home"));

  $("#nav-back").addEventListener("click", () => {
    if ((history.state && history.state.idx) > 0) history.back();
    else show("home");
  });
  $("#nav-settings").addEventListener("click", () => { if (current !== "settings") go("settings"); });

  // ---------- home ----------
  function renderHome() {
    const card = $("#draft-card");
    card.hidden = !hasDraft();
    $("#btn-start").hidden = hasDraft();
    if (hasDraft()) {
      $("#draft-title").textContent = [state.trailerId.trim() || "New trailer", state.job.trim()].filter(Boolean).join(" · ");
      $("#draft-sub").textContent = `${checkedCount()} of ${ITEMS.length} items checked · ${fmtDate(state.date)}` +
        (state.inspector.trim() ? ` · ${state.inspector.trim()}` : "");
    }
  }

  function startNew() {
    state = blankState();
    state.started = true;
    state.inspector = settings.name || "";
    if (lastImported) {
      state.trailerId = lastImported.trailerId;
      state.job = lastImported.job || "";
    }
    lastPdf = null;
    syncAllFields();
    flushSave();
    go("info");
  }

  function discardDraft() {
    state = blankState();
    lastPdf = null;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    syncAllFields();
  }

  $("#btn-start").addEventListener("click", startNew);
  $("#btn-continue").addEventListener("click", () => go(STEPS.includes(state.step) ? state.step : "info"));
  $("#btn-discard").addEventListener("click", () => {
    if (confirm("Discard this inspection and start a new one?")) { discardDraft(); startNew(); }
  });

  // ---------- step 1: header fields ----------
  const FIELDS = ["trailerId", "job", "inspector", "date", "requests"];
  FIELDS.forEach((key) => {
    const el = document.getElementById(key);
    el.addEventListener("input", () => {
      state[key] = el.value;
      el.classList.remove("invalid");
      if (key === "inspector") updateSigName();
      if (key === "trailerId" || key === "date") {
        $$(".item").forEach(syncItem);
        renderLastWeek();
        show(current); // refresh app bar subtitle
      }
      save();
    });
  });
  // Enter on the phone keyboard moves to the next field
  ["trailerId", "job"].forEach((id, i, arr) => {
    document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); document.getElementById(i === 0 ? "job" : "inspector").focus(); }
    });
  });
  $("#inspector").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });

  function syncAllFields() {
    FIELDS.forEach((k) => (document.getElementById(k).value = state[k] || ""));
    renderInventory();
    renderPhotos();
    updateSigName();
    sig.clear(true); // silent: don't wipe the saved signature from the draft
    if (state.signature) sig.load(state.signature);
    $$(".screen-errors").forEach((b) => { b.hidden = true; b.innerHTML = ""; });
  }

  function updateSigName() { $("#sig-name").textContent = state.inspector.trim(); }

  // ---------- last inspection (history) ----------
  function trailerKey(t) { return String(t || "").trim().toUpperCase().replace(/\s+/g, ""); }
  function readHistory() { return readJSON(HISTORY_KEY, {}); }
  function itemLabel(id) {
    const std = ITEMS.find((i) => i.id === id);
    if (std) return std.name;
    const o = state.others.find((x) => x.id === id);
    return o && o.name.trim() ? `Other: ${o.name.trim()}` : null;
  }
  function lastWeek(name) {
    if (!name) return null;
    const h = readHistory()[trailerKey(state.trailerId)];
    if (!h || !h.date || h.date >= state.date) return null; // only earlier inspections
    const it = h.items && h.items[name];
    return it ? { ...it, date: h.date } : null;
  }
  // Store an inspection summary (same shape as the PDF data stamp).
  // Returns false if a newer one for that trailer is already stored.
  function storeHistory(payload) {
    const h = readHistory();
    const key = trailerKey(payload.trailerId);
    if (!key) return false;
    if (h[key] && h[key].date > payload.date) return false;
    const items = {};
    (payload.flagged || []).forEach((r) => { items[r.name] = r; });
    h[key] = { trailerId: payload.trailerId, date: payload.date, inspector: payload.inspector, job: payload.job, items };
    writeJSON(HISTORY_KEY, h);
    return true;
  }

  function historySummaryHTML(h, label) {
    const names = Object.keys(h.items || {});
    let html = `<div><b>${esc(label)}</b> ${esc(fmtDate(h.date))}` +
      (h.inspector ? ` by ${esc(h.inspector)}` : "") + ` — ${plural(names.length, "item")} flagged</div>`;
    if (names.length) {
      html += "<ul>" + names.map((n) => {
        const it = h.items[n];
        const extra = it.ordered === "YES" ? ` – ordered${it.eta ? ", ETA " + esc(fmtDate(it.eta)) : ""}` : "";
        return `<li>${esc(n)} (${esc(it.status)}${extra})</li>`;
      }).join("") + "</ul>";
    }
    return html;
  }

  function renderLastWeek(msg, kind) {
    const box = $("#lastweek");
    const h = readHistory()[trailerKey(state.trailerId)];
    let html = msg ? `<div>${msg}</div>` : "";
    if (h && state.trailerId.trim()) {
      html += historySummaryHTML(h, `Last inspection on file for ${state.trailerId.trim()}:`);
      if (h.date >= state.date) html += `<div><i>That's the same date or later than this inspection, so it won't be used.</i></div>`;
    } else if (!msg) {
      html = state.trailerId.trim()
        ? `No earlier inspection of ${esc(state.trailerId.trim())} on this phone. Load last week's PDF if someone sent it to you.`
        : "";
      kind = "plain";
    }
    box.innerHTML = html;
    box.hidden = !html;
    box.className = "lastweek" + (kind && kind !== "plain" ? " " + kind : "");
  }

  // PDF import — any "Load last inspection PDF" button
  $$(".import-pdf").forEach((input) =>
    input.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      let payload = null;
      try { payload = window.STX_readStamp(await file.arrayBuffer()); } catch (err) { payload = null; }
      const where = current;
      const report = (msg, kind) => {
        if (where === "info") renderLastWeek(msg, kind);
        else {
          const box = where === "settings" ? $("#settings-msg") : $("#home-msg");
          box.innerHTML = msg;
          box.hidden = false;
          box.className = "lastweek" + (kind ? " " + kind : "");
          if (where === "settings") renderSettings();
        }
      };
      if (!payload || !payload.trailerId || !payload.date) {
        report("That PDF wasn't created by this app, so it can't be loaded. Use the PDF the app made for the last inspection.", "err");
        return;
      }
      const stored = storeHistory(payload);
      const n = (payload.flagged || []).length;
      const what = `${esc(payload.trailerId)} – ${esc(fmtDate(payload.date))}${payload.inspector ? " by " + esc(payload.inspector) : ""} (${plural(n, "item")} flagged)`;

      if (where === "info" || (where === "home" && hasDraft())) {
        if (!state.trailerId.trim()) { state.trailerId = payload.trailerId; $("#trailerId").value = payload.trailerId; }
        if (!state.job.trim() && payload.job) { state.job = payload.job; $("#job").value = payload.job; }
      }
      if (where === "home" && !hasDraft()) lastImported = payload;

      let msg, kind = "";
      if (!stored) {
        msg = `This phone already has a newer inspection of ${esc(payload.trailerId)}, so that one was kept.`;
        kind = "warn";
      } else if (hasDraft() && state.trailerId.trim() && trailerKey(payload.trailerId) !== trailerKey(state.trailerId)) {
        msg = `Loaded ${what}. You're inspecting ${esc(state.trailerId)}, so it will be used the next time ${esc(payload.trailerId)} is inspected.`;
        kind = "warn";
      } else if (hasDraft() && payload.date >= state.date) {
        msg = `Loaded ${what}, but it's not older than today's inspection date, so it won't be used for repeats.`;
        kind = "warn";
      } else {
        msg = `✓ Loaded ${what}. Items flagged then will be marked as repeats.` +
          (where === "home" && !hasDraft() ? " Tap Start new inspection." : "");
      }
      $$(".item").forEach(syncItem);
      report(msg, kind);
      toast(stored ? "Last inspection loaded" : "Kept the newer inspection");
      save();
    })
  );

  // ---------- step 2: inventory ----------
  function itemHTML(id, nameHTML, isOther) {
    return `
      <div class="item" data-id="${id}">
        <div class="item-row">
          <div class="item-name">${nameHTML}</div>
          <div class="seg" role="group" aria-label="Condition">
            <button type="button" data-v="GOOD">GOOD</button>
            <button type="button" data-v="REPAIR">REPAIR</button>
            <button type="button" data-v="NEED">NEED</button>
          </div>
          ${isOther ? '<button type="button" class="other-del">Remove this item</button>' : ""}
        </div>
        <div class="followup" hidden>
          <div class="fu-hint" hidden></div>
          <div class="fq"></div>
          <div class="opts" data-f="method">
            <button type="button" data-val="SUPERVISOR">${METHODS.SUPERVISOR.label}<small>Supervisor handles it on site</small></button>
            <button type="button" data-val="YARD">Delivery from Yard<small>Consumable Manager sends it</small></button>
          </div>
          <div class="fu-block" data-show="urgency" hidden>
            <div class="fq2">How soon is it needed? <span class="req">required</span></div>
            <div class="opts" data-f="urgency">
              <button type="button" data-val="OVERNIGHT" class="urgent">Immediate – overnight it<small>Crew held up / safety item</small></button>
              <button type="button" data-val="NORMAL">As time allows<small>Next regular delivery</small></button>
            </div>
          </div>
          <div class="fu-block">
            <div class="fq2">Was this on last week's inspection too? <span class="req">required</span></div>
            <div class="opts" data-f="repeat">
              <button type="button" data-val="NO">No<small>New this week</small></button>
              <button type="button" data-val="YES">Yes<small>Repeat from last week</small></button>
            </div>
          </div>
          <div class="fu-block" data-show="ordered" hidden>
            <div class="fq2">Has it already been ordered? <span class="req">required</span></div>
            <div class="opts" data-f="ordered">
              <button type="button" data-val="YES">Yes<small>It's on order</small></button>
              <button type="button" data-val="NO">No / not sure<small>Not ordered yet</small></button>
            </div>
          </div>
          <div class="fu-block" data-show="eta" hidden>
            <div class="fq2">Expected delivery date <span class="req">required</span></div>
            <div class="eta-row">
              <input type="date" class="fu-eta" aria-label="Expected delivery date">
              <button type="button" class="eta-unknown">Don't know yet</button>
            </div>
          </div>
          <div class="fu-row">
            <input type="number" inputmode="numeric" min="0" max="999" class="fu-qty" placeholder="Qty" aria-label="Quantity">
            <input type="text" class="fu-notes" maxlength="200" placeholder="What's wrong / details" aria-label="Notes">
          </div>
        </div>
      </div>`;
  }

  function otherHTML(o) {
    return itemHTML(o.id, `<input type="text" class="other-name" maxlength="40" placeholder="Other item name (optional)" value="${esc(o.name)}" aria-label="Other item name">`, true);
  }

  function renderInventory() {
    let html = "";
    SECTIONS.forEach((sec) => {
      html += `<section class="card inv-section" data-section="${esc(sec.title)}">
        <h2 class="section-head">${esc(sec.title)} <span class="section-count"></span></h2>
        ${sec.items.map((name) => itemHTML(slug(name), esc(name), false)).join("")}
      </section>`;
    });
    html += `<section class="card inv-section" data-section="Other">
      <h2 class="section-head">Other Items <span class="opt">optional</span></h2>
      <div id="others">${state.others.map(otherHTML).join("")}</div>
      <button type="button" class="btn btn-secondary btn-add" id="btn-add-other">+ Add another item</button>
    </section>`;
    $("#inventory").innerHTML = html;
    $$("#inventory .item").forEach(syncItem);
    updateProgress();
  }

  function syncItem(el) {
    const id = el.dataset.id;
    const r = state.items[id] || {};
    $$(".seg button", el).forEach((b) => b.classList.toggle("on", b.dataset.v === r.status));
    const fu = $(".followup", el);
    fu.hidden = !isFlagged(r);
    fu.classList.toggle("need", r.status === "NEED");
    $(".fq", fu).innerHTML =
      (r.status === "REPAIR" ? "How will this be repaired or replaced?" : "How will this be replaced?") +
      ' <span class="req">required</span>';
    $$(".opts", fu).forEach((g) => {
      const f = g.dataset.f;
      $$("button", g).forEach((b) => b.classList.toggle("on", b.dataset.val === r[f]));
    });
    $('[data-show="urgency"]', fu).hidden = r.method !== "YARD";
    $('[data-show="ordered"]', fu).hidden = r.repeat !== "YES";
    $('[data-show="eta"]', fu).hidden = !(r.repeat === "YES" && r.ordered === "YES");
    const eta = $(".fu-eta", fu);
    eta.value = r.eta || "";
    eta.disabled = !!r.etaUnknown;
    $(".eta-unknown", fu).classList.toggle("on", !!r.etaUnknown);
    $(".fu-qty", fu).value = r.qty || "";
    $(".fu-notes", fu).value = r.notes || "";

    const prev = lastWeek(itemLabel(id));
    const hint = $(".fu-hint", fu);
    hint.hidden = !prev;
    if (prev) {
      let t = `Also flagged <b>${esc(prev.status)}</b> on the ${esc(fmtDate(prev.date))} inspection of this trailer`;
      if (prev.ordered === "YES") t += prev.eta ? ` — ordered, expected ${esc(fmtDate(prev.eta))}` : " — ordered, delivery date unknown";
      hint.innerHTML = "↻ " + t + ".";
    }
  }

  function isOtherId(id) { return id.startsWith("other-"); }

  function updateProgress() {
    const total = ITEMS.length;
    const done = checkedCount();
    $("#progress-fill").style.width = `${(done / total) * 100}%`;
    $("#progress-text").textContent = `${done} of ${total} checked`;
    $$(".inv-section").forEach((secEl) => {
      const sec = SECTIONS.find((s) => s.title === secEl.dataset.section);
      if (!sec) return;
      const n = sec.items.filter((name) => (state.items[slug(name)] || {}).status).length;
      const c = $(".section-count", secEl);
      c.textContent = n === sec.items.length ? `✓ ${n}/${n}` : `${n}/${sec.items.length}`;
      c.classList.toggle("done", n === sec.items.length);
    });
  }

  $("#inventory").addEventListener("click", (e) => {
    if (e.target.closest("#btn-add-other")) {
      if (state.others.length >= MAX_OTHERS) { toast(`Up to ${MAX_OTHERS} other items`); return; }
      const id = `other-${Date.now()}`;
      state.others.push({ id, name: "" });
      $("#others").insertAdjacentHTML("beforeend", otherHTML({ id, name: "" }));
      syncItem($(`.item[data-id="${id}"]`));
      $(`.item[data-id="${id}"] .other-name`).focus();
      save();
      return;
    }
    const item = e.target.closest(".item");
    if (!item) return;
    const id = item.dataset.id;

    if (e.target.closest(".other-del")) {
      state.others = state.others.filter((o) => o.id !== id);
      delete state.items[id];
      item.remove();
      save();
      return;
    }

    const r = rec(id);
    const segBtn = e.target.closest(".seg button");
    const optBtn = e.target.closest(".opts button");
    const etaUnknownBtn = e.target.closest(".eta-unknown");
    if (segBtn) {
      const v = segBtn.dataset.v;
      r.status = r.status === v && isOtherId(id) ? "" : v; // "Other" rows can be un-set
      if (!isFlagged(r)) {
        Object.assign(r, { method: "", urgency: "", repeat: "", ordered: "", eta: "", etaUnknown: false, qty: "", notes: "" });
      } else if (!r.repeat) {
        // Pre-answer "repeat" from the last inspection (user can change it)
        const prev = lastWeek(itemLabel(id));
        if (prev) {
          r.repeat = "YES";
          if (prev.ordered === "YES") { r.ordered = "YES"; r.eta = prev.eta || ""; r.etaUnknown = !prev.eta; }
        }
      }
      item.classList.remove("missing");
      syncItem(item);
      if (isFlagged(r)) $(".followup", item).scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (optBtn) {
      const group = optBtn.closest(".opts");
      r[group.dataset.f] = optBtn.dataset.val;
      if (r.method !== "YARD") r.urgency = "";
      if (r.repeat !== "YES") r.ordered = "";
      if (r.ordered !== "YES") { r.eta = ""; r.etaUnknown = false; }
      group.classList.remove("fu-missing");
      syncItem(item);
    } else if (etaUnknownBtn) {
      r.etaUnknown = !r.etaUnknown;
      if (r.etaUnknown) r.eta = "";
      etaUnknownBtn.closest(".fu-block").classList.remove("fu-missing");
      syncItem(item);
    } else {
      return;
    }
    updateProgress();
    save();
  });

  $("#inventory").addEventListener("input", (e) => {
    const item = e.target.closest(".item");
    if (!item) return;
    const id = item.dataset.id;
    if (e.target.classList.contains("other-name")) {
      const o = state.others.find((x) => x.id === id);
      if (o) o.name = e.target.value;
      e.target.classList.remove("invalid");
    } else if (e.target.classList.contains("fu-qty")) {
      rec(id).qty = e.target.value;
    } else if (e.target.classList.contains("fu-notes")) {
      rec(id).notes = e.target.value;
    } else if (e.target.classList.contains("fu-eta")) {
      rec(id).eta = e.target.value;
      if (e.target.value) rec(id).etaUnknown = false;
      e.target.closest(".fu-block").classList.remove("fu-missing");
    }
    save();
  });

  // ---------- step 4: photos ----------
  function compressImage(file, maxSide = 1600, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve({ dataUrl: c.toDataURL("image/jpeg", quality), w, h, takenAt: new Date().toISOString() });
      };
      img.src = url;
    });
  }

  function renderPhotos() {
    state.photos.forEach((p, i) => {
      const prev = $(`#photo-preview-${i}`);
      prev.style.backgroundImage = p ? `url("${p.dataUrl}")` : "";
      prev.classList.toggle("has", !!p);
      $(`#photo-cap-${i}`).textContent = p ? "✓ Tap photo to retake" : "Tap to take";
    });
  }

  $$(".photo-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      const slot = Number(input.dataset.slot);
      try {
        state.photos[slot] = await compressImage(file);
        $(`.photo-slot[data-slot="${slot}"]`).classList.remove("invalid-slot");
        renderPhotos();
        save();
      } catch (err) {
        toast("Couldn't read that photo — please try again");
      }
    });
  });

  // ---------- step 5: review & signature ----------
  const sig = window.SignaturePad($("#sig"), (url) => {
    state.signature = url;
    $(".sig-wrap").classList.remove("invalid");
    save();
  });
  $("#sig-clear").addEventListener("click", () => sig.clear());

  function urgencyRank(r) { return r.method === "YARD" && r.urgency === "OVERNIGHT" ? 0 : r.method === "SUPERVISOR" ? 1 : 2; }

  function renderReview() {
    const data = reportData();
    const all = data.rows.concat(data.others);
    const c = { GOOD: 0, REPAIR: 0, NEED: 0 };
    all.forEach((r) => { if (c[r.status] !== undefined) c[r.status]++; });
    const flagged = all.filter(isFlagged).sort((a, b) => urgencyRank(a) - urgencyRank(b));
    const overnight = flagged.filter((r) => urgencyRank(r) === 0).length;
    const repeat = flagged.filter((r) => r.repeat === "YES").length;
    let html = `<p class="review-meta">${esc(data.trailerId)} · ${esc(data.job)}<br>${esc(fmtDate(data.date))} · ${esc(data.inspector)}</p>
      <div class="review-counts">
        <span class="chip good">${c.GOOD} GOOD</span><span class="chip repair">${c.REPAIR} REPAIR</span><span class="chip need">${c.NEED} NEED</span>
        ${overnight ? `<span class="chip overnight">${overnight} OVERNIGHT</span>` : ""}
        ${repeat ? `<span class="chip repeat">${repeat} REPEAT</span>` : ""}
      </div>`;
    if (flagged.length) {
      html += `<ul class="review-list">${flagged.map((r) => {
        const by = r.method === "YARD" ? `Yard / Consumable Mgr${r.urgency === "OVERNIGHT" ? "" : " – as time allows"}` : "Site Supervisor";
        const rep = r.repeat === "YES" ? (r.ordered === "YES" ? `Repeat – ordered${r.eta ? ", ETA " + fmtDate(r.eta) : ""}` : "Repeat – NOT ordered") : "";
        return `<li><b>${esc(r.name)}</b>
          ${urgencyRank(r) === 0 ? '<span class="tag on">OVERNIGHT</span>' : ""}${rep ? `<span class="tag rp">${esc(rep)}</span>` : ""}
          ${esc(r.status)}${r.qty ? " · Qty " + esc(r.qty) : ""} · ${esc(by)}${r.notes ? " · " + esc(r.notes) : ""}</li>`;
      }).join("")}</ul>`;
    } else {
      html += `<p class="review-meta">No repairs or replacements needed.</p>`;
    }
    html += `<p class="review-meta">Photos: ${state.photos.filter(Boolean).length} of 2${data.requests ? " · Other requests added" : ""}</p>
      <button type="button" class="btn btn-secondary btn-full review-edit" data-goto="inventory">Edit inventory</button>`;
    $("#review").innerHTML = html;
  }
  $("#review").addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (b) go(b.dataset.goto);
  });

  // ---------- validation ----------
  function validateStep(step) {
    const screenEl = $(`.screen[data-screen="${step}"]`);
    const errors = []; // { msg, el }
    if (!screenEl) return errors;
    $$(".invalid, .missing, .fu-missing, .invalid-slot", screenEl).forEach((el) =>
      el.classList.remove("invalid", "missing", "fu-missing", "invalid-slot"));

    if (step === "info") {
      [["trailerId", "Tool Trailer #"], ["date", "Date of inspection"], ["job", "Job / Location"], ["inspector", "Inspector name"]].forEach(([k, label]) => {
        if (!String(state[k] || "").trim()) {
          const el = document.getElementById(k);
          el.classList.add("invalid");
          errors.push({ msg: `${label} is required`, el });
        }
      });
      if (state.date && state.date > todayISO()) {
        const el = $("#date");
        el.classList.add("invalid");
        errors.push({ msg: "Date of inspection can't be in the future", el });
      }
    }

    if (step === "inventory") {
      const unchecked = ITEMS.filter((i) => !(state.items[i.id] && state.items[i.id].status));
      unchecked.forEach((i) => $(`.item[data-id="${i.id}"]`).classList.add("missing"));
      if (unchecked.length) {
        errors.push({
          msg: `${plural(unchecked.length, "item")} not checked yet (first: ${unchecked[0].name})`,
          el: $(`.item[data-id="${unchecked[0].id}"]`),
        });
      }
      const rows = ITEMS.map((i) => ({ id: i.id, name: i.name }))
        .concat(state.others.map((o) => ({ id: o.id, name: o.name.trim(), other: true })));
      rows.forEach((row) => {
        const r = state.items[row.id];
        const el = $(`.item[data-id="${row.id}"]`);
        if (!el) return;
        if (row.other) {
          if (r && r.status && !row.name) {
            $(".other-name", el).classList.add("invalid");
            errors.push({ msg: "An “Other” item is marked but has no name", el });
          }
          if (row.name && !(r && r.status)) {
            el.classList.add("missing");
            errors.push({ msg: `Mark GOOD / REPAIR / NEED for “${row.name}”`, el });
          }
        }
        if (isFlagged(r)) {
          const nm = row.name || "Other item";
          const flag = (sel, msg) => {
            const target = $(sel, el);
            target.classList.add("fu-missing");
            errors.push({ msg, el: target });
          };
          if (!r.method) flag('.opts[data-f="method"]', `Choose how “${nm}” will be ${r.status === "REPAIR" ? "repaired/replaced" : "replaced"}`);
          if (r.method === "YARD" && !r.urgency) flag('.opts[data-f="urgency"]', `“${nm}”: overnight it, or as time allows?`);
          if (!r.repeat) flag('.opts[data-f="repeat"]', `“${nm}”: was it on last week's inspection too?`);
          if (r.repeat === "YES" && !r.ordered) flag('.opts[data-f="ordered"]', `“${nm}”: has it already been ordered?`);
          if (r.repeat === "YES" && r.ordered === "YES" && !r.eta && !r.etaUnknown) flag('[data-show="eta"]', `“${nm}”: enter the expected delivery date (or tap Don't know yet)`);
        }
      });
    }

    if (step === "photos") {
      state.photos.forEach((p, i) => {
        if (!p) {
          const el = $(`.photo-slot[data-slot="${i}"]`);
          el.classList.add("invalid-slot");
          errors.push({ msg: `Trailer photo ${i + 1} is required`, el });
        }
      });
    }

    if (step === "sign" && !state.signature) {
      $(".sig-wrap").classList.add("invalid");
      errors.push({ msg: "Inspector signature is required", el: $(".sig-wrap") });
    }
    return errors;
  }

  function showStepErrors(step, errors) {
    const screenEl = $(`.screen[data-screen="${step}"]`);
    const box = screenEl && $(".screen-errors", screenEl);
    if (!box) return;
    if (!errors.length) { box.hidden = true; box.innerHTML = ""; return; }
    const shown = errors.slice(0, 8);
    box.hidden = false;
    box.innerHTML = `<b>Fix ${plural(errors.length, "thing")} to continue:</b><ul>${shown
      .map((e, i) => `<li><a href="#" data-err="${i}">${esc(e.msg)}</a></li>`).join("")}</ul>` +
      (errors.length > shown.length ? `<div>…and ${errors.length - shown.length} more</div>` : "");
    $$("a[data-err]", box).forEach((a) =>
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        errors[Number(a.dataset.err)].el.scrollIntoView({ behavior: "smooth", block: "center" });
      })
    );
  }

  // ---------- next / finish ----------
  $("#btn-next").addEventListener("click", () => {
    const i = STEPS.indexOf(current);
    if (i < 0) return;
    const errors = validateStep(current);
    showStepErrors(current, errors);
    if (errors.length) {
      toast(`Fix ${plural(errors.length, "thing")} to continue`);
      errors[0].el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (i < STEPS.length - 1) go(STEPS[i + 1]);
    else finish();
  });

  function reportData() {
    const rows = ITEMS.map((i) => ({ ...(state.items[i.id] || {}), name: i.name }));
    const others = state.others
      .filter((o) => String(o.name || "").trim() && state.items[o.id] && state.items[o.id].status)
      .map((o) => ({ ...state.items[o.id], name: `Other: ${o.name.trim()}` }));
    return {
      trailerId: state.trailerId.trim(),
      job: state.job.trim(),
      inspector: state.inspector.trim(),
      date: state.date,
      rows,
      others,
      requests: state.requests.trim(),
      photos: state.photos,
      signature: state.signature,
      submittedAt: new Date().toISOString(),
    };
  }

  // Crop the signature to the ink (plus a margin) so it fills the PDF signature line.
  function trimSignature(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3] > 10) {
              if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) return resolve({ url, w: c.width, h: c.height });
        const pad = Math.round(Math.max(c.width, c.height) * 0.02) + 4;
        x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
        x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
        const out = document.createElement("canvas");
        out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
        out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
        resolve({ url: out.toDataURL("image/png"), w: out.width, h: out.height });
      };
      img.onerror = () => resolve({ url, w: 0, h: 0 });
      img.src = url;
    });
  }

  let finishing = false;
  async function finish() {
    if (finishing) return; // ignore double taps
    finishing = true;
    try { await finishInner(); } finally { finishing = false; }
  }

  async function finishInner() {
    // Re-check every step (something may have changed via back navigation)
    for (const step of STEPS) {
      const errs = validateStep(step);
      if (errs.length) {
        go(step);
        showStepErrors(step, errs);
        toast(`Fix ${plural(errs.length, "thing")} on this screen`);
        return;
      }
    }
    let built;
    const data = reportData();
    try {
      data.signature = await trimSignature(state.signature);
      built = window.STX_buildPdf(data);
    } catch (err) {
      console.error(err);
      toast("Couldn't create the PDF — please try again");
      return;
    }
    storeHistory(window.STX_stampPayload(data));
    const blob = built.doc.output("blob");
    lastPdf = { blob, filename: built.filename, doc: built.doc };
    const c = built.counts;
    $("#done-file").textContent = built.filename;
    $("#done-summary").textContent =
      `${c.GOOD} Good · ${c.REPAIR} Repair · ${c.NEED} Need` +
      (c.OVERNIGHT ? ` · ${c.OVERNIGHT} overnight` : "") +
      (c.REPEAT ? ` · ${c.REPEAT} repeat` : "") + " · 2 photos · signed";
    $("#btn-share").hidden = !canShareFile();
    flushSave();
    go("done");
  }

  // ---------- done ----------
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function pdfFile() { return new File([lastPdf.blob], lastPdf.filename, { type: "application/pdf" }); }
  function canShareFile() {
    try { return !!(navigator.canShare && lastPdf && navigator.canShare({ files: [pdfFile()] })); } catch (e) { return false; }
  }
  async function sharePdf() {
    try {
      await navigator.share({ files: [pdfFile()], title: lastPdf.filename.replace(/\.pdf$/, "") });
    } catch (e) { /* cancelled */ }
  }
  $("#btn-share").addEventListener("click", () => { if (lastPdf) sharePdf(); });
  $("#btn-download").addEventListener("click", () => {
    if (!lastPdf) return;
    // iPhone home-screen apps can't download files; the share sheet has "Save to Files".
    if (isIOS && canShareFile()) sharePdf();
    else lastPdf.doc.save(lastPdf.filename);
  });
  $("#btn-edit").addEventListener("click", () => history.back());
  $("#btn-new").addEventListener("click", () => {
    discardDraft();
    lastImported = null;
    goHome();
  });

  // ---------- settings ----------
  function renderSettings() {
    $("#set-name").value = settings.name || "";
    $("#app-version").textContent = APP_VERSION;
    const h = readHistory();
    const keys = Object.keys(h).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    $("#set-history").innerHTML = keys.length
      ? keys.map((k) => {
          const r = h[k];
          const n = Object.keys(r.items || {}).length;
          return `<div class="hist-row"><div><b>${esc(r.trailerId || k)}</b>${esc(fmtDate(r.date))}${r.inspector ? " · " + esc(r.inspector) : ""} · ${plural(n, "item")} flagged</div>
            <button type="button" data-del="${esc(k)}">Remove</button></div>`;
        }).join("")
      : `<p class="empty">None yet. They're saved here when you finish an inspection or load a PDF.</p>`;
    $("#btn-clear-draft").disabled = !hasDraft();
    $("#btn-clear-draft").style.opacity = hasDraft() ? 1 : 0.5;
  }
  $("#set-name").addEventListener("input", (e) => {
    settings.name = e.target.value;
    writeJSON(SETTINGS_KEY, settings);
  });
  $("#set-history").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const h = readHistory();
    delete h[b.dataset.del];
    writeJSON(HISTORY_KEY, h);
    renderSettings();
    $$(".item").forEach(syncItem);
  });
  $("#btn-clear-draft").addEventListener("click", () => {
    if (!hasDraft()) return;
    if (confirm("Discard the current inspection? This can't be undone.")) {
      discardDraft();
      toast("Inspection discarded");
      goHome();
    }
  });

  // Hide the bottom Next bar only while the on-screen keyboard is open
  // (detected by the visible area shrinking), so it doesn't cover fields.
  if (window.visualViewport) {
    let baseH = window.visualViewport.height;
    const onVV = () => {
      const vv = window.visualViewport.height;
      if (vv > baseH) baseH = vv;
      const a = document.activeElement;
      const editing = a && a.matches && a.matches("input[type=text], input[type=number], textarea");
      document.body.classList.toggle("typing", !!editing && vv < baseH * 0.75);
    };
    window.visualViewport.addEventListener("resize", onVV);
    window.addEventListener("orientationchange", () => { setTimeout(() => { baseH = window.visualViewport.height; onVV(); }, 400); });
    document.addEventListener("focusout", () => setTimeout(onVV, 100));
  }

  // ---------- init ----------
  syncAllFields();
  history.replaceState({ screen: "home", idx: 0 }, "", "#home");
  show("home");

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // Exposed for automated tests only.
  window.STX_app = { get state() { return state; }, get current() { return current; }, validateStep, reportData };
})();
