"""
ComfyUI-EVM-Live-Agent
Ponte bidirecional ao vivo (HTTP + WebSocket do PromptServer) para permitir que
agentes de IA locais (Antigravity, Hermes, Codex, DSH, OpenCode) inspecionem,
criem, conectem, configurem, agrupem (EVM Group) e animem nós diretamente no
canvas aberto do navegador do ComfyUI em tempo real.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

from aiohttp import web
from server import PromptServer

WEB_DIRECTORY = "./js"
NODE_CLASS_MAPPINGS: dict[str, Any] = {}
NODE_DISPLAY_NAME_MAPPINGS: dict[str, Any] = {}

# Registro em memória de requisições síncronas aguardando resposta do navegador
_PENDING_REQUESTS: dict[str, asyncio.Future[dict[str, Any]]] = {}
_LAST_HEARTBEAT: dict[str, dict[str, Any]] = {}
_COMMAND_HISTORY: list[dict[str, Any]] = []
_MAX_HISTORY = 100


def _record_history(entry: dict[str, Any]) -> None:
    _COMMAND_HISTORY.append(entry)
    if len(_COMMAND_HISTORY) > _MAX_HISTORY:
        del _COMMAND_HISTORY[: len(_COMMAND_HISTORY) - _MAX_HISTORY]


async def _dispatch_to_browser(
    actions: list[dict[str, Any]],
    *,
    timeout: float = 15.0,
    client_id: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    req_id = f"evmlive_{uuid.uuid4().hex[:12]}"
    loop = asyncio.get_running_loop()
    fut: asyncio.Future[dict[str, Any]] = loop.create_future()
    _PENDING_REQUESTS[req_id] = fut

    payload = {
        "req_id": req_id,
        "timestamp": time.time(),
        "actions": actions,
        "meta": meta or {},
    }

    try:
        PromptServer.instance.send_sync("evm.live.request", payload, sid=client_id)
        result = await asyncio.wait_for(fut, timeout=timeout)
        _record_history(
            {
                "req_id": req_id,
                "ts": time.time(),
                "actions": [a.get("op") or a.get("type") for a in actions],
                "ok": bool(result.get("ok", True)),
            }
        )
        return result
    except asyncio.TimeoutError:
        return {
            "ok": False,
            "req_id": req_id,
            "error": (
                "Timeout aguardando resposta da aba do ComfyUI no navegador. "
                "Verifique se o ComfyUI está aberto em uma aba ativa do navegador "
                "e recarregado (F5) após instalar o ComfyUI-EVM-Live-Agent."
            ),
            "active_clients": list(_LAST_HEARTBEAT.keys()),
        }
    finally:
        _PENDING_REQUESTS.pop(req_id, None)


@PromptServer.instance.routes.post("/evm/live/reply")
async def evm_live_reply(request: web.Request) -> web.Response:
    try:
        data = await request.json()
    except Exception as exc:
        return web.json_response({"ok": False, "error": f"Invalid JSON: {exc}"}, status=400)

    req_id = data.get("req_id")
    client_info = data.get("client")
    if isinstance(client_info, dict) and client_info.get("tab_id"):
        _LAST_HEARTBEAT[str(client_info["tab_id"])] = {
            **client_info,
            "last_seen": time.time(),
        }

    fut = _PENDING_REQUESTS.get(str(req_id))
    if fut is not None and not fut.done():
        fut.set_result(data)
        return web.json_response({"ok": True, "delivered": True})

    return web.json_response({"ok": True, "delivered": False})


@PromptServer.instance.routes.post("/evm/live/heartbeat")
async def evm_live_heartbeat(request: web.Request) -> web.Response:
    try:
        data = await request.json()
    except Exception:
        data = {}
    tab_id = str(data.get("tab_id") or "default")
    _LAST_HEARTBEAT[tab_id] = {
        **data,
        "last_seen": time.time(),
    }
    return web.json_response({"ok": True, "tab_id": tab_id})


@PromptServer.instance.routes.get("/evm/live/ping")
async def evm_live_ping(request: web.Request) -> web.Response:
    now = time.time()
    # Filtra abas vistas nos últimos 120s
    fresh_clients = {
        k: {**v, "age_seconds": round(now - v.get("last_seen", 0), 2)}
        for k, v in _LAST_HEARTBEAT.items()
        if now - v.get("last_seen", 0) < 120
    }
    probe = request.query.get("probe", "1") != "0"
    live_pong = None
    if probe:
        live_pong = await _dispatch_to_browser([{"op": "ping"}], timeout=3.0)

    return web.json_response(
        {
            "ok": True,
            "extension": "ComfyUI-EVM-Live-Agent",
            "version": "1.0.0",
            "clients": fresh_clients,
            "live_pong": live_pong,
            "recent_commands": _COMMAND_HISTORY[-10:],
        }
    )


@PromptServer.instance.routes.get("/evm/live/state")
async def evm_live_state(request: web.Request) -> web.Response:
    include_full = request.query.get("full", "0") == "1"
    result = await _dispatch_to_browser(
        [{"op": "get_state", "include_full_graph": include_full}],
        timeout=10.0,
    )
    status = 200 if result.get("ok") else 504
    return web.json_response(result, status=status)


@PromptServer.instance.routes.post("/evm/live/exec")
async def evm_live_exec(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception as exc:
        return web.json_response({"ok": False, "error": f"Invalid JSON: {exc}"}, status=400)

    if isinstance(body, dict) and "actions" in body and isinstance(body["actions"], list):
        actions = body["actions"]
    elif isinstance(body, dict) and ("op" in body or "type" in body):
        actions = [body]
    elif isinstance(body, list):
        actions = body
    else:
        return web.json_response(
            {"ok": False, "error": "Payload deve conter {'op': ...} ou {'actions': [...]}"},
            status=400,
        )

    timeout = float(body.get("timeout", 20.0)) if isinstance(body, dict) else 20.0
    client_id = body.get("client_id") if isinstance(body, dict) else None
    meta = body.get("meta") if isinstance(body, dict) else None

    result = await _dispatch_to_browser(actions, timeout=timeout, client_id=client_id, meta=meta)
    status = 200 if result.get("ok") else 504
    return web.json_response(result, status=status)


__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
