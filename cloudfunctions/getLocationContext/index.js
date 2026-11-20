const https = require('https');
const config = require('./config');

const AMAP_WEB_KEY = process.env.AMAP_WEB_KEY || config.amapWebKey || '';
const REQUEST_TIMEOUT_MS = Number(process.env.MAP_REQUEST_TIMEOUT_MS || config.timeoutMs || 12000);

function requestJson(urlString) {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode >= 400) {
              reject(new Error(parsed.info || parsed.infocode || `http_${res.statusCode}`));
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`map_request_timeout_${REQUEST_TIMEOUT_MS}ms`));
    });
    req.end();
  });
}

function normalizeLocationPoint(value) {
  const parts = String(value || '').split(',');
  const longitude = Number(parts[0]);
  const latitude = Number(parts[1]);
  return {
    longitude: Number.isFinite(longitude) ? longitude : null,
    latitude: Number.isFinite(latitude) ? latitude : null,
  };
}

function normalizePoi(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const point = normalizeLocationPoint(item.location);
  return {
    id: item.id || '',
    name: String(item.name || '').trim(),
    type: String(item.type || '').trim(),
    typecode: String(item.typecode || '').trim(),
    address: String(item.address || '').trim(),
    distance: Number.isFinite(Number(item.distance)) ? Number(item.distance) : null,
    longitude: point.longitude,
    latitude: point.latitude,
  };
}

function normalizeAoi(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const point = normalizeLocationPoint(item.location);
  const officialAoiTypecode = String(item.type || item.typecode || '').trim();
  return {
    id: item.id || '',
    name: String(item.name || '').trim(),
    type: String(item.type || item.typecode || '').trim(),
    typecode: officialAoiTypecode,
    area: Number.isFinite(Number(item.area)) ? Number(item.area) : null,
    address: String(item.address || '').trim(),
    adcode: String(item.adcode || '').trim(),
    distance: Number.isFinite(Number(item.distance)) ? Number(item.distance) : null,
    longitude: point.longitude,
    latitude: point.latitude,
  };
}

function normalizeBusinessArea(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const point = normalizeLocationPoint(item.location);
  return {
    id: String(item.id || '').trim(),
    name: String(item.name || '').trim(),
    longitude: point.longitude,
    latitude: point.latitude,
  };
}

function normalizeRoad(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  return {
    name: String(item.name || '').trim(),
    distance: Number.isFinite(Number(item.distance)) ? Number(item.distance) : null,
    direction: String(item.direction || '').trim(),
  };
}

function buildContextLabel(payload, placeName) {
  const regeocode = payload && payload.regeocode && typeof payload.regeocode === 'object'
    ? payload.regeocode
    : {};
  const aois = Array.isArray(regeocode.aois)
    ? regeocode.aois
      .map(normalizeAoi)
      .filter(Boolean)
      .sort((left, right) => {
        const leftArea = Number(left && left.area);
        const rightArea = Number(right && right.area);
        if (Number.isFinite(leftArea) && Number.isFinite(rightArea) && rightArea !== leftArea) {
          return rightArea - leftArea;
        }
        return 0;
      })
    : [];
  const businessAreas = Array.isArray(regeocode.addressComponent && regeocode.addressComponent.businessAreas)
    ? regeocode.addressComponent.businessAreas.map(normalizeBusinessArea).filter(Boolean)
    : [];
  const pois = Array.isArray(regeocode.pois) ? regeocode.pois.map(normalizePoi).filter(Boolean) : [];
  const roads = Array.isArray(regeocode.roads) ? regeocode.roads.map(normalizeRoad).filter(Boolean) : [];
  const primaryAoi = aois[0] || null;
  const primaryBusinessArea = businessAreas[0] || null;
  const primaryPoi = pois[0] || null;
  const primaryRoad = roads[0] || null;
  const addressComponent = regeocode.addressComponent && typeof regeocode.addressComponent === 'object'
    ? regeocode.addressComponent
    : {};
  const district = String(addressComponent.district || addressComponent.township || '').trim();
  const context = [
    primaryAoi && primaryAoi.name,
    primaryBusinessArea && primaryBusinessArea.name,
    primaryPoi && primaryPoi.name,
    primaryRoad && primaryRoad.name,
    district,
    placeName,
  ].map((item) => String(item || '').trim()).find(Boolean) || '城市街道';

  return {
    context,
    formattedAddress: String(regeocode.formatted_address || '').trim(),
    district,
    primaryAoi,
    aois,
    businessAreas,
    pois: pois.slice(0, 8),
    roads: roads.slice(0, 4),
    addressComponent: {
      province: String(addressComponent.province || '').trim(),
      city: Array.isArray(addressComponent.city)
        ? String(addressComponent.city[0] || '').trim()
        : String(addressComponent.city || '').trim(),
      district,
      township: String(addressComponent.township || '').trim(),
      neighborhood: addressComponent.neighborhood && addressComponent.neighborhood.name
        ? String(addressComponent.neighborhood.name).trim()
        : '',
      building: addressComponent.building && addressComponent.building.name
        ? String(addressComponent.building.name).trim()
        : '',
      adcode: String(addressComponent.adcode || '').trim(),
      citycode: String(addressComponent.citycode || '').trim(),
    },
  };
}

exports.main = async (event) => {
  const latitude = Number(event.latitude);
  const longitude = Number(event.longitude);
  const placeName = String(event.placeName || '').trim() || '当前位置';

  if (!AMAP_WEB_KEY) {
    return {
      context: placeName === '当前位置' ? '城市街道' : placeName,
      placeName,
      reason: 'missing_amap_web_key',
    };
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return {
      context: placeName === '当前位置' ? '城市街道' : placeName,
      placeName,
      reason: 'invalid_location',
    };
  }

  try {
    const query = new URLSearchParams({
      key: AMAP_WEB_KEY,
      location: `${longitude},${latitude}`,
      extensions: 'all',
      radius: '500',
      roadlevel: '0',
    });
    const response = await requestJson(`https://restapi.amap.com/v3/geocode/regeo?${query.toString()}`);
    if (!response || response.status !== '1') {
      throw new Error((response && (response.info || response.infocode)) || 'amap_regeo_failed');
    }
    const nativeContext = buildContextLabel(response, placeName);
    return {
      context: nativeContext.context,
      placeName,
      formattedAddress: nativeContext.formattedAddress,
      district: nativeContext.district,
      primaryAoiName: nativeContext.primaryAoi && nativeContext.primaryAoi.name || '',
      primaryAoiType: nativeContext.primaryAoi && nativeContext.primaryAoi.type || '',
      primaryAoiTypecode: nativeContext.primaryAoi && (nativeContext.primaryAoi.typecode || nativeContext.primaryAoi.type) || '',
      nativeContext,
    };
  } catch (error) {
    return {
      context: placeName === '当前位置' ? '城市街道' : placeName,
      placeName,
      reason: error.message || 'context_failed',
    };
  }
};
