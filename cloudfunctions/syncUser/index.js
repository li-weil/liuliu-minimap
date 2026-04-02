const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const TEXT_RISK_PATTERN = /(?:加微|加v|vx|v信|微信号|qq|扣扣|色情网|裸聊|约炮|招嫖|嫖娼|赌博|博彩|彩票|刷单|返利|代开发票|办证|毒品|冰毒|海洛因|枪支|炸药)/i;

function normalizeText(value, maxLength = 30) {
  return String(value || '').trim().slice(0, maxLength);
}

function isContentSecurityRejected(error) {
  const message = String((error && error.message) || (error && error.errMsg) || '').toLowerCase();
  return (
    message.includes('risky') ||
    message.includes('content violate') ||
    message.includes('content security') ||
    message.includes('msgseccheck') ||
    message.includes('errcode: 87014') ||
    message.includes('errcode:87014')
  );
}

function shouldSkipCloudSecurity(error) {
  const message = String((error && error.message) || (error && error.errMsg) || '').toLowerCase();
  return (
    message.includes('msgseccheck is not a function') ||
    message.includes('openapi') ||
    message.includes('api unsupported') ||
    message.includes('invalid scope') ||
    message.includes('not available')
  );
}

async function ensureSafeNickName(content) {
  const normalized = normalizeText(content);
  if (!normalized) {
    return '';
  }
  if (TEXT_RISK_PATTERN.test(normalized)) {
    throw new Error('nickname_risky');
  }

  if (
    cloud.openapi &&
    cloud.openapi.security &&
    typeof cloud.openapi.security.msgSecCheck === 'function'
  ) {
    try {
      await cloud.openapi.security.msgSecCheck({ content: normalized });
    } catch (error) {
      if (isContentSecurityRejected(error)) {
        throw new Error('nickname_risky');
      }
      if (!shouldSkipCloudSecurity(error)) {
        throw error;
      }
    }
  }

  return normalized;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const collection = db.collection('users');
  const action = event.action || 'sync';
  const incomingProfile = event.profile && typeof event.profile === 'object'
    ? event.profile
    : event;
  const safeNickName = await ensureSafeNickName(incomingProfile.nickName || '');
  const profile = {
    nickName: safeNickName,
    avatarUrl: incomingProfile.avatarUrl || '',
  };

  if (!openid) {
    throw new Error('missing_openid');
  }

  if (action === 'get') {
    try {
      const userDoc = await collection.doc(openid).get();
      return {
        loggedIn: !!(userDoc && userDoc.data),
        user: userDoc && userDoc.data ? userDoc.data : null,
        openid,
      };
    } catch (error) {
      return {
        loggedIn: false,
        user: null,
        openid,
      };
    }
  }

  try {
    await collection.doc(openid).get();
    await collection.doc(openid).update({
      data: {
        nickName: profile.nickName || '微信用户',
        avatarUrl: profile.avatarUrl || '',
        lastLoginAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
  } catch (error) {
    await collection.doc(openid).set({
      data: {
        openid,
        nickName: profile.nickName || '微信用户',
        avatarUrl: profile.avatarUrl || '',
        role: 'user',
        createdAt: db.serverDate(),
        lastLoginAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
  }

  const userDoc = await collection.doc(openid).get();
  return {
    loggedIn: true,
    user: userDoc.data,
    openid,
  };
};
