const DRAFT_KEY = 'walk_draft_v1';

function getDefaultDraft() {
  return {
    locationName: '当前位置',
    locationContext: '城市街道',
    locationAddress: '',
    latitude: null,
    longitude: null,
    routePoints: [],
    completedMissions: [],
    missionReviews: {},
    missionAssetMap: {},
    selectedMission: '',
    noteText: '',
    photoList: [],
    videoList: [],
    audioList: [],
    isPublic: false,
    startedAt: null,
    trackStartedAt: null,
    trackStoppedAt: null,
    routeStats: {
      durationMs: 0,
      pointCount: 0,
      distanceMeters: 0,
    },
    sticker: null,
    walkMode: 'pure',
    generationSource: 'preset',
  };
}

function loadDraft(forceReset = false) {
  if (forceReset) {
    return getDefaultDraft();
  }

  try {
    const draft = wx.getStorageSync(DRAFT_KEY);
    return draft && typeof draft === 'object' ? { ...getDefaultDraft(), ...draft } : getDefaultDraft();
  } catch (error) {
    console.warn('loadDraft failed', error);
    return getDefaultDraft();
  }
}

function saveDraft(draft) {
  try {
    wx.setStorageSync(DRAFT_KEY, draft);
  } catch (error) {
    console.warn('saveDraft failed', error);
  }
}

module.exports = {
  DRAFT_KEY,
  getDefaultDraft,
  loadDraft,
  saveDraft,
};
