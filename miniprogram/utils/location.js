function getSetting() {
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: resolve,
      fail: reject,
    });
  });
}

function authorize(scope) {
  return new Promise((resolve, reject) => {
    wx.authorize({
      scope,
      success: resolve,
      fail: reject,
    });
  });
}

function openSetting() {
  return new Promise((resolve, reject) => {
    wx.openSetting({
      success: resolve,
      fail: reject,
    });
  });
}

function showModal(options) {
  return new Promise((resolve) => {
    wx.showModal({
      ...options,
      success: resolve,
      fail: () => resolve({ confirm: false, cancel: true }),
    });
  });
}

async function ensureLocationPermission() {
  const scope = 'scope.userLocation';
  const setting = await getSetting();
  const current = setting.authSetting[scope];

  if (current === true) {
    return true;
  }

  if (current === undefined) {
    try {
      await authorize(scope);
      return true;
    } catch (error) {
      // Continue to openSetting flow below.
    }
  }

  const modal = await showModal({
    title: '需要定位权限',
    content: '遛遛需要定位权限来获取当前位置、手动选点和记录漫步轨迹。是否前往设置开启？',
    confirmText: '去设置',
  });

  if (!modal.confirm) {
    throw new Error('location_permission_denied');
  }

  const nextSetting = await openSetting();
  if (nextSetting.authSetting[scope]) {
    return true;
  }

  throw new Error('location_permission_denied');
}

function getCurrentLocation() {
  return ensureLocationPermission().then(() => new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: resolve,
      fail: reject,
    });
  }));
}

function explainLocationError(error, action) {
  const message = (error && error.errMsg) || error.message || '';

  if (message.includes('auth deny') || message.includes('location_permission_denied')) {
    return `${action}失败：请在小程序设置里开启定位权限`;
  }

  if (message.includes('fail:cancel')) {
    return `${action}已取消`;
  }

  if (message.includes('not supported') || message.includes('not supported in app')) {
    return `${action}失败：当前环境不支持，请使用真机调试`;
  }

  return `${action}失败，请检查定位权限或在真机上重试`;
}

module.exports = {
  explainLocationError,
  getCurrentLocation,
};
