from django.urls import re_path
from .consumers import PreviewHealthConsumer

websocket_urlpatterns = [
    re_path(r"^ws/health/$", PreviewHealthConsumer.as_asgi()),
]
