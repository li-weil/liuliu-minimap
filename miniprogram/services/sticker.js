const { callApi } = require('./api');

function generateStickerPlan(payload) {
  return callApi('generateStickerPlan', {
    ...payload,
    stage: 'plan',
  });
}

function generateStickerImage(payload) {
  return callApi('generateStickerImage', {
    ...payload,
    stage: 'image',
  });
}

function generateCompanionNote(payload) {
  return callApi('generateCompanionNote', {
    ...payload,
    stage: 'companion-note',
  });
}

module.exports = {
  generateCompanionNote,
  generateStickerPlan,
  generateStickerImage,
};
