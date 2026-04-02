Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '隐私保护说明',
    },
    content: {
      type: String,
      value: '',
    },
    buttonText: {
      type: String,
      value: '同意并继续',
    },
    contractName: {
      type: String,
      value: '隐私保护指引',
    },
  },

  methods: {
    handleClose() {
      this.triggerEvent('close');
    },

    handleOpenContract() {
      this.triggerEvent('opencontract');
    },

    handleAgree() {
      this.triggerEvent('agree');
    },

    handleAgreeError() {
      this.triggerEvent('close');
    },

    noop() {},
  },
});
