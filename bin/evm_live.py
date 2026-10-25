#!/usr/bin/env python3
"""
CLI Helper para o ComfyUI-EVM-Live-Agent.
Permite inspecionar e manipular o canvas aberto do ComfyUI em tempo real via terminal.
Escrito 100% em Python stdlib (zero dependências externas).
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any

DEFAULT_URL = "http://127.0.0.1:8188"


def _http_get(url: str, timeout: float = 12.0) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except Exception:
            return {"ok": False, "status": exc.code, "error": body}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _http_post(url: str, payload: Any, timeout: float = 25.0) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except Exception:
            return {"ok": False, "status": exc.code, "error": body}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def cmd_ping(args: argparse.Namespace) -> int:
    res = _http_get(f"{args.url}/evm/live/ping")
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0 if res.get("ok") else 1


def cmd_state(args: argparse.Namespace) -> int:
    q = "?full=1" if args.full else ""
    res = _http_get(f"{args.url}/evm/live/state{q}")
    if args.summary and res.get("ok"):
        inner = res.get("results") or res
        nodes = inner.get("nodes", [])
        selected = set(inner.get("selected_node_ids", []))
        print(f"Tab: {inner.get('tab_id')} | Nodes: {len(nodes)} | Selected: {sorted(selected)} | EVM Groups: {len(inner.get('evm_groups', []))}")
        for n in nodes:
            sel_mark = "*" if n["id"] in selected else " "
            w_summary = ", ".join(f"{w['name']}={repr(w['value'])[:40]}" for w in n.get("widgets", [])[:4])
            print(f" {sel_mark} #{n['id']:<4} [{n['type']}] '{n['title']}' pos={n['pos']} ({w_summary})")
        return 0
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0 if res.get("ok") else 1


def cmd_exec(args: argparse.Namespace) -> int:
    if args.file:
        with open(args.file, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    elif args.json:
        payload = json.loads(args.json)
    else:
        payload = json.load(sys.stdin)

    if args.step_delay is not None and isinstance(payload, dict):
        payload.setdefault("meta", {})["step_delay_ms"] = args.step_delay
    elif args.step_delay is not None and isinstance(payload, list):
        payload = {"actions": payload, "meta": {"step_delay_ms": args.step_delay}}

    res = _http_post(f"{args.url}/evm/live/exec", payload)
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0 if res.get("ok") else 1


def cmd_toast(args: argparse.Namespace) -> int:
    res = _http_post(
        f"{args.url}/evm/live/exec",
        {"op": "toast", "text": args.message, "badge": args.badge, "duration": args.duration},
    )
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0 if res.get("ok") else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="EVM Live Canvas Bridge CLI")
    parser.add_argument("--url", default=DEFAULT_URL, help="ComfyUI server URL (default: http://127.0.0.1:8188)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("ping", help="Verifica conexão com a aba aberta do ComfyUI")

    p_state = sub.add_parser("state", help="Lê os nós e seleção da aba aberta do ComfyUI")
    p_state.add_argument("--summary", "-s", action="store_true", help="Mostra resumo compacto em tabela")
    p_state.add_argument("--full", action="store_true", help="Inclui o grafo serializado completo")

    p_exec = sub.add_parser("exec", help="Executa ações JSON ao vivo no canvas")
    p_exec.add_argument("--json", "-j", help="String JSON com ação ou lista de ações")
    p_exec.add_argument("--file", "-f", help="Arquivo JSON com ação ou lista de ações")
    p_exec.add_argument("--step-delay", "-d", type=int, default=None, help="Atraso em ms entre cada ação para animação passo a passo")

    p_toast = sub.add_parser("toast", help="Mostra notificação visual no canvas do ComfyUI")
    p_toast.add_argument("message", help="Texto da mensagem")
    p_toast.add_argument("--badge", default="⚡ EVM Live Agent", help="Rótulo do crachá")
    p_toast.add_argument("--duration", type=int, default=3500, help="Duração em ms")

    args = parser.parse_args()
    if args.cmd == "ping":
        return cmd_ping(args)
    if args.cmd == "state":
        return cmd_state(args)
    if args.cmd == "exec":
        return cmd_exec(args)
    if args.cmd == "toast":
        return cmd_toast(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
