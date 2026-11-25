// Bible reading tracker: reading plans, chapter checklist, streaks,
// verse of the day and an in-app chapter reader (World English Bible,
// public domain, served by bible-api.com).

import { store, esc, dateKey, parseDateKey, addDays, dayDiff } from "./util.js";

export const BOOKS = [
  ["Genesis", 50], ["Exodus", 40], ["Leviticus", 27], ["Numbers", 36], ["Deuteronomy", 34],
  ["Joshua", 24], ["Judges", 21], ["Ruth", 4], ["1 Samuel", 31], ["2 Samuel", 24],
  ["1 Kings", 22], ["2 Kings", 25], ["1 Chronicles", 29], ["2 Chronicles", 36], ["Ezra", 10],
  ["Nehemiah", 13], ["Esther", 10], ["Job", 42], ["Psalms", 150], ["Proverbs", 31],
  ["Ecclesiastes", 12], ["Song of Solomon", 8], ["Isaiah", 66], ["Jeremiah", 52],
  ["Lamentations", 5], ["Ezekiel", 48], ["Daniel", 12], ["Hosea", 14], ["Joel", 3],
  ["Amos", 9], ["Obadiah", 1], ["Jonah", 4], ["Micah", 7], ["Nahum", 3], ["Habakkuk", 3],
  ["Zephaniah", 3], ["Haggai", 2], ["Zechariah", 14], ["Malachi", 4],
  ["Matthew", 28], ["Mark", 16], ["Luke", 24], ["John", 21], ["Acts", 28], ["Romans", 16],
  ["1 Corinthians", 16], ["2 Corinthians", 13], ["Galatians", 6], ["Ephesians", 6],
  ["Philippians", 4], ["Colossians", 4], ["1 Thessalonians", 5], ["2 Thessalonians", 3],
  ["1 Timothy", 6], ["2 Timothy", 4], ["Titus", 3], ["Philemon", 1], ["Hebrews", 13],
  ["James", 5], ["1 Peter", 5], ["2 Peter", 3], ["1 John", 5], ["2 John", 1], ["3 John", 1],
  ["Jude", 1], ["Revelation", 22],
];

const ALL = BOOKS.flatMap(([book, n], bi) =>
  Array.from({ length: n }, (_, i) => ({ book, ch: i + 1, nt: bi >= 39 })),
);
export const chKey = (c) => `${c.book} ${c.ch}`;

const inBooks = (...names) => ALL.filter((c) => names.includes(c.book));

export const PLANS = {
  year: { name: "Whole Bible in a year", days: 365, chapters: ALL },
  nt90: { name: "New Testament in 90 days", days: 90, chapters: ALL.filter((c) => c.nt) },
  gospels30: { name: "The Gospels in 30 days", days: 30, chapters: inBooks("Matthew", "Mark", "Luke", "John") },
  wisdom60: { name: "Psalms & Proverbs in 60 days", days: 60, chapters: inBooks("Psalms", "Proverbs") },
  free: { name: "Free reading (no schedule)", days: 0, chapters: ALL },
};

// A rotating set of well-known verses for "Verse of the day".
const VOTD = [
  "John 3:16", "Philippians 4:13", "Jeremiah 29:11", "Proverbs 3:5-6", "Romans 8:28",
  "Isaiah 41:10", "Joshua 1:9", "Psalm 23:1-3", "Matthew 11:28-30", "2 Timothy 1:7",
  "Romans 12:2", "Galatians 5:22-23", "Psalm 46:1", "1 Corinthians 10:13", "Ephesians 2:8-9",
  "Hebrews 11:1", "James 1:5", "Psalm 119:105", "Isaiah 40:31", "Matthew 6:33",
  "Colossians 3:23", "1 Peter 5:7", "Lamentations 3:22-23", "Micah 6:8", "Psalm 37:4",
  "Romans 5:8", "2 Corinthians 5:17", "John 14:6", "Proverbs 16:3", "Deuteronomy 31:6",
  "Psalm 139:14", "1 John 4:19", "Romans 15:13", "Philippians 4:6-7", "Matthew 5:16",
  "Zephaniah 3:17", "Psalm 118:24", "Hebrews 12:1-2", "John 16:33", "Isaiah 26:3",
];

