import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

/**
 * ComfyUI-EVM-Live-Agent (Frontend Bridge)
 * Permite que agentes de IA locais (Antigravity, Hermes, Codex, DSH, OpenCode)
 * manipulem o canvas do ComfyUI ao vivo, criando nós, puxando fios, alterando
 * widgets (com sincronia automática de widgets_values_named), agrupando em
 * EVM Groups, organizando o workflow e destacando visualmente as ações em tempo real.
 */

const TAB_ID = "tab_" + Math.random().toString(36).slice(2, 10);
const GRID = 10;

function snap(v) {
    return Math.round(Number(v || 0) / GRID) * GRID;
}

function getGraph() {
    return app.canvas?.graph || app.graph;
}

function getCanvas() {
    return app.canvas;
}

function repaint() {
    try {
        const g = getGraph();
        if (g && typeof g.setDirtyCanvas === "function") {
            g.setDirtyCanvas(true, true);
        }
        const c = getCanvas();
        if (c && typeof c.setDirty === "function") {
            c.setDirty(true, true);
        }
        if (window.EVMGroupSetGet?.repaint) {
            window.EVMGroupSetGet.repaint();
        }
    } catch (_e) {}
}

// ── Efeitos Visuais (Toast + Pulse de Destaque no Canvas) ───────────────────
const _pulses = []; // { nodeId, rect, color, until, label }
let _animRunning = false;

function addNodePulse(node, color = "#38bdf8", durationMs = 1400, label = "") {
    if (!node) return;
    _pulses.push({
        nodeId: node.id,
        color,
        started: performance.now(),
        until: performance.now() + durationMs,
        label,
    });
    startPulseLoop();
}

function startPulseLoop() {
    if (_animRunning) return;
    _animRunning = true;
    const step = () => {
        const now = performance.now();
        for (let i = _pulses.length - 1; i >= 0; i--) {
            if (_pulses[i].until <= now) {
                _pulses.splice(i, 1);
            }
        }
        repaint();
        if (_pulses.length > 0) {
            requestAnimationFrame(step);
        } else {
            _animRunning = false;
        }
    };
    requestAnimationFrame(step);
}

let _toastEl = null;
let _toastTimer = null;

function showAgentToast(text, badge = "⚡ EVM Live Agent", durationMs = 3200) {
    try {
        if (!_toastEl) {
            _toastEl = document.createElement("div");
            _toastEl.id = "evm-live-agent-toast";
            Object.assign(_toastEl.style, {
                position: "fixed",
                bottom: "24px",
                right: "24px",
                zIndex: "999999",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 16px",
                borderRadius: "10px",
                background: "rgba(15, 23, 42, 0.94)",
                border: "1.5px solid rgba(56, 189, 248, 0.75)",
                boxShadow: "0 10px 30px rgba(0, 0, 0, 0.55), 0 0 18px rgba(56, 189, 248, 0.28)",
                color: "#f8fafc",
                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                fontSize: "13px",
                pointerEvents: "none",
                transition: "opacity 0.22s ease, transform 0.22s ease",
                opacity: "0",
                transform: "translateY(10px)",
            });
            document.body.appendChild(_toastEl);
        }
        _toastEl.innerHTML = `
            <span style="
                background: rgba(56, 189, 248, 0.18);
                color: #38bdf8;
                border: 1px solid rgba(56, 189, 248, 0.45);
                border-radius: 6px;
                padding: 3px 8px;
                font-weight: 700;
                font-size: 11px;
                letter-spacing: 0.3px;
                white-space: nowrap;
            ">${badge}</span>
            <span style="font-weight: 500; color: #e2e8f0;">${text}</span>
        `;
        _toastEl.style.opacity = "1";
        _toastEl.style.transform = "translateY(0)";
        if (_toastTimer) clearTimeout(_toastTimer);
        if (durationMs > 0) {
            _toastTimer = setTimeout(() => {
                if (_toastEl) {
                    _toastEl.style.opacity = "0";
                    _toastEl.style.transform = "translateY(10px)";
                }
            }, durationMs);
        }
    } catch (_e) {}
}

