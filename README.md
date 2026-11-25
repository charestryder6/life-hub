# Hub

One home-screen app for:

- **Assignments** from Google Classroom: overdue, due today, the next 7 days, and later
- **Bible reading**: reading plans, a chapter checklist, a streak, a verse of the day, and a built-in reader
- **Upcoming events** from Google Calendar, plus events you add yourself
- **Health** from Garmin: steps, Body Battery, sleep, resting heart rate, stress, HRV, and recent activities

It's a web app you install to the home screen (a PWA). It works on iPhone, Android, and Mac, and it opens full-screen like a normal app.

```
web/            ← the app itself (this is what gets published)
  config.js     ← your settings (Google client ID goes here)
garmin_sync/    ← script that pulls your Garmin stats
.github/        ← automation that publishes the app and refreshes Garmin every 2 hours
```

---

## Step 1: Put it online (free, with GitHub Pages)

The app has to live at an `https://` address for sign-in and home-screen install to work.

1. Make a free account at github.com.
2. Install **GitHub Desktop** (desktop.github.com). It's the easiest way to upload this folder.
3. In GitHub Desktop: **File → Add local repository →** choose this `life-hub` folder. When it asks, choose **create a repository**. Name it `life-hub`. Then **Publish repository** and **untick "Keep this code private"**. Free GitHub Pages needs a public repo. Your Garmin data stays encrypted, and nothing personal is stored in the code.
4. On github.com, open the repo and go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. Open the **Actions** tab. Wait for "Build hub" to turn green. Your hub is now at
   `https://YOUR-USERNAME.github.io/life-hub/`

From then on, any change you push in GitHub Desktop republishes the hub automatically.

## Step 2: Add it to your home screen

- **iPhone:** open the link in **Safari** → Share button → **Add to Home Screen**.
- **Mac:** In Safari, choose **File → Add to Dock**. In Chrome, choose **⋮ → Cast, save, and share → Install page as app**.
- **Android:** In Chrome, choose **⋮ → Add to Home screen**.

The Bible tracker and your own events work right away. Classroom, Calendar, and Garmin need the steps below.

## Step 3: Google sign-in (Classroom + Calendar)

Google requires every app that reads Classroom to have its own "client ID". Here's how to make one (about 10 minutes). Use your **personal Gmail** for this, because school accounts usually aren't allowed to create projects.

1. Go to **console.cloud.google.com** → create a project called `Hub`.
2. **APIs & Services → Library**: enable **Google Classroom API** and **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"):
   - User type: **External**. App name: `Hub`. Add your email as the support and contact email.
   - **Audience / Test users:** add your school email **and** your personal Gmail.
   - Leave the app in **Testing** mode. That's fine for personal use.
4. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized JavaScript origins:** `https://YOUR-USERNAME.github.io`
   - **Authorized redirect URIs:** `https://YOUR-USERNAME.github.io/life-hub/` (the trailing `/` matters)
5. Copy the **Client ID**. Paste it into `web/config.js` as `GOOGLE_CLIENT_ID`. Push the change.
6. Open the hub → **Connect Classroom** → sign in with your school account. Then use **Connect Google Calendar** with whichever account has your events.

**How sign-in works:** Google tokens last an hour. When you open the hub, it quietly gets a new one by bouncing through Google for a second. If Google ever needs you to sign in again, a yellow **Sign in** banner appears.

**If you see "Access blocked: [your school] has not approved this app":** your school's Google admin blocks outside apps. You have two options:
- Ask your school's IT to allow the app. Give them the client ID. It only asks for *read-only* access to your own courses and work.
- Or skip Classroom. Instead, connect **Google Calendar** with your school account. Classroom puts every due date on your class calendars, so assignments still show up under "Upcoming".

## Step 4: Garmin

Garmin doesn't offer a public API for personal apps. So a small script uses the same login as the Garmin Connect app to read your stats. GitHub runs it every 2 hours. It **encrypts** the result with a passphrase that only you know, and the hub decrypts it on your device.

1. On your computer (needs Python, which you already have):
   ```powershell
   cd path\to\life-hub
   python -m pip install -r garmin_sync/requirements.txt
   python garmin_sync/get_token.py
   ```
   Sign in with your Garmin account. It prints a long line of text, which is a login token, not your password.
2. On github.com, open your repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `GARMIN_TOKENS`: paste that whole line
   - `HUB_PASSPHRASE`: make up a long passphrase, for example four random words
3. Same page, **Variables** tab → add `HUB_TZ` = your time zone, for example `America/Chicago` or `America/New_York`.
4. **Actions → Build hub → Run workflow.** When it's green, open the hub and enter your passphrase in the Health card. Do this once on each device.

If Garmin stats stop updating after a few months, run `get_token.py` again and update the `GARMIN_TOKENS` secret.

## Using it

- **Assignments:** tap a title to open it in Classroom. The circle hides an item in the hub only (useful for paper assignments). It doesn't turn anything in.
- **Bible:** tap the circle next to a chapter to check it off. Tap the chapter name to read it right there (World English Bible). **All books** shows every chapter, and **Change plan** switches plans (whole Bible in a year, New Testament in 90 days, Gospels in 30 days, Psalms & Proverbs in 60 days, or free reading).
- **Events:** **Add event** for things that aren't on a calendar. In ⚙ Settings, choose which calendars to show.
- Your reading progress and added events are saved **on each device**. A phone and a laptop each keep their own copy.

## Changing settings

Edit `web/config.js`: your name, the school email, the calendar account, and how many days of events to show.

## Privacy

- Google access is **read-only**. Tokens stay in your browser and are never sent anywhere except Google.
- Garmin data is published only as an AES-256 encrypted file. Without your passphrase it's unreadable.
- Your Garmin token is stored as an encrypted GitHub secret and is never committed to the repo.
