"""Turn the text sent by the "Hub Sync" iPhone Shortcut into an encrypted file.

The Shortcut sends one item per line:
  R|<title>|<due date, ISO 8601 or empty>|<list name>|<priority>|<flagged Yes/No>
  E|<title>|<start ISO>|<end ISO>|<all-day Yes/No>|<calendar>|<location>

Priority may be None/Low/Medium/High, !/!!/!!!, or Apple's 0-9 number.

Env: APPLE_TEXT (the lines), HUB_PASSPHRASE. Writes .apple-cache/apple.enc.json.
Nothing from the data is printed — Action logs are public.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from crypto_box import encrypt  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / ".apple-cache" / "apple.enc.json"


def iso(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return None


def has_time(s):
    try:
        d = datetime.fromisoformat(s)
        return (d.hour, d.minute) != (0, 0)
    except (TypeError, ValueError):
        return False


def priority(s):
    """0 = none, 1 = low, 2 = medium, 3 = high."""
    s = (s or "").strip().lower()
    names = {"high": 3, "medium": 2, "med": 2, "low": 1, "!!!": 3, "!!": 2, "!": 1}
    if s in names:
        return names[s]
    if s.isdigit():  # Apple stores 1-4 = high, 5 = medium, 6-9 = low, 0 = none
        n = int(s)
        return 0 if n == 0 else 3 if n <= 4 else 2 if n == 5 else 1
    return 0


def yes(s):
    return (s or "").strip().lower() in ("yes", "true", "1", "on")


def parse(text):
    reminders, events = [], []
    for raw in text.splitlines():
        parts = [p.strip() for p in raw.split("|")]
        if parts[0] == "R" and len(parts) >= 2 and parts[1]:
            due = iso(parts[2] if len(parts) > 2 else "")
            reminders.append({
                "title": parts[1],
                "due": due,
                "hasTime": has_time(due),
                "list": parts[3] if len(parts) > 3 else "",
                "priority": priority(parts[4] if len(parts) > 4 else ""),
                "flagged": yes(parts[5] if len(parts) > 5 else ""),
            })
        elif parts[0] == "E" and len(parts) >= 3 and parts[1]:
            start = iso(parts[2])
            if not start:
                continue
            events.append({
                "title": parts[1],
                "start": start,
                "end": iso(parts[3] if len(parts) > 3 else "") or start,
                "allDay": yes(parts[4] if len(parts) > 4 else ""),
                "calendar": parts[5] if len(parts) > 5 else "",
                "location": parts[6] if len(parts) > 6 else "",
            })
    return reminders[:300], events[:300]


def main():
    passphrase = os.getenv("HUB_PASSPHRASE", "")
    if not passphrase:
        raise SystemExit("HUB_PASSPHRASE is not set.")
    reminders, events = parse(os.getenv("APPLE_TEXT", ""))
    data = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "reminders": reminders,
        "events": events,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(encrypt(data, passphrase)))
    print(f"Stored {len(reminders)} reminders and {len(events)} events (encrypted).")


if __name__ == "__main__":
    main()
