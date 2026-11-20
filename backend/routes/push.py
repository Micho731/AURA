"""Web Push subscription endpoints."""
from fastapi import APIRouter
from pydantic import BaseModel

from services import push

router = APIRouter()


class SubscribeRequest(BaseModel):
    faculty_id: str
    subscription: dict


class UnsubscribeRequest(BaseModel):
    endpoint: str


@router.get("/vapid-public-key")
async def vapid_public_key():
    return {"key": push.VAPID_PUBLIC_KEY, "configured": push.is_configured()}


@router.post("/subscribe")
async def subscribe(req: SubscribeRequest):
    push.save_subscription(req.faculty_id, req.subscription)
    return {"success": True}


@router.post("/unsubscribe")
async def unsubscribe(req: UnsubscribeRequest):
    push.remove_subscription(req.endpoint)
    return {"success": True}
