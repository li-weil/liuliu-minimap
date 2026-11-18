#!/usr/bin/env node
// cbx-mcp — 用项目内凭据启动 CloudBase MCP（stdio），供任意 MCP 客户端使用
//   node cbx-mcp.mjs --project <项目目录> [--cli-dir <CLI 目录>] [--home <状态目录>]
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

function fail(msg) {
  process.stderr.write("[cbx-mcp] " + msg + "\n");
  process.exit(1);
}

function parseArgs(argv) {
  const out = { project: "", cliDir: "", home: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project" && i + 1 < argv.length) out.project = argv[++i];
    else if (a.indexOf("--project=") === 0) out.project = a.slice(10);
    else if (a === "--cli-dir" && i + 1 < argv.length) out.cliDir = argv[++i];
    else if (a.indexOf("--cli-dir=") === 0) out.cliDir = a.slice(10);
    else if (a === "--home" && i + 1 < argv.length) out.home = argv[++i];
    else if (a.indexOf("--home=") === 0) out.home = a.slice(7);
    else fail("未知参数: " + a + "（可用 --project/--cli-dir/--home）");
  }
  return out;
}

function credFileName() {
  const profile = (process.env.CBX_PROFILE || "").trim();
  return profile ? "credentials." + profile + ".env" : "credentials.env";
}

function findProjectRoot(start) {
  let dir = resolve(start);
  for (;;) {
    const base = join(dir, ".cloudbase");
    if (existsSync(join(base, credFileName())) || existsSync(join(base, "project.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return "";
    dir = parent;
  }
}

function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.charAt(0) === "#") continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2) {
      const first = val.charAt(0);
      const last = val.charAt(val.length - 1);
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const project = args.project
  ? resolve(args.project)
  : process.env.CBX_PROJECT
    ? resolve(process.env.CBX_PROJECT)
    : findProjectRoot(process.cwd());
if (!project) fail("找不到项目：用 --project <dir> 指定，或设置 CBX_PROJECT");

const credFile = join(project, ".cloudbase", credFileName());
const creds = readEnvFile(credFile);
const envId = (process.env.CLOUDBASE_ENV_ID || creds.CLOUDBASE_ENV_ID || "").trim();
const apiKey = (process.env.CLOUDBASE_API_KEY || creds.CLOUDBASE_API_KEY || "").trim();
const site = (process.env.TCB_SITE || creds.TCB_SITE || "domestic").trim();
const region = (process.env.TCB_REGION || creds.TCB_REGION || "").trim();
if (!envId) fail("缺少 CLOUDBASE_ENV_ID：检查 " + credFile);
if (!apiKey) fail("缺少 CLOUDBASE_API_KEY：把管理员签发的 Key 填进 " + credFile);

const cbxHome = process.env.CBX_HOME || join(homedir(), ".cloudbase");
const cliDir = args.cliDir ? resolve(args.cliDir) : join(cbxHome, "cli");
const mcpCli = join(cliDir, "node_modules", "@cloudbase", "cloudbase-mcp", "dist", "cli.cjs");
if (!existsSync(mcpCli)) fail("找不到 CloudBase MCP：" + mcpCli + "（先在该项目运行 cbx setup）");

// MCP 会往 ~/.cloudbase-mcp/logs 写日志；HOME 指到项目独立状态目录，避免撞到只读位置
let stateHome = args.home ? resolve(args.home) : "";
if (!stateHome) {
  const base = project.split(/[\\/]/).filter(Boolean).pop() || "project";
  const stamp = createHash("sha1").update(project).digest("hex").slice(0, 8);
  stateHome = join(cbxHome, "state", base + "-" + stamp);
}
mkdirSync(stateHome, { recursive: true });

const childEnv = Object.assign({}, process.env, {
  CLOUDBASE_ENV_ID: envId,
  CLOUDBASE_API_KEY: apiKey,
  TCB_SITE: site,
  HOME: stateHome,
  USERPROFILE: stateHome,
});
if (region) childEnv.TCB_REGION = region;

const child = spawn(process.execPath, [mcpCli], { cwd: project, env: childEnv, stdio: "inherit" });
child.on("error", (err) => fail("启动 MCP 失败：" + err.message));
child.on("exit", (code) => process.exit(code === null ? 1 : code));
