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

// Ensure models directory exists
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// Model download URLs
const MODELS = [
  {
    name: 'YOLOv8n',
    url: 'https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx',
    filename: 'yolov8n.onnx',
    size: '6.2 MB'
  },
  {
    name: 'MobileNetV3',
    url: 'https://github.com/onnx/models/raw/main/vision/classification/mobilenet/model/mobilenetv3-large-1.0.onnx',
    filename: 'mobilenet_v3.onnx',
    size: '21 MB'
  }
];

// Download helper with progress
function downloadFile(url, dest, name, size) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    console.log(`📥 Downloading ${name} (${size})...`);
    
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        https.get(response.headers.location, (redirectResponse) => {
          const totalBytes = parseInt(redirectResponse.headers['content-length'], 10);
          let downloadedBytes = 0;
          
          redirectResponse.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            process.stdout.write(`\r   Progress: ${percent}%`);
          });
          
          redirectResponse.pipe(file);
          
          file.on('finish', () => {
            file.close();
            console.log(`\n✅ ${name} downloaded successfully`);
            resolve();
          });
        }).on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      } else {
        const totalBytes = parseInt(response.headers['content-length'], 10);
        let downloadedBytes = 0;
        
        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          process.stdout.write(`\r   Progress: ${percent}%`);
        });
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log(`\n✅ ${name} downloaded successfully`);
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Main download function
async function downloadModels() {
  console.log('🚀 ORC/AI Model Downloader\n');
  
  for (const model of MODELS) {
    const filepath = path.join(MODELS_DIR, model.filename);
    
    // Skip if already exists
    if (fs.existsSync(filepath)) {
      console.log(`⏭️  ${model.name} already exists, skipping...`);
      continue;
    }
    
    try {
      await downloadFile(model.url, filepath, model.name, model.size);
    } catch (error) {
      console.error(`❌ Failed to download ${model.name}:`, error.message);
      process.exit(1);
    }
  }
  
  console.log('\n✨ All models downloaded successfully!');
  console.log('📁 Models location:', MODELS_DIR);
  console.log('\n🎯 Next step: Run `npm start` to test locally');
}

// Run download
downloadModels();
