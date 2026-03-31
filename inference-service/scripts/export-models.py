"""
Export + Download ONNX Models for ORC/AI Inference Service

Exports two models to ONNX format, then downloads two optional models:
  1. YOLOv8n          — vehicle detection (input 640×640, output 8400 boxes × 84 attrs)
  2. MobileNetV3 Large — feature embeddings (input 224×224, output 960-dim vector)
  3. UltraFace-640    — face detection (optional, input 1×3×480×640, ~1.3 MB)
  4. plate_detect     — YOLOv9-nano plate detection (optional, input 320×320, ~5 MB)

Usage:
    pip install "torch>=2.0" "torchvision>=0.15" --extra-index-url https://download.pytorch.org/whl/cpu
    pip install "ultralytics>=8.0" "onnx>=1.14"
    python scripts/export-models.py

Output files are written to  inference-service/models/
"""

import os
import shutil
import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ── 1. YOLOv8n ───────────────────────────────────────────────────────────────
def export_yolov8n():
    try:
        from ultralytics import YOLO
    except ImportError:
        print("❌  ultralytics not installed.  Run: pip install ultralytics")
        sys.exit(1)

    dest = MODELS_DIR / "yolov8n.onnx"
    if dest.exists() and dest.stat().st_size >= 5 * 1024 * 1024:
        print(f"⏭️  YOLOv8n already exists ({dest.stat().st_size / 1e6:.1f} MB), skipping.")
        return

    print("📥  Exporting YOLOv8n to ONNX (downloads yolov8n.pt ~6 MB) …")
    # Change to MODELS_DIR so the .pt download and .onnx output land there
    orig_dir = os.getcwd()
    try:
        os.chdir(MODELS_DIR)
        model = YOLO("yolov8n.pt")
        result = model.export(format="onnx", imgsz=640, opset=12, simplify=False)
        result_path = Path(str(result))
        if result_path != dest:
            shutil.move(str(result_path), str(dest))
    finally:
        os.chdir(orig_dir)

    print(f"✅  YOLOv8n exported: {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


# ── 2. MobileNetV3 Large ──────────────────────────────────────────────────────
def export_mobilenet_v3():
    try:
        import torch
        import torchvision.models as tvm
    except ImportError:
        print("❌  torch / torchvision not installed.")
        print("    Run: pip install torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu")
        sys.exit(1)

    dest = MODELS_DIR / "mobilenet_v3.onnx"
    if dest.exists() and dest.stat().st_size >= 15 * 1024 * 1024:
        print(f"⏭️  MobileNetV3 already exists ({dest.stat().st_size / 1e6:.1f} MB), skipping.")
        return

    print("📥  Exporting MobileNetV3 Large to ONNX …")
    net = tvm.mobilenet_v3_large(weights="IMAGENET1K_V2")
    # Remove the final 1000-class classifier → 960-dimensional feature embeddings
    net.classifier = torch.nn.Identity()
    net.eval()

    dummy = torch.zeros(1, 3, 224, 224)
    torch.onnx.export(
        net,
        dummy,
        str(dest),
        opset_version=12,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch_size"}, "output": {0: "batch_size"}},
    )
    print(f"✅  MobileNetV3 exported: {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


# ── 3. UltraFace-640 (optional) ───────────────────────────────────────────────
def download_face_model():
    dest = MODELS_DIR / "version-RFB-640.onnx"
    if dest.exists() and dest.stat().st_size >= 500 * 1024:
        print(f"⏭️  UltraFace-640 already exists ({dest.stat().st_size / 1e6:.1f} MB), skipping.")
        return

    # Try multiple URLs: media.githubusercontent.com serves Git LFS files as real binaries.
    urls = [
        "https://media.githubusercontent.com/media/onnx/models/main/validated/vision/body_analysis/ultraface/models/version-RFB-640.onnx",
        "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-640.onnx",
    ]
    print("📥  Downloading UltraFace-640 face detection model (~1.3 MB) …")
    for url in urls:
        try:
            urllib.request.urlretrieve(url, str(dest))
            if dest.exists() and dest.stat().st_size >= 500 * 1024:
                print(f"✅  UltraFace-640 downloaded: {dest} ({dest.stat().st_size / 1e6:.1f} MB)")
                return
            else:
                print(f"⚠️  Download from {url} yielded a too-small file, trying next URL …")
                dest.unlink(missing_ok=True)
        except Exception as e:
            print(f"⚠️  Failed to download from {url}: {e}")
            dest.unlink(missing_ok=True)

    print("⚠️  UltraFace-640 could not be downloaded (optional – service uses OpenAI vision fallback).")


# ── 4. YOLOv9-nano plate detector (optional) ─────────────────────────────────
def download_plate_model():
    dest = MODELS_DIR / "plate_detect.onnx"
    if dest.exists() and dest.stat().st_size >= 1 * 1024 * 1024:
        print(f"⏭️  plate_detect already exists ({dest.stat().st_size / 1e6:.1f} MB), skipping.")
        return

    # yolo-v9-t-384 end2end model (384×384 input, ~7.8 MB, MIT licence).
    # "end2end" means NMS is baked in; output shape [N, 7] = [idx, x1, y1, x2, y2, class_id, score].
    url = "https://github.com/ankandrew/open-image-models/releases/download/assets/yolo-v9-t-384-license-plates-end2end.onnx"
    print("📥  Downloading YOLOv9-nano plate detection model (~5 MB) …")
    try:
        urllib.request.urlretrieve(url, str(dest))
        if dest.exists() and dest.stat().st_size >= 1 * 1024 * 1024:
            print(f"✅  plate_detect downloaded: {dest} ({dest.stat().st_size / 1e6:.1f} MB)")
        else:
            print("⚠️  plate_detect download yielded a too-small file (optional – Tesseract OCR fallback remains active).")
            dest.unlink(missing_ok=True)
    except Exception as e:
        print(f"⚠️  plate_detect could not be downloaded (optional): {e}")
        dest.unlink(missing_ok=True)


if __name__ == "__main__":
    print("🚀  ORC/AI Model Exporter\n")
    export_yolov8n()
    export_mobilenet_v3()
    download_face_model()
    download_plate_model()
    print("\n✨  All models ready in:", MODELS_DIR)
