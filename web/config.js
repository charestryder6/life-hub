// ─────────────────────────────────────────────────────────────
//  Hub settings. The only value you MUST fill in is GOOGLE_CLIENT_ID
//  (see README.md → "Step 3: Google sign-in").
//
//  Your name and email addresses are NOT stored here — enter them in the
//  hub under ⚙ Settings → You. They're saved only on your device.
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  // OAuth "Web application" client ID from Google Cloud Console.
  GOOGLE_CLIENT_ID: "PASTE-YOUR-CLIENT-ID.apps.googleusercontent.com",

  // Optional defaults (leave empty to keep this file free of personal info).
  NAME: "",
  SCHOOL_EMAIL: "",
  CALENDAR_EMAIL: "",

  // How many days ahead to show events.
  EVENT_DAYS_AHEAD: 14,

  // Where the encrypted Garmin file is published (written by the GitHub Action).
  GARMIN_DATA_URL: "data/garmin.enc.json",
};
