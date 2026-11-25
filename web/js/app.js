import { store, esc, $, toast, fmtDayDate, relDay, fmtTime, fmtNum, dateKey } from "./util.js";
import * as G from "./google.js";
import { renderAssignments, buckets, toggleLocalDone } from "./classroom.js";
import { renderEvents, addManualEvent, removeManualEvent, nextEvent, hiddenCalendars, setCalendarHidden } from "./events.js";
import * as Bible from "./bible.js";
import { loadHealth, renderHealth, setPassphrase, getPassphrase } from "./health.js";
import { profile, saveProfile } from "./profile.js";

const STALE_MS = 20 * 60 * 1000;
let health = null;

const cache = {
  get classroom() { return store.get("cache.classroom", null); },
  get calendar() { return store.get("cache.calendar", null); },
};

// ── Rendering ────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const name = profile().name;
  return name ? `${part}, ${name}` : part;
}

function reconnectBanner() {
  const kinds = Object.keys(G.ACCOUNTS).filter((k) => store.get(`reconnect.${k}`, false));
  const el = $("#banner");
  if (!kinds.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `Google needs you to sign in again to refresh ${kinds.map((k) => G.ACCOUNTS[k].label).join(" and ")}.
    ${kinds.map((k) => `<button class="btn small" data-connect="${k}">Sign in</button>`).join(" ")}`;
}

function renderToday() {
  const b = buckets(cache.classroom);
  const due = b.today.length + b.week.length;
  const bs = Bible.summary();
  const ev = nextEvent(cache.calendar);
  const steps = health?.data?.today?.steps;

  const tile = (label, value, sub, target) => `
    <button class="tile" data-jump="${target}">
      <span class="muted small">${esc(label)}</span>
      <strong>${value}</strong>
      <span class="muted small">${sub}</span>
    </button>`;

  $("#today").innerHTML = [
    tile(
      "Due this week",
      cache.classroom ? due : "–",
      b.overdue.length ? `<span class="bad">${b.overdue.length} overdue</span>` : b.today.length ? `${b.today.length} due today` : "on track",
      "card-assignments",
    ),
    tile(
      "Bible today",
      bs.today.length ? `${bs.todayDone}/${bs.today.length}` : bs.readToday,
      bs.streak ? `${bs.streak}-day streak` : "start a streak",
      "card-bible",
    ),
    tile(
      "Next up",
      ev ? esc(ev.title) : "–",
      ev ? esc(`${relDay(ev.startDate)}${ev.allDay ? "" : ` · ${fmtTime(ev.startDate)}`}`) : "no events",
      "card-events",
    ),
    tile(
      "Steps",
      steps != null ? fmtNum(steps) : "–",
      health?.data?.today?.stepGoal ? `goal ${fmtNum(health.data.today.stepGoal)}` : "Garmin",
      "card-health",
    ),
  ].join("");
}

function renderAll() {
  $("#greeting").textContent = greeting();
  $("#date").textContent = fmtDayDate(new Date());
  const configured = G.isConfigured();
  renderAssignments($("#assignments"), cache.classroom, { configured, connected: G.isConnected("classroom") });
  renderEvents($("#events"), cache.calendar, { configured, connected: G.isConnected("calendar") });
  Bible.renderBible($("#bible"));
  renderHealth($("#health"), health);
  renderToday();
  reconnectBanner();
}

// ── Sync ─────────────────────────────────────────────────────

const fetchers = { classroom: G.fetchClassroom, calendar: G.fetchCalendar };

async function syncGoogle(kind, { force = false } = {}) {
  if (!G.isConfigured() || !G.isConnected(kind)) return;
  const cached = cache[kind];
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < STALE_MS;
  if (fresh && !force) return;

  if (!G.getToken(kind)) {
    // Token expired (they last an hour). Bounce through Google silently once.
    const tried = Number(sessionStorage.getItem(`hub.silentTried.${kind}`) || 0);
    if (Date.now() - tried > 10 * 60 * 1000 && !store.get(`reconnect.${kind}`, false)) {
      sessionStorage.setItem(`hub.silentTried.${kind}`, String(Date.now()));
      G.signIn(kind, { silent: true });
      return "redirecting";
    }
    return;
  }

  try {
    const data = await fetchers[kind]();
    store.set(`cache.${kind}`, data);
  } catch (e) {
    if (e instanceof G.AuthError) return syncGoogle(kind, { force });
    toast(`${G.ACCOUNTS[kind].label}: ${e.message}`);
  }
}

async function syncAll({ force = false } = {}) {
  document.body.classList.add("syncing");
  try {
    for (const kind of ["classroom", "calendar"]) {
      if ((await syncGoogle(kind, { force })) === "redirecting") return;
    }
    renderAll();
    health = await loadHealth();
    renderAll();
  } finally {
    document.body.classList.remove("syncing");
  }
}

// ── Modals ───────────────────────────────────────────────────

const modal = $("#modal");

function openModal(title, html, { wide = false } = {}) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  modal.classList.toggle("wide", wide);
  modal.showModal();
}

