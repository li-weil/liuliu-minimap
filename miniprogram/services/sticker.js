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

module.exports = {
  generateStickerPlan,
  generateStickerImage,
};
