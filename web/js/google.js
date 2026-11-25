// Google sign-in (OAuth 2.0 token flow via full-page redirect — this works
// inside home-screen apps on iPhone where pop-ups don't) plus the Classroom
// and Calendar API calls.

import { CONFIG } from "../config.js";
import { store } from "./util.js";
import { profile } from "./profile.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export const ACCOUNTS = {
  classroom: {
    label: "Google Classroom",
    scopes: [
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    ],
    hint: () => profile().schoolEmail,
  },
  calendar: {
    label: "Google Calendar",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    hint: () => profile().calendarEmail,
  },
};

export class AuthError extends Error {}

export const isConfigured = () =>
  CONFIG.GOOGLE_CLIENT_ID && !CONFIG.GOOGLE_CLIENT_ID.startsWith("PASTE-");

const redirectUri = () => location.origin + location.pathname;

export const isConnected = (kind) => store.get(`connected.${kind}`, false);

export function disconnect(kind) {
  store.del(`connected.${kind}`);
  store.del(`token.${kind}`);
}

export function getToken(kind) {
  const t = store.get(`token.${kind}`, null);
  return t && t.exp > Date.now() + 60_000 ? t.access_token : null;
}

/** Send the browser to Google. silent=true asks Google not to show any UI. */
export function signIn(kind, { silent = false } = {}) {
  if (!isConfigured()) throw new Error("Add your Google client ID to config.js first.");
  const state = `${kind}.${crypto.randomUUID()}`;
  sessionStorage.setItem("hub.oauthState", state);
  sessionStorage.setItem("hub.oauthSilent", silent ? "1" : "");
  const params = new URLSearchParams({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "token",
    scope: ACCOUNTS[kind].scopes.join(" "),
    include_granted_scopes: "true",
    state,
  });
  const hint = ACCOUNTS[kind].hint();
  if (hint) params.set("login_hint", hint);
  if (silent) params.set("prompt", "none");
  else if (!hint) params.set("prompt", "select_account");
  location.assign(`${AUTH_URL}?${params}`);
}

/**
 * Call once on page load. If we just came back from Google, store the token
 * and clean the URL. Returns { kind, ok, error } or null.
 */
export function handleRedirect() {
  if (!location.hash.includes("state=")) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname + location.search);

  const expected = sessionStorage.getItem("hub.oauthState");
  const silent = sessionStorage.getItem("hub.oauthSilent") === "1";
  sessionStorage.removeItem("hub.oauthState");
  const state = p.get("state");
  if (!state || state !== expected) return { ok: false, error: "Sign-in state mismatch — try again." };

  const kind = state.split(".")[0];
  if (p.get("access_token")) {
    store.set(`token.${kind}`, {
      access_token: p.get("access_token"),
      exp: Date.now() + Number(p.get("expires_in") || 3600) * 1000,
    });
    store.set(`connected.${kind}`, true);
    return { kind, ok: true, silent };
  }
  return { kind, ok: false, silent, error: p.get("error") || "unknown_error" };
}

async function gget(kind, url) {
  const token = getToken(kind);
  if (!token) throw new AuthError(kind);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    store.del(`token.${kind}`);
    throw new AuthError(kind);
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function pages(kind, baseUrl, field, maxPages = 3) {
  const out = [];
  let token = "";
  for (let i = 0; i < maxPages; i++) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const data = await gget(kind, baseUrl + (token ? `${sep}pageToken=${token}` : ""));
    out.push(...(data[field] || []));
    token = data.nextPageToken;
    if (!token) break;
  }
  return out;
}

// ── Classroom ────────────────────────────────────────────────

const CR = "https://classroom.googleapis.com/v1";

function dueDateOf(work) {
  const d = work.dueDate;
  if (!d) return null;
  const t = work.dueTime || {};
  if (t.hours == null && t.minutes == null) {
    return new Date(d.year, d.month - 1, d.day, 23, 59);
  }
  // Classroom stores due dates/times in UTC.
  return new Date(Date.UTC(d.year, d.month - 1, d.day, t.hours || 0, t.minutes || 0));
}

export async function fetchClassroom() {
  const courses = await pages(
    "classroom",
    `${CR}/courses?studentId=me&courseStates=ACTIVE&pageSize=50`,
    "courses",
  );

  const perCourse = await Promise.all(
    courses.map(async (c) => {
      const [work, subs] = await Promise.all([
        pages("classroom", `${CR}/courses/${c.id}/courseWork?pageSize=60`, "courseWork", 2).catch(() => []),
        pages(
          "classroom",
          `${CR}/courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`,
          "studentSubmissions",
          2,
        ).catch(() => []),
      ]);
      const subBy = Object.fromEntries(subs.map((s) => [s.courseWorkId, s]));
      return work.map((w) => {
        const due = dueDateOf(w);
        const sub = subBy[w.id] || {};
        return {
          id: w.id,
          course: c.name,
          courseId: c.id,
          title: w.title,
          link: sub.alternateLink || w.alternateLink,
          due: due ? due.toISOString() : null,
          created: w.creationTime,
          points: w.maxPoints ?? null,
          type: w.workType,
          state: sub.state || "NEW",
          late: !!sub.late,
          grade: sub.assignedGrade ?? null,
        };
      });
    }),
  );

  return {
    fetchedAt: new Date().toISOString(),
    courses: courses.map((c) => ({ id: c.id, name: c.name })),
    work: perCourse.flat(),
  };
}

// ── Calendar ─────────────────────────────────────────────────

const CAL = "https://www.googleapis.com/calendar/v3";

export async function fetchCalendar() {
  const now = new Date();
  const until = new Date(now.getTime() + CONFIG.EVENT_DAYS_AHEAD * 86400000);
  const list = await pages("calendar", `${CAL}/users/me/calendarList?minAccessRole=reader`, "items", 2);
  const cals = list.filter((c) => c.primary || c.selected).slice(0, 15);

  const events = (
    await Promise.all(
      cals.map(async (cal) => {
        const q = new URLSearchParams({
          timeMin: now.toISOString(),
          timeMax: until.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "50",
        });
        const items = await pages(
          "calendar",
          `${CAL}/calendars/${encodeURIComponent(cal.id)}/events?${q}`,
          "items",
          1,
        ).catch(() => []);
        return items
          .filter((e) => e.status !== "cancelled")
          .map((e) => ({
            id: `${cal.id}|${e.id}`,
            calendarId: cal.id,
            calendar: cal.summaryOverride || cal.summary,
            color: cal.backgroundColor,
            title: e.summary || "(No title)",
            allDay: !!e.start?.date,
            start: e.start?.dateTime || e.start?.date,
            end: e.end?.dateTime || e.end?.date,
            location: e.location || "",
            link: e.htmlLink,
          }));
      }),
    )
  ).flat();

  return {
    fetchedAt: new Date().toISOString(),
    calendars: cals.map((c) => ({
      id: c.id,
      name: c.summaryOverride || c.summary,
      color: c.backgroundColor,
    })),
    events,
  };
}