// ── Resolução de Nós por ID, Alias ($ref), Título (@Titulo) ou Tipo ─────────
function resolveNode(ref, aliasMap, graph) {
    const g = graph || getGraph();
    if (!g) return null;
    if (ref === null || ref === undefined) return null;

    if (typeof ref === "number") {
        return g.getNodeById(ref) || null;
    }
    const s = String(ref).trim();
    if (aliasMap && aliasMap.has(s)) {
        return aliasMap.get(s);
    }
    if (s.startsWith("$") && aliasMap && aliasMap.has(s.slice(1))) {
        return aliasMap.get(s.slice(1));
    }
    if (s.startsWith("#")) {
        const idNum = Number(s.slice(1));
        if (!Number.isNaN(idNum)) return g.getNodeById(idNum) || null;
    }
    if (/^\d+$/.test(s)) {
        return g.getNodeById(Number(s)) || null;
    }
    const nodes = g._nodes || [];
    if (s.startsWith("@")) {
        const titleTarget = s.slice(1).toLowerCase();
        return (
            nodes.find((n) => String(n.title || "").toLowerCase() === titleTarget) ||
            nodes.find((n) => String(n.title || "").toLowerCase().includes(titleTarget)) ||
            null
        );
    }
    // Busca exata por título ou tipo
    return (
        nodes.find((n) => String(n.title || "") === s) ||
        nodes.find((n) => String(n.type || "") === s) ||
        null
    );
}

function serializeNodeSummary(n) {
    if (!n) return null;
    const widgets = (n.widgets || []).map((w, idx) => ({
        index: idx,
        name: w.name,
        type: w.type,
        value: w.value,
    }));
    const inputs = (n.inputs || []).map((inp, idx) => ({
        slot: idx,
        name: inp.name,
        type: inp.type,
        link: inp.link ?? null,
    }));
    const outputs = (n.outputs || []).map((out, idx) => ({
        slot: idx,
        name: out.name,
        type: out.type,
        links: Array.isArray(out.links) ? [...out.links] : [],
    }));
    return {
        id: n.id,
        type: n.type,
        title: n.title || n.type,
        pos: n.pos ? [Math.round(Number(n.pos[0] || 0)), Math.round(Number(n.pos[1] || 0))] : [0, 0],
        size: n.size ? [Math.round(Number(n.size[0] || 0)), Math.round(Number(n.size[1] || 0))] : [0, 0],
        mode: n.mode ?? 0,
        collapsed: !!(n.flags && n.flags.collapsed),
        color: n.color || null,
        bgcolor: n.bgcolor || null,
        widgets,
        inputs,
        outputs,
    };
}

function isVueNodes() {
    return !!(window.LiteGraph && window.LiteGraph.vueNodesMode);
}

function setNodePos(node, x, y) {
    if (!node) return;
    const sx = snap(x);
    const sy = snap(y);
    if (isVueNodes()) {
        node.pos = [sx, sy];
    } else if (node.pos) {
        node.pos[0] = sx;
        node.pos[1] = sy;
    } else {
        node.pos = [sx, sy];
    }
}

function setNodeSize(node, w, h) {
    if (!node) return;
    const sw = snap(w);
    const sh = snap(h);
    if (typeof node.setSize === "function") {
        try {
            node.setSize([sw, sh]);
        } catch (_e) {}
    }
    if (isVueNodes()) {
        node.size = [sw, sh];
    } else if (node.size) {
        node.size[0] = sw;
        node.size[1] = sh;
    } else {
        node.size = [sw, sh];
    }
    node._evmPrevW = Math.round(sw);
    node._evmPrevBodyH = Math.round(sh);
    try {
        node.onResize?.(node.size);
    } catch (_e) {}
}

function setNodeWidgetValue(node, widgetKey, newValue) {
    if (!node) return { ok: false, error: "Node nulo" };
    const widgets = node.widgets || [];
    let w = null;
    let idx = -1;

    if (typeof widgetKey === "number" || /^\d+$/.test(String(widgetKey))) {
        idx = Number(widgetKey);
        w = widgets[idx] || null;
    } else {
        const keyStr = String(widgetKey);
        idx = widgets.findIndex((item) => item.name === keyStr);
        if (idx === -1) {
            idx = widgets.findIndex((item) => String(item.name || "").toLowerCase() === keyStr.toLowerCase());
        }
        if (idx !== -1) w = widgets[idx];
    }

    if (!w) {
        return {
            ok: false,
            error: `Widget '${widgetKey}' não encontrado no nó #${node.id} (${node.type}). Disponíveis: ${widgets.map((x) => x.name).join(", ")}`,
        };
    }

    const oldVal = w.value;
    w.value = newValue;

    // Atualiza widgets_values posicional
    if (Array.isArray(node.widgets_values) && idx >= 0) {
        node.widgets_values[idx] = newValue;
    }
    // Regra Inviolável: atualiza também widgets_values_named se existir
    if (node.widgets_values_named && typeof node.widgets_values_named === "object") {
        node.widgets_values_named[w.name] = newValue;
    }

    if (typeof w.callback === "function") {
        try {
            w.callback(newValue, getCanvas(), node, [0, 0], null);
        } catch (_e) {}
    }
    if (typeof node.onWidgetChanged === "function") {
        try {
            node.onWidgetChanged(w.name, newValue, oldVal, w);
        } catch (_e) {}
    }

    return { ok: true, widget: w.name, index: idx, old: oldVal, value: newValue };
}

