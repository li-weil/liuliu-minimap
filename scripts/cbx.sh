#!/usr/bin/env bash
# cbx — 通用 CloudBase 访问入口（无需浏览器登录，凭据来自项目内文件）
#
#   项目约定：<project>/.cloudbase/credentials.env   （加入 .gitignore）
#             <project>/.cloudbase/project.json     （可提交，记录 envId/site/region）
#   全局目录：$CBX_HOME（默认 ~/.cloudbase）
#             cli/     固定版本 @cloudbase/cli + @cloudbase/cloudbase-mcp（只装一次）
#             state/   每个项目的独立登录状态（不同项目互不串号）
#             bin/     cbx 与 MCP 启动器
#
#   子命令：install setup init login info mcp run，其他参数原样交给 tcb
set -u

say() { printf '%s\n' "$*" >&2; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

init_globals() {
  CBX_VERSION="1.0.0"
  CBX_PROFILE=${CBX_PROFILE:-}
  CBX_HOME=${CBX_HOME:-$HOME/.cloudbase}
  CLI_VERSION=${CBX_CLI_VERSION:-3.9.2}
  MCP_VERSION=${CBX_MCP_VERSION:-2.37.5}
  CLI_DIR="$CBX_HOME/cli"
  STATE_ROOT="$CBX_HOME/state"
  BIN_DIR="$CBX_HOME/bin"
  SELF="$0"
  [ "$SELF" = "bash" ] && SELF=""
  SELF_DIR=""
  if [ -n "$SELF" ]; then
    SELF_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd)"
  fi
  [ -n "$SELF_DIR" ] || SELF_DIR="$(pwd)"
  TCB_BIN="$CLI_DIR/node_modules/@cloudbase/cli/bin/tcb"
  MCP_BIN="$CLI_DIR/node_modules/@cloudbase/cloudbase-mcp/dist/cli.cjs"
  CLOUDBASE_API_KEY=${CLOUDBASE_API_KEY:-}
  CLOUDBASE_ENV_ID=${CLOUDBASE_ENV_ID:-}
  TCB_SITE=${TCB_SITE:-domestic}
  TCB_REGION=${TCB_REGION:-}
}

cred_file_name() {
  if [ -n "$CBX_PROFILE" ]; then
    printf 'credentials.%s.env' "$CBX_PROFILE"
  else
    printf 'credentials.env'
  fi
}

find_project_root() {
  local dir parent
  if [ -n "${CBX_PROJECT:-}" ]; then
    dir="$(cd "$CBX_PROJECT" 2>/dev/null && pwd)" || die "CBX_PROJECT 不是有效目录: $CBX_PROJECT"
    printf '%s' "$dir"
    return 0
  fi
  dir="$(pwd)"
  while :; do
    if [ -f "$dir/.cloudbase/$(cred_file_name)" ] || [ -f "$dir/.cloudbase/project.json" ]; then
      printf '%s' "$dir"
      return 0
    fi
    parent="$(dirname "$dir")"
    [ "$parent" = "$dir" ] && break
    dir="$parent"
  done
  return 1
}

