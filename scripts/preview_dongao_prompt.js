#!/usr/bin/env node
/**
 * 本地预览东澳岛语料拼接与 prompt v2（不连微信云、不调模型）。
 *
 * 用法：
 *   node scripts/preview_dongao_prompt.js 婚礼堂
 *   node scripts/preview_dongao_prompt.js 婚礼堂 --pref=couple
 *   node scripts/preview_dongao_prompt.js 听涛步道 --recent="在码头边听三种声音|数一数音乐阶梯"
 *
 * 读取：
 *   东澳岛/data/corpus/_index.json
 *   东澳岛/data/corpus/{mapName}.json（可缺失，缺失时只走 L2）
 * 复用：
 *   cloudfunctions/dongaoGenerate/corpus.js（与线上同一份纯函数）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const corpusLib = require('../cloudfunctions/dongaoGenerate/corpus');

const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, '东澳岛', 'data', 'corpus');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function parseArgs(argv) {
  const result = { mapName: '', preference: 'general', recentMissions: [] };
  argv.forEach(function (item) {
    if (item.indexOf('--pref=') === 0) {
      result.preference = item.slice(7);
      return;
    }
    if (item.indexOf('--recent=') === 0) {
      result.recentMissions = item.slice(9).split('|').map(function (text) { return text.trim(); }).filter(Boolean);
      return;
    }
    if (!result.mapName && item.indexOf('--') !== 0) result.mapName = item.trim();
  });
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mapName) {
    console.error('用法: node scripts/preview_dongao_prompt.js <mapName> [--pref=couple|family|elder|hardcore] [--recent="任务A|任务B"]');
    process.exit(1);
  }

  const index = readJsonSafe(path.join(CORPUS_DIR, '_index.json'));
  const spot = readJsonSafe(path.join(CORPUS_DIR, args.mapName + '.json'));
  if (!index) {
    console.warn('[warn] 未找到 ' + path.join(CORPUS_DIR, '_index.json') + '，将只演示无语料回退路径');
  }
  if (!spot) {
    console.warn('[warn] 未找到 ' + args.mapName + '.json（该点位无 L1 档案，只走 L2/L3）');
  }

  const corpusContext = corpusLib.buildCorpusContext({
    mapName: args.mapName,
    spot: spot,
    index: index,
    preference: args.preference,
    recentMissions: args.recentMissions,
  });

  const time = {
    currentTime: '2026-11-08 15:20',
    season: '秋',
    hour: 15,
    minute: 20,
  };
  const weatherSummary = '15时时段，多云，23°C，降水0mm，日出06:34，日落17:48';
  const tideSummary = '当前潮汐时段：15时，潮高1.42m';
  const visitorRules = '注意人身安全，遵守景区规定；海边湿滑，礁石区域不要单独前往。';

  console.log('===== 语料命中 =====');
  console.log(JSON.stringify(corpusContext.stats, null, 2));
  if (!corpusContext.text) {
    console.log('\n[提示] 无语料命中，线上会走原有 v1 prompt。');
    return;
  }

  const isFoodMode = corpusContext.mode === 'food';
  const prompt = isFoodMode
    ? corpusLib.buildPromptFoodV2({
      mapName: args.mapName,
      corpusText: corpusContext.text,
      weatherSummary: weatherSummary,
      time: time,
      recentMissions: args.recentMissions,
    })
    : corpusLib.buildPromptV2({
      mapName: args.mapName,
      corpusText: corpusContext.text,
      weatherSummary: weatherSummary,
      tideSummary: tideSummary,
      visitorRules: visitorRules,
      time: time,
      recentMissions: args.recentMissions,
    });

  console.log('\n===== 生成模式：' + (isFoodMode ? '美食推荐（餐厅点位）' : '景点漫步任务') + ' =====');
  if (isFoodMode) console.log('兜底菜名：' + (corpusContext.picks.join('／') || '（无菜单）'));
  console.log('\n===== corpus text（注入 ' + corpusContext.text.length + ' 字符） =====');
  console.log(corpusContext.text);
  console.log('\n===== systemPrompt =====');
  console.log(prompt.systemPrompt);
  console.log('\n===== userPrompt =====');
  console.log(prompt.userPrompt);
}

main();