async function openReader(key) {
  const { book, ch } = Bible.splitKey(key);
  const next = Bible.nextChapterAfter(key);
  openModal(key, `<div class="reader"><p class="muted">Loading ${esc(key)}…</p></div>`, { wide: true });
  const foot = () => `
    <div class="row-actions sticky-foot">
      <button class="btn primary" data-read-done="${esc(key)}" ${next ? `data-next="${esc(next)}"` : ""}>
        ${Bible.isRead(key) ? "Read ✓" : "Mark as read"}${next ? " & next" : ""}</button>
      <a class="btn ghost" href="https://www.bible.com/search/bible?q=${encodeURIComponent(key)}" target="_blank" rel="noopener">Other translations</a>
    </div>`;
  try {
    const verses = await Bible.chapterText(book, ch);
    $("#modal-body").innerHTML = `<div class="reader">${verses
      .map((v) => `<p><sup>${v.verse}</sup>${esc(v.text.trim())}</p>`)
      .join("")}<p class="muted small">World English Bible (public domain)</p></div>${foot()}`;
  } catch {
    $("#modal-body").innerHTML = `<p class="muted">Couldn't load the text (are you offline?). You can still mark it read.</p>${foot()}`;
  }
}

function openPlanPicker() {
  const s = Bible.summary();
  const opts = Object.entries(Bible.PLANS)
    .map(([id, p]) => `<label class="radio"><input type="radio" name="plan" value="${id}" ${id === s.planId ? "checked" : ""}>
      <span><strong>${esc(p.name)}</strong><span class="muted small">${p.chapters.length} chapters${p.days ? ` · about ${Math.ceil(p.chapters.length / p.days)} a day` : ""}</span></span></label>`)
    .join("");
  openModal(
    "Reading plan",
    `<form data-form="plan" class="stack">
      ${opts}
      <label class="field"><span>Start date</span><input type="date" name="start" value="${esc(s.state.start)}"></label>
      <p class="muted small">Chapters you've already checked off stay checked when you switch plans.</p>
      <div class="row-actions"><button class="btn primary">Save plan</button></div>
    </form>`,
  );
}

function openAddEvent() {
  openModal(
    "Add event",
    `<form data-form="event" class="stack">
      <label class="field"><span>What</span><input name="title" required placeholder="Youth group, game, test…"></label>
      <div class="two">
        <label class="field"><span>Date</span><input type="date" name="date" required value="${dateKey()}"></label>
        <label class="field"><span>Time (optional)</span><input type="time" name="time"></label>
      </div>
      <label class="field"><span>Where / note</span><input name="note"></label>
      <div class="row-actions"><button class="btn primary">Add</button></div>
    </form>`,
  );
}

function openSettings() {
  const configured = G.isConfigured();
  const acct = (kind) => {
    const on = G.isConnected(kind);
    const who = G.ACCOUNTS[kind].hint();
    return `<div class="setting">
      <div><strong>${esc(G.ACCOUNTS[kind].label)}</strong>
        <div class="muted small">${on ? "Connected" : "Not connected"}${who ? ` · ${esc(who)}` : ""}</div></div>
      ${configured ? (on ? `<button class="btn small ghost" data-disconnect="${kind}">Disconnect</button>` : `<button class="btn small" data-connect="${kind}">Connect</button>`) : ""}
    </div>`;
  };
  const hidden = hiddenCalendars();
  const cals = (cache.calendar?.calendars || [])
    .map((c) => `<label class="check"><input type="checkbox" data-cal="${esc(c.id)}" ${hidden.has(c.id) ? "" : "checked"}>
      <span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</label>`)
    .join("");

  openModal(
    "Settings",
    `<div class="stack">
      <h3>You</h3>
      <form data-form="profile" class="stack">
        <label class="field"><span>First name</span><input name="name" value="${esc(profile().name)}" autocomplete="given-name"></label>
        <label class="field"><span>School email (Google Classroom)</span><input type="email" name="schoolEmail" value="${esc(profile().schoolEmail)}" autocomplete="email"></label>
        <label class="field"><span>Calendar email (optional)</span><input type="email" name="calendarEmail" value="${esc(profile().calendarEmail)}"></label>
        <p class="muted small">Saved only on this device. Used to pick the right Google account when you connect.</p>
        <div><button class="btn small">Save</button></div>
      </form>
      <h3>Accounts</h3>
      ${configured ? "" : `<div class="note warn">Add your Google client ID to <code>config.js</code> first (README → Step 3).</div>`}
      ${acct("classroom")}
      ${acct("calendar")}
      ${cals ? `<h3>Calendars to show</h3><div class="stack tight">${cals}</div>` : ""}
      <h3>Garmin</h3>
      <div class="setting"><div><strong>Hub passphrase</strong>
        <div class="muted small">${getPassphrase() ? "Saved on this device" : "Not set on this device"}</div></div>
        ${getPassphrase() ? `<button class="btn small ghost" data-action="forget-pass">Forget</button>` : ""}</div>
      <h3>Bible</h3>
      <div class="setting"><div><strong>${esc(Bible.summary().plan.name)}</strong></div>
        <button class="btn small" data-action="bible-plan">Change</button></div>
      <h3>Put it on your home screen</h3>
      <p class="muted small"><strong>iPhone:</strong> open in Safari → Share → Add to Home Screen.<br>
      <strong>Mac:</strong> Safari → File → Add to Dock, or Chrome → ⋮ → Cast, save and share → Install page as app.</p>
      <h3>Data</h3>
      <div class="row-actions"><button class="btn small ghost danger" data-action="reset">Erase everything on this device</button></div>
    </div>`,
  );
}

