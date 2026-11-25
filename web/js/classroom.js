// Assignments card: groups Classroom work into Overdue / Today / This week / Later.

import { store, esc, relDay, fmtTime, dayDiff, timeAgo } from "./util.js";

const DONE_STATES = new Set(["TURNED_IN", "RETURNED"]);

export const localDone = () => new Set(store.get("classroom.localDone", []));

export function toggleLocalDone(id) {
  const s = localDone();
  s.has(id) ? s.delete(id) : s.add(id);
  store.set("classroom.localDone", [...s]);
}

export function buckets(data, now = new Date()) {
  const mine = localDone();
  const b = { overdue: [], today: [], week: [], later: [], nodue: [], doneThisWeek: 0 };
  for (const w of data?.work || []) {
    const done = DONE_STATES.has(w.state) || mine.has(w.id);
    const due = w.due ? new Date(w.due) : null;
    if (done) {
      if (due && Math.abs(dayDiff(now, due)) <= 7) b.doneThisWeek++;
      continue;
    }
    if (!due) {
      const ageDays = w.created ? dayDiff(new Date(w.created), now) : 999;
      if (ageDays <= 21) b.nodue.push(w);
      continue;
    }
    const d = dayDiff(now, due);
    if (due < now && d >= -30) b.overdue.push(w);
    else if (due < now) continue; // very old — ignore
    else if (d === 0) b.today.push(w);
    else if (d <= 7) b.week.push(w);
    else b.later.push(w);
  }
  const byDue = (a, c) => new Date(a.due) - new Date(c.due);
  b.overdue.sort(byDue);
  b.today.sort(byDue);
  b.week.sort(byDue);
  b.later.sort(byDue);
  b.nodue.sort((a, c) => new Date(c.created) - new Date(a.created));
  return b;
}

function item(w) {
  const due = w.due ? new Date(w.due) : null;
  const when = due ? `${relDay(due)} · ${fmtTime(due)}` : "No due date";
  return `<li class="task">
    <button class="tick" data-done="${esc(w.id)}" aria-label="Mark done in hub"></button>
    <div class="task-body">
      <a href="${esc(w.link)}" target="_blank" rel="noopener">${esc(w.title)}</a>
      <div class="muted small">${esc(w.course)} · ${esc(when)}${w.points ? ` · ${w.points} pts` : ""}</div>
    </div>
  </li>`;
}

function group(label, list, cls = "", collapsed = false) {
  if (!list.length) return "";
  const inner = `<ul class="tasks">${list.map(item).join("")}</ul>`;
  if (collapsed) {
    return `<details class="group ${cls}"><summary>${esc(label)} <span class="count">${list.length}</span></summary>${inner}</details>`;
  }
  return `<div class="group ${cls}"><div class="section-label">${esc(label)} <span class="count">${list.length}</span></div>${inner}</div>`;
}

export function renderAssignments(el, data, { connected, configured }) {
  if (!configured && !data) {
    el.innerHTML = `<p class="muted">Add your Google client ID in <code>config.js</code> to connect Classroom. See the README.</p>`;
    return;
  }
  if (!connected && !data) {
    el.innerHTML = `<p class="muted">Connect your school account to see what's due.</p>
      <button class="btn primary" data-connect="classroom">Connect Classroom</button>`;
    return;
  }
  if (!data) {
    el.innerHTML = `<p class="muted">Loading assignments…</p>`;
    return;
  }
  const b = buckets(data);
  const open = b.overdue.length + b.today.length + b.week.length + b.later.length;
  const body =
    group("Overdue", b.overdue, "danger") +
    group("Due today", b.today, "accent") +
    group("Next 7 days", b.week) +
    group("Later", b.later, "", true) +
    group("No due date", b.nodue, "", true);

  el.innerHTML = `
    ${open || b.nodue.length ? body : `<div class="empty">Nothing due. You're all caught up.</div>`}
    <div class="card-foot muted small">
      ${b.doneThisWeek} turned in this week · updated ${esc(timeAgo(data.fetchedAt))}
    </div>`;
}
