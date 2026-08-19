const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function encryptPdfBuffer(pdfBuffer, password) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaf-pdf-'));
  const inputPath = path.join(tmpDir, 'input.pdf');
  const outputPath = path.join(tmpDir, 'output.pdf');

  try {
    fs.writeFileSync(inputPath, pdfBuffer);
    execFileSync(
      'qpdf',
      [
        '--encrypt',
        password,
        password,
        '256',
        '--',
        inputPath,
        outputPath,
      ],
      { stdio: 'pipe' }
    );
    return fs.readFileSync(outputPath);
  } catch (err) {
    console.warn('PDF encryption unavailable (install qpdf):', err.message);
    return pdfBuffer;
  } finally {
    try {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
      fs.rmdirSync(tmpDir);
    } catch {
      /* ignore cleanup errors */
    }
  }
}

module.exports = { encryptPdfBuffer };
