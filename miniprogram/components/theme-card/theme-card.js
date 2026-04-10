Component({
  properties: {
    displaySummary: {
      type: String,
      value: '',
    },
    modeLabel: {
      type: String,
      value: '纯粹模式',
    },
    theme: {
      type: Object,
      value: null,
    },
    startMain: {
      type: String,
      value: '开始这次漫步',
    },
    startSub: {
      type: String,
      value: '带着这份线索，走进今天的城市片刻',
    },
    startDisabled: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    handleStart() {
      this.triggerEvent('start');
    },
  },
});
