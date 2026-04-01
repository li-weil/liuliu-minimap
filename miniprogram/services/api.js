const { apiBaseUrl, apiPrefix, requestTimeout, useCloudMediaStorage, useCloudWalkStorage } = require('../utils/config');
const { callCloud, uploadToCloud } = require('./cloud');
const { inferExtension } = require('../utils/media');

const CLOUD_ENDPOINTS = new Set(
  useCloudWalkStorage
    ? ['createWalk', 'listMyWalks', 'listPublicWalks', 'getWalkDetail', 'verifyMission', 'generateSticker', 'generateStickerPlan', 'generateStickerImage', 'publishWalkShare']
    : []
);

function normalizeThemeResponse(data, requestData, source) {
  return {
    theme: data,
    source,
    request: requestData,
  };
}

function normalizeWalkRecord(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const recordId = item._id || item.id || '';
  const completedMissions = Array.isArray(item.completedMissions) ? item.completedMissions : [];
  const missionList = completedMissions
    .map((mission) => {
      if (typeof mission === 'string') {
        return mission;
      }
      return mission && mission.mission ? mission.mission : '';
    })
    .filter(Boolean);
  const routePoints = Array.isArray(item.routePoints)
    ? item.routePoints
        .map((point) => ({
          latitude: point.latitude !== undefined ? point.latitude : point.lat,
          longitude: point.longitude !== undefined ? point.longitude : point.lng,
          timestamp: point.timestamp,
        }))
        .filter((point) => point.latitude !== undefined && point.longitude !== undefined)
    : Array.isArray(item.path)
      ? item.path.map((point) => ({
          latitude: point.lat,
          longitude: point.lng,
          timestamp: point.timestamp,
        }))
      : [];
  const photoList = Array.isArray(item.photoList)
    ? item.photoList.filter(Boolean)
    : item.photoUrl
      ? [item.photoUrl]
      : [];
  const videoList = Array.isArray(item.videoList)
    ? item.videoList.filter(Boolean)
    : item.videoUrl
      ? [item.videoUrl]
      : [];
  const audioList = Array.isArray(item.audioList)
    ? item.audioList.filter(Boolean)
    : item.audioUrl
      ? [item.audioUrl]
      : [];
  const themeSnapshot = item.themeSnapshot || {};
  const missionAssetMap = item.missionAssetMap || {};
  const summaryAssets = missionAssetMap.__summary__ || {};
  const firstMissionAssetWithCard = Object.values(missionAssetMap).find((asset) => asset && asset.cardImagePath);
  const routeStats = item.routeStats || {};
  const durationMs = routeStats.durationMs || 0;
  const distanceMeters = routeStats.distanceMeters || 0;
  const trackStartedAt = item.trackStartedAt || null;
  const trackStoppedAt = item.trackStoppedAt || null;
  return {
    _id: recordId,
    id: recordId,
    themeTitle: item.themeTitle || themeSnapshot.title || '',
    themeCategory: item.themeCategory || themeSnapshot.category || '',
    locationName: item.locationName || '未知地点',
    locationContext: item.locationContext || '',
    locationAddress: item.locationAddress || '',
    noteText: item.noteText || summaryAssets.noteText || '',
    createdAt: item.createdAt || Date.now(),
    trackStartedAt,
    trackStoppedAt,
    routeStats: {
      durationMs,
      pointCount: routeStats.pointCount || routePoints.length,
      distanceMeters,
      durationLabel: formatDuration(durationMs),
      distanceLabel: formatDistance(distanceMeters),
      startedLabel: formatTrackTime(trackStartedAt),
      stoppedLabel: formatTrackTime(trackStoppedAt),
    },
    sticker: item.sticker || null,
    photoList,
    videoList,
    audioList,
    coverImage: item.coverImage || summaryAssets.cardImagePath || summaryAssets.photoList && summaryAssets.photoList[0] || photoList[0] || (firstMissionAssetWithCard && firstMissionAssetWithCard.cardImagePath) || '',
    routePoints,
    completedMissions: missionList,
    missionReviews: item.missionReviews || {},
    missionAssetMap,
    isPublic: !!item.isPublic,
    walkMode: item.walkMode || 'pure',
    generationSource: item.generationSource || 'unknown',
    themeSnapshot: {
      ...themeSnapshot,
      title: item.themeTitle || themeSnapshot.title || '',
      category: item.themeCategory || themeSnapshot.category || '',
      description: themeSnapshot.description || item.noteText || '',
      missions: Array.isArray(themeSnapshot.missions) && themeSnapshot.missions.length
        ? themeSnapshot.missions
        : missionList,
    },
  };
}

