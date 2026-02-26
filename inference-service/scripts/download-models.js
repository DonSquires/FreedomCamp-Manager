/**
 * Download ONNX Models Script
 * 
 * Downloads pretrained models for ORC/AI inference:
 * - YOLOv8n (6.2 MB) - Vehicle detection
 * - MobileNetV3 (21 MB) - Feature embeddings
 * 
 * Usage: node scripts/download-models.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'models');
const MAX_REDIRECTS = 10;

// Ensure models directory exists
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// Model download URLs
// NOTE: These URLs are fallbacks for manual/local use.
// In the Docker build, models are pre-exported by scripts/export-models.py
// (Python + ultralytics + torchvision) and copied before this script runs,
// so the size checks below pass immediately and no download occurs.
//
// If you need models outside Docker, run instead:
//   pip install "torch>=2.0" torchvision "ultralytics>=8.0" onnx
//   python scripts/export-models.py
const MODELS = [
  {
    name: 'YOLOv8n',
    // yolov8n.onnx is not a pre-built release asset; it must be exported from
    // yolov8n.pt via the ultralytics Python package (see scripts/export-models.py).
    url: 'https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8n.onnx',
    filename: 'yolov8n.onnx',
    size: '6.2 MB',
    minSize: 5 * 1024 * 1024  // 5 MB minimum (real model is ~6.2 MB)
  },
  {
    name: 'MobileNetV3',
    // mobilenet_v3.onnx is exported from torchvision (see scripts/export-models.py).
    url: 'https://github.com/ultralytics/assets/releases/download/v8.4.0/mobilenet_v3.onnx',
    filename: 'mobilenet_v3.onnx',
    size: '21 MB',
    minSize: 15 * 1024 * 1024  // 15 MB minimum (real model is ~21 MB)
  }
];

// Download helper with multi-level redirect support and progress reporting
function downloadFile(url, dest, name, size) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let settled = false;

    function done(err) {
      if (settled) return;
      settled = true;
      file.close(() => {
        if (err) {
          fs.unlink(dest, (unlinkErr) => {
            if (unlinkErr && unlinkErr.code !== 'ENOENT') {
              console.warn(`⚠️  Could not delete partial download ${dest}:`, unlinkErr.message);
            }
          });
          reject(err);
        } else {
          resolve();
        }
      });
    }

    file.on('error', (err) => done(err));

    console.log(`📥 Downloading ${name} (${size})...`);

    // Follow redirects recursively (GitHub releases and LFS CDN can chain several)
    function follow(currentUrl, hops) {
      if (hops > MAX_REDIRECTS) {
        done(new Error('Too many redirects'));
        return;
      }

      https.get(currentUrl, (response) => {
        const { statusCode, headers } = response;

        // Follow any 3xx redirect
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          response.resume(); // drain response body so socket is reused
          follow(headers.location, hops + 1);
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          done(new Error(`HTTP ${statusCode} for ${currentUrl}`));
          return;
        }

        const totalBytes = parseInt(headers['content-length'], 10);
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes) {
            const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            process.stdout.write(`\r   Progress: ${percent}%`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          console.log(`\n✅ ${name} downloaded successfully`);
          done(null);
        });
      }).on('error', (err) => done(err));
    }

    follow(url, 0);
  });
}

// Returns true if the file at `filepath` starts with a text byte rather than
// binary ONNX protobuf data.  ONNX files begin with protobuf field bytes;
// error pages and LFS pointers begin with printable ASCII.
function isTextFile(filepath) {
  const TEXT_FIRST_BYTES = new Set([
    0x3C, // '<'  — HTML / XML
    0x76, // 'v'  — Git LFS pointer ("version https://…")
    0x7B, // '{'  — JSON
    0x4E, // 'N'  — "Not Found" plain-text response
  ]);
  const buf = Buffer.alloc(1);
  const fd = fs.openSync(filepath, 'r');
  fs.readSync(fd, buf, 0, 1, 0);
  fs.closeSync(fd);
  return TEXT_FIRST_BYTES.has(buf[0]);
}

// Main download function
async function downloadModels() {
  console.log('🚀 ORC/AI Model Downloader\n');
  
  for (const model of MODELS) {
    const filepath = path.join(MODELS_DIR, model.filename);
    
    // Skip if already exists AND passes minimum size check (avoids using cached corrupted files)
    if (fs.existsSync(filepath)) {
      const { size: fileSize } = fs.statSync(filepath);
      if (fileSize >= model.minSize) {
        // Also confirm the file starts with binary data (not a cached HTML error page)
        if (!isTextFile(filepath)) {
          console.log(`⏭️  ${model.name} already exists (${(fileSize / 1024 / 1024).toFixed(1)} MB), skipping...`);
          continue;
        }
        console.log(`⚠️  ${model.name} exists but appears corrupt (text file, not binary) — re-downloading...`);
      } else {
        console.log(`⚠️  ${model.name} exists but is too small (${fileSize} bytes) — re-downloading...`);
      }
      fs.unlinkSync(filepath);
    }
    
    try {
      await downloadFile(model.url, filepath, model.name, model.size);

      // Validate the downloaded file is large enough to be a real model
      const { size: downloadedSize } = fs.statSync(filepath);
      if (downloadedSize < model.minSize) {
        try { fs.unlinkSync(filepath); } catch (e) { /* best-effort */ }
        throw new Error(
          `Downloaded file is only ${downloadedSize} bytes (expected >= ${model.minSize}). ` +
          `Likely an HTML error page or Git LFS pointer. Check the download URL.`
        );
      }

      // Validate the file is a binary ONNX protobuf, not an HTML error page or
      // plain-text LFS pointer.
      if (isTextFile(filepath)) {
        try { fs.unlinkSync(filepath); } catch (e) { /* best-effort */ }
        throw new Error(
          `Downloaded file appears to be text, not a binary ONNX model. ` +
          `The download URL likely returned an error page. ` +
          `Run  python scripts/export-models.py  to generate models locally instead.`
        );
      }

      console.log(`✅ ${model.name} validated (${(downloadedSize / 1024 / 1024).toFixed(1)} MB)`);
    } catch (error) {
      console.error(`❌ Failed to download ${model.name}:`, error.message);
      console.error(`   To generate ONNX models without a download URL, run:`);
      console.error(`   pip install "torch>=2.0" torchvision "ultralytics>=8.0" onnx`);
      console.error(`   python scripts/export-models.py`);
      process.exit(1);
    }
  }
  
  console.log('\n✨ All models ready!');
  console.log('📁 Models location:', MODELS_DIR);
  console.log('\n🎯 Next step: Run `npm start` to test locally');
}

// Run download
downloadModels();
