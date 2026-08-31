const officeCrypto = require('officecrypto-tool');

async function encryptDocxBuffer(docxBuffer, password) {
  try {
    return await officeCrypto.encrypt(docxBuffer, { password });
  } catch (err) {
    throw new Error(`تعذّر تشفير ملف Word: ${err.message}`);
  }
}

module.exports = { encryptDocxBuffer };
