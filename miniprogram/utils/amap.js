const { amapKey } = require('./config');

let amapSdk = null;

try {
  amapSdk = require('../libs/amap-wx.130');
} catch (error) {
  amapSdk = null;
}

function hasAmapSdk() {
  return !!(amapKey && amapSdk && amapSdk.AMapWX);
}

function createAmapInstance() {
  if (!hasAmapSdk()) {
    return null;
  }
  return new amapSdk.AMapWX({ key: amapKey });
}

function getRegeo({ latitude, longitude }) {
  const amap = createAmapInstance();
  if (!amap) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    amap.getRegeo({
      location: `${longitude},${latitude}`,
      success: (result) => resolve(result && result[0] ? result[0] : result),
      fail: reject,
    });
  });
}

function getInputTips({ keyword, location }) {
  const amap = createAmapInstance();
  if (!amap || !keyword) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    amap.getInputtips({
      keywords: keyword,
      location: location ? `${location.longitude},${location.latitude}` : '',
      success: (result) => resolve((result && result.tips) || []),
      fail: reject,
    });
  });
}

function normalizeAmapLocation(regeo, fallbackName) {
  if (!regeo) {
    return {
      placeName: fallbackName || '当前位置',
      address: '',
      district: '',
      pois: [],
    };
  }

  return {
    placeName: regeo.name || fallbackName || regeo.desc || '当前位置',
    address: regeo.desc || '',
    district: regeo.district || '',
    pois: regeo.pois || [],
  };
}

module.exports = {
  getInputTips,
  getRegeo,
  hasAmapSdk,
  normalizeAmapLocation,
};
