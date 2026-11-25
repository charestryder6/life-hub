# Hub

One home-screen app for:

- **Assignments** from a *School* list in Apple Reminders, sorted by due date or by urgency (priority)
- **Bible reading**: reading plans, a chapter checklist, a streak, a verse of the day, and a built-in reader
- **Upcoming events** from your iPhone calendar (and optionally Google Calendar), plus events you add yourself
- **Reminders**: everything else in the Apple Reminders app
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

The Bible tracker and your own events work right away. Assignments, Reminders, your iPhone calendar, and Garmin need the steps below.

## Step 3: Google Calendar (optional)

Your iPhone calendar already comes in through the Shortcut in Step 5, so you can skip this step. Do it only if you also want a Google Calendar that isn't on your iPhone.

1. Go to **console.cloud.google.com** with your **personal Gmail** → create a project called `Hub`.
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **OAuth consent screen**: User type **External**, app name `Hub`, add your Gmail as a **test user**, and leave it in **Testing** mode.
4. **Credentials → Create credentials → OAuth client ID**: choose **Web application**.
   - **Authorized JavaScript origins:** `https://YOUR-USERNAME.github.io`
   - **Authorized redirect URIs:** `https://YOUR-USERNAME.github.io/life-hub/` (the trailing `/` matters)
5. Paste the **Client ID** into `web/config.js` as `GOOGLE_CLIENT_ID`, then push the change.
6. In the hub, open **⋯ → Settings → Google Calendar → Connect**.

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

## Step 5: Apple Reminders + iPhone Calendar

Apple doesn't let websites read Reminders, so an iPhone **Shortcut** sends them (plus the next 14 days of your iPhone calendar) to GitHub. GitHub encrypts them with your hub passphrase, the same as Garmin. Do Step 4's `HUB_PASSPHRASE` secret first.

**A. Make a GitHub key the Shortcut can use** (on github.com):
**Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
- Name: `Hub Sync`. Expiration: 1 year.
- Repository access: **Only select repositories → life-hub**
- Permissions → Repository permissions → **Contents: Read and write** (needed to send data to the repo)
- Generate it and copy it. You'll paste it into the Shortcut in step B. Don't share it.

**B. Build the Shortcut** (iPhone → Shortcuts app → **+**). Name it exactly **Hub Sync**. Add these actions in order:

1. **Find Reminders** → tap *Add Filter* → **Is Completed** · *is not* · on. Leave everything else as is.
2. **Repeat with Each** (it fills in *Reminders*). Inside the repeat, add a **Text** action and build this line. The parts in [brackets] are variables: tap *Repeat Item*, then pick the property.
   `R|`[Repeat Item → **Title**]`|`[Repeat Item → **Due Date**]`|`[Repeat Item → **List**]`|`[Repeat Item → **Priority**]`|`[Repeat Item → **Is Flagged**]
   For Due Date, tap the variable → **Date Format: ISO 8601** → turn **Include ISO 8601 Time** on.
3. After *End Repeat*: **Combine Text** → *Repeat Results* with **New Lines**. Then **Set Variable** → name it `Reminders Text`.
4. **Find Calendar Events** → Add Filter → **Start Date** · *is in the next* · **14 days**.
5. **Repeat with Each** (Calendar Events). Inside, add a **Text** action:
   `E|`[**Title**]`|`[**Start Date**]`|`[**End Date**]`|`[**Is All Day**]`|`[**Calendar**]`|`[**Location**]
   Set both dates to **ISO 8601** with time, as in step 2.
6. After *End Repeat*: **Combine Text** → *Repeat Results* with **New Lines**.
7. **Text** action with two lines: [`Reminders Text`] on the first line, [*Combined Text*] on the second.
8. **Get Contents of URL**:
   - URL: `https://api.github.com/repos/charestryder6/life-hub/dispatches`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer ` + your token from step A (keep the space after *Bearer*), and `Accept` = `application/vnd.github+json`
   - Request Body: **JSON**. Add field `event_type` (Text) = `apple`. Add field `client_payload` (**Dictionary**). Inside it, add `text` (Text) = the *Text* from step 7.

Tap ▶ to test. The first run asks permission for Reminders and Calendar, so allow both. After about 1–2 minutes the hub's **Reminders** card fills in.

**C. Make it run by itself** (Shortcuts → **Automation** → **+**):
- **App** → choose *Reminders* and *Calendar* → **Is Closed** → **Run Immediately** → *Hub Sync*. Now it updates every time you leave those apps.
- **Time of Day** → 6:00 AM → Daily → **Run Immediately** → *Hub Sync*.

The hub's **Sync from iPhone** button also runs the Shortcut on demand (iPhone only).

## Using it

- **Assignments:** in the Reminders app, make a list called **School** and add each assignment there. Give it a **due date** and a **priority** (None / Low `!` / Medium `!!` / High `!!!`), and flag anything extra important. To change a due date or urgency, edit the reminder in Reminders. It updates here on the next sync. In the hub, switch between **By due date** and **By urgency**. Tapping an assignment on iPhone or Mac opens Reminders. The circle hides an item in the hub only, so complete it in Reminders to clear it everywhere. To count other lists as school (one list per class works well), turn them on in **⋯ → Settings → Assignments**.
- **Bible:** tap the circle next to a chapter to check it off. Tap the chapter name to read it right there (World English Bible). **All books** shows every chapter, and **Change plan** switches plans (whole Bible in a year, New Testament in 90 days, Gospels in 30 days, Psalms & Proverbs in 60 days, or free reading).
- **Events:** **Add event** for things that aren't on a calendar. In ⚙ Settings, choose which calendars to show.
- Your reading progress and added events are saved **on each device**. A phone and a laptop each keep their own copy.

## Changing settings

Your name, assignment lists, calendars, and reading plan are in **⋯ → Settings** in the hub. Each device saves its own. `web/config.js` holds the Google client ID and how many days of events to show.

## Privacy

- Google access is **read-only**. Tokens stay in your browser and are never sent anywhere except Google.
- Garmin data is published only as an AES-256 encrypted file. Without your passphrase it's unreadable.
- Your Garmin token is stored as an encrypted GitHub secret and is never committed to the repo.
