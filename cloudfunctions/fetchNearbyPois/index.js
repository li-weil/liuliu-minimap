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

function normalizePoi(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const locationParts = String(item.location || '').split(',');
  const longitude = Number(locationParts[0]);
  const latitude = Number(locationParts[1]);

  return {
    id: item.id || item.poiid || item.location || '',
    name: item.name || '',
    address: item.address || '',
    district: item.adname || item.district || '',
    city: item.cityname || item.city || '',
    type: item.type || '',
    typecode: item.typecode || '',
    distance: Number.isFinite(Number(item.distance)) ? Number(item.distance) : null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

exports.main = async (event) => {
  const latitude = Number(event.lat !== undefined ? event.lat : event.latitude);
  const longitude = Number(event.lng !== undefined ? event.lng : event.longitude);
  const limit = Math.min(24, Math.max(1, Number(event.limit) || 18));
  const radius = Math.min(5000, Math.max(500, Number(event.radius) || 3500));

  if (!AMAP_WEB_KEY) {
    throw new Error('missing_amap_web_key');
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('invalid_location');
  }

  const query = new URLSearchParams({
    key: AMAP_WEB_KEY,
    location: `${longitude},${latitude}`,
    sortrule: 'distance',
    radius: String(radius),
    offset: String(limit),
    page: '1',
    extensions: 'all',
  });

  const response = await requestJson(`https://restapi.amap.com/v3/place/around?${query.toString()}`);
  if (!response || response.status !== '1') {
    throw new Error((response && (response.info || response.infocode)) || 'amap_nearby_failed');
  }

  return (response.pois || []).map(normalizePoi).filter(Boolean);
};
