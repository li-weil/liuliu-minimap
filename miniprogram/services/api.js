const { apiBaseUrl, apiPrefix, requestTimeout } = require('../utils/config');
const { callCloud, uploadToCloud } = require('./cloud');

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

  const completedMissions = Array.isArray(item.completedMissions) ? item.completedMissions : [];
  const missionList = completedMissions
    .map((mission) => (mission && mission.mission ? mission.mission : ''))
    .filter(Boolean);

  return {
    _id: item.id,
    id: item.id,
    themeTitle: item.themeTitle,
    themeCategory: item.themeCategory,
    locationName: item.locationName,
    noteText: item.noteText || '',
    createdAt: item.createdAt || Date.now(),
    photoList: item.photoUrl ? [item.photoUrl] : [],
    videoList: item.videoUrl ? [item.videoUrl] : [],
    audioList: item.audioUrl ? [item.audioUrl] : [],
    routePoints: Array.isArray(item.path)
      ? item.path.map((point) => ({
          latitude: point.lat,
          longitude: point.lng,
          timestamp: point.timestamp,
        }))
      : [],
    completedMissions: missionList,
    missionReviews: {},
    themeSnapshot: {
      title: item.themeTitle,
      category: item.themeCategory,
      description: item.noteText || '',
      missions: missionList,
    },
  };
}

const ENDPOINTS = {
  syncUser: {
    cloudName: 'syncUser',
    web: {
      path: '/auth/sync-user',
      method: 'POST',
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
  createWalk: {
    cloudName: 'createWalk',
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
        return {
          themeTitle: data.themeTitle || (data.themeSnapshot && data.themeSnapshot.title) || '',
          themeCategory: (data.themeSnapshot && data.themeSnapshot.category) || '',
          locationName: data.locationName || '',
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
  if (getBackendProvider() !== 'web' || !endpoint.web) {
    const ext = String(filePath).split('.').pop() || 'jpg';
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

  if (getBackendProvider() !== 'web') {
    return callCloud(endpoint.cloudName || name, data);
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