const ENDPOINTS = {
  syncUser: {
    cloudName: 'syncUser',
    web: {
      path: '/miniapp/auth/sync-user',
      method: 'POST',
      normalizeRequest: (data) => ({
        code: data.code,
        nickName: data.nickName,
        avatarUrl: data.avatarUrl,
      }),
      normalizeResponse: (data) => {
        persistAuthSession(data);
        return data;
      },
    },
  },
  generateTheme: {
    cloudName: 'generateTheme',
    web: {
      path: '/ai/themes/generate',
      method: 'POST',
      normalizeResponse: (data, requestData) => normalizeThemeResponse(data, requestData, data && data.provider ? 'rag+ai' : 'rag-fallback'),
    },
  },
  generateRandomTheme: {
    cloudName: 'generateRandomTheme',
    web: {
      path: '/ai/themes/preset',
      method: 'POST',
      normalizeRequest: (data) => ({
        category: data.category,
        locationName: data.locationName,
        locationContext: data.locationContext,
        walkMode: data.walkMode,
      }),
      normalizeResponse: (data, requestData) => normalizeThemeResponse(data, requestData, data && data.provider ? 'random+ai' : 'random-fallback'),
    },
  },
  generateCombinedTheme: {
    cloudName: 'generateCombinedTheme',
    web: {
      path: '/ai/themes/combine',
      method: 'POST',
      normalizeResponse: (data, requestData) => normalizeThemeResponse(data, requestData, data && data.provider ? 'combined+ai' : 'combined-fallback'),
    },
  },
  getLocationContext: {
    cloudName: 'getLocationContext',
    web: {
      path: '/ai/location/context',
      method: 'GET',
      normalizeRequest: (data) => ({
        lat: data.latitude,
        lng: data.longitude,
      }),
      normalizeResponse: (data, requestData) => ({
        placeName: requestData.placeName || '当前位置',
        context: (data && data.locationContext) || requestData.placeName || '城市街道',
      }),
    },
  },
  searchLocations: {
    cloudName: '',
    web: {
      path: '/map/search',
      method: 'GET',
      normalizeRequest: (data) => ({
        query: data.query,
      }),
      normalizeResponse: (data) => (Array.isArray(data) ? data : []),
    },
  },
  fetchNearbyPois: {
    cloudName: '',
    web: {
      path: '/map/pois/nearby',
      method: 'GET',
      normalizeRequest: (data) => ({
        lat: data.lat,
        lng: data.lng,
      }),
      normalizeResponse: (data) => (Array.isArray(data) ? data : []),
    },
  },
  verifyMission: {
    cloudName: 'verifyMission',
    web: {
      path: '/ai/missions/verify',
      method: 'POST',
      normalizeRequest: (data) => {
        const fileIDs = Array.isArray(data.fileIDs) ? data.fileIDs.filter(Boolean) : [];
        return {
          mission: data.mission,
          noteText: data.noteText,
          fileIDs,
          fileUrls: fileIDs.filter((item) => String(item).startsWith('http')),
        };
      },
    },
  },
  generateSticker: {
    cloudName: 'generateSticker',
  },
  generateStickerPlan: {
    cloudName: 'generateSticker',
  },
  generateStickerImage: {
    cloudName: 'generateSticker',
  },
  createWalk: {
    cloudName: 'createWalk',
    normalizeCloudResponse: (data) => data,
    web: {
      path: '/walks',
      method: 'POST',
      normalizeRequest: (data) => {
        const photoUrl = Array.isArray(data.photoList) && data.photoList.length ? data.photoList[0] : '';
        const videoUrl = Array.isArray(data.videoList) && data.videoList.length ? data.videoList[0] : '';
        const audioUrl = Array.isArray(data.audioList) && data.audioList.length ? data.audioList[0] : '';
        const primaryMediaUrl = photoUrl || videoUrl || audioUrl || '';
        const primaryMediaType = photoUrl ? 'image' : videoUrl ? 'video' : audioUrl ? 'audio' : '';
        const completed = Array.isArray(data.missionsCompleted) ? data.missionsCompleted : [];
        const reviews = data.missionReviews || {};
        const missionAssetMap = data.missionAssetMap || {};
        return {
          themeTitle: data.themeTitle || (data.themeSnapshot && data.themeSnapshot.title) || '',
          themeCategory: (data.themeSnapshot && data.themeSnapshot.category) || '',
          locationName: data.locationName || '',
          locationContext: data.locationContext || '',
          locationAddress: data.locationAddress || '',
          recordUnit: photoUrl ? 'image' : Array.isArray(data.routePoints) && data.routePoints.length ? 'location' : 'event',
          isPublic: !!data.isPublic,
          noteText: data.noteText || '',
          path: (data.routePoints || []).map((point) => ({
            lat: point.lat !== undefined ? point.lat : point.latitude,
            lng: point.lng !== undefined ? point.lng : point.longitude,
            timestamp: point.timestamp || Date.now(),
          })),
          completedMissions: completed.map((mission) => {
            const review = reviews[mission] || {};
            const reviewMediaUrl = Array.isArray(review.photoList) && review.photoList.length ? review.photoList[0] : primaryMediaUrl;
            const reviewMediaType = Array.isArray(review.photoList) && review.photoList.length ? 'image' : primaryMediaType;
            return {
              mission,
              mediaUrl: reviewMediaUrl || '',
              mediaType: reviewMediaType || '',
            };
          }),
          themeSnapshot: data.themeSnapshot || null,
          missionReviews: reviews,
          missionAssetMap,
          walkMode: data.walkMode || 'pure',
          generationSource: data.generationSource || 'unknown',
          trackStartedAt: data.trackStartedAt || null,
          trackStoppedAt: data.trackStoppedAt || null,
          routeStats: data.routeStats || null,
          sticker: data.sticker || null,
          photoUrl,
          videoUrl,
          audioUrl,
        };
      },
      normalizeResponse: (data) => ({
        walk: normalizeWalkRecord(data),
      }),
    },
  },
  listMyWalks: {
    cloudName: 'listMyWalks',
    normalizeCloudResponse: (data) => ({
      records: Array.isArray(data.records) ? data.records.map(normalizeWalkRecord).filter(Boolean) : [],
    }),
    web: {
      path: '/walks/me',
      method: 'GET',
      normalizeRequest: (data) => ({
        page: 1,
        pageSize: data.limit || data.pageSize || 20,
      }),
      normalizeResponse: (data) => ({
        records: Array.isArray(data) ? data.map(normalizeWalkRecord).filter(Boolean) : [],
      }),
    },
  },
  listPublicWalks: {
    cloudName: 'listPublicWalks',
    normalizeCloudResponse: (data) => ({
      records: Array.isArray(data.records) ? data.records.map(normalizeWalkRecord).filter(Boolean) : [],
    }),
    web: {
      path: '/walks/public',
      method: 'GET',
      normalizeRequest: (data) => ({
        page: 1,
        pageSize: data.limit || data.pageSize || 20,
      }),
      normalizeResponse: (data) => ({
        records: Array.isArray(data) ? data.map(normalizeWalkRecord).filter(Boolean) : [],
      }),
    },
  },
  getWalkDetail: {
    cloudName: 'getWalkDetail',
    normalizeCloudResponse: (data) => ({
      walk: data && data.walk ? normalizeWalkRecord(data.walk) : null,
    }),
    web: {
      path: '/walks',
      method: 'GET',
      resolvePath: (data) => `/walks/${encodeURIComponent(data.id)}`,
      normalizeRequest: () => ({}),
      normalizeResponse: (data) => ({
        walk: normalizeWalkRecord(data),
      }),
    },
  },
  publishWalkShare: {
    cloudName: 'publishWalkShare',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      walk: data && data.walk ? normalizeWalkRecord(data.walk) : null,
    }),
  },
  uploadMedia: {
    cloudName: '',
    web: {
      path: '/files/upload',
      method: 'UPLOAD',
      normalizeUploadFormData: (formData) => ({
        bizType:
          formData.kind === 'video'
            ? 'video'
            : formData.kind === 'audio'
              ? 'audio'
              : 'mission_media',
      }),
    },
  },
};

