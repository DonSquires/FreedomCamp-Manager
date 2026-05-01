# Bob Translator Pod (Python FastAPI)

Persistent GPU translator pod for EN <-> HI stream handling.

## Endpoints

- `GET /health`
- `POST /translate` for text translation
- `WS /ws/translate` for streaming audio chunks

## Environment Variables

- `WHISPER_MODEL` (default: `distil-large-v3`)
- `WHISPER_DEVICE` (default: `cuda`)
- `WHISPER_COMPUTE_TYPE` (default: `float16`)
- `TRANSLATOR_MODEL_PATH` (default: `nllb-200-distilled-600M`)
- `TOKENIZER_MODEL_NAME` (default: `facebook/nllb-200-distilled-600M`)
- `TRANSLATOR_DEVICE` (default: `cuda`)
- `DEFAULT_CONTEXT` (default: `LINZ_ENFORCEMENT`)

## Run Locally

```bash
cd ptt-bridge-python
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8274
```

## Container

```bash
docker build -t bob-translator-pod:latest .
docker run --gpus all -p 8274:8274 bob-translator-pod:latest
```
