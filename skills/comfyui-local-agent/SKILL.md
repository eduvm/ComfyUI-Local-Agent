---
name: comfyui-local-agent
description: >-
  Control and edit the live ComfyUI browser canvas in real time via the ComfyUI-Local-Agent
  HTTP + WebSocket bridge (/evm/live/*). Use whenever the user asks to create, edit, wire,
  configure, resize, color, organize, or focus nodes/groups directly on their open ComfyUI
  screen, or wants a local Comfy Agent experience without Comfy Cloud credits.
---

# ComfyUI Local Agent — Live Canvas Bridge Skill

This skill enables any AI coding agent (Claude Code, Codex, Cursor, Antigravity, OpenCode, Hermes, DSH) to inspect and manipulate the **currently open ComfyUI browser tab in real time**.

Instead of editing disconnected `.json` files on disk and asking the user to manually reload them, you send commands straight into the live `LiteGraph` instance (`app.canvas.graph`) running in the user's browser, with glowing visual pulse rings, toast notifications, automatic camera framing, and full `widgets_values` + `widgets_values_named` synchronization.

---

## 1. Quick CLI Reference (`comfy-local-agent` / `evm-live`)

The bridge includes a zero-dependency Python stdlib CLI located at `bin/evm_live.py` (or `comfy-local-agent` / `evm-live` on `PATH`):

```bash
# 1. Check if the ComfyUI browser tab is connected and responsive
python3 /path/to/ComfyUI/custom_nodes/ComfyUI-Local-Agent/bin/evm_live.py ping

# 2. Read a compact summary of all nodes, widgets, EVM groups, and mouse selection
python3 /path/to/ComfyUI/custom_nodes/ComfyUI-Local-Agent/bin/evm_live.py state -s

# 3. Read the complete serialized workflow JSON from the open tab
python3 /path/to/ComfyUI/custom_nodes/ComfyUI-Local-Agent/bin/evm_live.py state --full

# 4. Execute live actions on the canvas (with optional --step-delay in ms for smooth step-by-step animation)
python3 /path/to/ComfyUI/custom_nodes/ComfyUI-Local-Agent/bin/evm_live.py exec --step-delay 400 -j '{
  "actions": [
    {"op": "toast", "text": "Building workflow live on canvas..."},
    {"op": "clear_canvas"},
    {"op": "add_node", "node_type": "LoadImage", "pos": [200, 200], "size": [300, 360], "alias": "loader"},
    {"op": "add_node", "node_type": "PreviewImage", "pos": [530, 200], "size": [300, 360], "alias": "preview"},
    {"op": "connect", "from": "$loader", "from_slot": "IMAGE", "to": "$preview", "to_slot": "images"},
    {"op": "focus", "nodes": ["$loader", "$preview"]}
  ]
}'
```

You can also call the HTTP endpoints directly on the ComfyUI server (`http://127.0.0.1:8188`):
- `GET /evm/live/ping`
- `GET /evm/live/state?full=1`
- `POST /evm/live/exec`

---

## 2. Discovering Available Nodes & Models (`/object_info`)

Before adding unfamiliar nodes or setting model combo widgets, query the live ComfyUI `/object_info` endpoint so you never hallucinate node class names, slot names, or model filenames:

```bash
# Search node class names matching a keyword
curl -s http://127.0.0.1:8188/object_info | python3 -c "import sys, json; d=json.load(sys.stdin); print([k for k in d if 'seedvr' in k.lower()])"

# Inspect required/optional inputs and available model options for a specific node
curl -s http://127.0.0.1:8188/object_info/SeedVR2LoadDiTModel | python3 -m json.tool
```

---

## 3. Supported Live Canvas Operations (`POST /evm/live/exec`)

Pass either a single action object `{"op": "..."}` or a batch `{"actions": [...], "meta": {"step_delay_ms": 400}}`.

### Node Lifecycle & Wiring
- **`clear_canvas`**: Clears all nodes and groups from the active tab.
- **`add_node`**:
  - `node_type` (required): Exact ComfyUI class name (e.g., `"LoadImage"`, `"KSampler"`, `"SeedVR2VideoUpscaler"`).
  - `title` (optional): Custom node title.
  - `pos` (optional): `[x, y]` coordinates (automatically snapped to the 10px grid).
  - `size` (optional): `[width, height]` in pixels.
  - `widgets` (optional): Object mapping widget names (or indices) to values. Automatically updates both `widgets_values` and `widgets_values_named`.
  - `alias` (optional): String alias (e.g. `"loader"`) so subsequent actions in the same batch can reference it as `"$loader"`.
  - `color` / `bgcolor` / `collapsed` / `mode`: Visual and state properties.
- **`remove_node`**:
  - `node`: Node ID (`12`, `"#12"`), alias (`"$loader"`), or title (`"@Load Image"`).
- **`connect`**:
  - `from`: Source node ID, alias (`"$loader"`), or title (`"@Load Image"`).
  - `from_slot`: Output slot name (e.g. `"IMAGE"`, `"MODEL"`) or 0-based index.
  - `to`: Target node ID, alias, or title.
  - `to_slot`: Input slot name (e.g. `"images"`, `"model"`) or 0-based index.
- **`disconnect`**:
  - `to`: Target node reference.
  - `to_slot`: Input slot name or index to disconnect.

### Configuring & Transforming Existing Nodes
- **`set_widget`** (or `set_widgets`):
  - `node`: Node reference.
  - `widgets`: `{"seed": 42, "steps": 8}` (or single `widget` + `value`).
  - *Note:* Always use `set_widget` to modify parameters live; it triggers the widget's native callback and keeps `widgets_values` and `widgets_values_named` 100% synchronized.
- **`move_node`** (or `transform_node`):
  - `node`: Node reference.
  - `pos`: `[x, y]`, `size`: `[w, h]`, `title`: `"..."`, `color`: `"#..."`, `bgcolor`: `"#..."`, `collapsed`: `true/false`, `mode`: `0` (active) / `2` (mute) / `4` (bypass).
- **`select_nodes`**:
  - `nodes`: Array of node references to select on the user's canvas (`focus: true` to also center camera).

### Camera & Visual Feedback
- **`focus`** / **`camera`**:
  - `group` or `groups`: Title or ID of an `EVM Group` (e.g. `{"op": "focus", "group": "Output"}`) to frame that group in full view.
  - `nodes`: Array of node references to frame.
  - `rect`: `[x, y, w, h]` custom bounding box to frame.
  - `zoom`: Optional explicit scale (`0.15` to `2.5`). Omit for automatic best-fit zoom.
  - *(If called with no arguments, frames the entire workflow).*
- **`toast`**:
  - `text`: Message displayed in the bottom-right notification pill on the ComfyUI canvas.
  - `badge`: Custom badge title (default `"⚡ EVM Live Agent"`).
  - `duration`: Duration in ms (default `3500`).

### EVM Advanced Group Integration (When `ComfyUI-EVM-Advanced-Group` is installed)
- **`create_evm_group`**:
  - `nodes`: Array of node references.
  - `title`: Group title (e.g. `"Upscale"`).
  - `color`: Hex color.
- **`organize_workflow`**:
  - Automatically runs the full canonical workflow organizer: groups nodes by stage (`Notes → Models → Input → Prompt → Settings → Sampling → Refine → Upscale → Output`), creates self-contained `SetNode` (right rail) and `GetNode` (left rail) pairs so zero wires cross group boundaries, applies stage color palettes, and aligns everything to the 30px (3-grid-square) geometry rule.
- **`auto_color`**:
  - Re-applies the canonical stage color palette across all groups, internal nodes, and `SetNode`/`GetNode` rails.
- **`load_graph`**:
  - `workflow`: Full ComfyUI workflow JSON object to load directly into the active browser tab without requiring `Ctrl+O`.

---

## 4. Layout & Geometry Best Practices

1. **Grid Alignment:** ComfyUI's grid is `10px`. Keep all node positions, sizes, and gaps in multiples of `10px`.
2. **Standard 3-Grid-Square Spacing (`30px`):**
   - Horizontal gap between adjacent nodes or columns: **`30px`** (`next_x = prev_x + prev_width + 30`).
   - Vertical gap between stacked nodes: remember that LiteGraph draws a **`30px` title bar above `node.pos[1]`**. Therefore, to achieve a visible **`30px` gap** between a top node at `[x, y1]` with body height `h1` and a node below it, set the bottom node's `y2 = y1 + h1 + 60` (`30px` visible gap + `30px` for the bottom node's title bar).
3. **Step-by-Step Visual Pacing:** When building or refactoring multiple nodes while the user watches, pass `--step-delay 350` (or `"meta": {"step_delay_ms": 350}`) so the user sees each node appear, resize, and wire up smoothly.
