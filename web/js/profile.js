// Personal details live on this device only (Settings → You), never in the code.
import { CONFIG } from "../config.js";
import { store } from "./util.js";

export function profile() {
  return {
    name: store.get("profile.name", "") || CONFIG.NAME || "",
    schoolEmail: store.get("profile.schoolEmail", "") || CONFIG.SCHOOL_EMAIL || "",
    calendarEmail: store.get("profile.calendarEmail", "") || CONFIG.CALENDAR_EMAIL || "",
  };
}

export function saveProfile({ name, schoolEmail, calendarEmail }) {
  store.set("profile.name", (name || "").trim());
  store.set("profile.schoolEmail", (schoolEmail || "").trim());
  store.set("profile.calendarEmail", (calendarEmail || "").trim());
}