function resolveSlotIndex(list, slotSpec) {
    if (!Array.isArray(list)) return -1;
    if (typeof slotSpec === "number") return slotSpec;
    const s = String(slotSpec).trim();
    if (/^\d+$/.test(s)) return Number(slotSpec);
    let idx = list.findIndex((item) => item.name === s);
    if (idx !== -1) return idx;
    idx = list.findIndex((item) => String(item.name || "").toLowerCase() === s.toLowerCase());
    if (idx !== -1) return idx;
    idx = list.findIndex((item) => String(item.type || "").toLowerCase() === s.toLowerCase());
    return idx;
}

function centerCameraOnBounds(minX, minY, maxX, maxY, zoom = null, padding = 100) {
    const c = getCanvas();
    if (!c || !c.ds || !Number.isFinite(minX) || !Number.isFinite(minY)) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const el = c.canvas;
    const viewW = el ? el.clientWidth || el.width : 1280;
    const viewH = el ? el.clientHeight || el.height : 720;

    if (zoom !== null && Number.isFinite(Number(zoom))) {
        c.ds.scale = Math.max(0.15, Math.min(2.5, Number(zoom)));
    } else {
        const spanW = Math.max(200, (maxX - minX) + padding * 2);
        const spanH = Math.max(200, (maxY - minY) + padding * 2);
        const fitScale = Math.min(viewW / spanW, viewH / spanH);
        c.ds.scale = Math.max(0.25, Math.min(1.6, fitScale));
    }

    c.ds.offset[0] = viewW / (2 * c.ds.scale) - cx;
    c.ds.offset[1] = viewH / (2 * c.ds.scale) - cy;
    repaint();
}

function resolveEvmGroup(ref, graph) {
    const g = graph || getGraph();
    const list = g?.extra?.evmGroups || [];
    if (!ref || !Array.isArray(list) || list.length === 0) return null;
    const s = String(ref).trim().toLowerCase();
    return (
        list.find((grp) => String(grp.id || "").toLowerCase() === s) ||
        list.find((grp) => String(grp.title || "").toLowerCase() === s) ||
        list.find((grp) => String(grp.title || "").toLowerCase().includes(s)) ||
        null
    );
}

function getGroupBounds(grp) {
    if (!grp) return null;
    const x = Number(grp.x ?? grp.pos?.[0] ?? 0);
    const y = Number(grp.y ?? grp.pos?.[1] ?? 0);
    const w = Number(grp.w ?? grp.size?.[0] ?? 400);
    const h = Number(grp.h ?? grp.size?.[1] ?? 300);
    return { minX: x, minY: y, maxX: x + w, maxY: y + h, x, y, w, h };
}

function centerCameraOnNodes(nodes, zoom = null, padding = 120) {
    if (!Array.isArray(nodes) || nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
        if (!n) continue;
        const x = Number(n.pos?.[0] || 0);
        const y = Number(n.pos?.[1] || 0) - 30;
        const w = Number(n.size?.[0] || 200);
        const h = Number(n.size?.[1] || 100) + 30;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
    }
    centerCameraOnBounds(minX, minY, maxX, maxY, zoom, padding);
}

