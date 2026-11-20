const { privacyBypassForDev } = require('./config');

function createDefaultPrivacyPopup() {
  return {
    visible: false,
    title: '隐私保护说明',
    content: '',
    buttonText: '同意并继续',
    contractName: '隐私保护指引',
  };
}

function getPrivacySetting() {
  return new Promise((resolve) => {
    if (!wx.getPrivacySetting) {
      resolve({
        needAuthorization: false,
        privacyContractName: '隐私保护指引',
        buttonName: '同意并继续',
      });
      return;
    }

    wx.getPrivacySetting({
      success: (res) => {
        resolve({
          needAuthorization: !!res.needAuthorization,
          privacyContractName: res.privacyContractName || '隐私保护指引',
          buttonName: res.buttonName || '同意并继续',
        });
      },
      fail: () => {
        resolve({
          needAuthorization: false,
          privacyContractName: '隐私保护指引',
          buttonName: '同意并继续',
        });
      },
    });
  });
}

function setPrivacyPopup(page, patch = {}) {
  page.setData({
    privacyPopup: {
      ...createDefaultPrivacyPopup(),
      ...(page.data && page.data.privacyPopup ? page.data.privacyPopup : {}),
      ...patch,
    },
  });
}

function resetPrivacyResolvers(page) {
  page.__privacyResolve = null;
  page.__privacyReject = null;
}

function ensurePrivacyAuthorization(page, options = {}) {
  if (!page || typeof page.setData !== 'function') {
    return Promise.reject(new Error('privacy_page_context_required'));
  }

  if (privacyBypassForDev) {
    return Promise.resolve(true);
  }

  return getPrivacySetting().then((setting) => {
    if (!setting.needAuthorization) {
      return true;
    }

    return new Promise((resolve, reject) => {
      if (page.__privacyReject) {
        page.__privacyReject(new Error('privacy_authorization_interrupted'));
      }

      page.__privacyResolve = resolve;
      page.__privacyReject = reject;

      setPrivacyPopup(page, {
        visible: true,
        title: options.title || '隐私保护说明',
        content: options.content || '继续使用前，请先阅读并同意隐私保护指引。',
        buttonText: setting.buttonName || options.buttonText || '同意并继续',
        contractName: setting.privacyContractName || '隐私保护指引',
      });
    });
  });
}

function resolvePrivacyAuthorization(page) {
  if (!page) {
    return;
  }

  const resolve = page.__privacyResolve;
  resetPrivacyResolvers(page);
  setPrivacyPopup(page, { visible: false });

  if (resolve) {
    resolve(true);
  }
}

function rejectPrivacyAuthorization(page, error) {
  if (!page) {
    return;
  }

  const reject = page.__privacyReject;
  resetPrivacyResolvers(page);
  setPrivacyPopup(page, { visible: false });

  if (reject) {
    reject(error || new Error('privacy_authorization_denied'));
  }
}

function openPrivacyContract() {
  return new Promise((resolve, reject) => {
    if (!wx.openPrivacyContract) {
      reject(new Error('privacy_contract_not_supported'));
      return;
    }

    wx.openPrivacyContract({
      success: resolve,
      fail: reject,
    });
  });
}

module.exports = {
  createDefaultPrivacyPopup,
  ensurePrivacyAuthorization,
  openPrivacyContract,
  rejectPrivacyAuthorization,
  resolvePrivacyAuthorization,
};
