const assert = require('assert');

const EXPECTED_BASE_URL = 'https://api.deepseek.com';
const EXPECTED_MODEL = 'deepseek-v4-flash';

function resetEnv() {
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_CHAT_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_CHAT_MODEL;
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function assertThemeAiConfig(modulePath) {
  resetEnv();
  clearModule(modulePath);
  const { getAiConfig } = require(modulePath);
  const config = getAiConfig();
  assert.strictEqual(config.baseUrl, EXPECTED_BASE_URL);
  assert.strictEqual(config.model, EXPECTED_MODEL);
}

assertThemeAiConfig('../cloudfunctions/generateTheme/ai');
assertThemeAiConfig('../cloudfunctions/generateCombinedTheme/ai');

const dongaoConfig = require('../cloudfunctions/dongaoGenerate/config.json');
assert.strictEqual(dongaoConfig.baseUrl, EXPECTED_BASE_URL);
assert.strictEqual(dongaoConfig.model, EXPECTED_MODEL);

resetEnv();
process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
clearModule('../cloudfunctions/generateTheme/ai');
const { getAiConfig } = require('../cloudfunctions/generateTheme/ai');
assert.strictEqual(getAiConfig().apiKey, 'deepseek-test-key');

console.log('DeepSeek AI config verification passed.');
