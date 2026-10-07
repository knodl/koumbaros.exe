"""Ping Telegram when free slots appear on Limassol District Admin SimplyBook.

Env: TG_TOKEN, TG_CHAT_ID. Optional: DAYS_AHEAD (default 120), STATE (default state.json).
"""
import datetime as dt
import json
import os
import urllib.parse
import urllib.request

BASE = "https://limassoldistrictadmin.simplybook.it/v2"
SERVICE, PROVIDER = 8, 10
LINK = BASE + "/#book/service/{s}/count/1/provider/{p}/date/{d}/"
STATE = os.environ.get("STATE", "state.json")


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def free_dates(days_ahead):
    today = dt.date.today()
    found = set()
    # API rejects ranges longer than ~30 days ("Too long period")
    for start in range(0, days_ahead, 30):
        a = today + dt.timedelta(days=start)
        b = a + dt.timedelta(days=29)
        q = urllib.parse.urlencode({"from": a, "to": b, "location": "", "category": "",
                                    "provider": PROVIDER, "service": SERVICE, "count": 1})
        slots = get_json(f"{BASE}/booking/time-slots/?{q}")
        if isinstance(slots, dict):  # {"error": ...}
            raise RuntimeError(slots)
        found |= {s["date"] for s in slots if s["type"] == "free"}
    return found


def send(text):
    data = urllib.parse.urlencode({"chat_id": os.environ["TG_CHAT_ID"], "text": text,
                                   "disable_web_page_preview": "true"}).encode()
    urllib.request.urlopen(f"https://api.telegram.org/bot{os.environ['TG_TOKEN']}/sendMessage", data, timeout=30)


def main():
    now = free_dates(int(os.environ.get("DAYS_AHEAD", 120)))
    try:
        with open(STATE) as f:
            prev = set(json.load(f))
    except FileNotFoundError:
        prev = set()
    new = sorted(now - prev)
    if new:
        send("Free slots:\n" + "\n".join(f"{d}: {LINK.format(s=SERVICE, p=PROVIDER, d=d)}" for d in new))
    with open(STATE, "w") as f:
        json.dump(sorted(now), f)
    print("free:", sorted(now), "new:", new)


if __name__ == "__main__":
    main()
