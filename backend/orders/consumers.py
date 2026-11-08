import json
from channels.generic.websocket import AsyncWebsocketConsumer

class PreviewHealthConsumer(AsyncWebsocketConsumer):
    """Authenticated-session-only transport smoke test; not a production order socket."""
    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4401)
            return
        await self.accept()
        await self.send(text_data=json.dumps({"type": "ready"}))

    async def receive(self, text_data=None, bytes_data=None):
        try:
            payload = json.loads(text_data or "{}")
        except (TypeError, ValueError):
            await self.send(text_data=json.dumps({"type": "error", "code": "invalid_message"}))
            return
        if payload.get("type") == "ping":
            await self.send(text_data=json.dumps({"type": "pong"}))