// ── Executor de Operações no Canvas ─────────────────────────────────────────
async function executeAction(action, aliasMap) {
    const g = getGraph();
    const c = getCanvas();
    const op = String(action.op || action.type || "").trim();

    switch (op) {
        case "ping": {
            return {
                ok: true,
                pong: true,
                tab_id: TAB_ID,
                nodes_count: (g?._nodes || []).length,
                evm_groups_count: (g?.extra?.evmGroups || []).length,
            };
        }

        case "get_state": {
            const nodes = (g?._nodes || []).map(serializeNodeSummary);
            const selectedMap = c?.selected_nodes || {};
            const selectedIds = Object.keys(selectedMap).map((k) => Number(k));
            const evmGroups = (g?.extra?.evmGroups || []).map((grp) => ({
                id: grp.id,
                title: grp.title,
                x: grp.x ?? grp.pos?.[0] ?? 0,
                y: grp.y ?? grp.pos?.[1] ?? 0,
                w: grp.w ?? grp.size?.[0] ?? 0,
                h: grp.h ?? grp.size?.[1] ?? 0,
                color: grp.color,
                folded: !!grp.folded,
                leftRailOpen: grp.leftRailOpen !== false,
                rightRailOpen: grp.rightRailOpen !== false,
                getNodeIds: grp.getNodeIds || grp.leftNodeIds || [],
                setNodeIds: grp.setNodeIds || grp.rightNodeIds || [],
            }));
            const nativeGroups = (g?._groups || []).map((grp, idx) => ({
                index: idx,
                title: grp.title,
                pos: grp._pos ? [grp._pos[0], grp._pos[1]] : grp.pos,
                size: grp._size ? [grp._size[0], grp._size[1]] : grp.size,
                color: grp.color,
            }));
            const links = [];
            if (g?.links) {
                const linkEntries = g.links instanceof Map ? g.links.values() : Object.values(g.links);
                for (const l of linkEntries) {
                    if (!l) continue;
                    links.push({
                        id: l.id,
                        origin_id: l.origin_id,
                        origin_slot: l.origin_slot,
                        target_id: l.target_id,
                        target_slot: l.target_slot,
                        type: l.type,
                    });
                }
            }
            const res = {
                ok: true,
                tab_id: TAB_ID,
                workflow_id: g?.extra?.workflow_id || null,
                selected_node_ids: selectedIds,
                selected_evm_group: window.EVMGroupSetGet?.getSelected?.()?.id || null,
                camera: c?.ds ? { scale: c.ds.scale, offset: [c.ds.offset[0], c.ds.offset[1]] } : null,
                nodes,
                links,
                evm_groups: evmGroups,
                native_groups: nativeGroups,
            };
            if (action.include_full_graph && typeof g?.serialize === "function") {
                res.serialized_graph = g.serialize();
            }
            return res;
        }

        case "toast": {
            showAgentToast(
                action.text || action.message || "Operação executada no Canvas",
                action.badge || "⚡ EVM Live Agent",
                Number(action.duration || 3500)
            );
            return { ok: true };
        }

        case "clear_canvas":
        case "clear": {
            if (g && typeof g.clear === "function") {
                g.clear();
                if (g.extra) g.extra.evmGroups = [];
            }
            showAgentToast("Canvas limpo para novo workflow", "⚡ EVM Live Agent");
            repaint();
            return { ok: true };
        }

        case "add_node": {
            const nodeType = action.node_type || action.class_type || action.node;
            if (!nodeType) {
                return { ok: false, error: "add_node requer 'node_type'" };
            }
            if (!window.LiteGraph || typeof window.LiteGraph.createNode !== "function") {
                return { ok: false, error: "LiteGraph.createNode indisponível" };
            }
            const node = window.LiteGraph.createNode(nodeType);
            if (!node) {
                return { ok: false, error: `Tipo de nó desconhecido no LiteGraph: '${nodeType}'` };
            }
            if (action.title) {
                node.title = String(action.title);
            }
            g.add(node);

            if (Array.isArray(action.pos) && action.pos.length >= 2) {
                setNodePos(node, action.pos[0], action.pos[1]);
            } else if (c?.ds) {
                const el = c.canvas;
                const cx = (el ? el.clientWidth / 2 : 600) / c.ds.scale - c.ds.offset[0];
                const cy = (el ? el.clientHeight / 2 : 400) / c.ds.scale - c.ds.offset[1];
                setNodePos(node, cx, cy);
            }
            if (Array.isArray(action.size) && action.size.length >= 2) {
                setNodeSize(node, action.size[0], action.size[1]);
            }
            if (action.color) node.color = action.color;
            if (action.bgcolor) node.bgcolor = action.bgcolor;
            if (action.mode !== undefined) node.mode = Number(action.mode);

            if (action.alias || action.id_alias || action.ref) {
                const alias = String(action.alias || action.id_alias || action.ref).replace(/^\$/, "");
                aliasMap.set(alias, node);
                aliasMap.set("$" + alias, node);
            }

            const widgetResults = {};
            if (action.widgets && typeof action.widgets === "object") {
                for (const [wKey, wVal] of Object.entries(action.widgets)) {
                    widgetResults[wKey] = setNodeWidgetValue(node, wKey, wVal);
                }
            }

            if (action.collapsed !== undefined) {
                if (!node.flags) node.flags = {};
                node.flags.collapsed = !!action.collapsed;
            }

            addNodePulse(node, action.pulse_color || "#38bdf8", 1600, `Novo: ${node.title || node.type}`);
            if (action.focus) {
                centerCameraOnNodes([node], action.zoom ?? null);
            }
            showAgentToast(`Nó criado: ${node.title || node.type} (#${node.id})`);
            repaint();
            return {
                ok: true,
                node: serializeNodeSummary(node),
                widgets_updated: widgetResults,
            };
        }

        case "remove_node": {
            const node = resolveNode(action.node ?? action.id, aliasMap, g);
            if (!node) return { ok: false, error: `Nó não encontrado: ${action.node ?? action.id}` };
            const removedId = node.id;
            const removedTitle = node.title || node.type;
            g.remove(node);
            showAgentToast(`Nó removido: ${removedTitle} (#${removedId})`);
            repaint();
            return { ok: true, removed_id: removedId };
        }

        case "set_widget":
        case "set_widgets": {
            const node = resolveNode(action.node ?? action.id, aliasMap, g);
            if (!node) return { ok: false, error: `Nó não encontrado: ${action.node ?? action.id}` };

            const updates = {};
            if (action.widgets && typeof action.widgets === "object") {
                for (const [k, v] of Object.entries(action.widgets)) {
                    updates[k] = setNodeWidgetValue(node, k, v);
                }
            } else if (action.widget !== undefined) {
                updates[action.widget] = setNodeWidgetValue(node, action.widget, action.value);
            } else {
                return { ok: false, error: "set_widget requer 'widget'+'value' ou 'widgets': {...}" };
            }

            addNodePulse(node, "#22c55e", 1300, `Configurado: ${node.title || node.type}`);
            showAgentToast(`Configurado: ${node.title || node.type} (#${node.id})`);
            repaint();
            return { ok: true, node_id: node.id, updates };
        }

        case "connect": {
            const fromNode = resolveNode(action.from ?? action.origin ?? action.source, aliasMap, g);
            const toNode = resolveNode(action.to ?? action.target, aliasMap, g);
            if (!fromNode) return { ok: false, error: `Nó de origem não encontrado: ${action.from ?? action.origin}` };
            if (!toNode) return { ok: false, error: `Nó de destino não encontrado: ${action.to ?? action.target}` };

            const outSlot = resolveSlotIndex(fromNode.outputs || [], action.from_slot ?? action.output ?? 0);
            const inSlot = resolveSlotIndex(toNode.inputs || [], action.to_slot ?? action.input ?? 0);

            if (outSlot === -1) {
                return {
                    ok: false,
                    error: `Slot de saída '${action.from_slot ?? action.output ?? 0}' não encontrado em #${fromNode.id} (${fromNode.type})`,
                };
            }
            if (inSlot === -1) {
                return {
                    ok: false,
                    error: `Slot de entrada '${action.to_slot ?? action.input ?? 0}' não encontrado em #${toNode.id} (${toNode.type})`,
                };
            }

            const link = fromNode.connect(outSlot, toNode, inSlot);
            addNodePulse(fromNode, "#a855f7", 1100);
            addNodePulse(toNode, "#38bdf8", 1100);
            showAgentToast(`Conectado: ${fromNode.title || fromNode.type} → ${toNode.title || toNode.type}`);
            repaint();
            return {
                ok: true,
                from_id: fromNode.id,
                from_slot: outSlot,
                to_id: toNode.id,
                to_slot: inSlot,
                link_id: link?.id ?? null,
            };
        }

        case "disconnect": {
            const toNode = resolveNode(action.to ?? action.node ?? action.id, aliasMap, g);
            if (!toNode) return { ok: false, error: `Nó não encontrado: ${action.to ?? action.node}` };
            const inSlot = resolveSlotIndex(toNode.inputs || [], action.to_slot ?? action.input ?? action.slot ?? 0);
            if (inSlot === -1) return { ok: false, error: `Slot de entrada não encontrado` };
            toNode.disconnectInput(inSlot);
            addNodePulse(toNode, "#f97316", 1000);
            repaint();
            return { ok: true, node_id: toNode.id, disconnected_slot: inSlot };
        }

        case "move_node":
        case "transform_node": {
            const node = resolveNode(action.node ?? action.id, aliasMap, g);
            if (!node) return { ok: false, error: `Nó não encontrado: ${action.node ?? action.id}` };
            if (Array.isArray(action.pos) && action.pos.length >= 2) {
                setNodePos(node, action.pos[0], action.pos[1]);
            }
            if (Array.isArray(action.size) && action.size.length >= 2) {
                setNodeSize(node, action.size[0], action.size[1]);
            }
            if (action.title !== undefined) node.title = String(action.title);
            if (action.color !== undefined) node.color = action.color;
            if (action.bgcolor !== undefined) node.bgcolor = action.bgcolor;
            if (action.mode !== undefined) node.mode = Number(action.mode);
            if (action.collapsed !== undefined) {
                if (!node.flags) node.flags = {};
                node.flags.collapsed = !!action.collapsed;
            }
            addNodePulse(node, "#38bdf8", 1000);
            repaint();
            return { ok: true, node: serializeNodeSummary(node) };
        }

        case "select_nodes": {
            const refs = Array.isArray(action.nodes) ? action.nodes : [action.node ?? action.id];
            const nodes = refs.map((r) => resolveNode(r, aliasMap, g)).filter(Boolean);
            if (c) {
                c.deselectAllNodes();
                if (nodes.length > 0) {
                    c.selectNodes(nodes);
                }
            }
            for (const n of nodes) addNodePulse(n, "#38bdf8", 1200);
            if (action.focus && nodes.length > 0) {
                centerCameraOnNodes(nodes, action.zoom ?? null);
            }
            repaint();
            return { ok: true, selected_ids: nodes.map((n) => n.id) };
        }

        case "focus_group":
        case "focus":
        case "camera": {
            const padding = Number(action.padding ?? 80);
            if (action.group || action.groups || op === "focus_group") {
                const refs = Array.isArray(action.groups) ? action.groups : [action.group ?? action.target ?? action.title ?? action.id];
                const groups = refs.map((r) => resolveEvmGroup(r, g)).filter(Boolean);
                if (groups.length === 0) {
                    return { ok: false, error: `EVM Group não encontrado: ${refs.join(", ")}` };
                }
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const grp of groups) {
                    const b = getGroupBounds(grp);
                    if (!b) continue;
                    if (b.minX < minX) minX = b.minX;
                    if (b.minY < minY) minY = b.minY;
                    if (b.maxX > maxX) maxX = b.maxX;
                    if (b.maxY > maxY) maxY = b.maxY;
                }
                centerCameraOnBounds(minX, minY, maxX, maxY, action.zoom ?? null, padding);
                showAgentToast(`Foco no grupo: ${groups.map((x) => x.title).join(", ")}`);
                return { ok: true, focused_groups: groups.map((x) => ({ id: x.id, title: x.title })) };
            }
            if (action.rect && Array.isArray(action.rect) && action.rect.length >= 4) {
                const [rx, ry, rw, rh] = action.rect.map(Number);
                centerCameraOnBounds(rx, ry, rx + rw, ry + rh, action.zoom ?? null, padding);
                return { ok: true, focused_rect: [rx, ry, rw, rh] };
            }
            if (action.nodes || action.node) {
                const refs = Array.isArray(action.nodes) ? action.nodes : [action.node];
                const nodes = refs.map((r) => resolveNode(r, aliasMap, g)).filter(Boolean);
                centerCameraOnNodes(nodes, action.zoom ?? null, padding);
                return { ok: true, focused_ids: nodes.map((n) => n.id) };
            }
            // Se existirem EVM Groups, foca na caixa total dos grupos; caso contrário, nos nós
            const allGroups = g?.extra?.evmGroups || [];
            if (allGroups.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const grp of allGroups) {
                    const b = getGroupBounds(grp);
                    if (!b) continue;
                    if (b.minX < minX) minX = b.minX;
                    if (b.minY < minY) minY = b.minY;
                    if (b.maxX > maxX) maxX = b.maxX;
                    if (b.maxY > maxY) maxY = b.maxY;
                }
                centerCameraOnBounds(minX, minY, maxX, maxY, action.zoom ?? null, padding);
                return { ok: true, focused_all_groups: true };
            }
            const allNodes = g?._nodes || [];
            if (allNodes.length > 0) {
                centerCameraOnNodes(allNodes, action.zoom ?? null, padding);
            }
            return { ok: true, focused_all: true };
        }

        case "create_evm_group": {
            const refs = Array.isArray(action.nodes) ? action.nodes : [];
            const nodes = refs.map((r) => resolveNode(r, aliasMap, g)).filter(Boolean);
            if (nodes.length === 0) {
                return { ok: false, error: "create_evm_group requer 'nodes' com pelo menos 1 nó válido" };
            }
            if (!window.EVMGroupSetGet || typeof window.EVMGroupSetGet.createGroup !== "function") {
                return { ok: false, error: "EVMGroupSetGet.createGroup não está carregado" };
            }
            if (c) {
                c.deselectAllNodes();
                c.selectNodes(nodes);
            }
            const grp = window.EVMGroupSetGet.createGroup(nodes, action.title || "EVM Group");
            if (grp && action.color && typeof window.EVMGroupSetGet.setGroupColor === "function") {
                window.EVMGroupSetGet.setGroupColor(grp, action.color);
            }
            if (grp && action.tidy !== false && typeof window.EVMGroupSetGet.tidyGroup === "function") {
                window.EVMGroupSetGet.tidyGroup(grp);
            }
            showAgentToast(`EVM Group criado: ${grp?.title || action.title || "EVM Group"}`);
            repaint();
            return {
                ok: true,
                group: grp
                    ? {
                          id: grp.id,
                          title: grp.title,
                          pos: grp.pos,
                          size: grp.size,
                          color: grp.color,
                      }
                    : null,
            };
        }

        case "organize_workflow": {
            if (!window.EVMGroupSetGet || typeof window.EVMGroupSetGet.organizeWorkflow !== "function") {
                return { ok: false, error: "EVMGroupSetGet.organizeWorkflow não está disponível" };
            }
            window.EVMGroupSetGet.organizeWorkflow();
            if (window.EVMColorPalette?.autoColorWorkflow) {
                try {
                    window.EVMColorPalette.autoColorWorkflow();
                } catch (_e) {}
            }
            showAgentToast("Workflow organizado e colorido em EVM Groups!", "⚡ EVM Live Agent", 4000);
            repaint();
            return { ok: true };
        }

        case "auto_color": {
            if (window.EVMColorPalette?.autoColorWorkflow) {
                window.EVMColorPalette.autoColorWorkflow();
                showAgentToast("Cores atualizadas no padrão Dj Edu!", "⚡ EVM Live Agent", 3500);
                repaint();
                return { ok: true };
            }
            return { ok: false, error: "window.EVMColorPalette.autoColorWorkflow não disponível" };
        }

        case "load_graph": {
            if (!action.workflow || typeof action.workflow !== "object") {
                return { ok: false, error: "load_graph requer objeto 'workflow'" };
            }
            await app.loadGraphData(action.workflow, true, true, action.workflow_name || null);
            showAgentToast("Workflow carregado ao vivo no Canvas!", "⚡ EVM Live Agent", 4000);
            repaint();
            return { ok: true, nodes_count: (getGraph()?._nodes || []).length };
        }

        case "sleep":
        case "wait": {
            const ms = Math.max(0, Math.min(10000, Number(action.ms || action.duration || 400)));
            await new Promise((r) => setTimeout(r, ms));
            return { ok: true, waited_ms: ms };
        }

        case "reload_bridge": {
            const mod = await import(`/extensions/ComfyUI-EVM-Live-Agent/EVM_Live_Agent.js?t=${Date.now()}`);
            return { ok: true, reloaded: !!mod };
        }

        case "eval": {
            if (!action.code) return { ok: false, error: "eval requer 'code'" };
            const fn = new Function("app", "api", "graph", "canvas", "LiteGraph", action.code);
            const val = await fn(app, api, g, c, window.LiteGraph);
            repaint();
            return { ok: true, result: val ?? null };
        }

        default:
            return { ok: false, error: `Operação desconhecida: '${op}'` };
    }
}

