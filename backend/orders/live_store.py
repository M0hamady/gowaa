"""MongoDB persistence helpers for preview-only courier location documents."""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from django.conf import settings
from pymongo import ASCENDING, DESCENDING, GEOSPHERE, MongoClient

@lru_cache(maxsize=1)
def get_database():
    if not settings.MONGODB_URI:
        raise RuntimeError("MONGODB_URI is not configured")
    client = MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=5000)
    db = client[settings.MONGODB_DATABASE]
    db.courier_locations.create_index([("location", GEOSPHERE)])
    db.courier_locations.create_index([("courier_id", ASCENDING), ("recorded_at", DESCENDING)])
    # Preview-only retention. Production retention must be approved separately.
    db.courier_locations.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    db.live_events.create_index([("created_at", DESCENDING)])
    return db

def record_courier_location(*, courier_id, order_id, latitude, longitude, accuracy_m=None):
    """Persist one point. The caller MUST authorize courier/order ownership first."""
    lat, lon = float(latitude), float(longitude)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Invalid GPS coordinates")
    now = datetime.now(timezone.utc)
    doc = {
        "courier_id": str(courier_id),
        "order_id": str(order_id),
        "location": {"type": "Point", "coordinates": [lon, lat]},
        "accuracy_m": float(accuracy_m) if accuracy_m is not None else None,
        "recorded_at": now,
        "expires_at": now + timedelta(days=30),
    }
    get_database().courier_locations.insert_one(doc)
    return doc
