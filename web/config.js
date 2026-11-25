// ─────────────────────────────────────────────────────────────
//  Hub settings. GOOGLE_CLIENT_ID is only needed if you want to connect a
//  Google Calendar (see README.md → "Step 3: Google Calendar").
//
//  Your name and email address are NOT stored here — enter them in the
//  hub under ⚙ Settings → You. They're saved only on your device.
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  // OAuth "Web application" client ID from Google Cloud Console.
  GOOGLE_CLIENT_ID: "201926687553-lccln02pvlnmrgk8pq77i375b4gdnlc8.apps.googleusercontent.com",

  // Optional defaults (leave empty to keep this file free of personal info).
  NAME: "",
  CALENDAR_EMAIL: "",

  // How many days ahead to show events.
  EVENT_DAYS_AHEAD: 14,

  // Where the encrypted Garmin file is published (written by the GitHub Action).
  GARMIN_DATA_URL: "data/garmin.enc.json",

  // Encrypted Apple Reminders + iPhone Calendar (sent by the "Hub Sync" Shortcut).
  APPLE_DATA_URL: "data/apple.enc.json",
};