async function handleLiveRequest(event) {
    const payload = event.detail || event;
    const reqId = payload?.req_id;
    const actions = Array.isArray(payload?.actions) ? payload.actions : [];
    const aliasMap = new Map();
    const results = [];
    let allOk = true;

    for (let i = 0; i < actions.length; i++) {
        const act = actions[i];
        try {
            const res = await executeAction(act, aliasMap);
            results.push({ index: i, op: act.op || act.type, ...res });
            if (!res.ok) {
                allOk = false;
                if (payload?.meta?.stop_on_error !== false) break;
            }
            // Pequena pausa opcional entre passos para visualização fluida ao vivo
            const stepDelay = Number(act.delay_after_ms ?? payload?.meta?.step_delay_ms ?? 0);
            if (stepDelay > 0 && i < actions.length - 1) {
                await new Promise((r) => setTimeout(r, Math.min(3000, stepDelay)));
            }
        } catch (err) {
            allOk = false;
            results.push({
                index: i,
                op: act?.op || act?.type,
                ok: false,
                error: String(err?.message || err),
            });
            if (payload?.meta?.stop_on_error !== false) break;
        }
    }

    const replyBody = {
        ok: allOk,
        req_id: reqId,
        client: {
            tab_id: TAB_ID,
            title: document.title,
            visibility: document.visibilityState,
            nodes_count: (getGraph()?._nodes || []).length,
        },
        results: results.length === 1 ? results[0] : results,
    };

    try {
        await api.fetchApi("/evm/live/reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(replyBody),
        });
    } catch (err) {
        console.error("[ComfyUI-EVM-Live-Agent] Erro ao enviar resposta:", err);
    }
}

