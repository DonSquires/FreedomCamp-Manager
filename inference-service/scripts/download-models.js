/**
 * Download Model Weights Script
 *
 * Downloads the YOLOv8n PyTorch weights (.pt) that are later exported to ONNX
 * by scripts/export-models.py.  MobileNetV3 is exported directly from torchvision
 * and does not need a separate download.
 *
 * Key fixes vs. original:
 *  - Checks HTTP status code before writing to disk (prevents saving 404 HTML)
 *  - Follows up to MAX_REDIRECTS levels of HTTP redirects
 *  - Validates downloaded file size; deletes and retries corrupted files
 *
 * Usage: node scripts/download-models.js
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const MODELS_DIR        = path.join(__dirname, '..', 'models');
const MAX_REDIRECTS     = 10;
const DOWNLOAD_TIMEOUT_MS = 120_000;

if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// Only the PyTorch weights are downloaded here.
// ONNX models are exported by scripts/export-models.py.
const MODELS = [
  {
    name: 'YOLOv8n (PyTorch weights)',
    url:  'https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.pt',
    filename: 'yolov8n.pt',
    size: '6.2 MB',
    minSize: 5 * 1024 * 1024,  // reject if < 5 MB (real file is ~6.2 MB)
  },
];

/**
 * Download a file, following up to MAX_REDIRECTS redirects.
 * Rejects with an error if the response status is not 200 or the
 * downloaded file is smaller than minSize bytes.
 */
function downloadFile(url, dest, name, minSize) {
  return new Promise((resolve, reject) => {
    let redirectsLeft = MAX_REDIRECTS;

    function doRequest(requestUrl) {
      const parsed = new URL(requestUrl);
      const lib = parsed.protocol === 'https:' ? https : http;

      const req = lib.get(requestUrl, { headers: { 'User-Agent': 'inference-service/1.0' } }, (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (!location) {
            reject(new Error(`Redirect with no Location header for ${name}`));
            return;
          }
          if (--redirectsLeft < 0) {
            reject(new Error(`Too many redirects downloading ${name}`));
            return;
          }
          res.resume();  // drain response body to free the socket
          doRequest(new URL(location, requestUrl).toString());
          return;
        }

        // Reject non-200 responses (prevents writing HTML error pages to disk)
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(
            `HTTP ${res.statusCode} downloading ${name} from ${requestUrl}. ` +
            'Check that the URL is valid and the file exists.'
          ));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const file = fs.createWriteStream(dest);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            process.stdout.write(`\r   Progress: ${pct}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
          } else {
            process.stdout.write(`\r   Downloaded: ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB`);
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            process.stdout.write('\n');
            const { size } = fs.statSync(dest);
            if (minSize && size < minSize) {
              fs.unlinkSync(dest);
              reject(new Error(
                `Downloaded ${name} is only ${size} bytes — expected ≥ ${minSize} bytes. ` +
                'The URL may have returned an error page instead of the model.'
              ));
              return;
            }
            console.log(`✅ ${name} (${(size / 1024 / 1024).toFixed(1)} MB)`);
            resolve();
          });
        });

        file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
        res.on('error',  (err) => { fs.unlink(dest, () => {}); reject(err); });
      }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });

      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Download timed out for ${name}`));
      });
    }

    doRequest(url);
  });
}

async function downloadModels() {
  console.log('🚀 ORC/AI Model Downloader\n');

  for (const model of MODELS) {
    const filepath = path.join(MODELS_DIR, model.filename);

    // Skip only if file exists AND meets minimum size (prevents re-using corrupted files)
    if (fs.existsSync(filepath)) {
      const { size } = fs.statSync(filepath);
      if (!model.minSize || size >= model.minSize) {
        console.log(`⏭️  ${model.name} already valid (${(size / 1024 / 1024).toFixed(1)} MB), skipping`);
        continue;
      }
      console.log(`⚠️  ${model.name} is too small (${size} bytes) — deleting and re-downloading...`);
      fs.unlinkSync(filepath);
    }

    console.log(`📥 Downloading ${model.name} (${model.size})...`);
    try {
      await downloadFile(model.url, filepath, model.name, model.minSize);
    } catch (err) {
      console.error(`❌ Failed to download ${model.name}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\n✅ Downloads complete — run export-models.py to build ONNX models');
}

downloadModels();
