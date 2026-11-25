// Apple Reminders + iPhone Calendar. An iPhone Shortcut ("Hub Sync") sends
// them to the GitHub Action, which encrypts them into data/apple.enc.json.

import { CONFIG } from "../config.js";
import { store, esc, relDay, fmtTime, dayDiff, timeAgo } from "./util.js";
import { loadEncrypted } from "./crypto.js";
import { passphraseForm } from "./health.js";

export const SHORTCUT_NAME = "Hub Sync";
const runShortcutUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;

export async function loadApple() {
  return loadEncrypted(CONFIG.APPLE_DATA_URL || "data/apple.enc.json", "apple.cache");
}

const hidden = () => new Set(store.get("apple.hidden", []));
const remKey = (r) => `${r.list}|${r.title}|${r.due || ""}`;

export function toggleReminderHidden(key) {
  const s = hidden();
  s.has(key) ? s.delete(key) : s.add(key);
  store.set("apple.hidden", [...s]);
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

export function renderReminders(el, result) {
  const syncBtn = `<a class="btn" href="${runShortcutUrl}">Sync from iPhone</a>`;
  if (!result) {
    el.innerHTML = `<p class="muted">Loading reminders…</p>`;
    return;
  }
  if (result.needsPassphrase) {
    el.innerHTML = passphraseForm(result.error);
    return;
  }
  if (!result.data) {
    el.innerHTML = `<p class="muted">Set up the “${SHORTCUT_NAME}” Shortcut on your iPhone (README → Step 5) to see your Apple Reminders and iPhone calendar here.</p>
      <div class="row-actions">${syncBtn}</div>`;
    return;
  }

  const now = new Date();
  const hide = hidden();
  const items = (result.data.reminders || [])
    .filter((r) => !hide.has(remKey(r)))
    .map((r) => ({ ...r, dueDate: r.due ? new Date(r.due) : null }));

  const groups = { overdue: [], today: [], soon: [], later: [], none: [] };
  for (const r of items) {
    if (!r.dueDate || isNaN(r.dueDate)) groups.none.push(r);
    else if (dayDiff(now, r.dueDate) < 0 || (r.dueDate < now && r.hasTime)) groups.overdue.push(r);
    else if (dayDiff(now, r.dueDate) === 0) groups.today.push(r);
    else if (dayDiff(now, r.dueDate) <= 7) groups.soon.push(r);
    else groups.later.push(r);
  }
  for (const g of Object.values(groups)) g.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

  const row = (r) => `<li class="task">
      <button class="tick" data-rem="${esc(remKey(r))}" aria-label="Hide in hub"></button>
      <div class="task-body">
        <span class="task-title">${esc(r.title)}</span>
        <div class="muted small">${esc(r.list || "Reminders")}${r.dueDate ? ` · ${esc(relDay(r.dueDate))}${r.hasTime ? ` ${esc(fmtTime(r.dueDate))}` : ""}` : ""}</div>
      </div>
    </li>`;
  const group = (label, list, cls = "", collapsed = false) => {
    if (!list.length) return "";
    const inner = `<ul class="tasks">${list.map(row).join("")}</ul>`;
    return collapsed
      ? `<details class="group ${cls}"><summary>${esc(label)} <span class="count">${list.length}</span></summary>${inner}</details>`
      : `<div class="group ${cls}"><div class="section-label">${esc(label)} <span class="count">${list.length}</span></div>${inner}</div>`;
  };

  const body =
    group("Overdue", groups.overdue, "danger") +
    group("Today", groups.today, "accent") +
    group("Next 7 days", groups.soon) +
    group("Later", groups.later, "", true) +
    group("No date", groups.none, "", groups.none.length > 5);

  el.innerHTML = `${body || `<div class="empty">No open reminders.</div>`}
    <div class="card-foot muted small row-between">
      <span>From iPhone ${esc(timeAgo(result.data.updated))}${result.stale ? " (offline copy)" : ""}</span>
      ${syncBtn}
    </div>`;
}
