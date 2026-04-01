const fs = require('fs');
const https = require('https');
const path = require('path');

const dir = path.join(__dirname, '../miniprogram/assets/images');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function run() {
  try {
    console.log('Downloading stamp...');
    // A placeholder red stamp
    await download('https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Red_stamp_example.svg/1024px-Red_stamp_example.svg.png', path.join(dir, 'stamp.png'));
    
    console.log('Downloading barcode...');
    // A placeholder barcode
    await download('https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/EAN-13-5901234123457.svg/1024px-EAN-13-5901234123457.svg.png', path.join(dir, 'barcode.png'));

    console.log('Downloading texture...');
    // A placeholder paper texture
    await download('https://www.transparenttextures.com/patterns/cream-paper.png', path.join(dir, 'texture.png'));

    console.log('Done downloading assets.');
  } catch (e) {
    console.error(e);
  }
}

run();