// ── State ────────────────────────────────────────────────────

function load() {
  return store.get("bible", null) || { plan: "year", start: dateKey(), read: {}, log: {} };
}
function save(s) {
  store.set("bible", s);
}

export function setPlan(planId, startKey = dateKey()) {
  const s = load();
  s.plan = planId;
  s.start = startKey;
  save(s);
}

export function toggleChapter(key, forceRead) {
  const s = load();
  const today = dateKey();
  const isRead = !!s.read[key];
  const makeRead = forceRead ?? !isRead;
  if (makeRead && !isRead) {
    s.read[key] = today;
    s.log[today] = (s.log[today] || 0) + 1;
  } else if (!makeRead && isRead) {
    const when = s.read[key];
    delete s.read[key];
    if (s.log[when]) s.log[when] = Math.max(0, s.log[when] - 1);
    if (!s.log[when]) delete s.log[when];
  }
  save(s);
  return makeRead;
}

export function streak(s = load()) {
  let day = new Date();
  if (!s.log[dateKey(day)]) day = addDays(day, -1); // today not read yet: streak still alive
  let n = 0;
  while (s.log[dateKey(day)]) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function summary() {
  const s = load();
  const plan = PLANS[s.plan] || PLANS.year;
  const N = plan.chapters.length;
  const readCount = plan.chapters.filter((c) => s.read[chKey(c)]).length;
  const nextUp = plan.chapters.find((c) => !s.read[chKey(c)]) || null;

  let today = [];
  let behind = 0;
  let dayNum = null;
  if (plan.days) {
    const i = dayDiff(parseDateKey(s.start), new Date());
    dayNum = i + 1;
    if (i >= 0 && i < plan.days) {
      const from = Math.floor((i * N) / plan.days);
      const to = Math.floor(((i + 1) * N) / plan.days);
      today = plan.chapters.slice(from, to);
      behind = plan.chapters.slice(0, from).filter((c) => !s.read[chKey(c)]).length;
    } else if (i >= plan.days) {
      behind = N - readCount;
    }
  } else if (nextUp) {
    today = [nextUp];
  }

  return {
    state: s,
    plan,
    planId: s.plan,
    total: N,
    readCount,
    pct: N ? Math.round((readCount / N) * 100) : 0,
    today,
    todayDone: today.filter((c) => s.read[chKey(c)]).length,
    behind,
    dayNum,
    nextUp,
    streak: streak(s),
    readToday: s.log[dateKey()] || 0,
  };
}

// ── Remote text (bible-api.com, WEB translation) ─────────────

async function fetchPassage(ref) {
  const res = await fetch(`https://bible-api.com/${encodeURIComponent(ref)}?translation=web`);
  if (!res.ok) throw new Error(`Couldn't load ${ref}`);
  return res.json();
}

export async function verseOfTheDay() {
  const today = dateKey();
  const cached = store.get("votd", null);
  if (cached && cached.date === today) return cached;
  const doy = dayDiff(new Date(new Date().getFullYear(), 0, 1), new Date());
  const ref = VOTD[doy % VOTD.length];
  const data = await fetchPassage(ref);
  const out = {
    date: today,
    ref: data.reference || ref,
    text: (data.text || "").replace(/\s+/g, " ").trim(),
  };
  store.set("votd", out);
  return out;
}

export async function chapterText(book, ch) {
  const data = await fetchPassage(`${book} ${ch}`);
  return data.verses || [];
}

// ── Rendering ────────────────────────────────────────────────

export function renderBible(el) {
  const s = summary();
  const chips = s.today
    .map((c) => {
      const k = chKey(c);
      const done = !!s.state.read[k];
      return `<span class="chip ${done ? "done" : ""}">
        <button class="chip-check" data-toggle="${esc(k)}" aria-label="${done ? "Unmark" : "Mark"} ${esc(k)} as read">${done ? "✓" : ""}</button>
        <button class="chip-label" data-read="${esc(k)}">${esc(k)}</button>
      </span>`;
    })
    .join("");

  let status = "";
  if (s.plan.days && s.dayNum > s.plan.days) {
    status = s.behind
      ? `Plan period finished — ${s.behind} chapters left to finish it.`
      : "Plan complete. Well done!";
  } else if (s.behind > 0) {
    status = `${s.behind} chapter${s.behind === 1 ? "" : "s"} to catch up on`;
  } else if (s.today.length && s.todayDone === s.today.length) {
    status = "Today's reading is done.";
  }

  el.innerHTML = `
    <div class="bible-top">
      <div>
        <div class="muted small">${esc(s.plan.name)}${s.plan.days && s.dayNum > 0 && s.dayNum <= s.plan.days ? ` · Day ${s.dayNum} of ${s.plan.days}` : ""}</div>
        <div class="progress" role="progressbar" aria-valuenow="${s.pct}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${s.pct}%"></span>
        </div>
        <div class="muted small">${s.readCount} of ${s.total} chapters · ${s.pct}%</div>
      </div>
      <div class="streak" title="Days in a row with reading">
        <strong>${s.streak}</strong><span>day streak</span>
      </div>
    </div>

    <div class="section-label">${s.plan.days ? "Today's reading" : "Up next"}</div>
    <div class="chips">${chips || `<span class="muted">Nothing scheduled.</span>`}</div>
    ${status ? `<div class="note ${s.behind ? "warn" : "ok"}">${esc(status)}</div>` : ""}

    <div class="votd" id="votd"><span class="muted small">Loading verse of the day…</span></div>

    <div class="row-actions">
      ${s.nextUp ? `<button class="btn primary" data-read="${esc(chKey(s.nextUp))}">Read ${esc(chKey(s.nextUp))}</button>` : ""}
      <button class="btn" data-action="bible-browse">All books</button>
      <button class="btn ghost" data-action="bible-plan">Change plan</button>
    </div>`;

  verseOfTheDay()
    .then((v) => {
      const box = el.querySelector("#votd");
      if (box) box.innerHTML = `<div class="section-label">Verse of the day</div>
        <blockquote>${esc(v.text)}</blockquote><div class="muted small">— ${esc(v.ref)} (WEB)</div>`;
    })
    .catch(() => {
      const box = el.querySelector("#votd");
      if (box) box.innerHTML = "";
    });
}

export function renderBrowser() {
  const s = load();
  return BOOKS.map(([book, n], bi) => {
    const done = Array.from({ length: n }, (_, i) => !!s.read[`${book} ${i + 1}`]);
    const count = done.filter(Boolean).length;
    const cells = done
      .map((d, i) => `<button class="cell ${d ? "done" : ""}" data-toggle="${esc(`${book} ${i + 1}`)}">${i + 1}</button>`)
      .join("");
    return `${bi === 0 ? '<h3 class="testament">Old Testament</h3>' : ""}${bi === 39 ? '<h3 class="testament">New Testament</h3>' : ""}
      <details class="book">
        <summary><span>${esc(book)}</span><span class="muted small">${count}/${n}</span></summary>
        <div class="cells">${cells}</div>
      </details>`;
  }).join("");
}

export function nextChapterAfter(key) {
  const i = ALL.findIndex((c) => chKey(c) === key);
  return i >= 0 && i < ALL.length - 1 ? chKey(ALL[i + 1]) : null;
}

export function splitKey(key) {
  const m = key.match(/^(.*) (\d+)$/);
  return { book: m[1], ch: Number(m[2]) };
}

export const isRead = (key) => !!load().read[key];
