from django.test import SimpleTestCase
from django.urls import reverse

class HealthEndpointTests(SimpleTestCase):
    def test_health_endpoint_is_available_without_exposing_internals(self):
        response = self.client.get(reverse("health"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True, "service": "jowwa-preview-api"})
