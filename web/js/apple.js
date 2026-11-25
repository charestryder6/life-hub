// Apple Reminders + iPhone Calendar. An iPhone Shortcut ("Hub Sync") sends
// them to the GitHub Action, which encrypts them into data/apple.enc.json.
//
// Assignments live in the Reminders app (a "School" list, or whichever lists
// you pick in Settings). Change due dates and priority there; the hub shows
// them organised by when they're due or by how urgent they are.

import { CONFIG } from "../config.js";
import { store, esc, relDay, fmtTime, dayDiff, timeAgo } from "./util.js";
import { loadEncrypted } from "./crypto.js";
import { passphraseForm } from "./health.js";

export const SHORTCUT_NAME = "Hub Sync";
const runShortcutUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;
const REMINDERS_APP = "x-apple-reminderkit://";
const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

export async function loadApple() {
  return loadEncrypted(CONFIG.APPLE_DATA_URL || "data/apple.enc.json", "apple.cache");
}

// ── Hidden-in-hub items ──────────────────────────────────────

const hidden = () => new Set(store.get("apple.hidden", []));
const remKey = (r) => `${r.list}|${r.title}|${r.due || ""}`;

export function toggleReminderHidden(key) {
  const s = hidden();
  s.has(key) ? s.delete(key) : s.add(key);
  store.set("apple.hidden", [...s]);
}

// ── Which lists count as school ──────────────────────────────

const SCHOOLISH = /school|class|homework|assignment|hw\b/i;

/** Every list name seen in the last sync. */
export function allLists(result) {
  return [...new Set((result?.data?.reminders || []).map((r) => r.list || "Reminders"))].sort();
}

/** The lists shown under Assignments. Chosen in Settings, or guessed by name. */
export function schoolLists(result) {
  const chosen = store.get("assign.lists", null);
  if (Array.isArray(chosen)) return new Set(chosen);
  const guess = allLists(result).filter((l) => SCHOOLISH.test(l));
  return new Set(guess.length ? guess : ["School"]);
}

export function setSchoolLists(lists) {
  store.set("assign.lists", lists);
}

// ── Shaping the data ─────────────────────────────────────────

const PRIORITY = { 3: "High", 2: "Medium", 1: "Low", 0: "None" };

function items(result, wantSchool) {
  const hide = hidden();
  const school = schoolLists(result);
  return (result?.data?.reminders || [])
    .filter((r) => school.has(r.list || "Reminders") === wantSchool)
    .filter((r) => !hide.has(remKey(r)))
    .map((r) => {
      const dueDate = r.due ? new Date(r.due) : null;
      return { ...r, priority: r.priority || 0, dueDate: dueDate && !isNaN(dueDate) ? dueDate : null };
    });
}

function isOverdue(r, now) {
  if (!r.dueDate) return false;
  const d = dayDiff(now, r.dueDate);
  return d < 0 || (d === 0 && r.hasTime && r.dueDate < now);
}

function byDue(list, now) {
  const g = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const r of list) {
    if (!r.dueDate) g.none.push(r);
    else if (isOverdue(r, now)) g.overdue.push(r);
    else if (dayDiff(now, r.dueDate) === 0) g.today.push(r);
    else if (dayDiff(now, r.dueDate) <= 7) g.week.push(r);
    else g.later.push(r);
  }
  // Within a day group: most urgent first, then soonest.
  const cmp = (a, b) => b.priority - a.priority || (b.flagged - a.flagged) || (a.dueDate || 0) - (b.dueDate || 0);
  Object.values(g).forEach((x) => x.sort(cmp));
  return g;
}

/** Counts for the "Due this week" tile at the top. */
export function assignmentSummary(result, now = new Date()) {
  if (!result?.data) return null;
  const g = byDue(items(result, true), now);
  return { overdue: g.overdue.length, today: g.today.length, week: g.today.length + g.week.length };
}

/** iPhone calendar events in the same shape the Upcoming card uses. */
export function appleEvents(result) {
  return (result?.data?.events || []).map((e, i) => ({
    id: `apple-${i}`,
    title: e.title || "(No title)",
    allDay: !!e.allDay,
    start: e.start,
    end: e.end || e.start,
    location: e.location || "",
    calendar: e.calendar || "iPhone",
    calendarId: `apple:${e.calendar || ""}`,
    color: "var(--events)",
    apple: true,
  }));
}

// ── Rendering ────────────────────────────────────────────────

const bangs = (p) => (p >= 3 ? "!!!" : p === 2 ? "!!" : p === 1 ? "!" : "");

