# Distributed Bob Architecture Strategy

## Objective
Optimize latency, reliability, and operating cost for the ptt-server ecosystem by moving safety-critical inference to the edge while preserving cloud-based verification and compliance workflows.

## 1. Core Shift: Edge-First Safety
### Problem
Streaming raw video and audio to cloud inference nodes introduces a network-dependent single point of failure. In rural New Zealand conditions, unreliable connectivity can degrade or block real-time safety decisions.

### Solution
Move real-time detection logic to the user device. Use cloud services for verification, enrichment, and reporting, not for first-response detection.

## 2. Three-Layer Distributed Architecture
| Component | Location | Responsibility | Latency Target | Technology |
|---|---|---|---|---|
| Bob (Edge) | User device | Immediate safety detection: vehicle detection, man-down alerts, and weapon detection. Must continue operating offline. | Near real-time | onnxruntime-react-native, onnxruntime-web, TensorFlow.js |
| Bob (Core) | hPanel VPS / RunPod | Orchestration: PTT signaling, authentication, rostering, CRM logic, policy routing, and audit event intake. | ~100 ms | Node.js, Supabase |
| Bob (Brain) | RunPod | Deep analysis: evidence review, infringement drafting with LLMs, multimodal verification for high-fidelity media. | Seconds | Ollama, LLaVA, containerized inference |

## 3. Network Optimization: Audio Hot Lane
To prevent robotic or unstable voice quality, separate signaling and media transport.

### Signaling Path
App -> Railway -> App (HTTP/WebSocket)

Purpose:
- User authentication
- Channel selection
- Floor control
- Session metadata and policy controls

### Media Path
App -> RunPod SFU -> App (UDP/RTP)

Purpose:
- Low-latency audio transport
- Better jitter behavior
- Reduced media path congestion

### Action
Deploy Mediasoup or LiveKit on a CPU RunPod container as the SFU, while keeping signaling in Railway.

## 4. Cost and Scale Strategy: Serverless Inference
### Current State
Persistent GPU pods run continuously, including during low activity windows.

### Target State
RunPod serverless endpoints execute only during inference bursts.

### Reference Workflow
1. Bob (Edge) detects a candidate violation and captures evidence.
2. App uploads evidence metadata and payload to Railway.
3. Railway invokes RunPod Serverless Endpoint API.
4. RunPod executes short-lived verification (for example 2 to 5 seconds).
5. Result returns to Railway for persistence, compliance workflows, and operator review.
6. Compute scales down automatically when idle.

### Benefit
Pay-per-inference-second economics with improved scalability for sporadic enforcement demand.

## 5. Implementation Roadmap
### Phase 1: Edge Deployment (Safety)
- Export current YOLOv8 models to ONNX format.
- Integrate onnxruntime-web (and/or onnxruntime-react-native where relevant) into the client inference path.
- Validate offline detection for key safety events.

Success criteria:
- Core safety detections continue when network is unavailable.

### Phase 2: Serverless Migration (Cost)
- Package Ollama/LLaVA workflows as reproducible containers.
- Deploy inference as RunPod Serverless endpoints.
- Refactor server.js orchestration to endpoint invocation instead of persistent inference sockets.

Success criteria:
- No always-on GPU required for routine operations.

### Phase 3: Evidence Locking (Compliance)
- Implement store-and-forward on the edge client.
- Encrypt evidence at rest while offline.
- Auto-upload and reconcile when connectivity returns.

Success criteria:
- No evidence loss during outages, with auditable chain-of-custody.

## 6. Operational Guardrails
- Enforce branch protection for Bob-generated code changes.
- Require human approval before merge to protected branches.
- Record emergency events in immutable audit logs with linked evidence artifacts.
- Store large model assets via Git LFS or dedicated model storage, not standard Git blobs.

## 7. KPI Framework
- Edge detection latency (p50/p95)
- PTT media jitter and packet loss
- Offline detection success rate
- GPU cost per verified incident
- Evidence upload reconciliation success rate
- False positive and false negative rates per model and environment

## 8. Professional Assessment
This strategy is excellent. It is practical, field-aware, and financially disciplined.

Key strengths:
- It prioritizes officer safety by removing network dependency from first-response detection.
- It uses clear separation of responsibilities across edge, core orchestration, and deep analysis.
- It introduces a realistic cost model through serverless inference, directly aligned with variable enforcement demand.
- It includes compliance-grade evidence handling, which is critical for enforcement defensibility.

Overall, this is the right architecture direction for resilient, real-world operation in mixed-connectivity environments.
