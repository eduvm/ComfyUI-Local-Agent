#!/usr/bin/env bash
set -euo pipefail

# Installer for the comfyui-local-agent skill and CLI helper.
# Links the bundled skill into common AI coding agent skill directories
# and places `comfy-local-agent` / `evm-live` on ~/.local/bin.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_SRC="${REPO_DIR}/skills/comfyui-local-agent"
CLI_SRC="${REPO_DIR}/bin/evm_live.py"

mkdir -p "${HOME}/.local/bin"
ln -sf "${CLI_SRC}" "${HOME}/.local/bin/comfy-local-agent"
ln -sf "${CLI_SRC}" "${HOME}/.local/bin/evm-live"
echo "✓ Linked CLI: ~/.local/bin/comfy-local-agent (and ~/.local/bin/evm-live)"

# Detect and link into installed agent skill directories
TARGET_DIRS=(
    "${HOME}/.claude/skills"
    "${HOME}/.codex/skills"
    "${HOME}/.cursor/skills"
    "${HOME}/.gemini/config/skills"
    "${HOME}/.hermes/skills"
)

for dir in "${TARGET_DIRS[@]}"; do
    parent="$(dirname "${dir}")"
    if [ -d "${parent}" ]; then
        mkdir -p "${dir}"
        ln -sfn "${SKILL_SRC}" "${dir}/comfyui-local-agent"
        echo "✓ Linked skill: ${dir}/comfyui-local-agent"
    fi
done

echo ""
echo "Done! Your AI agents now have the 'comfyui-local-agent' skill and CLI."
