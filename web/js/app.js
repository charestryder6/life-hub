import { store, esc, $, $$, toast, relDay, fmtTime, fmtNum, dateKey } from "./util.js";
import * as G from "./google.js";
import { renderEvents, addManualEvent, removeManualEvent, nextEvent, hiddenCalendars, setCalendarHidden } from "./events.js";
import * as Bible from "./bible.js";
import { loadHealth, renderHealth, setPassphrase, getPassphrase } from "./health.js";
import { profile, saveProfile } from "./profile.js";
import {
  loadApple, renderAssignments, renderReminders, appleEvents, toggleReminderHidden,
  assignmentSummary, allLists, schoolLists, setSchoolLists,
} from "./apple.js";

const STALE_MS = 20 * 60 * 1000;
let health = null;
let apple = null;

const cache = {
  get calendar() { return store.get("cache.calendar", null); },
};

// Tidy up data from the old Google Classroom version.
["cache.classroom", "connected.classroom", "token.classroom", "reconnect.classroom", "profile.schoolEmail", "classroom.done"]
  .forEach((k) => store.del(k));

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
  el.innerHTML = `<span>Sign in again to refresh ${kinds.map((k) => G.ACCOUNTS[k].label).join(" and ")}.</span>
    ${kinds.map((k) => `<button class="btn small primary" data-connect="${k}">Sign In</button>`).join(" ")}`;
}

function renderToday() {
  const a = assignmentSummary(apple);
  const bs = Bible.summary();
  const ev = nextEvent(cache.calendar, appleEvents(apple));
  const steps = health?.data?.today?.steps;

  const tile = (kind, label, value, sub, target) => `
    <button class="tile" data-kind="${kind}" data-jump="${target}">
      <span class="tile-label">${esc(label)}</span>
      <strong>${value}</strong>
      <span class="tile-sub">${sub}</span>
    </button>`;

  $("#today").innerHTML = [
    tile(
      "assign",
      "Due This Week",
      a ? a.week : "–",
      !a ? "Reminders" : a.overdue ? `<span class="bad">${a.overdue} overdue</span>` : a.today ? `${a.today} due today` : "On track",
      "card-assignments",
    ),
    tile(
      "bible",
      "Bible Today",
      bs.today.length ? `${bs.todayDone}/${bs.today.length}` : bs.readToday,
      bs.streak ? `${bs.streak}-day streak` : "Start a streak",
      "card-bible",
    ),
    tile(
      "events",
      "Next Up",
      ev ? esc(ev.title) : "–",
      ev ? esc(`${relDay(ev.startDate)}${ev.allDay ? "" : ` · ${fmtTime(ev.startDate)}`}`) : "No events",
      "card-events",
    ),
    tile(
      "health",
      "Steps",
      steps != null ? fmtNum(steps) : "–",
      health?.data?.today?.stepGoal ? `Goal ${fmtNum(health.data.today.stepGoal)}` : "Garmin",
      "card-health",
    ),
  ].join("");
}

function renderAll() {
  $("#greeting").textContent = greeting();
  $("#date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  renderAssignments($("#assignments"), apple);
  renderEvents($("#events"), cache.calendar, { configured: G.isConfigured(), connected: G.isConnected("calendar"), extra: appleEvents(apple) });
  renderReminders($("#reminders"), apple);
  Bible.renderBible($("#bible"));
  renderHealth($("#health"), health);
  renderToday();
  reconnectBanner();
}

// ── Sync ─────────────────────────────────────────────────────

const fetchers = { calendar: G.fetchCalendar };

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
    if ((await syncGoogle("calendar", { force })) === "redirecting") return;
    renderAll();
    [health, apple] = await Promise.all([loadHealth(), loadApple()]);
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
  if (!modal.open) modal.showModal();
  $("#modal-body").scrollTop = 0;
}