load_credentials() {
  # 读取项目凭据；真实环境变量优先于文件（方便 CI 注入）
  local root="$1" file line key val
  file="$root/.cloudbase/$(cred_file_name)"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    key=${line%%=*}
    val=${line#*=}
    val=${val%$'\r'}
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    val=${val#\"}
    val=${val%\"}
    val=${val#\'}
    val=${val%\'}
    case "$key" in
      CLOUDBASE_API_KEY) [ -n "$CLOUDBASE_API_KEY" ] || CLOUDBASE_API_KEY="$val" ;;
      CLOUDBASE_ENV_ID) [ -n "$CLOUDBASE_ENV_ID" ] || CLOUDBASE_ENV_ID="$val" ;;
      TCB_SITE) TCB_SITE="$val" ;;
      TCB_REGION) [ -n "$TCB_REGION" ] || TCB_REGION="$val" ;;
    esac
  done < "$file"
  return 0
}

project_id() {
  local root="$1" stamp base
  stamp="$(printf '%s' "$root" | cksum | awk '{print $1}')"
  base="$(basename "$root" | tr -cd 'A-Za-z0-9._-')"
  [ -n "$base" ] || base="project"
  if [ -n "$CBX_PROFILE" ]; then
    printf '%s-%s-%s' "$base" "$CBX_PROFILE" "$stamp"
  else
    printf '%s-%s' "$base" "$stamp"
  fi
}

state_home() {
  printf '%s/%s' "$STATE_ROOT" "$(project_id "$1")"
}

key_fingerprint() {
  printf '%s' "$1" | cksum | awk '{print $1}'
}

require_node() {
  command -v node >/dev/null 2>&1 || die "需要 Node.js 18+（找不到 node）"
}

setup_cli() {
  require_node
  say "安装 CloudBase CLI $CLI_VERSION + MCP $MCP_VERSION 到 $CLI_DIR（只装一次，约 50MB）"
  mkdir -p "$CLI_DIR" || die "无法创建 $CLI_DIR"
  local prefix
  prefix="$CLI_DIR"
  if command -v cygpath >/dev/null 2>&1; then prefix="$(cygpath -w "$CLI_DIR")"; fi
  npm install --prefix "$prefix" --no-save --no-audit --no-fund \
      "@cloudbase/cli@$CLI_VERSION" "@cloudbase/cloudbase-mcp@$MCP_VERSION" >&2 \
    || die "npm 安装失败，检查网络或代理设置"
  [ -f "$TCB_BIN" ] && [ -f "$MCP_BIN" ] || die "安装完成但入口文件缺失，请重试"
  say "安装完成"
}

ensure_cli() {
  require_node
  if [ -f "$TCB_BIN" ] && [ -f "$MCP_BIN" ]; then return 0; fi
  setup_cli
}

run_tcb_in() {
  # run_tcb_in <projectRoot> <stateHome> <tcb 参数...>
  local root="$1" shome="$2" shome_win
  shift 2
  mkdir -p "$shome" || die "无法创建登录状态目录 $shome"
  shome_win="$shome"
  if command -v cygpath >/dev/null 2>&1; then shome_win="$(cygpath -w "$shome")"; fi
  ( cd "$root" \
    && HOME="$shome_win" USERPROFILE="$shome_win" NO_COLOR=1 \
       TCB_SITE="$TCB_SITE" \
       node "$TCB_BIN" "$@" )
}

ensure_login() {
  local root="$1" shome="$2" fp
  fp="$(key_fingerprint "$CLOUDBASE_API_KEY")"
  # 同一个 Key：只补一次默认环境，避免每条命令都重登
  if [ -f "$shome/.cbx-key" ] && [ "$(cat "$shome/.cbx-key" 2>/dev/null)" = "$fp" ]; then
    if [ "$(cat "$shome/.cbx-env" 2>/dev/null)" != "$CLOUDBASE_ENV_ID" ]; then
      run_tcb_in "$root" "$shome" env use "$CLOUDBASE_ENV_ID" >/dev/null 2>&1 || true
      printf '%s' "$CLOUDBASE_ENV_ID" > "$shome/.cbx-env"
    fi
    return 0
  fi
  [ -n "$CLOUDBASE_API_KEY" ] || die "缺少 CLOUDBASE_API_KEY：编辑 $root/.cloudbase/$(cred_file_name)"
  [ -n "$CLOUDBASE_ENV_ID" ] || die "缺少 CLOUDBASE_ENV_ID：编辑 $root/.cloudbase/$(cred_file_name)"
  say "为该环境建立登录态（API Key，免扫码）"
  if [ -d "$shome" ]; then run_tcb_in "$root" "$shome" logout >/dev/null 2>&1 || true; fi
  if ! run_tcb_in "$root" "$shome" login --cloudbase-api-key "$CLOUDBASE_API_KEY" -e "$CLOUDBASE_ENV_ID" >/dev/null 2>&1; then
    run_tcb_in "$root" "$shome" login --cloudbase-api-key "$CLOUDBASE_API_KEY" -e "$CLOUDBASE_ENV_ID" >&2
    die "登录失败：检查 API Key 是否有效、是否属于 $CLOUDBASE_ENV_ID"
  fi
  printf '%s' "$fp" > "$shome/.cbx-key"
  run_tcb_in "$root" "$shome" env use "$CLOUDBASE_ENV_ID" >/dev/null 2>&1 || true
  printf '%s' "$CLOUDBASE_ENV_ID" > "$shome/.cbx-env"
}

mask_key() {
  local key="$1" len head tail
  [ -n "$key" ] || { printf '(未配置)'; return 0; }
  len="$(printf '%s' "$key" | wc -c | tr -d ' ')"
  if [ "$len" -gt 16 ]; then
    head="$(printf '%s' "$key" | cut -c1-8)"
    tail="$(printf '%s' "$key" | cut -c$((len - 5))-"$len")"
    printf '%s…%s（%s 字符）' "$head" "$tail" "$len"
  else
    printf '（%s 字符，可能不完整）' "$len"
  fi
}

cmd_install() {
  mkdir -p "$BIN_DIR" || die "无法创建 $BIN_DIR"
  cp "$SELF" "$BIN_DIR/cbx" || die "复制失败"
  if [ -f "$SELF_DIR/cbx-mcp.mjs" ]; then cp "$SELF_DIR/cbx-mcp.mjs" "$BIN_DIR/cbx-mcp.mjs"; fi
  chmod +x "$BIN_DIR/cbx" 2>/dev/null || true
  say "已安装: $BIN_DIR/cbx"
  case ":${PATH:-}:" in
    *":$BIN_DIR:"*) say "CBX 已在 PATH 中" ;;
    *) say "把这一行加进 shell 配置："; say "  export PATH=\"$BIN_DIR:\$PATH\"" ;;
  esac
  say "首次使用前执行一次: cbx setup"
}

