const https = require('https');
const fileConfig = require('./config');

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || fileConfig.timeoutMs || 12000);

function requestJson(urlString, options, body) {
  const url = new URL(urlString);

  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'POST',
      headers: options.headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error && parsed.error.message ? parsed.error.message : `http_${res.statusCode}`));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`ai_request_timeout_${REQUEST_TIMEOUT_MS}ms`)));
    req.write(body);
    req.end();
  });
}

function parseAssistantText(payload) {
  return payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content || ''
    : '';
}

function stripCodeFence(text) {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

function getAiConfig() {
  return {
    apiKey: process.env.AI_API_KEY || fileConfig.apiKey || '',
    baseUrl: process.env.AI_BASE_URL || fileConfig.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: process.env.AI_CHAT_MODEL || fileConfig.model || 'deepseek-v3.2',
  };
}

async function chatJson(systemPrompt, userPrompt) {
  const result = await chatJsonWithMeta(systemPrompt, userPrompt);
  return result.parsed;
}

async function chatJsonWithMeta(systemPrompt, userPrompt) {
  const config = getAiConfig();
  if (!config.apiKey) {
    throw new Error('missing_ai_api_key');
  }

  const payload = await requestJson(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  }, JSON.stringify({
    model: config.model,
    temperature: 1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  }));

  const rawText = String(parseAssistantText(payload) || '');
  const strippedText = stripCodeFence(rawText);
  return {
    parsed: JSON.parse(strippedText || '{}'),
    rawText,
    strippedText,
    finishReason: payload && payload.choices && payload.choices[0] ? payload.choices[0].finish_reason || '' : '',
    responseId: String(payload && payload.id || '').trim(),
    responseModel: String(payload && payload.model || '').trim(),
    usage: payload && payload.usage && typeof payload.usage === 'object' ? payload.usage : null,
  };
}

module.exports = {
  chatJson,
  chatJsonWithMeta,
  getAiConfig,
};
