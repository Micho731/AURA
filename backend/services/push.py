"""Web Push (VAPID) — notify instructors of new appointment requests even when the app is closed.

Background delivery requires the site be served over HTTPS; on plain http the frontend skips
subscribing and uses in-app notifications instead. This module is a no-op if VAPID keys aren't set,
so the kiosk never breaks for lack of push config.
"""
import json
import os

import db

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@aust.edu.lb")


def is_configured() -> bool:
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def save_subscription(faculty_id: str, subscription: dict) -> None:
    db.save_push_subscription(faculty_id, subscription)


def remove_subscription(endpoint: str) -> None:
    db.remove_push_subscription(endpoint)


def send_to_faculty(faculty_id: str, title: str, body: str, data: dict | None = None) -> int:
    """Send a push to all of an instructor's subscriptions. Returns count delivered. Best-effort."""
    if not is_configured():
        return 0
    try:
        from pywebpush import webpush, WebPushException
    except Exception as e:
        print(f"[push] pywebpush not available: {e}")
        return 0

    payload = json.dumps({"title": title, "body": body, "data": data or {}})
    sent = 0
    for row in db.list_push_subscriptions(faculty_id):
        sub = row.get("subscription") or {}
        try:
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT},
            )
            sent += 1
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):  # subscription expired/gone — prune it
                db.remove_push_subscription(sub.get("endpoint", ""))
            else:
                print(f"[push] send failed: {e}")
        except Exception as e:
            print(f"[push] unexpected: {e}")
    return sent
