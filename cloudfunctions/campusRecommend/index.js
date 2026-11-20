const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readGeoDistanceMeters(item) {
  if (!item || typeof item !== 'object') return null;
  const candidates = [item._distance, item.distance, item.dist && item.dist.calculated, item.location && item.location.distance];
  for (const candidate of candidates) {
    const number = toFiniteNumber(candidate);
    if (number !== null) return number;
  }
  return null;
}

function calculateDistanceMeters(fromLat, fromLng, toLat, toLng) {
  if (![fromLat, fromLng, toLat, toLng].every((value) => Number.isFinite(value))) return null;
  const radiusMeters = 6371000;
  const toRad = (degree) => (degree * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

exports.main = async (event) => {
  const lat = Number(event.lat);
  const lng = Number(event.lng);
  const tag = String(event.tag || '').trim();
  const excludeNames = Array.isArray(event.excludeNames) ? event.excludeNames.filter(Boolean) : [];
  const limit = Math.min(20, Math.max(1, Number(event.limit) || 20));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { spots: [] };
  }

  const whereCondition = {
    location: _.geoNear({
      geometry: db.Geo.Point(lng, lat),
      maxDistance: 20000,
      minDistance: 0,
    }),
  };
  // tags 为数组字段，等值条件匹配包含该主题标签的地点
  if (tag) whereCondition.tags = tag;
  if (excludeNames.length) whereCondition.map_name = _.nin(excludeNames);

  const result = await db.collection('campusSpots')
    .where(whereCondition)
    .limit(limit)
    .get();

  const spots = (result.data || [])
    .map((item, index) => {
      const coordsParts = (item.coords || '').split(',');
      const spotLat = Number(coordsParts[1]) || 0;
      const spotLng = Number(coordsParts[0]) || 0;
      const dbDistance = readGeoDistanceMeters(item);
      const fallbackDistance = calculateDistanceMeters(lat, lng, spotLat, spotLng);
      const distance = dbDistance !== null ? dbDistance : (fallbackDistance || 0);
      return {
        map_name: item.map_name || '',
        amap_name: item.amap_name || '',
        coords: item.coords || '',
        lat: spotLat,
        lng: spotLng,
        distance: Math.round(distance),
        sortRank: index + 1,
        distanceSource: dbDistance !== null ? 'database' : 'calculated',
        tags: Array.isArray(item.tags) ? item.tags : [],
        category: item.category || '',
        intro: item.intro || '',
      };
    });

  return { spots };
};
