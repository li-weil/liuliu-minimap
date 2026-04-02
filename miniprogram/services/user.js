const { callApi } = require('./api');

const USER_STORAGE_KEY = 'citywalk_user';
const LOGIN_STATUS_KEY = 'citywalk_login_status';
const MANUAL_LOGOUT_KEY = 'citywalk_manual_logout';

function normalizeUser(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }
  return {
    ...user,
    nickName: user.nickName || user.nickname || '微信用户',
    avatarUrl: user.avatarUrl || '',
  };
}

function getStoredUser() {
  try {
    return normalizeUser(wx.getStorageSync(USER_STORAGE_KEY) || null);
  } catch (error) {
    return null;
  }
}

function hasLoginPreference() {
  try {
    return !!wx.getStorageSync(LOGIN_STATUS_KEY);
  } catch (error) {
    return false;
  }
}

function persistUser(user) {
  const normalizedUser = normalizeUser(user);
  try {
    if (normalizedUser) {
      wx.setStorageSync(USER_STORAGE_KEY, normalizedUser);
      wx.setStorageSync(LOGIN_STATUS_KEY, true);
      wx.removeStorageSync(MANUAL_LOGOUT_KEY);
    } else {
      wx.removeStorageSync(USER_STORAGE_KEY);
    }
  } catch (error) {
    // Ignore storage failures and keep the in-memory state as source of truth.
  }
  return normalizedUser;
}

function clearUserStorage() {
  try {
    wx.removeStorageSync(USER_STORAGE_KEY);
    wx.removeStorageSync(LOGIN_STATUS_KEY);
    wx.removeStorageSync('citywalk_token');
    wx.removeStorageSync('citywalk_refresh_token');
    wx.removeStorageSync('citywalk_token_expires_in');
  } catch (error) {
    // Ignore storage cleanup failures.
  }
}

function markManualLogout() {
  try {
    wx.setStorageSync(MANUAL_LOGOUT_KEY, true);
  } catch (error) {
    // Ignore storage failures.
  }
}

function clearManualLogoutMark() {
  try {
    wx.removeStorageSync(MANUAL_LOGOUT_KEY);
  } catch (error) {
    // Ignore storage failures.
  }
}

function isManualLogoutSuppressed() {
  try {
    return !!wx.getStorageSync(MANUAL_LOGOUT_KEY);
  } catch (error) {
    return false;
  }
}

function fetchCurrentUser() {
  return callApi('syncUser', { action: 'get' }).then((result) => ({
    ...result,
    user: normalizeUser(result && result.user ? result.user : null),
  }));
}

function syncUserProfile(payload = {}) {
  return callApi('syncUser', {
    action: 'sync',
    profile: {
      nickName: payload.nickName || '',
      avatarUrl: payload.avatarUrl || '',
    },
  }).then((result) => ({
    ...result,
    user: normalizeUser(result && result.user ? result.user : null),
  }));
}

module.exports = {
  USER_STORAGE_KEY,
  LOGIN_STATUS_KEY,
  MANUAL_LOGOUT_KEY,
  clearManualLogoutMark,
  clearUserStorage,
  fetchCurrentUser,
  getStoredUser,
  hasLoginPreference,
  isManualLogoutSuppressed,
  markManualLogout,
  normalizeUser,
  persistUser,
  syncUser: syncUserProfile,
};
