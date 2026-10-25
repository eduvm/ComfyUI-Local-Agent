# ComfyUI-EVM-Live-Agent (`EVM Live Canvas Bridge`)

Ponte bidirecional em tempo real (**HTTP + WebSocket nativo do `PromptServer`**) para o ComfyUI, criada em pacote separado (`ComfyUI-EVM-Live-Agent`) para permitir que agentes de IA locais (Antigravity, Hermes, Codex, DSH, OpenCode) inspecionem e editem o **canvas aberto no navegador ao vivo**, com feedback visual instantâneo (pulsos luminosos nos nós, toasts de ação, foco de câmera e criação de `EVM Groups`).

---

## Como funciona

1. **Backend (`__init__.py`):** Registra endpoints leves no `PromptServer` do ComfyUI:
   - `GET /evm/live/ping`: Verifica abas conectadas e testa o RTT via WebSocket (`evm.live.request`).
   - `GET /evm/live/state`: Retorna todos os nós da aba aberta, valores de widgets, links, `evmGroups`, câmera e **quais nós estão selecionados pelo mouse**.
   - `POST /evm/live/exec`: Envia uma operação (ou lista de operações sequenciais com `step_delay_ms`) para o navegador executar ao vivo no `app.graph` (`LiteGraph`).
   - `POST /evm/live/reply` & `POST /evm/live/heartbeat`: Canais internos de resposta do navegador.

2. **Frontend (`js/EVM_Live_Agent.js`):**
   - Escuta eventos `evm.live.request` pelo WebSocket nativo do ComfyUI (`api.addEventListener`).
   - Executa operações diretamente sobre a instância viva do `LiteGraph` (`app.canvas.graph`).
   - Atualiza simultaneamente `widget.value`, `node.widgets_values` e `node.widgets_values_named` (respeitando a Regra Inviolável de Widgets do ComfyUI).
   - Desenha anéis de pulso animados (`onDrawOverlay`) e notificações toast no canto inferior direito a cada ação do agente.
   - Integra-se nativamente com `window.EVMGroupSetGet` (`ComfyUI-EVM-Advanced-Group`) para criar grupos `EVM Group` com trilhos `GetNode`/`SetNode` e organizar workflows inteiros ao vivo.

---

## Operações Suportadas (`POST /evm/live/exec`)

| `op` | Parâmetros principais | O que faz na tela ao vivo |
| :--- | :--- | :--- |
| `get_state` | `include_full_graph` (bool) | Lê todos os nós, widgets, conexões e seleção atual do mouse. |
| `clear_canvas` | — | Limpa o canvas atual. |
| `add_node` | `node_type`, `title`, `pos`, `size`, `widgets`, `alias`, `focus` | Cria um nó ao vivo, preenche widgets, registra alias (`$meu_no`) e pulsa em azul. |
| `connect` | `from`, `from_slot`, `to`, `to_slot` | Conecta dois nós pelo ID, título (`@Titulo`) ou alias (`$alias`) e nome/índice do slot. |
| `disconnect` | `to`, `to_slot` | Desconecta um slot de entrada. |
| `set_widget` | `node`, `widget`, `value` (ou `widgets: {...}`) | Altera valores de widgets ao vivo na tela (atualiza `widgets_values` + `widgets_values_named`). |
| `move_node` | `node`, `pos`, `size`, `title`, `color`, `collapsed` | Move, redimensiona, renomeia, colore ou minimiza um nó. |
| `remove_node` | `node` | Remove o nó do canvas. |
| `select_nodes` | `nodes` (lista), `focus` (bool) | Seleciona os nós indicados no canvas e opcionalmente centraliza a câmera neles. |
| `focus` | `nodes` (opcional), `zoom` (opcional) | Centraliza a câmera do usuário nos nós especificados (ou no workflow todo). |
| `create_evm_group` | `nodes` (lista), `title`, `color`, `tidy` | Empacota os nós em um **EVM Group** com auto-layout na grade de 3 quadradinhos. |
| `organize_workflow` | — | Aciona o organizador automático completo do `EVM Advanced Group`. |
| `load_graph` | `workflow` (JSON object) | Carrega um JSON completo direto na aba aberta sem precisar de Ctrl+O. |
| `toast` | `text`, `badge`, `duration` | Exibe um aviso visual no canto da tela do ComfyUI. |
