// Personal details live on this device only (Settings → You), never in the code.
import { CONFIG } from "../config.js";
import { store } from "./util.js";

export function profile() {
  return {
    name: store.get("profile.name", "") || CONFIG.NAME || "",
    calendarEmail: store.get("profile.calendarEmail", "") || CONFIG.CALENDAR_EMAIL || "",
  };
}

export function saveProfile({ name, calendarEmail }) {
  store.set("profile.name", (name || "").trim());
  store.set("profile.calendarEmail", (calendarEmail || "").trim());
}
