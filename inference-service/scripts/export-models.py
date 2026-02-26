#!/usr/bin/env python3
"""
Export ONNX models required by the inference service.

YOLOv8n  →  models/yolov8n.onnx
  Source:  models/yolov8n.pt  (downloaded by download-models.js)
  Tool:    ultralytics export
  Input:   'images'  [1, 3, 640, 640]
  Output:  'output0' [1, 84, 8400]   (ultralytics standard — channel-first)

MobileNetV3-Large + 384-D projection  →  models/mobilenet_v3.onnx
  Source:  torchvision pretrained weights + fixed seed projection head
  Input:   'input'  [1, 3, 224, 224]
  Output:  'output' [1, 384]   (matches database vector(384) column)

The 384-D projection uses torch.manual_seed(42) so the weights are
deterministic across Docker rebuilds, keeping embeddings comparable.
"""

import sys
import pathlib

import torch
import torch.nn as nn
import torchvision.models as models
from ultralytics import YOLO

MODELS_DIR = pathlib.Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


def export_yolov8n():
    pt_path   = MODELS_DIR / "yolov8n.pt"
    onnx_path = MODELS_DIR / "yolov8n.onnx"

    if onnx_path.exists() and onnx_path.stat().st_size > 5_000_000:
        size_mb = onnx_path.stat().st_size / 1024 / 1024
        print(f"⏭️  yolov8n.onnx already valid ({size_mb:.1f} MB), skipping")
        return

    if not pt_path.exists():
        print("❌ yolov8n.pt not found — download-models.js must run first", file=sys.stderr)
        sys.exit(1)

    print("🔄 Exporting yolov8n.pt → yolov8n.onnx (ultralytics) ...")

    model = YOLO(str(pt_path))
    # simplify=False preserves the standard [1, 84, 8400] output layout
    # that server.js detectVehicle() expects.
    exported = model.export(format="onnx", imgsz=640, opset=11, simplify=False, half=False)

    exported_path = pathlib.Path(str(exported))
    if exported_path.resolve() != onnx_path.resolve():
        exported_path.rename(onnx_path)

    size_mb = onnx_path.stat().st_size / 1024 / 1024
    print(f"✅ yolov8n.onnx exported ({size_mb:.1f} MB)")


def export_mobilenet_v3():
    onnx_path = MODELS_DIR / "mobilenet_v3.onnx"

    if onnx_path.exists() and onnx_path.stat().st_size > 10_000_000:
        size_mb = onnx_path.stat().st_size / 1024 / 1024
        print(f"⏭️  mobilenet_v3.onnx already valid ({size_mb:.1f} MB), skipping")
        return

    print("🔄 Exporting MobileNetV3-Large + 384-D projection → mobilenet_v3.onnx ...")

    # Load pretrained MobileNetV3-Large (ImageNet weights)
    base = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.IMAGENET1K_V2)

    # Build embedding head:
    #   features  →  [1, 960, 7, 7]
    #   avgpool   →  [1, 960, 1, 1]
    #   flatten   →  [1, 960]
    #   linear    →  [1, 384]   ← matches database vector(384)
    #   layernorm →  [1, 384]
    #
    # Fixed seed ensures the same projection matrix across every Docker build,
    # so embeddings remain comparable between deployments.
    torch.manual_seed(42)
    embedding_model = nn.Sequential(
        base.features,       # pretrained feature extractor
        base.avgpool,        # AdaptiveAvgPool2d → [1, 960, 1, 1]
        nn.Flatten(),        # [1, 960]
        nn.Linear(960, 384), # project to 384-D
        nn.LayerNorm(384),   # normalise
    )
    embedding_model.eval()

    dummy = torch.randn(1, 3, 224, 224)
    torch.onnx.export(
        embedding_model,
        dummy,
        str(onnx_path),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=11,
        export_params=True,
    )

    size_mb = onnx_path.stat().st_size / 1024 / 1024
    print(f"✅ mobilenet_v3.onnx exported ({size_mb:.1f} MB)")


if __name__ == "__main__":
    print("🚀 ONNX Model Export\n")

    export_yolov8n()
    export_mobilenet_v3()

    print("\n✨ All models exported successfully!")
    print(f"📁 Models location: {MODELS_DIR}")