cmd_init() {
  local root env_id="" site="" region=""
  root="$(pwd)"
  while [ $# -gt 0 ]; do
    case "$1" in
      --env-id) [ $# -ge 2 ] || die "--env-id 需要值"; env_id="$2"; shift 2 ;;
      --site) [ $# -ge 2 ] || die "--site 需要值"; site="$2"; shift 2 ;;
      --region) [ $# -ge 2 ] || die "--region 需要值"; region="$2"; shift 2 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  mkdir -p "$root/.cloudbase" || die "无法创建 $root/.cloudbase"
  if [ ! -f "$root/.cloudbase/project.json" ]; then
    [ -n "$env_id" ] || die "用法: cbx init --env-id <envId> [--site domestic] [--region ap-shanghai]"
    {
      printf '{\n'
      printf '  "envId": "%s"' "$env_id"
      [ -n "$site" ] && printf ',\n  "site": "%s"' "$site"
      [ -n "$region" ] && printf ',\n  "region": "%s"' "$region"
      printf '\n}\n'
    } > "$root/.cloudbase/project.json"
  fi
  if [ ! -f "$root/.cloudbase/$(cred_file_name)" ]; then
    local old_umask
    old_umask="$(umask)"
    umask 077
    {
      printf '# CloudBase 凭据（cbx）——不要提交到仓库\n'
      printf '# 环境级 API Key 由该环境的管理员签发；CI 可用同名环境变量覆盖\n'
      printf 'CLOUDBASE_ENV_ID=%s\n' "${env_id:-}"
      printf 'CLOUDBASE_API_KEY=\n'
      [ -n "$site" ] && printf 'TCB_SITE=%s\n' "$site"
      [ -n "$region" ] && printf 'TCB_REGION=%s\n' "$region"
    } > "$root/.cloudbase/$(cred_file_name)"
    umask "$old_umask"
  fi
  ensure_gitignore "$root"
  say "已就绪: $root/.cloudbase/"
  say "下一步：把 CLOUDBASE_API_KEY 填进 $(cred_file_name)，然后运行 cbx info 验证"
}

ensure_gitignore() {
  local root="$1" gi="$1/.gitignore"
  if [ -f "$gi" ] && grep -qxF ".cloudbase/$(cred_file_name)" "$gi" 2>/dev/null; then return 0; fi
  if printf '\n# CloudBase 凭据（cbx）\n.cloudbase/%s\n' "$(cred_file_name)" >> "$gi" 2>/dev/null; then
    say "已把 .cloudbase/$(cred_file_name) 加入 .gitignore"
  else
    say "提示：请手动把 .cloudbase/$(cred_file_name) 加入 .gitignore"
  fi
}

cmd_env() {
  local root shome
  root="$(find_project_root)" || die "当前目录不在 CloudBase 项目内（找不到 .cloudbase/credentials.env）"
  load_credentials "$root"
  shome="$(state_home "$root")"
  printf '项目目录   %s\n' "$root"
  printf '环境 ID    %s\n' "${CLOUDBASE_ENV_ID:-(未配置)}"
  printf '站点/地域  %s / %s\n' "$TCB_SITE" "${TCB_REGION:-(默认)}"
  printf 'API Key    %s\n' "$(mask_key "$CLOUDBASE_API_KEY")"
  printf '凭据文件   %s\n' "$root/.cloudbase/$(cred_file_name)"
  printf '登录状态   '
  if [ -f "$shome/.cbx-key" ] && [ "$(cat "$shome/.cbx-key" 2>/dev/null)" = "$(key_fingerprint "$CLOUDBASE_API_KEY")" ] \
     && [ "$(cat "$shome/.cbx-env" 2>/dev/null)" = "$CLOUDBASE_ENV_ID" ]; then
    printf '已登录（状态目录 %s）\n' "$shome"
  else
    printf '未登录（首次执行命令时自动建立）\n'
  fi
  printf 'CLI 目录   %s（固定版本 %s）\n' "$CLI_DIR" "$CLI_VERSION"
}

cmd_login() {
  local root shome
  root="$(find_project_root)" || die "当前目录不在 CloudBase 项目内"
  load_credentials "$root"
  shome="$(state_home "$root")"
  ensure_cli
  rm -f "$shome/.cbx-key"
  ensure_login "$root" "$shome"
  say "登录成功: env=$CLOUDBASE_ENV_ID"
}

cmd_mcp() {
  local root="" proj=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) [ $# -ge 2 ] || die "--project 需要值"; proj="$2"; shift 2 ;;
      *) break ;;
    esac
  done
  if [ -n "$proj" ]; then
    root="$(cd "$proj" 2>/dev/null && pwd)" || die "目录不存在: $proj"
  else
    root="$(find_project_root)" || die "当前目录不在 CloudBase 项目内"
  fi
  ensure_cli
  exec node "$SELF_DIR/cbx-mcp.mjs" --project "$root" --cli-dir "$CLI_DIR" --home "$(state_home "$root")"
}

