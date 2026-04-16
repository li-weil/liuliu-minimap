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

function requestAmapRest({ url, data }) {
  if (!amapKey) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      data: {
        key: amapKey,
        ...data,
      },
      header: {
        'content-type': 'application/json',
      },
      success(res) {
        const payload = res && res.data;
        if (payload && payload.status === '1') {
          resolve(payload.pois || []);
          return;
        }
        reject(new Error((payload && (payload.info || payload.infocode)) || 'amap_request_failed'));
      },
      fail: reject,
    });
  });
}

function joinAddress(parts) {
  return parts
    .map((item) => (item ? String(item).trim() : ''))
    .filter(Boolean)
    .join('');
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function getDistanceMeters(from, to) {
  if (!from || !to) {
    return null;
  }
  const fromLat = Number(from.latitude);
  const fromLng = Number(from.longitude);
  const toLat = Number(to.latitude);
  const toLng = Number(to.longitude);
  if (![fromLat, fromLng, toLat, toLng].every((item) => Number.isFinite(item))) {
    return null;
  }
  const earthRadius = 6371000;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadius * c);
}

function normalizePoi(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const locationParts = String(item.location || '').split(',');
  const longitude = Number(item.longitude !== undefined ? item.longitude : locationParts[0]);
  const latitude = Number(item.latitude !== undefined ? item.latitude : locationParts[1]);
  const district = item.district || item.adname || '';
  const city = item.cityname || item.city || '';
  const address = item.address || joinAddress([item.pname, city, district, item.address]);
  const distance = Number(item.distance);

  return {
    id: item.id || item.poiid || item.location || '',
    name: item.name || item.address || district || '推荐地点',
    address,
    district,
    city,
    type: item.type || '',
    typecode: item.typecode || '',
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    distance: Number.isFinite(distance) ? distance : null,
  };
}

function dedupeLocations(results) {
  const seen = new Set();
  return (results || []).filter((item) => {
    if (!item) {
      return false;
    }
    const key = [
      item.id || '',
      item.name || '',
      item.latitude !== null && item.latitude !== undefined ? Number(item.latitude).toFixed(6) : '',
      item.longitude !== null && item.longitude !== undefined ? Number(item.longitude).toFixed(6) : '',
    ].join('::');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function searchAmapPois({ keyword, location, limit = 20 }) {
  const trimmedKeyword = String(keyword || '').trim();
  if (!trimmedKeyword || !amapKey) {
    return Promise.resolve([]);
  }

  const hasLocation =
    location &&
    Number.isFinite(Number(location.latitude)) &&
    Number.isFinite(Number(location.longitude));
  const aroundRequest = hasLocation
    ? requestAmapRest({
      url: 'https://restapi.amap.com/v3/place/around',
      data: {
        location: `${Number(location.longitude)},${Number(location.latitude)}`,
        keywords: trimmedKeyword,
        sortrule: 'distance',
        radius: 5000,
        offset: limit,
        page: 1,
        extensions: 'all',
      },
    }).catch(() => [])
    : Promise.resolve([]);
  const textRequest = requestAmapRest({
    url: 'https://restapi.amap.com/v3/place/text',
    data: {
      keywords: trimmedKeyword,
      offset: limit,
      page: 1,
      extensions: 'all',
    },
  }).catch(() => []);

  return Promise.all([
    aroundRequest,
    textRequest,
    getInputTips({ keyword: trimmedKeyword, location }).catch(() => []),
  ]).then(([aroundPois, textPois, tips]) => {
    const normalizedAround = aroundPois.map(normalizePoi).filter(Boolean);
    const normalizedText = textPois.map(normalizePoi).filter(Boolean);
    const normalizedTips = (tips || []).map((item) => normalizePoi({
      ...item,
      district: item.district || '',
      address: item.address || item.district || '',
      location: item.location || '',
    })).filter(Boolean);

    const merged = dedupeLocations([
      ...normalizedAround,
      ...normalizedText,
      ...normalizedTips,
    ]).map((item) => ({
      ...item,
      distance: Number.isFinite(Number(item.distance))
        ? Number(item.distance)
        : getDistanceMeters(location, item),
    }));

    return merged
      .sort((a, b) => {
        const distanceA = Number.isFinite(Number(a.distance)) ? Number(a.distance) : Number.MAX_SAFE_INTEGER;
        const distanceB = Number.isFinite(Number(b.distance)) ? Number(b.distance) : Number.MAX_SAFE_INTEGER;
        if (distanceA !== distanceB) {
          return distanceA - distanceB;
        }
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      })
      .slice(0, limit);
  });
}

function fetchAmapNearbyPois({ latitude, longitude, limit = 12, radius = 3000 }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!amapKey || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Promise.resolve([]);
  }

  return requestAmapRest({
    url: 'https://restapi.amap.com/v3/place/around',
    data: {
      location: `${lng},${lat}`,
      sortrule: 'distance',
      radius,
      offset: limit,
      page: 1,
      extensions: 'all',
    },
  }).then((pois) => (
    dedupeLocations((pois || []).map(normalizePoi).filter(Boolean))
      .map((item) => ({
        ...item,
        distance: Number.isFinite(Number(item.distance))
          ? Number(item.distance)
          : getDistanceMeters({ latitude: lat, longitude: lng }, item),
      }))
      .sort((a, b) => {
        const distanceA = Number.isFinite(Number(a.distance)) ? Number(a.distance) : Number.MAX_SAFE_INTEGER;
        const distanceB = Number.isFinite(Number(b.distance)) ? Number(b.distance) : Number.MAX_SAFE_INTEGER;
        if (distanceA !== distanceB) {
          return distanceA - distanceB;
        }
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      })
      .slice(0, limit)
  ));
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

  const regeoData = regeo.regeocodeData || {};
  const rawPois = Array.isArray(regeo.pois) && regeo.pois.length
    ? regeo.pois
    : Array.isArray(regeoData.pois)
      ? regeoData.pois
      : [];
  const normalizedPois = rawPois
    .map((poi) => normalizePoi({
      ...poi,
      district: poi.district || (regeoData.addressComponent && regeoData.addressComponent.district) || regeo.district || '',
      city: poi.cityname || (regeoData.addressComponent && regeoData.addressComponent.city) || '',
    }))
    .filter(Boolean)
    .sort((left, right) => {
      const leftDistance = Number.isFinite(Number(left.distance)) ? Number(left.distance) : Number.MAX_SAFE_INTEGER;
      const rightDistance = Number.isFinite(Number(right.distance)) ? Number(right.distance) : Number.MAX_SAFE_INTEGER;
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
    });
  const topPoi = normalizedPois.find((item) => Number.isFinite(Number(item.distance)) && Number(item.distance) <= 80) || null;
  const topPoiName = topPoi && topPoi.name ? String(topPoi.name).trim() : '';
  const descName = regeo.desc ? String(regeo.desc).replace(/附近$/, '').trim() : '';
  const fallback = fallbackName ? String(fallbackName).trim() : '';

  return {
    placeName: topPoiName || descName || regeo.name || fallback || '当前位置',
    address: regeo.desc || '',
    district: regeo.district || '',
    pois: normalizedPois,
  };
}

module.exports = {
  fetchAmapNearbyPois,
  getInputTips,
  getRegeo,
  hasAmapSdk,
  normalizeAmapLocation,
  searchAmapPois,
};
