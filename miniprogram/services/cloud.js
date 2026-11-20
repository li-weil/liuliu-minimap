function callCloud(name, data = {}) {
  return wx.cloud.callFunction({
    name,
    data,
  }).then((response) => response.result);
}

function uploadToCloud({ cloudPath, filePath }) {
  return wx.cloud.uploadFile({
    cloudPath,
    filePath,
  });
}

module.exports = {
  callCloud,
  uploadToCloud,
};
