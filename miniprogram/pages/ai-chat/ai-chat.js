const { askLiuliu } = require('../../services/dongao');
const userTags = require('../../utils/userTags');

const WELCOME_TEXT = '喵~ 我是遛遛，你的东澳岛小向导。岛上的景点、玩法、天气怎么安排，都可以问我。';

Page({
  data: {
    messages: [
      { role: 'ai', text: WELCOME_TEXT },
    ],
    inputValue: '',
    sending: false,
    scrollIntoView: '',
  },

  onLoad() {
    this._msgSeq = 1;
  },

  onShow() {
    if (!userTags.isOnboardingDone()) {
      wx.navigateTo({ url: '/pages/onboarding/onboarding' });
    }
  },

  onInputValueChange(e) {
    this.setData({ inputValue: e.detail.value });
  },

  onMicTap() {
    wx.showToast({ title: '语音提问还在路上，先打字问问吧', icon: 'none' });
  },

  onSendTap() {
    this._send();
  },

  onInputConfirm() {
    this._send();
  },

  _send() {
    const question = String(this.data.inputValue || '').trim();
    if (!question || this.data.sending) return;
    const userMsg = { role: 'user', text: question };
    const sendingMsg = { role: 'ai', text: '遛遛在想…', pending: true };
    const messages = [...this.data.messages, userMsg, sendingMsg];
    this.setData({
      messages,
      inputValue: '',
      sending: true,
    });
    this._scrollToBottom();

    // 云函数按 [{role, content}] 处理，去掉 pending 提示条
    const history = this.data.messages
      .filter(m => !m.pending)
      .slice(-6)
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));

    askLiuliu(question, history)
      .then((result) => {
        const reply = String((result && result.reply) || '').trim()
          || '遛遛暂时没想好，换个问法试试？';
        this._replaceLastAiMessage(reply);
      })
      .catch((err) => {
        console.error('askLiuliu failed:', err);
        this._replaceLastAiMessage('遛遛走神了，请确认云函数 askLiuliu 已部署后再试一次。');
      })
      .finally(() => {
        this.setData({ sending: false });
        this._scrollToBottom();
      });
  },

  _replaceLastAiMessage(text) {
    const messages = this.data.messages.slice();
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'ai') {
        messages[i] = { role: 'ai', text };
        break;
      }
    }
    this.setData({ messages });
  },

  _scrollToBottom() {
    this.setData({ scrollIntoView: `msg-${this.data.messages.length - 1}` });
  },
});
