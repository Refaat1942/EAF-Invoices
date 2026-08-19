const officeCrypto = require('officecrypto-tool');

async function encryptDocxBuffer(docxBuffer, password) {
  try {
    return await officeCrypto.encrypt(docxBuffer, { password });
  } catch (err) {
    console.warn('Word encryption failed:', err.message);
    return docxBuffer;
  }
}

module.exports = { encryptDocxBuffer };
