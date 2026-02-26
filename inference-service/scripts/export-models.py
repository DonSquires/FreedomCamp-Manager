"""
Export ONNX Models for ORC/AI Inference Service

Exports two models to ONNX format using the installed Python packages:
  1. YOLOv8n   — vehicle detection (input 640×640, output 8400 boxes × 84 attrs)
  2. MobileNetV3 Large — feature embeddings (input 224×224, output 960-dim vector)

Usage:
    pip install "torch>=2.0" "torchvision>=0.15" --extra-index-url https://download.pytorch.org/whl/cpu
    pip install "ultralytics>=8.0" "onnx>=1.14"
    python scripts/export-models.py

Output files are written to  inference-service/models/
"""

import os
import shutil
import sys
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


if __name__ == "__main__":
    print("🚀  ORC/AI Model Exporter\n")
    export_yolov8n()
    export_mobilenet_v3()
    print("\n✨  All models ready in:", MODELS_DIR)
