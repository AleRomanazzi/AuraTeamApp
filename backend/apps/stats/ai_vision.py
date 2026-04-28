import base64
import json
import logging
import os
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def _extract_json_obj(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    m = re.search(r'\{[\s\S]*\}', text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _call_anthropic(
    api_key: str,
    model: str,
    antes: list[tuple[bytes, str]],
    despues: list[tuple[bytes, str]],
) -> dict[str, Any] | None:
    content: list[dict[str, Any]] = []
    for raw, mime in antes:
        b64 = base64.standard_b64encode(raw).decode('ascii')
        content.append({'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': b64}})
    for raw, mime in despues:
        b64 = base64.standard_b64encode(raw).decode('ascii')
        content.append({'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': b64}})
    prompt = (
        'Analizá estas capturas de estadísticas de redes sociales (primeras imágenes = período ANTERIOR, siguientes = RECIENTE). '
        'Extraé métricas numéricas comparables. Respondé SOLAMENTE con un JSON válido sin markdown:\n'
        '{"plataforma":"Instagram o similar","metricas":[{"nombre":"Seguidores","antes":100,"despues":120,"variacion":"+20%"}], '
        '"interpretacion":"Texto breve en español"}'
    )
    content.append({'type': 'text', 'text': prompt})
    payload = {
        'model': model,
        'max_tokens': 4096,
        'messages': [{'role': 'user', 'content': content}],
    }
    with httpx.Client(timeout=120.0) as client:
        r = client.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
    blocks = data.get('content') or []
    text = ''
    for b in blocks:
        if b.get('type') == 'text':
            text += b.get('text', '')
    return _extract_json_obj(text)


def _call_openai(
    api_key: str,
    model: str,
    antes: list[tuple[bytes, str]],
    despues: list[tuple[bytes, str]],
) -> dict[str, Any] | None:
    parts: list[dict[str, Any]] = [{'type': 'text', 'text': 'Imágenes período ANTERIOR (referencia más vieja):'}]
    for raw, mime in antes:
        b64 = base64.standard_b64encode(raw).decode('ascii')
        parts.append({'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{b64}'}})
    parts.append({'type': 'text', 'text': 'Imágenes período RECIENTE:'})
    for raw, mime in despues:
        b64 = base64.standard_b64encode(raw).decode('ascii')
        parts.append({'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{b64}'}})
    parts.append(
        {
            'type': 'text',
            'text': (
                'Analizá las capturas. Respondé solo JSON: '
                '{"plataforma":"...","metricas":[{"nombre":"...","antes":0,"despues":0,"variacion":"..."}], '
                '"interpretacion":"..."}'
            ),
        }
    )
    payload = {
        'model': model,
        'max_tokens': 4096,
        'messages': [{'role': 'user', 'content': parts}],
    }
    with httpx.Client(timeout=120.0) as client:
        r = client.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'content-type': 'application/json'},
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
    text = (data.get('choices') or [{}])[0].get('message', {}).get('content') or ''
    return _extract_json_obj(text)


def analyze_screenshots(
    antes: list[tuple[bytes, str]],
    despues: list[tuple[bytes, str]],
) -> tuple[list | None, str, str]:
    """
    Devuelve (metricas, interpretacion, plataforma).
    Si metricas es None, interpretacion contiene el mensaje de error.
    """
    provider = (os.getenv('AI_PROVIDER') or '').strip().lower()
    api_key = (os.getenv('AI_API_KEY') or '').strip()
    if not api_key or provider not in ('openai', 'anthropic'):
        return None, 'Configura AI_PROVIDER=openai|anthropic y AI_API_KEY en el servidor.', ''

    model = (os.getenv('AI_MODEL') or '').strip()
    if not model:
        model = 'gpt-4o-mini' if provider == 'openai' else 'claude-3-5-sonnet-20241022'

    try:
        if provider == 'anthropic':
            parsed = _call_anthropic(api_key, model, antes, despues)
        else:
            parsed = _call_openai(api_key, model, antes, despues)
    except httpx.HTTPStatusError as e:
        logger.exception('IA HTTP error')
        try:
            detail = e.response.json()
        except Exception:
            detail = e.response.text
        return None, f'Error del proveedor IA ({e.response.status_code}): {detail}', ''
    except Exception as e:
        logger.exception('IA error')
        return None, f'Error al llamar a la IA: {e}', ''

    if not parsed:
        return None, 'La IA no devolvió JSON válido.', ''

    metricas = parsed.get('metricas')
    if not isinstance(metricas, list):
        metricas = []
    interp = str(parsed.get('interpretacion') or '')
    plataforma = str(parsed.get('plataforma') or '')
    return metricas, interp, plataforma
