#!/usr/bin/env node
'use strict';

// 东澳岛 AI 生成云端自检（二期新增内容）
// 只验证语料、点位库、美食推荐模式，不覆盖其它页面。
//
// 用法：
//   node scripts/verify_dongao_cloud.js               # 全量（会调用 7 次 dongaoGenerate，消耗少量模型额度）
//   node scripts/verify_dongao_cloud.js --no-generate # 只查数据/存储/部署，不调模型
//
// 依赖：本机已按 private/云开发接入通用方案.md 装好 cbx，且项目根有 .cloudbase/credentials.env。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, '东澳岛', 'data', 'corpus');
const MODEL_AUDIT = process.argv.indexOf('--no-generate') < 0;

const FOOD_POINTS = ['万觅餐吧', '东发海鲜酒家', '是旦有愉食堂', '是旦海鲜餐厅', '精致拾光', '聚鲜楼'];
const SPOT_POINTS = ['珠海东澳岛万豪度假酒店', '万觅书店'];
const NO_MENU_POINT = '潮汐咖啡';
const PRICE_RE = /[¥￥]\s*\d|\d+\s*元/;

const results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

function runCbx(args) {
  return execFileSync('bash', ['-c', 'export PATH="$HOME/.cloudbase/bin:$PATH"; cbx "$@"', 'cbx'].concat(args), {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseJsonLoose(text) {
  const i = String(text || '').indexOf('{');
  if (i < 0) throw new Error('no json in output: ' + String(text).slice(0, 200));
  return JSON.parse(String(text).slice(i));
}

function dbCommand(table, command) {
  const payload = JSON.stringify([{ TableName: table, CommandType: 'COMMAND', Command: JSON.stringify(command) }]);
  const out = runCbx(['db', 'nosql', 'execute', '--command', payload, '--json']);
  const parsed = parseJsonLoose(out);
  return (parsed.data && parsed.data.results && parsed.data.results[0]) || [];
}

function listStorage(prefix) {
  const parsed = parseJsonLoose(runCbx(['storage', 'list', prefix, '--json']));
  return { files: (parsed.data || []).map(function (item) { return item.key; }), total: (parsed.meta && parsed.meta.total) || 0 };
}

function loadMenuItems(mapName) {
  const file = path.join(CORPUS_DIR, mapName + '.json');
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const menu = data.menu || {};
  const items = [];
  (menu.dishes || []).forEach(function (dish) { if (dish && dish.name) items.push(String(dish.name)); });
  (menu.packages || []).forEach(function (pkg) {
    if (pkg && pkg.name) items.push(String(pkg.name));
    (pkg && pkg.items || []).forEach(function (item) { if (item) items.push(String(item)); });
  });
  return items.filter(Boolean);
}

function invokeGenerate(payload) {
  const out = runCbx(['fn', 'invoke', 'dongaoGenerate', '-d', JSON.stringify(payload), '--json']);
  const parsed = parseJsonLoose(out);
  const data = parsed.data || {};
  const card = JSON.parse(data.RetMsg || '{}');
  return { card: card, errMsg: data.ErrMsg || '', durationMs: data.Duration || null };
}

// ---------- 0. 环境 ----------
let envReady = false;
try {
  const info = runCbx(['info']);
  const envMatch = info.match(/环境 ID\s+(\S+)/);
  envReady = true;
  check('cbx 可用并识别云环境', true, envMatch ? 'envId=' + envMatch[1] : '');
} catch (e) {
  check('cbx 可用并识别云环境', false, '先按 private/云开发接入通用方案.md 安装 cbx 并配置 .cloudbase/credentials.env');
}

if (!envReady) {
  console.log('\n跳过后续检查：本机没有可用的 cbx 凭据。');
  process.exit(2);
}

// ---------- 1. 语料存储 ----------
const localCorpus = fs.readdirSync(CORPUS_DIR).filter(function (name) { return /\.json$/.test(name); }).sort();
check('本地语料文件数 = 26', localCorpus.length === 26, 'actual=' + localCorpus.length);
try {
  const cloud = listStorage('dongao-corpus/');
  const cloudNames = cloud.files.map(function (key) { return key.replace('dongao-corpus/', ''); });
  const missing = localCorpus.filter(function (name) { return cloudNames.indexOf(name) < 0; });
  const extra = cloudNames.filter(function (name) { return localCorpus.indexOf(name) < 0; });
  check('云存储 dongao-corpus/ 与本地一致', missing.length === 0 && extra.length === 0,
    'cloud=' + cloudNames.length + ' missing=' + (missing.length ? missing.join(',') : 'none') + ' extra=' + (extra.length ? extra.join(',') : 'none'));
} catch (e) {
  check('云存储 dongao-corpus/ 与本地一致', false, String(e.message || e).slice(0, 160));
}

// ---------- 2. 点位库 ----------
try {
  const docs = dbCommand('spots', { find: 'spots', filter: {}, projection: { map_name: 1, category: 1, location: 1 }, limit: 500 }) || [];
  const names = docs.map(function (doc) { return doc.map_name; });
  const dup = names.filter(function (name, index) { return names.indexOf(name) !== index; });
  const dist = {};
  docs.forEach(function (doc) { const key = doc.category || '(none)'; dist[key] = (dist[key] || 0) + 1; });
  const noLocation = docs.filter(function (doc) { return !doc.location; }).length;
  check('spots 点位 = 65 且无重复', docs.length === 65 && dup.length === 0, 'actual=' + docs.length + ' dup=' + (dup.length ? dup.join(',') : 'none'));
  check('spots 分类齐全', dist.spot === 52 && dist.stay === 5 && dist.food === 7 && dist.shop === 1, JSON.stringify(dist));
  check('spots 全部有 location', noLocation === 0, 'missing=' + noLocation);
} catch (e) {
  check('spots 点位入库检查', false, String(e.message || e).slice(0, 160));
}

// ---------- 3. dongaoCards 集合 ----------
try {
  const collections = dbCommand('spots', { listCollections: 1 }) || [];
  const names = collections.map(function (item) { return item.name; });
  check('dongaoCards 集合存在', names.indexOf('dongaoCards') >= 0, 'collections=' + names.length);
} catch (e) {
  check('dongaoCards 集合存在', false, String(e.message || e).slice(0, 160));
}

// ---------- 4. 生成（可选） ----------
if (MODEL_AUDIT) {
  FOOD_POINTS.forEach(function (name) {
    try {
      const res = invokeGenerate({ map_name: name });
      const card = res.card || {};
      const input = (card.debug && card.debug.modelInput) || {};
      const output = (card.debug && card.debug.modelOutput) || {};
      const corpus = input.corpus || {};
      const mission = String(card.mission || '');
      const grounded = loadMenuItems(name).filter(function (item) { return item.length >= 2 && mission.indexOf(item) >= 0; });
      const problems = [];
      if (card.mode !== 'food') problems.push('mode=' + card.mode);
      if (corpus.hit !== 'L1') problems.push('hit=' + corpus.hit);
      if (!(corpus.dishCount > 0)) problems.push('dishCount=0');
      if (output.usedFallback) problems.push('fallback=' + output.fallbackReason);
      if (!mission) problems.push('mission empty');
      if (PRICE_RE.test(mission)) problems.push('菜价泄漏');
      if (grounded.length < 2) problems.push('菜单菜名落地不足（' + grounded.length + '）');
      check('生成·美食推荐 ' + name, problems.length === 0, problems.length ? problems.join('; ') : mission);
    } catch (e) {
      check('生成·美食推荐 ' + name, false, String(e.message || e).slice(0, 160));
    }
  });

  SPOT_POINTS.forEach(function (name) {
    try {
      const res = invokeGenerate({ map_name: name });
      const card = res.card || {};
      const corpus = ((card.debug && card.debug.modelInput) || {}).corpus || {};
      const output = (card.debug && card.debug.modelOutput) || {};
      const problems = [];
      if (card.mode !== 'spot') problems.push('mode=' + card.mode);
      if (corpus.hit !== 'L1') problems.push('hit=' + corpus.hit);
      if (output.usedFallback) problems.push('fallback=' + output.fallbackReason);
      if (!card.mission) problems.push('mission empty');
      check('生成·点位任务 ' + name, problems.length === 0, problems.length ? problems.join('; ') : card.mission);
    } catch (e) {
      check('生成·点位任务 ' + name, false, String(e.message || e).slice(0, 160));
    }
  });

  try {
    const res = invokeGenerate({ map_name: NO_MENU_POINT });
    const card = res.card || {};
    check('生成·无菜单餐饮点位退回任务模式 ' + NO_MENU_POINT, card.mode === 'spot' && !!card.mission, 'mode=' + card.mode);
  } catch (e) {
    check('生成·无菜单餐饮点位退回任务模式 ' + NO_MENU_POINT, false, String(e.message || e).slice(0, 160));
  }
} else {
  console.log('SKIP  生成检查（--no-generate）');
}

// ---------- 汇总 ----------
const failed = results.filter(function (item) { return !item.ok; });
console.log('\n结果：' + (results.length - failed.length) + '/' + results.length + ' 通过');
if (failed.length) {
  failed.forEach(function (item) { console.log('  FAIL ' + item.name + '  ' + item.detail); });
  process.exit(1);
}
console.log('全部通过：东澳岛二期云端状态正常。');
