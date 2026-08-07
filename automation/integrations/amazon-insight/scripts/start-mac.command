#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AUTOMATION_DIR="$(cd "$WEB_DIR/../.." && pwd)"
LOCAL_NODE_BIN="$(cd "$WEB_DIR/../../.." && pwd)/.local/node/bin"

if ! command -v node >/dev/null 2>&1 && [ -x "$LOCAL_NODE_BIN/node" ]; then
  export PATH="$LOCAL_NODE_BIN:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js 22 LTS：https://nodejs.org/"
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "当前 Node.js 版本过低，请安装 Node.js 20.9 或更高版本（建议 22 LTS）。"
  exit 1
fi

if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
  if [ ! -x "$AUTOMATION_DIR/.venv/bin/python" ]; then
    echo "正在初始化本地自动化 Python 环境……"
    python3 -m venv "$AUTOMATION_DIR/.venv"
    "$AUTOMATION_DIR/.venv/bin/python" -m pip install --upgrade pip
    "$AUTOMATION_DIR/.venv/bin/python" -m pip install -e "$AUTOMATION_DIR"
  fi
  export STORE_OPS_PYTHON="$AUTOMATION_DIR/.venv/bin/python"
else
  echo "提示：未找到 Python 3.10+，网页可以调试，但一键数据重建功能不可用。"
fi

cd "$WEB_DIR"

# Prisma CLI resolves the schema database under prisma/, while Next runs from
# the web root. Pin the same file for both processes unless the caller opted in
# to another database explicitly.
export DATABASE_URL="${DATABASE_URL:-file:$WEB_DIR/prisma/dev.db}"

if [ ! -f .env ]; then
  cp .env.example .env
fi

if [ ! -d node_modules ]; then
  echo "正在安装适用于当前 Mac 架构的网页依赖……"
  npm ci
fi

npm run db:generate
npm run db:push

echo ""
echo "Measureman Ops 将启动在：http://localhost:3000/login"
echo "关闭本窗口或按 Control+C 可停止服务。"
echo ""

(sleep 4; open "http://localhost:3000/login") &
npm run dev -- --hostname 0.0.0.0
