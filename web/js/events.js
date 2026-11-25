// Upcoming events: iPhone calendar (via the Shortcut), Google Calendar
// (optional) and events added by hand in the hub.

import { store, esc, relDay, fmtTime, parseDateKey, dateKey, dayDiff, timeAgo } from "./util.js";

export const manualEvents = () => store.get("events.manual", []);

export function addManualEvent({ title, date, time, note }) {
  const list = manualEvents();
  list.push({ id: crypto.randomUUID(), title, date, time: time || "", note: note || "" });
  store.set("events.manual", list);
}

export function removeManualEvent(id) {
  store.set("events.manual", manualEvents().filter((e) => e.id !== id));
}

export const hiddenCalendars = () => new Set(store.get("events.hiddenCals", []));
export function setCalendarHidden(id, hidden) {
  const s = hiddenCalendars();
  hidden ? s.add(id) : s.delete(id);
  store.set("events.hiddenCals", [...s]);
}

/** Normalised, sorted list of upcoming events from both sources. */
export function allEvents(calData, extra = [], now = new Date()) {
  const hidden = hiddenCalendars();
  const fromApple = extra.map((e) => {
    const startDate = new Date(e.start);
    let endDate = new Date(e.end);
    if (isNaN(endDate) || endDate <= startDate) endDate = new Date(startDate.getTime() + (e.allDay ? 86400000 : 3600000));
    return { ...e, startDate, endDate, manual: false };
  }).filter((e) => !isNaN(e.startDate));
  const fromCal = (calData?.events || [])
    .filter((e) => !hidden.has(e.calendarId))
    .map((e) => ({
      ...e,
      startDate: e.allDay ? parseDateKey(e.start) : new Date(e.start),
      endDate: e.allDay ? parseDateKey(e.end) : new Date(e.end),
      manual: false,
    }));

  const fromHub = manualEvents().map((e) => {
    const d = parseDateKey(e.date);
    if (e.time) {
      const [h, m] = e.time.split(":").map(Number);
      d.setHours(h, m);
    }
    return {
      id: e.id,
      title: e.title,
      allDay: !e.time,
      startDate: d,
      endDate: e.time ? new Date(d.getTime() + 3600000) : new Date(d.getTime() + 86400000),
      location: e.note,
      calendar: "Added in hub",
      color: "var(--accent)",
      manual: true,
    };
  });

  // Drop past hub events so the list stays tidy.
  const stale = manualEvents().filter((e) => dayDiff(parseDateKey(e.date), now) > 0);
  if (stale.length) store.set("events.manual", manualEvents().filter((e) => !stale.includes(e)));

  const seen = new Set();
  return [...fromCal, ...fromApple, ...fromHub]
    .filter((e) => e.endDate > now)
    .filter((e) => {
      const k = `${e.title}|${e.startDate.getTime()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.startDate - b.startDate);
}

export function renderEvents(el, calData, { connected, configured, extra = [] }) {
  const now = new Date();
  const events = allEvents(calData, extra, now);
  const byDay = new Map();
  for (const e of events) {
    const start = e.startDate < now ? now : e.startDate;
    const k = dateKey(start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }

  const days = [...byDay.entries()]
    .slice(0, 8)
    .map(([k, list]) => {
      const d = parseDateKey(k);
      return `<div class="day">
        <div class="day-head"><strong>${esc(relDay(d, now))}</strong>
          <span class="muted small">${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
        <ul class="events">${list
          .map(
            (e) => `<li class="event">
              <span class="dot" style="background:${esc(e.color || "var(--muted)")}"></span>
              <div class="event-body">
                ${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : `<span>${esc(e.title)}</span>`}
                <div class="muted small">${e.allDay ? "All day" : esc(fmtTime(e.startDate))}${e.location ? ` · ${esc(e.location)}` : ""}</div>
              </div>
              ${e.manual ? `<button class="icon-btn" data-del-event="${esc(e.id)}" aria-label="Delete event">×</button>` : ""}
            </li>`,
          )
          .join("")}</ul>
      </div>`;
    })
    .join("");

  const foot = connected && calData ? `<span class="muted small">Google Calendar updated ${esc(timeAgo(calData.fetchedAt))}</span>` : "<span></span>";

  el.innerHTML = `
    ${days || `<div class="empty">No upcoming events.</div>`}
    <div class="card-foot">
      ${foot}
      <span class="foot-actions"><button class="btn small" data-action="add-event">Add Event</button></span>
    </div>`;
}

export function nextEvent(calData, extra = []) {
  return allEvents(calData, extra)[0] || null;
}