const FLAG = `<svg class="flag" viewBox="0 0 16 16" aria-label="Flagged"><path d="M3 15V2m0 0h8.5l-1.6 3 1.6 3H3" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

function row(r, now, { showList = true } = {}) {
  const late = isOverdue(r, now);
  const when = r.dueDate ? `${relDay(r.dueDate, now)}${r.hasTime ? `, ${fmtTime(r.dueDate)}` : ""}` : "";
  const meta = [
    when ? `<span class="${late ? "late" : ""}">${esc(when)}</span>` : "",
    showList ? `<span>${esc(r.list || "Reminders")}</span>` : "",
  ].filter(Boolean).join(" · ");
  const body = `
      <span class="task-title">${r.priority ? `<span class="prio p${r.priority}" aria-label="${PRIORITY[r.priority]} priority">${bangs(r.priority)}</span> ` : ""}${esc(r.title)}</span>
      ${meta ? `<span class="task-meta">${meta}</span>` : ""}`;
  return `<li class="task">
      <button class="tick" data-rem="${esc(remKey(r))}" aria-label="Hide “${esc(r.title)}” in the hub"></button>
      ${isApple ? `<a class="task-body" href="${REMINDERS_APP}">${body}</a>` : `<div class="task-body">${body}</div>`}
      ${r.flagged ? FLAG : ""}
    </li>`;
}

function section(label, list, now, { cls = "", collapsed = false, showList = true } = {}) {
  if (!list.length) return "";
  const inner = `<ul class="tasks">${list.map((r) => row(r, now, { showList })).join("")}</ul>`;
  const head = `${esc(label)} <span class="count">${list.length}</span>`;
  return collapsed
    ? `<details class="group ${cls}"><summary>${head}</summary>${inner}</details>`
    : `<div class="group ${cls}"><div class="section-label">${head}</div>${inner}</div>`;
}

function footer(result, { openApp = true } = {}) {
  return `<div class="card-foot">
      <span class="muted small">From iPhone ${esc(timeAgo(result.data.updated))}${result.stale ? " (offline copy)" : ""}</span>
      <span class="foot-actions">
        ${openApp && isApple ? `<a class="btn ghost small" href="${REMINDERS_APP}">Open Reminders</a>` : ""}
        <a class="btn small" href="${runShortcutUrl}">Sync</a>
      </span>
    </div>`;
}

function notReady(el, result, what) {
  if (!result) {
    el.innerHTML = `<p class="muted">Loading…</p>`;
    return true;
  }
  if (result.needsPassphrase) {
    el.innerHTML = passphraseForm(result.error);
    return true;
  }
  if (!result.data) {
    el.innerHTML = `<p class="muted">${what} Set up the “${SHORTCUT_NAME}” Shortcut on your iPhone (README → Step 5).</p>
      <div class="row-actions"><a class="btn" href="${runShortcutUrl}">Sync from iPhone</a></div>`;
    return true;
  }
  return false;
}

export function renderAssignments(el, result) {
  if (notReady(el, result, "Assignments come from a <strong>School</strong> list in the Reminders app.")) return;

  const now = new Date();
  const list = items(result, true);
  const lists = [...schoolLists(result)];
  const multi = new Set(list.map((r) => r.list)).size > 1;
  const sort = store.get("assign.sort", "due");

  const seg = `<div class="segmented" role="tablist" aria-label="Sort assignments">
      <button role="tab" data-sort="due" aria-selected="${sort === "due"}">By due date</button>
      <button role="tab" data-sort="urgency" aria-selected="${sort === "urgency"}">By urgency</button>
    </div>`;

  let body = "";
  if (sort === "urgency") {
    const cmp = (a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity);
    const byP = (p) => list.filter((r) => r.priority === p).sort(cmp);
    body =
      section("High", byP(3), now, { cls: "danger", showList: multi }) +
      section("Medium", byP(2), now, { cls: "warn", showList: multi }) +
      section("Low", byP(1), now, { cls: "accent", showList: multi }) +
      section("No priority", byP(0), now, { showList: multi });
  } else {
    const g = byDue(list, now);
    body =
      section("Overdue", g.overdue, now, { cls: "danger", showList: multi }) +
      section("Today", g.today, now, { cls: "accent", showList: multi }) +
      section("Next 7 days", g.week, now, { showList: multi }) +
      section("Later", g.later, now, { collapsed: g.later.length > 4, showList: multi }) +
      section("No due date", g.none, now, { collapsed: g.none.length > 4, showList: multi });
  }

  const empty = `<div class="empty">Nothing due. Add assignments to your
      <strong>${esc(lists.join(", "))}</strong> list in Reminders. Set a due date and a priority there, and they'll show up here.</div>`;

  el.innerHTML = `${list.length ? seg : ""}${body || empty}${footer(result)}`;
}

export function renderReminders(el, result) {
  if (notReady(el, result, "See your Apple Reminders here.")) return;
  const now = new Date();
  const g = byDue(items(result, false), now);
  const body =
    section("Overdue", g.overdue, now, { cls: "danger" }) +
    section("Today", g.today, now, { cls: "accent" }) +
    section("Next 7 days", g.week, now) +
    section("Later", g.later, now, { collapsed: true }) +
    section("No date", g.none, now, { collapsed: g.none.length > 5 });
  el.innerHTML = `${body || `<div class="empty">No other reminders.</div>`}${footer(result, { openApp: false })}`;
}