function getBackendProvider() {
  return apiBaseUrl ? 'web' : 'cloud';
}

function shouldUseCloudEndpoint(name) {
  if (!apiBaseUrl) {
    return true;
  }
  return CLOUD_ENDPOINTS.has(name);
}

function getStoredToken() {
  try {
    return wx.getStorageSync('citywalk_token') || '';
  } catch (error) {
    return '';
  }
}

function persistAuthSession(data) {
  if (!data || typeof data !== 'object') {
    return;
  }

  try {
    if (data.token) {
      wx.setStorageSync('citywalk_token', data.token);
    }
    if (data.refreshToken) {
      wx.setStorageSync('citywalk_refresh_token', data.refreshToken);
    }
    if (data.expiresIn !== undefined) {
      wx.setStorageSync('citywalk_token_expires_in', data.expiresIn);
    }
  } catch (error) {
    // Ignore storage failures so login can still proceed in-memory.
  }
}

function normalizeResponse(response) {
  if (response && typeof response === 'object') {
    if (Object.prototype.hasOwnProperty.call(response, 'data')) {
      return response.data;
    }
    return response;
  }
  return {};
}

function formatDistance(distanceMeters) {
  const meters = Number(distanceMeters || 0);
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round((durationMs || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

function formatTrackTime(timestamp) {
  if (!timestamp) {
    return '未记录';
  }
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

function buildUrl(path) {
  const base = apiBaseUrl.replace(/\/$/, '');
  const prefix = apiPrefix.replace(/\/$/, '');
  return `${base}${prefix}${path}`;
}

function toQueryString(data = {}) {
  return Object.keys(data)
    .filter((key) => data[key] !== undefined && data[key] !== null && data[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&');
}

function requestWeb({ path, method, data, header }) {
  const token = getStoredToken();
  const query = method === 'GET' ? toQueryString(data) : '';
  const finalUrl = query ? `${buildUrl(path)}?${query}` : buildUrl(path);
  return new Promise((resolve, reject) => {
    wx.request({
      url: finalUrl,
      method,
      data: method === 'GET' ? undefined : data,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...header,
      },
      timeout: requestTimeout,
      success(res) {
        const statusCode = res.statusCode || 500;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(normalizeResponse(res.data));
          return;
        }
        reject(new Error((res.data && (res.data.message || res.data.error)) || `request_failed_${statusCode}`));
      },
      fail: reject,
    });
  });
}

function requestUpload(filePath, formData = {}) {
  const endpoint = ENDPOINTS.uploadMedia;
  if (getBackendProvider() !== 'web' || !endpoint.web || useCloudMediaStorage) {
    const inferredExt = inferExtension(filePath, formData.kind === 'image' ? 'jpg' : '');
    const ext =
      formData.kind === 'video'
        ? (inferredExt || 'mp4')
        : formData.kind === 'audio'
          ? (inferredExt || 'mp3')
          : (inferredExt || 'jpg');
    return uploadToCloud({
      cloudPath: `walks/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
      filePath,
    }).then((response) => response.fileID);
  }

  const token = getStoredToken();
  const normalizedFormData = endpoint.web.normalizeUploadFormData ? endpoint.web.normalizeUploadFormData(formData) : formData;
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: buildUrl(endpoint.web.path),
      filePath,
      name: 'file',
      formData: normalizedFormData,
      timeout: requestTimeout,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        let payload = {};
        try {
          payload = JSON.parse(res.data);
        } catch (error) {
          reject(new Error('upload_response_invalid'));
          return;
        }
        const normalized = normalizeResponse(payload);
        resolve(normalized.url || normalized.fileUrl || normalized.fileID || normalized.path);
      },
      fail: reject,
    });
  });
}

function callApi(name, data = {}) {
  const endpoint = ENDPOINTS[name];
  if (!endpoint) {
    return Promise.reject(new Error(`unknown_endpoint_${name}`));
  }

  if (shouldUseCloudEndpoint(name) || getBackendProvider() !== 'web') {
    return callCloud(endpoint.cloudName || name, data).then((response) => (
      endpoint.normalizeCloudResponse ? endpoint.normalizeCloudResponse(response, data) : response
    ));
  }

  if (!endpoint.web) {
    return Promise.reject(new Error(`web_endpoint_not_supported_${name}`));
  }

  const method = endpoint.web.method;
  const requestData = endpoint.web.normalizeRequest ? endpoint.web.normalizeRequest(data) : data;
  const path = endpoint.web.resolvePath ? endpoint.web.resolvePath(data) : endpoint.web.path;

  return requestWeb({ path, method, data: requestData }).then((response) => (
    endpoint.web.normalizeResponse ? endpoint.web.normalizeResponse(response, data) : response
  ));
}

module.exports = {
  callApi,
  getBackendProvider,
  requestUpload,
};
