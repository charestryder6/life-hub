"""Pull today's Garmin stats and write them, encrypted, to web/data/garmin.enc.json.

Environment variables:
  GARMIN_TOKENS    token JSON from get_token.py (GitHub secret)
  HUB_PASSPHRASE   passphrase used to encrypt the output (GitHub secret)
  HUB_TZ           your time zone, e.g. America/Chicago (default America/New_York)

Local test without encryption:  python garmin_sync/sync.py --plain
"""

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from garminconnect import Garmin

sys.path.insert(0, str(Path(__file__).parent))
from crypto_box import decrypt, encrypt  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "web" / "data"
TOKEN_CACHE = ROOT / ".garmin-cache" / "token.enc.json"


def safe(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception as e:  # each metric is optional — keep going
        print(f"  ! {getattr(fn, '__name__', fn)} failed: {type(e).__name__}")
        return default


def login(passphrase: str) -> Garmin:
    candidates = []
    # Newest token first: the one the last run saved (tokens refresh over time).
    if TOKEN_CACHE.exists() and passphrase:
        try:
            candidates.append(("cached", json.dumps(decrypt(json.loads(TOKEN_CACHE.read_text()), passphrase))))
        except Exception as e:
            print(f"  ! cached token unreadable: {type(e).__name__}")
    if os.getenv("GARMIN_TOKENS"):
        candidates.append(("secret", os.environ["GARMIN_TOKENS"].strip()))

    for label, tok in candidates:
        try:
            api = Garmin()
            api.login(tokenstore=tok)
            print(f"Logged in to Garmin with {label} token.")
            return api
        except Exception as e:
            print(f"  ! {label} token failed: {type(e).__name__}")

    if os.getenv("GARMIN_EMAIL") and os.getenv("GARMIN_PASSWORD"):  # local runs only
        api = Garmin(os.environ["GARMIN_EMAIL"], os.environ["GARMIN_PASSWORD"])
        api.login()
        return api
    raise SystemExit("No working Garmin login. Re-run get_token.py and update the GARMIN_TOKENS secret.")


def collect(api: Garmin, tz: str) -> dict:
    now = datetime.now(ZoneInfo(tz))
    today = now.date().isoformat()
    week_start = (now.date() - timedelta(days=6)).isoformat()

    st = safe(api.get_stats, today, default={}) or {}
    sleep = (safe(api.get_sleep_data, today, default={}) or {}).get("dailySleepDTO") or {}
    hrv = (safe(api.get_hrv_data, today, default={}) or {}).get("hrvSummary") or {}
    steps = safe(api.get_daily_steps, week_start, today, default=[]) or []
    acts = safe(api.get_activities, 0, 5, default=[]) or []
    if isinstance(acts, dict):
        acts = acts.get("activityList", [])

    dist = st.get("totalDistanceMeters")
    return {
        "updated": datetime.now(ZoneInfo("UTC")).isoformat(),
        "date": today,
        "today": {
            "steps": st.get("totalSteps"),
            "stepGoal": st.get("dailyStepGoal"),
            "distanceKm": round(dist / 1000, 1) if dist else None,
            "floors": st.get("floorsAscended"),
            "activeCalories": st.get("activeKilocalories"),
            "totalCalories": st.get("totalKilocalories"),
            "restingHR": st.get("restingHeartRate"),
            "minHR": st.get("minHeartRate"),
            "maxHR": st.get("maxHeartRate"),
            "stress": st.get("averageStressLevel") if (st.get("averageStressLevel") or -1) >= 0 else None,
            "bodyBattery": {
                "now": st.get("bodyBatteryMostRecentValue"),
                "high": st.get("bodyBatteryHighestValue"),
                "low": st.get("bodyBatteryLowestValue"),
            },
            "intensityMinutes": {
                "moderate": st.get("moderateIntensityMinutes"),
                "vigorous": st.get("vigorousIntensityMinutes"),
                "weekGoal": st.get("intensityMinutesGoal"),
            },
        },
        "sleep": {
            "seconds": sleep.get("sleepTimeSeconds"),
            "score": ((sleep.get("sleepScores") or {}).get("overall") or {}).get("value"),
            "deep": sleep.get("deepSleepSeconds"),
            "light": sleep.get("lightSleepSeconds"),
            "rem": sleep.get("remSleepSeconds"),
            "awake": sleep.get("awakeSleepSeconds"),
        },
        "hrv": {"lastNight": hrv.get("lastNightAvg"), "status": hrv.get("status")},
        "week": [
            {"date": d.get("calendarDate"), "steps": d.get("totalSteps"), "goal": d.get("stepGoal")}
            for d in steps
        ],
        "activities": [
            {
                "name": a.get("activityName") or (a.get("activityType") or {}).get("typeKey", "Activity"),
                "type": (a.get("activityType") or {}).get("typeKey"),
                "start": a.get("startTimeLocal"),
                "durationMin": round((a.get("duration") or 0) / 60),
                "distanceKm": round(a["distance"] / 1000, 2) if a.get("distance") else None,
                "calories": a.get("calories"),
                "avgHR": round(a["averageHR"]) if a.get("averageHR") else None,
            }
            for a in acts[:5]
        ],
    }


def main():
    plain = "--plain" in sys.argv
    passphrase = os.getenv("HUB_PASSPHRASE", "")
    if not plain and not passphrase:
        print("HUB_PASSPHRASE is not set — skipping Garmin sync.")
        return
    if not plain and not os.getenv("GARMIN_TOKENS") and not TOKEN_CACHE.exists():
        print("GARMIN_TOKENS is not set — skipping Garmin sync.")
        return

    api = login(passphrase)
    data = collect(api, os.getenv("HUB_TZ") or "America/New_York")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if plain:
        (OUT_DIR / "garmin.json").write_text(json.dumps(data, indent=2))
        print(f"Wrote {OUT_DIR / 'garmin.json'} (unencrypted — don't publish this).")
    else:
        (OUT_DIR / "garmin.enc.json").write_text(json.dumps(encrypt(data, passphrase)))
        print("Wrote encrypted Garmin stats.")  # logs are public — never print health data

    # Save the (possibly refreshed) token for the next run, encrypted.
    if passphrase:
        TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_CACHE.write_text(json.dumps(encrypt(json.loads(api.client.dumps()), passphrase)))


if __name__ == "__main__":
    main()
