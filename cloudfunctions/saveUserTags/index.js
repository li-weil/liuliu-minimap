const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 30000,
});

const VALID_TAGS = ['Z世代/情侣客群', '亲子客群', '银发/休闲客群', '资深玩家'];

function sanitizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .map((tag) => String(tag || '').trim())
    .filter((tag) => VALID_TAGS.includes(tag)))];
}

function sanitizeAnswers(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const result = {};
  Object.keys(raw).slice(0, 8).forEach((key) => {
    const value = raw[key];
    if (Number.isInteger(value) && value >= 0 && value <= 9) {
      result[String(key).slice(0, 32)] = value;
    }
  });
  return result;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, error: 'no_openid' };
  }

  const db = cloud.database();
  const collection = db.collection('userProfiles');
  const tags = sanitizeTags(event && event.tags);
  const answers = sanitizeAnswers(event && event.answers);
  const doc = {
    tags,
    answers,
    updatedAt: db.serverDate(),
  };

  try {
    const existing = await collection.where({ _openid: OPENID }).limit(1).get();
    if (existing.data && existing.data.length) {
      await collection.doc(existing.data[0]._id).update({ data: doc });
    } else {
      await collection.add({ data: Object.assign({ _openid: OPENID }, doc) });
    }
    return { ok: true, tags };
  } catch (err) {
    // 集合不存在时自动创建后重试一次（-502005 / COLLECTION_NOT_EXIST）
    const message = String((err && err.message) || '');
    const isMissingCollection = (err && err.errCode === -502005)
      || message.includes('not exists')
      || message.includes('COLLECTION_NOT_EXIST')
      || message.includes('-502005');
    if (!isMissingCollection) {
      console.error('saveUserTags failed:', message);
      return { ok: false, error: message };
    }
    try {
      await db.createCollection('userProfiles');
    } catch (createErr) {
      console.warn('createCollection failed:', createErr && createErr.message);
    }
    try {
      const existing = await collection.where({ _openid: OPENID }).limit(1).get();
      if (existing.data && existing.data.length) {
        await collection.doc(existing.data[0]._id).update({ data: doc });
      } else {
        await collection.add({ data: Object.assign({ _openid: OPENID }, doc) });
      }
      return { ok: true, tags };
    } catch (retryErr) {
      console.error('saveUserTags retry failed:', retryErr && retryErr.message);
      return { ok: false, error: retryErr && retryErr.message };
    }
  }
};
