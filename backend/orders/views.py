from django.http import JsonResponse
from django.views.decorators.http import require_GET

@require_GET
def health(request):
    # Intentionally does not expose credentials, hostnames, or dependency details.
    return JsonResponse({"ok": True, "service": "jowwa-preview-api"})
