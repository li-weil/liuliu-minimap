const { formatAudioClock } = require('../../utils/audio');

Component({
  properties: {
    src: {
      type: String,
      value: '',
    },
    accentColor: {
      type: String,
      value: '#6c6a49',
    },
  },

  data: {
    isPlaying: false,
    isDragging: false,
    currentTime: 0,
    duration: 0,
    sliderValue: 0,
    currentTimeLabel: '00:00',
    durationLabel: '00:00',
    loadError: '',
  },

  lifetimes: {
    attached() {
      this.createAudioContext();
      this.updateAudioSource(this.properties.src);
    },

    detached() {
      this.clearDurationTimer();
      if (this.audioContext) {
        this.audioContext.destroy();
        this.audioContext = null;
      }
    },
  },

  observers: {
    src(nextSrc) {
      this.updateAudioSource(nextSrc);
    },
  },

  methods: {
    createAudioContext() {
      if (this.audioContext || !wx.createInnerAudioContext) {
        return;
      }

      const audioContext = wx.createInnerAudioContext();
      audioContext.autoplay = false;

      try {
        audioContext.obeyMuteSwitch = false;
      } catch (error) {
        // Ignore unsupported platforms.
      }

      audioContext.onCanplay(() => {
        this.syncDuration();
      });

      audioContext.onPlay(() => {
        this.setData({
          isPlaying: true,
          loadError: '',
        });
      });

      audioContext.onPause(() => {
        this.setData({ isPlaying: false });
      });

      audioContext.onStop(() => {
        this.updateProgress(0, this.data.duration || 0, false);
        this.setData({ isPlaying: false });
      });

      audioContext.onEnded(() => {
        this.updateProgress(0, this.data.duration || 0, false);
        this.setData({ isPlaying: false });
      });

      audioContext.onTimeUpdate(() => {
        if (this.data.isDragging) {
          return;
        }
        this.updateProgress(audioContext.currentTime || 0, audioContext.duration || this.data.duration || 0, false);
      });

      audioContext.onError(() => {
        this.setData({
          isPlaying: false,
          loadError: '暂时无法播放这段录音',
        });
      });

      this.audioContext = audioContext;
    },

    clearDurationTimer() {
      if (this.durationTimer) {
        clearTimeout(this.durationTimer);
        this.durationTimer = null;
      }
    },

    syncDuration(attempt = 0) {
      this.clearDurationTimer();
      if (!this.audioContext) {
        return;
      }

      const duration = Number(this.audioContext.duration || 0);
      if (duration > 0) {
        this.updateProgress(this.audioContext.currentTime || 0, duration, false);
        return;
      }

      if (attempt >= 8) {
        return;
      }

      this.durationTimer = setTimeout(() => {
        this.syncDuration(attempt + 1);
      }, 180);
    },

    updateAudioSource(nextSrc) {
      if (!this.audioContext) {
        return;
      }

      this.clearDurationTimer();
      this.setData({
        isPlaying: false,
        isDragging: false,
        currentTime: 0,
        duration: 0,
        sliderValue: 0,
        currentTimeLabel: '00:00',
        durationLabel: '00:00',
        loadError: '',
      });

      if (!nextSrc) {
        this.audioContext.stop();
        return;
      }

      if (this.audioContext.src !== nextSrc) {
        this.audioContext.stop();
        this.audioContext.src = nextSrc;
      }

      this.syncDuration();
    },

    updateProgress(currentTime, duration, isDragging) {
      const safeDuration = Math.max(0, Number(duration || 0));
      const safeCurrentTime = Math.max(0, Math.min(Number(currentTime || 0), safeDuration || Number(currentTime || 0)));
      const sliderValue = safeDuration > 0
        ? Math.min(1000, Math.max(0, Math.round((safeCurrentTime / safeDuration) * 1000)))
        : 0;

      this.setData({
        isDragging: !!isDragging,
        currentTime: safeCurrentTime,
        duration: safeDuration,
        sliderValue,
        currentTimeLabel: formatAudioClock(safeCurrentTime),
        durationLabel: formatAudioClock(safeDuration),
      });
    },

    handleTogglePlay() {
      if (!this.audioContext || !this.properties.src) {
        return;
      }

      if (this.data.isPlaying) {
        this.audioContext.pause();
        return;
      }

      this.audioContext.play();
    },

    handleSliderChanging(event) {
      const sliderValue = Number(event.detail && event.detail.value);
      const duration = this.data.duration || Number(this.audioContext && this.audioContext.duration) || 0;
      const nextTime = duration > 0 ? (sliderValue / 1000) * duration : 0;
      this.updateProgress(nextTime, duration, true);
    },

    handleSliderChange(event) {
      const sliderValue = Number(event.detail && event.detail.value);
      const duration = this.data.duration || Number(this.audioContext && this.audioContext.duration) || 0;
      const nextTime = duration > 0 ? (sliderValue / 1000) * duration : 0;

      if (this.audioContext && duration > 0) {
        this.audioContext.seek(nextTime);
      }

      this.updateProgress(nextTime, duration, false);
    },
  },
});
