#!/bin/bash

# Local Testing Script for ORC/AI Inference Service
# 
# Usage: chmod +x test-local.sh && ./test-local.sh

set -e

echo "🧪 ORC/AI Inference Service - Local Test Suite"
echo "================================================"
echo ""

# Check if models exist
echo "📋 Step 1: Checking models..."
if [ ! -f "models/yolov8n.onnx" ] || [ ! -f "models/mobilenet_v3.onnx" ]; then
    echo "❌ Models not found!"
    echo "   Run: npm run download-models"
    exit 1
fi
echo "✅ Models found"
echo ""

# Check if server is running
echo "📋 Step 2: Checking if server is running..."
if ! curl -s http://localhost:3000/health > /dev/null; then
    echo "❌ Server not running!"
    echo "   Run: npm start"
    echo "   Then run this test script again in a new terminal"
    exit 1
fi
echo "✅ Server is running"
echo ""

# Test health endpoint
echo "📋 Step 3: Testing /health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:3000/health)
echo "$HEALTH_RESPONSE" | jq .

if echo "$HEALTH_RESPONSE" | jq -e '.status == "healthy"' > /dev/null; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi
echo ""

# Download test image if not exists
echo "📋 Step 4: Preparing test image..."
if [ ! -f "test-vehicle.jpg" ]; then
    echo "   Downloading test vehicle photo..."
    curl -sL "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=640" -o test-vehicle.jpg
    echo "   ✅ Test image downloaded"
else
    echo "   ✅ Test image exists"
fi
echo ""

# Test inference endpoint
echo "📋 Step 5: Testing /infer endpoint..."
echo "   Processing vehicle photo..."
INFER_RESPONSE=$(curl -s -X POST http://localhost:3000/infer \
    -F "photo=@test-vehicle.jpg")

echo "$INFER_RESPONSE" | jq .
echo ""

# Validate response
if echo "$INFER_RESPONSE" | jq -e '.success == true' > /dev/null; then
    QUALITY=$(echo "$INFER_RESPONSE" | jq -r '.data.embedding_quality')
    CONFIDENCE=$(echo "$INFER_RESPONSE" | jq -r '.data.detection.confidence')
    DIMENSION=$(echo "$INFER_RESPONSE" | jq -r '.data.metadata.dimension')
    TIME_MS=$(echo "$INFER_RESPONSE" | jq -r '.data.metadata.processing_time_ms')
    
    echo "✅ Inference successful!"
    echo "   📊 Results:"
    echo "      - Embedding Quality: $QUALITY"
    echo "      - Detection Confidence: $CONFIDENCE"
    echo "      - Vector Dimension: $DIMENSION"
    echo "      - Processing Time: ${TIME_MS}ms"
    echo ""
    
    # Performance check
    if (( $(echo "$TIME_MS > 1000" | bc -l) )); then
        echo "⚠️  Warning: Processing time >1s (slow performance)"
    else
        echo "🚀 Performance: GOOD (< 1 second)"
    fi
else
    echo "❌ Inference failed!"
    exit 1
fi

echo ""
echo "================================================"
echo "✨ All tests passed! Ready for deployment."
echo ""
echo "Next steps:"
echo "  1. Deploy to Fly.io: fly deploy"
echo "  2. Or deploy to Render: Push to GitHub"
echo "  3. Copy deployed URL"
echo "  4. Set INFERENCE_SERVICE_URL in Supabase"