// ── Events ───────────────────────────────────────────────────

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a, input");
  if (!t) return;
  const d = t.dataset;

  if (d.connect) {
    store.del(`reconnect.${d.connect}`);
    try {
      G.signIn(d.connect);
    } catch (err) {
      toast(err.message);
    }
  } else if (d.disconnect) {
    G.disconnect(d.disconnect);
    store.del(`cache.${d.disconnect}`);
    modal.close();
    renderAll();
  } else if (d.toggle) {
    const nowRead = Bible.toggleChapter(d.toggle);
    if (t.classList.contains("cell")) t.classList.toggle("done", nowRead);
    renderAll();
  } else if (d.read) {
    openReader(d.read);
  } else if (d.readDone) {
    Bible.toggleChapter(d.readDone, true);
    renderAll();
    d.next ? openReader(d.next) : modal.close();
  } else if (d.done) {
    toggleLocalDone(d.done);
    toast("Marked done in your hub (Classroom isn't changed).");
    renderAll();
  } else if (d.delEvent) {
    removeManualEvent(d.delEvent);
    renderAll();
  } else if (d.cal) {
    setCalendarHidden(d.cal, !t.checked);
    renderAll();
  } else if (d.jump) {
    document.getElementById(d.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (d.action === "bible-browse") {
    openModal("All books", `<div class="browser">${Bible.renderBrowser()}</div>`, { wide: true });
  } else if (d.action === "bible-plan") {
    openPlanPicker();
  } else if (d.action === "add-event") {
    openAddEvent();
  } else if (d.action === "settings") {
    openSettings();
  } else if (d.action === "sync") {
    await syncAll({ force: true });
    toast("Up to date.");
  } else if (d.action === "close") {
    modal.close();
  } else if (d.action === "forget-pass") {
    setPassphrase("");
    store.del("garmin.cache");
    health = await loadHealth();
    modal.close();
    renderAll();
  } else if (d.action === "reset") {
    if (confirm("Erase all hub data on this device (reading progress, events, sign-ins)? This can't be undone.")) {
      Object.keys(localStorage).filter((k) => k.startsWith("hub.")).forEach((k) => localStorage.removeItem(k));
      location.reload();
    }
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  if (form.dataset.form === "event") {
    addManualEvent(f);
    modal.close();
  } else if (form.dataset.form === "plan") {
    Bible.setPlan(f.plan, f.start || dateKey());
    modal.close();
  } else if (form.dataset.form === "profile") {
    saveProfile(f);
    toast("Saved on this device.");
    openSettings();
  } else if (form.dataset.form === "passphrase") {
    setPassphrase(f.pass);
    health = await loadHealth();
  }
  renderAll();
});

modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.close(); // click on backdrop
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    renderAll();
    syncAll();
  }
});

// ── Boot ─────────────────────────────────────────────────────

const back = G.handleRedirect();
if (back) {
  if (back.ok) {
    store.del(`reconnect.${back.kind}`);
    if (!back.silent) toast(`${G.ACCOUNTS[back.kind].label} connected.`);
  } else if (back.kind) {
    if (back.silent) store.set(`reconnect.${back.kind}`, true);
    else toast(`Google sign-in didn't finish: ${back.error}`);
  } else {
    toast(back.error);
  }
}

renderAll();
syncAll({ force: !!back?.ok });

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
