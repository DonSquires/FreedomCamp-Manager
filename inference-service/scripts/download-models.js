/**
 * Download ONNX Models Script
 * 
 * Downloads pretrained models for ORC/AI inference:
 * - YOLOv8n (6.2 MB) - Vehicle detection
 * - MobileNetV3 (21 MB) - Feature embeddings
 * - License Plate Detector (5 MB) - Plate detection (optional)
 * - UltraFace (1.2 MB) - Face detection (optional)
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
const MODELS = [
  {
    name: 'YOLOv8n',
    // Use a repo-hosted raw binary URL because the old Ultralytics release asset
    // URL now returns 404 and breaks Docker builds.
    url: 'https://raw.githubusercontent.com/Hyuto/yolov8-onnxruntime-web/master/public/model/yolov8n.onnx',
    filename: 'yolov8n.onnx',
    size: '12.2 MB',
    minSize: 5 * 1024 * 1024  // 5 MB minimum guard against HTML/error payloads
  },
  {
    name: 'MobileNetV3',
    // Use media.githubusercontent.com so Git LFS files are served as real binaries
    // (raw.githubusercontent.com returns only the LFS pointer text for LFS-tracked files)
    url: 'https://media.githubusercontent.com/media/onnx/models/main/validated/vision/classification/mobilenet/model/mobilenetv3-large-1.0.onnx',
    filename: 'mobilenet_v3.onnx',
    size: '21 MB',
    minSize: 15 * 1024 * 1024  // 15 MB minimum (real model is ~21 MB)
  },
  {
    name: 'License Plate Detector (YOLOv9-nano)',
    // Open-source ONNX plate detection model from ankandrew/open-image-models (MIT licence).
    // Input: 640x640, single class "license_plate", standard YOLOv9 output format.
    // Falls back gracefully if unavailable — the /infer/alpr endpoint works without it
    // by using the vehicle crop from the main YOLOv8n model.
    url: 'https://github.com/ankandrew/open-image-models/releases/download/v0.0.1/plates-yolov9-nano-1d-320.onnx',
    filename: 'plate_detect.onnx',
    size: '5 MB',
    minSize: 1 * 1024 * 1024,  // 1 MB minimum
    optional: true,             // service still works if this fails to download
  },
  {
    name: 'UltraFace-640 (Face Detector)',
    // UltraFace from ONNX Model Zoo (MIT licence).
    // Input:  1×3×480×640 float32, normalised (pixel − 127) / 128, BGR channel order.
    // Output: scores [1,4420,2] + boxes [1,4420,4] (cx,cy,w,h normalised 0-1).
    // Threshold: confidence index-1 >= 0.7 is a face.
    // Falls back to OpenAI vision when unavailable.
    url: 'https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-640.onnx',
    filename: 'version-RFB-640.onnx',
    size: '1.3 MB',
    minSize: 500 * 1024,        // 500 KB minimum
    optional: true,             // service still works; OpenAI vision is the fallback
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

// Main download function
async function downloadModels() {
  console.log('🚀 ORC/AI Model Downloader\n');
  
  for (const model of MODELS) {
    const filepath = path.join(MODELS_DIR, model.filename);
    
    // Skip if already exists AND passes minimum size check (avoids using cached corrupted files)
    if (fs.existsSync(filepath)) {
      const { size: fileSize } = fs.statSync(filepath);
      if (fileSize >= model.minSize) {
        console.log(`⏭️  ${model.name} already exists (${(fileSize / 1024 / 1024).toFixed(1)} MB), skipping...`);
        continue;
      }
      console.log(`⚠️  ${model.name} exists but is too small (${fileSize} bytes) — re-downloading...`);
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
      console.log(`✅ ${model.name} validated (${(downloadedSize / 1024 / 1024).toFixed(1)} MB)`);
    } catch (error) {
      if (model.optional) {
        console.warn(`⚠️  Optional model ${model.name} failed to download (non-fatal): ${error.message}`);
        console.warn(`   The /infer/alpr endpoint will use the vehicle-crop fallback instead.`);
      } else {
        console.error(`❌ Failed to download ${model.name}:`, error.message);
        process.exit(1);
      }
    }
  }
  
  console.log('\n✨ All models downloaded successfully!');
  console.log('📁 Models location:', MODELS_DIR);
  console.log('\n🎯 Next step: Run `npm start` to test locally');
}

// Run download
downloadModels();
