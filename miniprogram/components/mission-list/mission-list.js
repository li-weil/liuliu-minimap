function normalizeMissionKey(item) {
  if (typeof item === 'string') {
    return item;
  }
  if (!item || typeof item !== 'object') {
    return '';
  }
  return item.mission || item.key || item.label || '';
}

function hasMissionCheckIn(completedMissions, missionReviews, mission) {
  if (!mission) {
    return false;
  }
  const review = missionReviews && missionReviews[mission] ? missionReviews[mission] : null;
  if (review && review.status === 'needs_recheck') {
    return false;
  }
  const completedSet = new Set((completedMissions || []).map(normalizeMissionKey).filter(Boolean));
  if (completedSet.has(mission)) {
    return true;
  }
  if (!review) {
    return false;
  }
  return review.status === 'checked_in' || !!review.checkedInAt || review.passed === true;
}

function hasMissionRecheckRequired(missionReviews, mission) {
  const review = missionReviews && missionReviews[mission] ? missionReviews[mission] : null;
  return !!(review && review.status === 'needs_recheck');
}

Component({
  data: {
    missionCards: [],
  },

  properties: {
    activeMission: {
      type: String,
      value: '',
    },
    expandedMission: {
      type: String,
      value: '',
    },
    missions: {
      type: Array,
      value: [],
    },
    completedMissions: {
      type: Array,
      value: [],
    },
    missionReviews: {
      type: Object,
      value: {},
    },
    missionAssetMap: {
      type: Object,
      value: {},
    },
    locationName: {
      type: String,
      value: '',
    },
    themeTitle: {
      type: String,
      value: '',
    },
    dateLabel: {
      type: String,
      value: '',
    },
    accentColor: {
      type: String,
      value: '#c96f4a',
    },
    supplementalMissionKey: {
      type: String,
      value: '',
    },
    supplementalMissionLabel: {
      type: String,
      value: '',
    },
    isRecordingAudio: {
      type: Boolean,
      value: false,
    },
    recordingMission: {
      type: String,
      value: '',
    },
    checkingInMission: {
      type: String,
      value: '',
    },
  },

  observers: {
    'missions, activeMission, expandedMission, completedMissions, missionReviews, missionAssetMap, supplementalMissionKey, supplementalMissionLabel': function updateMissionCards(
      missions,
      activeMission,
      expandedMission,
      completedMissions,
      missionReviews,
      missionAssetMap,
      supplementalMissionKey,
      supplementalMissionLabel
    ) {
      const missionItems = [...(missions || [])];
      if (supplementalMissionKey && supplementalMissionLabel) {
        missionItems.push({
          key: supplementalMissionKey,
          label: supplementalMissionLabel,
          isSupplemental: true,
        });
      }
      const cards = missionItems.map((missionItem) => {
        const isObjectMission = missionItem && typeof missionItem === 'object';
        const mission = isObjectMission ? missionItem.key : missionItem;
        const label = isObjectMission ? missionItem.label : missionItem;
        const isSupplemental = !!(isObjectMission && missionItem.isSupplemental);
        return {
          mission,
          label,
          isSupplemental,
          active: activeMission === mission,
          expanded: expandedMission === mission,
          completed: hasMissionCheckIn(completedMissions, missionReviews, mission),
          needsRecheck: hasMissionRecheckRequired(missionReviews, mission),
          review: missionReviews && missionReviews[mission] ? missionReviews[mission] : null,
          assets: missionAssetMap && missionAssetMap[mission] ? missionAssetMap[mission] : null,
        };
      });
      this.setData({ missionCards: cards });
    },
  },

  methods: {
    selectMission(event) {
      const mission = event.currentTarget.dataset.mission;
      this.triggerEvent('select', { mission });
    },

    captureMissionMedia(event) {
      const mission = event.currentTarget.dataset.mission;
      const mode = event.currentTarget.dataset.mode || '';
      this.triggerEvent('capturemedia', { mission, mode });
    },

    checkIn(event) {
      const mission = event.currentTarget.dataset.mission;
      this.triggerEvent('checkin', { mission });
    },

    inputMissionNote(event) {
      const mission = event.currentTarget.dataset.mission;
      const noteText = event.detail.value;
      this.triggerEvent('missionnote', { mission, noteText });
    },

    removePhoto(event) {
      const mission = event.currentTarget.dataset.mission;
      const index = Number(event.currentTarget.dataset.index);
      this.triggerEvent('removephoto', { mission, index });
    },

    removeVideo(event) {
      const mission = event.currentTarget.dataset.mission;
      const index = Number(event.currentTarget.dataset.index);
      this.triggerEvent('removevideo', { mission, index });
    },

    removeAudio(event) {
      const mission = event.currentTarget.dataset.mission;
      const index = Number(event.currentTarget.dataset.index);
      this.triggerEvent('removeaudio', { mission, index });
    },
  },
});