cmd_run() {
  local root shome
  [ $# -gt 0 ] || die "用法: cbx run -- <命令...>"
  [ "$1" = "--" ] && shift
  root="$(find_project_root)" || die "当前目录不在 CloudBase 项目内"
  load_credentials "$root"
  shome="$(state_home "$root")"
  [ -n "$CLOUDBASE_ENV_ID" ] || die "缺少 CLOUDBASE_ENV_ID"
  local shome_win
  shome_win="$shome"
  if command -v cygpath >/dev/null 2>&1; then shome_win="$(cygpath -w "$shome")"; fi
  ( cd "$root" \
    && HOME="$shome_win" USERPROFILE="$shome_win" NO_COLOR=1 \
       CLOUDBASE_ENV_ID="$CLOUDBASE_ENV_ID" \
       CLOUDBASE_API_KEY="$CLOUDBASE_API_KEY" \
       TCB_SITE="$TCB_SITE" \
       TCB_REGION="$TCB_REGION" \
       "$@" )
}

usage() {
  cat >&2 <<'EOF'
cbx — 通用 CloudBase 访问入口

  安装   cbx install            把 cbx 装到 ~/.cloudbase/bin
         cbx setup              下载固定版本 CloudBase CLI + MCP
  接入   cbx init --env-id ...  在当前项目创建 .cloudbase/{project.json,credentials.env}
  验证   cbx info               查看解析到的项目、环境、登录状态（Key 打码）
  命令   cbx <tcb 子命令...>    例如 cbx fn list --limit 20、cbx db nosql execute ...
  登录   cbx login              用文件里的 API Key 重建登录态
  MCP    cbx mcp [--project X]  以 stdio 启动 CloudBase MCP（给 AI 工具用）
  脚本   cbx run -- <命令...>   带凭据环境变量执行任意命令

环境变量：CBX_HOME(~/.cloudbase) CBX_PROJECT CBX_PROFILE CBX_CLI_VERSION CBX_MCP_VERSION
          CLOUDBASE_API_KEY / CLOUDBASE_ENV_ID 可用真实环境变量覆盖文件
EOF
}

main() {
  init_globals
  local cmd="${1:-}"
  [ $# -gt 0 ] && shift
  case "$cmd" in
    ""|-h|--help|help) usage ;;
    --version|version) printf 'cbx %s (CloudBase CLI %s)\n' "$CBX_VERSION" "$CLI_VERSION" ;;
    install) cmd_install ;;
    setup) setup_cli ;;
    init) cmd_init "$@" ;;
    login) cmd_login ;;
    info) cmd_env ;;
    mcp) cmd_mcp "$@" ;;
    run) cmd_run "$@" ;;
    *)
      local root shome
      root="$(find_project_root)" || die "当前目录不在 CloudBase 项目内：先运行 cbx init --env-id <envId>，或用 CBX_PROJECT 指定项目目录"
      load_credentials "$root"
      [ -n "$CLOUDBASE_ENV_ID" ] || die "缺少 CLOUDBASE_ENV_ID：检查 $root/.cloudbase/$(cred_file_name)"
      [ -n "$CLOUDBASE_API_KEY" ] || die "缺少 CLOUDBASE_API_KEY：把管理员签发的 Key 填进 $root/.cloudbase/$(cred_file_name)"
      ensure_cli
      shome="$(state_home "$root")"
      ensure_login "$root" "$shome"
      run_tcb_in "$root" "$shome" "$cmd" "$@"
      ;;
  esac
}

main "$@"
