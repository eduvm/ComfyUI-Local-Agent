# ComfyUI Local Agent (`ComfyUI-Local-Agent`)

> **The Open-Source Local Comfy Agent Bridge.**  
> Control, build, wire, configure, group, and animate workflows **live on your local ComfyUI browser canvas** from **Claude Code, OpenAI Codex, Cursor, Google Antigravity, OpenCode, Hermes**, or any AI coding agent — **100% free on your own GPU, zero Comfy Cloud credits required.**

---

## Why `ComfyUI-Local-Agent`?

Comfy Org's built-in *Comfy Agent* runs in the cloud and charges Comfy Credits per token. Traditional local CLI/MCP tools only execute saved `.json` files in the background — leaving your browser canvas static and forcing you to manually reload files (`Ctrl+O`) every time your agent makes an edit.

**`ComfyUI-Local-Agent`** bridges that gap by connecting your AI coding agent directly to the live `LiteGraph` (`app.canvas.graph`) instance open in your browser via ComfyUI's native `PromptServer` WebSocket:

- **Watch your agent build live:** Nodes appear, resize, snap to the 10px grid, and wire themselves together step-by-step right in front of your eyes (`--step-delay`).
- **Visual pulse rings & toast notifications:** Every node created, rewired, or configured glows with an animated pulse ring on the canvas so you can follow what the agent is touching.
- **Bidirectional awareness:** Your agent can read your open tab at any time (`GET /evm/live/state`), see which nodes you selected with your mouse, inspect widget values, and frame the camera on specific nodes or groups (`focus` / `focus_group`).
- **Safe dual-widget updates:** Automatically updates `widget.value`, `node.widgets_values` (positional array), and `node.widgets_values_named` (dictionary), preventing stale values when converting UI graphs to API prompts.
- **Native integration with [`ComfyUI-EVM-Advanced-Group`](https://github.com/eduvm/ComfyUI-EVM-Advanced-Group):** When installed alongside `ComfyUI-EVM-Advanced-Group`, your agent can organize entire workflows into self-contained stage groups with `SetNode` / `GetNode` side rails and stage color palettes in a single command (`organize_workflow`).
- **Bundled Agent Skill (`SKILL.md`):** Ships with a ready-to-use `skills/comfyui-local-agent/SKILL.md` and one-command installer so your AI agent immediately knows how to drive your canvas.

---

## Installation

### 1. Install the Custom Node in ComfyUI

Clone into your `ComfyUI/custom_nodes/` directory and restart ComfyUI (zero external Python dependencies required):

```bash
cd /path/to/ComfyUI/custom_nodes
git clone https://github.com/eduvm/ComfyUI-Local-Agent.git
```

*(Optional but recommended)* For smart group containers with `GetNode`/`SetNode` side rails and 1-click workflow organization, also install [`ComfyUI-EVM-Advanced-Group`](https://github.com/eduvm/ComfyUI-EVM-Advanced-Group):

```bash
git clone https://github.com/eduvm/ComfyUI-EVM-Advanced-Group.git
```

### 2. Install the Agent Skill & CLI Helper

Run the bundled installer to place `comfy-local-agent` (and `evm-live`) on `~/.local/bin` and symlink the `comfyui-local-agent` skill into your AI coding agents (`~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.gemini/config/skills`, `~/.hermes/skills`):

```bash
bash /path/to/ComfyUI/custom_nodes/ComfyUI-Local-Agent/scripts/install-skill.sh
```

After restarting ComfyUI, reload your ComfyUI browser tab (`F5`).

---

## Quick Usage

### From Your AI Agent (Plain Language)
Once the skill is linked, just talk to your coding agent while looking at your ComfyUI browser window:
- *"Clear the current canvas and build a Load Image → SeedVR2 Upscaler → Preview Image + Image Comparer workflow with 30px spacing."*
- *"Optimize the SeedVR2 nodes on screen for my RTX 3090 (24GB VRAM)."*
- *"Organize the workflow on my screen into EVM Groups with Set/Get nodes and focus the camera on the Output group."*

### From the Terminal (`comfy-local-agent` / `evm-live`)

```bash
# Check active browser tabs connected to ComfyUI
comfy-local-agent ping

# View a compact table of all nodes, widgets, and mouse selection in the open tab
comfy-local-agent state -s

# Execute a sequence of live canvas actions with a 400ms visual step delay
comfy-local-agent exec --step-delay 400 -j '{
  "actions": [
    {"op": "toast", "text": "Building workflow live..."},
    {"op": "clear_canvas"},
    {"op": "add_node", "node_type": "LoadImage", "pos": [200, 200], "size": [300, 360], "alias": "loader"},
    {"op": "add_node", "node_type": "SaveImage", "pos": [530, 200], "size": [300, 360], "alias": "saver", "widgets": {"filename_prefix": "Live_Test"}},
    {"op": "connect", "from": "$loader", "from_slot": "IMAGE", "to": "$saver", "to_slot": "images"},
    {"op": "focus", "nodes": ["$loader", "$saver"]}
  ]
}'
```

---

## Supported Live Operations (`POST /evm/live/exec`)

| `op` | Key Parameters | What happens live on the browser canvas |
| :--- | :--- | :--- |
| `get_state` | `include_full_graph` (bool) | Returns all nodes, widgets, links, `evmGroups`, camera state, and mouse-selected nodes. |
| `clear_canvas` | — | Clears all nodes and groups from the active canvas. |
| `add_node` | `node_type`, `title`, `pos`, `size`, `widgets`, `alias`, `focus` | Creates a node on the grid, sets widgets (`widgets_values` + `widgets_values_named`), registers `$alias`, and pulses blue. |
| `connect` | `from`, `from_slot`, `to`, `to_slot` | Connects two nodes by ID, title (`@Title`), or alias (`$alias`) and slot name/index. |
| `disconnect` | `to`, `to_slot` | Disconnects an input slot. |
| `set_widget` | `node`, `widget`, `value` (or `widgets: {...}`) | Updates widget values live on screen and triggers native widget callbacks. |
| `move_node` | `node`, `pos`, `size`, `title`, `color`, `bgcolor`, `collapsed`, `mode` | Moves, resizes, renames, colors, collapses, or bypasses (`mode: 4`) a node. |
| `remove_node` | `node` | Removes a node from the canvas. |
| `select_nodes` | `nodes` (list), `focus` (bool) | Selects the target nodes on the canvas and optionally frames the camera on them. |
| `focus` / `focus_group` | `group` / `groups`, `nodes`, `rect`, `zoom` | Frames the user's camera on an `EVM Group` (by title/ID), a set of nodes, or the entire workflow. |
| `create_evm_group` | `nodes` (list), `title`, `color`, `tidy` | Wraps nodes into an **EVM Group** container with 3-grid-square (`30px`) auto-layout. |
| `organize_workflow` | — | Runs the full canonical workflow organizer (`EVM Groups` + `SetNode`/`GetNode` side rails + stage colors). |
| `auto_color` | — | Applies canonical stage colors to all groups, internal nodes, and `SetNode`/`GetNode` rails. |
| `load_graph` | `workflow` (JSON object) | Loads a complete ComfyUI workflow JSON directly into the open tab without `Ctrl+O`. |
| `toast` | `text`, `badge`, `duration` | Displays a glowing notification pill in the bottom-right corner of the ComfyUI window. |

---

## HTTP Endpoints

All endpoints are mounted directly on ComfyUI's `PromptServer` (default `http://127.0.0.1:8188`):

- `GET /evm/live/ping`: Healthcheck, connected browser tabs, and WebSocket round-trip probe.
- `GET /evm/live/state`: Live canvas state (`?full=1` includes full `graph.serialize()`).
- `POST /evm/live/exec`: Dispatches one or more actions to the browser tab and awaits the execution result.

---

## License

MIT License — Created by **Eduardo ([eduvm](https://github.com/eduvm))**.