async function openReader(key) {
  const { book, ch } = Bible.splitKey(key);
  const next = Bible.nextChapterAfter(key);
  openModal(key, `<div class="reader"><p class="muted">Loading ${esc(key)}…</p></div>`, { wide: true });
  const foot = () => `
    <div class="sticky-foot">
      <button class="btn primary block" data-read-done="${esc(key)}" ${next ? `data-next="${esc(next)}"` : ""}>
        ${Bible.isRead(key) ? "Read ✓" : "Mark as Read"}${next ? " & Next" : ""}</button>
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
    .map(([id, p]) => `<label class="list-row radio"><input type="radio" name="plan" value="${id}" ${id === s.planId ? "checked" : ""}>
      <span class="row-text"><span>${esc(p.name)}</span><span class="row-sub">${p.chapters.length} chapters${p.days ? ` · about ${Math.ceil(p.chapters.length / p.days)} a day` : ""}</span></span></label>`)
    .join("");
  openModal(
    "Reading Plan",
    `<form data-form="plan">
      <div class="list">${opts}</div>
      <div class="list"><label class="list-row"><span>Start date</span><input type="date" name="start" value="${esc(s.state.start)}"></label></div>
      <p class="list-foot">Chapters you've already checked off stay checked when you switch plans.</p>
      <button class="btn primary block">Save Plan</button>
    </form>`,
  );
}

function openAddEvent() {
  openModal(
    "New Event",
    `<form data-form="event">
      <div class="list">
        <label class="list-row"><input name="title" required placeholder="Title" aria-label="Title"></label>
        <label class="list-row"><input name="note" placeholder="Location or note" aria-label="Location or note"></label>
      </div>
      <div class="list">
        <label class="list-row"><span>Date</span><input type="date" name="date" required value="${dateKey()}"></label>
        <label class="list-row"><span>Time</span><input type="time" name="time" aria-label="Time (optional)"></label>
      </div>
      <p class="list-foot">Leave the time empty for an all-day event.</p>
      <button class="btn primary block">Add</button>
    </form>`,
  );
}

const switchRow = (label, attrs, on, dot = "") => `
  <label class="list-row">
    <span class="row-text">${dot}${label}</span>
    <input type="checkbox" class="switch" ${attrs} ${on ? "checked" : ""}>
  </label>`;

function openSettings() {
  const p = profile();
  const configured = G.isConfigured();
  const calOn = G.isConnected("calendar");

  const lists = allLists(apple);
  const school = schoolLists(apple);
  const listRows = lists.length
    ? lists.map((l) => switchRow(esc(l), `data-assign-list="${esc(l)}"`, school.has(l))).join("")
    : `<div class="list-row"><span class="row-text"><span>School</span><span class="row-sub">Your lists show up here after the first iPhone sync.</span></span></div>`;

  const hidden = hiddenCalendars();
  const cals = (cache.calendar?.calendars || [])
    .map((c) => switchRow(esc(c.name), `data-cal="${esc(c.id)}"`, !hidden.has(c.id), `<span class="dot" style="background:${esc(c.color)}"></span>`))
    .join("");

  openModal(
    "Settings",
    `<form data-form="profile">
      <h3>You</h3>
      <div class="list">
        <label class="list-row"><span>Name</span><input name="name" value="${esc(p.name)}" placeholder="First name" autocomplete="given-name"></label>
      </div>
      <p class="list-foot">Saved only on this device.</p>

      <h3>Assignments</h3>
      <div class="list">${listRows}</div>
      <p class="list-foot">Reminders lists that count as school work. Set due dates and priority
        (<span class="prio p3">!!!</span> high, <span class="prio p2">!!</span> medium, <span class="prio p1">!</span> low) in the Reminders app.
        They sync here when the “Hub Sync” Shortcut runs.</p>

      <h3>Google Calendar</h3>
      <div class="list">
        <div class="list-row">
          <span class="row-text"><span>Google Calendar</span><span class="row-sub">${calOn ? "Connected" : "Optional. Your iPhone calendar already syncs."}</span></span>
          ${configured ? (calOn ? `<button type="button" class="btn small ghost" data-disconnect="calendar">Disconnect</button>` : `<button type="button" class="btn small" data-connect="calendar">Connect</button>`) : ""}
        </div>
        <label class="list-row"><span>Account</span><input type="email" name="calendarEmail" value="${esc(p.calendarEmail)}" placeholder="Optional"></label>
        ${cals}
      </div>
    </form>

    <h3>Health</h3>
    <div class="list">
      <div class="list-row">
        <span class="row-text"><span>Hub passphrase</span><span class="row-sub">${getPassphrase() ? "Saved on this device" : "Not set on this device"}</span></span>
        ${getPassphrase() ? `<button class="btn small ghost danger" data-action="forget-pass">Forget</button>` : ""}
      </div>
    </div>

    <h3>Bible</h3>
    <div class="list">
      <button class="list-row nav" data-action="bible-plan">
        <span>Reading plan</span><span class="value">${esc(Bible.summary().plan.name)}</span>
      </button>
    </div>

    <h3>Home Screen</h3>
    <p class="list-foot"><strong>iPhone:</strong> open in Safari → Share → Add to Home Screen.<br>
      <strong>Mac:</strong> Safari → File → Add to Dock.</p>

    <div class="list">
      <button class="list-row destructive" data-action="reset">Erase Everything on This Device</button>
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
  } else if (d.rem) {
    toggleReminderHidden(d.rem);
    toast("Hidden here. Complete it in Reminders to remove it everywhere.");
    renderAll();
  } else if (d.sort) {
    store.set("assign.sort", d.sort);
    renderAll();
  } else if (d.assignList !== undefined) {
    setSchoolLists($$("[data-assign-list]", modal).filter((x) => x.checked).map((x) => x.dataset.assignList));
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
    openModal("All Books", `<div class="browser">${Bible.renderBrowser()}</div>`, { wide: true });
  } else if (d.action === "bible-plan") {
    openPlanPicker();
  } else if (d.action === "add-event") {
    openAddEvent();
  } else if (d.action === "settings") {
    openSettings();
  } else if (d.action === "sync") {
    await syncAll({ force: true });
    toast("Up to date");
  } else if (d.action === "close") {
    modal.close();
  } else if (d.action === "forget-pass") {
    setPassphrase("");
    store.del("garmin.cache");
    store.del("apple.cache");
    [health, apple] = await Promise.all([loadHealth(), loadApple()]);
    modal.close();
    renderAll();
  } else if (d.action === "reset") {
    if (confirm("Erase all hub data on this device (reading progress, events, sign-ins)? This can't be undone.")) {
      Object.keys(localStorage).filter((k) => k.startsWith("hub.")).forEach((k) => localStorage.removeItem(k));
      location.reload();
    }
  }
});

// Settings save as you type, like iOS.
document.addEventListener("change", (e) => {
  const form = e.target.closest('form[data-form="profile"]');
  if (!form || e.target.type === "checkbox") return;
  saveProfile(Object.fromEntries(new FormData(form)));
  renderAll();
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
    toast("Saved");
  } else if (form.dataset.form === "passphrase") {
    setPassphrase(f.pass);
    [health, apple] = await Promise.all([loadHealth(), loadApple()]);
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
    if (!back.silent) toast(`${G.ACCOUNTS[back.kind].label} connected`);
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