function installCanvasPulseRenderer() {
    const LGC = window.LGraphCanvas;
    if (!LGC || !LGC.prototype || LGC.prototype.__evmLiveAgentPulseInstalled) return;
    LGC.prototype.__evmLiveAgentPulseInstalled = true;

    const origOnDrawOverlay = LGC.prototype.onDrawOverlay;
    LGC.prototype.onDrawOverlay = function (ctx) {
        if (typeof origOnDrawOverlay === "function") {
            origOnDrawOverlay.apply(this, arguments);
        }
        if (_pulses.length === 0) return;

        const g = this.graph;
        if (!g) return;
        const now = performance.now();

        ctx.save();
        try {
            // Aplica a transformação de câmera (offset e zoom) do LiteGraph
            if (this.ds) {
                ctx.scale(this.ds.scale, this.ds.scale);
                ctx.translate(this.ds.offset[0], this.ds.offset[1]);
            }
            for (const p of _pulses) {
                const n = g.getNodeById(p.nodeId);
                if (!n) continue;
                const progress = Math.max(0, Math.min(1, (now - p.started) / (p.until - p.started)));
                const alpha = 1 - progress;
                const expand = 8 + progress * 18;
                const x = Number(n.pos?.[0] || 0) - expand;
                const y = Number(n.pos?.[1] || 0) - 30 - expand;
                const w = Number(n.size?.[0] || 200) + expand * 2;
                const h = Number(n.size?.[1] || 100) + 30 + expand * 2;

                ctx.strokeStyle = p.color || "#38bdf8";
                ctx.globalAlpha = alpha * 0.9;
                ctx.lineWidth = Math.max(2, 3.5 / (this.ds?.scale || 1));
                ctx.beginPath();
                if (typeof ctx.roundRect === "function") {
                    ctx.roundRect(x, y, w, h, 12);
                } else {
                    ctx.rect(x, y, w, h);
                }
                ctx.stroke();
            }
        } catch (_e) {}
        ctx.restore();
    };
}

async function sendHeartbeat() {
    try {
        await api.fetchApi("/evm/live/heartbeat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                tab_id: TAB_ID,
                title: document.title,
                visibility: document.visibilityState,
                nodes_count: (getGraph()?._nodes || []).length,
            }),
        });
    } catch (_e) {}
}

app.registerExtension({
    name: "EVM.LiveCanvasAgent",
    async setup() {
        installCanvasPulseRenderer();
        if (window.__evmLiveAgentHandler) {
            try {
                api.removeEventListener("evm.live.request", window.__evmLiveAgentHandler);
            } catch (_e) {}
        }
        window.__evmLiveAgentHandler = handleLiveRequest;
        api.addEventListener("evm.live.request", handleLiveRequest);

        window.EVMLiveAgent = {
            tabId: TAB_ID,
            executeAction: (act) => executeAction(act, new Map()),
            showToast: showAgentToast,
        };

        await sendHeartbeat();
        if (window.__evmLiveHeartbeatTimer) clearInterval(window.__evmLiveHeartbeatTimer);
        window.__evmLiveHeartbeatTimer = setInterval(sendHeartbeat, 25000);
        console.log(`[ComfyUI-EVM-Live-Agent] Ponte ao vivo ativa (${TAB_ID}).`);
    },
});
