const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function normalizeText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    if (!openid) {
      throw new Error('missing_openid');
    }

    const category = normalizeText(event.category, 30);
    const message = normalizeText(event.message, 500);
    if (!category) {
      throw new Error('missing_category');
    }
    if (!message) {
      throw new Error('missing_message');
    }

    const now = Date.now();
    const payload = {
      sourceType: normalizeText(event.sourceType, 30) || 'unknown',
      scene: normalizeText(event.scene, 30) || '',
      roomId: normalizeText(event.roomId, 60) || '',
      contributionId: normalizeText(event.contributionId, 60) || '',
      missionKey: normalizeText(event.missionKey, 120) || '',
      targetUserId: normalizeText(event.targetUserId, 60) || '',
      targetNickName: normalizeText(event.targetNickName, 60) || '',
      category,
      message,
      status: 'pending',
      reporterOpenId: openid,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection('contentFeedback').add({ data: payload });
    return {
      ok: true,
      id: result._id,
    };
  } catch (error) {
    return {
      ok: false,
      reason: String((error && error.message) || (error && error.errMsg) || 'unknown_error'),
    };
  }
};
