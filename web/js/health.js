// Garmin health card. The data file is produced by garmin_sync/sync.py
// (run by the GitHub Action) and is AES-GCM encrypted with your passphrase,
// so it's safe to sit on a public web host. It's decrypted here in the browser.

import { CONFIG } from "../config.js";
import { store, esc, fmtNum, timeAgo, parseDateKey } from "./util.js";

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function decrypt(payload, passphrase) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64(payload.salt), iterations: payload.iter || 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(payload.iv) }, key, b64(payload.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

export const getPassphrase = () => store.get("garmin.passphrase", "");
export const setPassphrase = (p) => (p ? store.set("garmin.passphrase", p) : store.del("garmin.passphrase"));

/** Returns { data } or { error, needsPassphrase }. Falls back to the last good copy. */
export async function loadHealth() {
  let payload;
  try {
    const res = await fetch(`${CONFIG.GARMIN_DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("not found");
    payload = await res.json();
  } catch {
    const cached = store.get("garmin.cache", null);
    return cached ? { data: cached, stale: true } : { error: "No Garmin data published yet." };
  }

  if (!payload.ct) {
    store.set("garmin.cache", payload);
    return { data: payload };
  }
  const pass = getPassphrase();
  if (!pass) return { needsPassphrase: true };
  try {
    const data = await decrypt(payload, pass);
    store.set("garmin.cache", data);
    return { data };
  } catch {
    return { needsPassphrase: true, error: "That passphrase didn't unlock the Garmin data." };
  }
}

function ring(value, goal, label) {
  const pct = goal ? Math.min(1, value / goal) : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  return `<div class="ring" role="img" aria-label="${esc(label)}">
    <svg viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="${r}" class="ring-bg"/>
      <circle cx="50" cy="50" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
    </svg>
    <div class="ring-text"><strong>${fmtNum(value)}</strong><span>of ${fmtNum(goal)} steps</span></div>
  </div>`;
}

const hm = (sec) => (sec ? `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m` : "–");

function stat(label, value, sub = "") {
  return `<div class="stat"><div class="muted small">${esc(label)}</div><div class="stat-v">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>`;
}

function weekBars(week = []) {
  if (!week.length) return "";
  const max = Math.max(...week.map((d) => Math.max(d.steps || 0, d.goal || 0)), 1);
  const bars = week
    .map((d) => {
      const h = Math.round(((d.steps || 0) / max) * 100);
      const hit = d.goal && d.steps >= d.goal;
      const day = parseDateKey(d.date).toLocaleDateString(undefined, { weekday: "narrow" });
      return `<div class="bar-col" title="${esc(d.date)}: ${fmtNum(d.steps)} steps">
        <div class="bar ${hit ? "hit" : ""}" style="height:${h}%"></div><span>${esc(day)}</span></div>`;
    })
    .join("");
  return `<div class="section-label">Steps, last 7 days</div><div class="bars">${bars}</div>`;
}

export function renderHealth(el, result) {
  if (!result) {
    el.innerHTML = `<p class="muted">Loading Garmin data…</p>`;
    return;
  }
  if (result.needsPassphrase) {
    el.innerHTML = `
      ${result.error ? `<div class="note warn">${esc(result.error)}</div>` : `<p class="muted">Enter your hub passphrase to unlock your Garmin stats on this device.</p>`}
      <form class="inline-form" data-form="passphrase">
        <input type="password" name="pass" placeholder="Hub passphrase" autocomplete="current-password" required>
        <button class="btn primary">Unlock</button>
      </form>`;
    return;
  }
  if (result.error && !result.data) {
    el.innerHTML = `<p class="muted">${esc(result.error)} Set up the Garmin sync (README → Step 4) and your stats will show up here.</p>`;
    return;
  }

  const d = result.data;
  const t = d.today || {};
  const s = d.sleep || {};
  const bb = t.bodyBattery || {};
  const im = t.intensityMinutes || {};
  const acts = (d.activities || []).slice(0, 3);

  el.innerHTML = `
    <div class="health-top">
      ${ring(t.steps || 0, t.stepGoal || 10000, "Steps today")}
      <div class="stats">
        ${stat("Body Battery", bb.now ?? "–", bb.high != null ? `high ${bb.high} · low ${bb.low}` : "")}
        ${stat("Sleep", hm(s.seconds), s.score ? `score ${s.score}` : "")}
        ${stat("Resting HR", t.restingHR ? `${t.restingHR}<small> bpm</small>` : "–")}
        ${stat("Stress", t.stress ?? "–", t.stress != null ? "avg today" : "")}
        ${stat("Active cal", fmtNum(t.activeCalories))}
        ${stat("Intensity min", fmtNum((im.moderate || 0) + 2 * (im.vigorous || 0)), im.weekGoal ? `goal ${im.weekGoal}/wk` : "")}
        ${d.hrv?.lastNight ? stat("HRV", `${d.hrv.lastNight}<small> ms</small>`, esc((d.hrv.status || "").toLowerCase())) : ""}
        ${t.distanceKm ? stat("Distance", `${t.distanceKm}<small> km</small>`) : ""}
      </div>
    </div>
    ${weekBars(d.week)}
    ${
      acts.length
        ? `<div class="section-label">Recent activities</div><ul class="acts">${acts
            .map(
              (a) => `<li><strong>${esc(a.name)}</strong>
                <span class="muted small">${esc(new Date(a.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}
                · ${a.durationMin} min${a.distanceKm ? ` · ${a.distanceKm} km` : ""}${a.avgHR ? ` · ${a.avgHR} bpm` : ""}</span></li>`,
            )
            .join("")}</ul>`
        : ""
    }
    <div class="card-foot muted small">Synced from Garmin ${esc(timeAgo(d.updated))}${result.stale ? " (offline copy)" : ""}</div>`;
}
