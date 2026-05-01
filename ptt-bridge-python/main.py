import os
import tempfile
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

try:
    import ctranslate2
except Exception:
    ctranslate2 = None

try:
    from faster_whisper import WhisperModel
except Exception:
    WhisperModel = None

try:
    from transformers import AutoTokenizer
except Exception:
    AutoTokenizer = None

app = FastAPI(title="Bob Translator Pod", version="2.0.0")

WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "distil-large-v3")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "float16")
TRANSLATOR_MODEL_PATH = os.getenv("TRANSLATOR_MODEL_PATH", "nllb-200-distilled-600M")
TOKENIZER_MODEL_NAME = os.getenv("TOKENIZER_MODEL_NAME", "facebook/nllb-200-distilled-600M")
TRANSLATOR_DEVICE = os.getenv("TRANSLATOR_DEVICE", "cuda")
DEFAULT_CONTEXT = os.getenv("DEFAULT_CONTEXT", "LINZ_ENFORCEMENT")
DEFAULT_TARGET_LANG = os.getenv("DEFAULT_TARGET_LANG", "hin_Deva")
DEFAULT_SOURCE_LANG = os.getenv("DEFAULT_SOURCE_LANG", "eng_Latn")
BOB_TRANSLATOR_MOCK = str(os.getenv("BOB_TRANSLATOR_MOCK", "false")).strip().lower() in {
    "1", "true", "yes", "on"
}


class TranslateRequest(BaseModel):
    text: str
    source_lang: Optional[str] = None
    target_lang: Optional[str] = None
    context: Optional[str] = None


stt_model = None
translator = None
tokenizer = None
model_init_error: Optional[str] = None


def ensure_models_loaded() -> None:
    global stt_model, translator, tokenizer, model_init_error

    if BOB_TRANSLATOR_MOCK:
        return

    if stt_model is not None and translator is not None and tokenizer is not None:
        return

    if model_init_error:
        raise RuntimeError(model_init_error)

    try:
        if WhisperModel is None or ctranslate2 is None or AutoTokenizer is None:
            raise RuntimeError('Model packages are not installed (faster-whisper/ctranslate2/transformers)')

        stt_model = WhisperModel(
            WHISPER_MODEL_NAME,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE,
        )
        translator = ctranslate2.Translator(
            TRANSLATOR_MODEL_PATH,
            device=TRANSLATOR_DEVICE,
        )
        tokenizer = AutoTokenizer.from_pretrained(TOKENIZER_MODEL_NAME)
    except Exception as exc:
        model_init_error = str(exc)
        raise


def detect_target_lang(source_lang: str, explicit_target: Optional[str]) -> str:
    if explicit_target:
      return explicit_target
    # Simple bidirectional default for EN <-> HI
    if source_lang.startswith("eng"):
      return "hin_Deva"
    return "eng_Latn"


def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    if BOB_TRANSLATOR_MOCK:
        return f"[mock:{source_lang}->{target_lang}] {text}"

    ensure_models_loaded()

    source_ids = tokenizer.encode(text)
    source_tokens = tokenizer.convert_ids_to_tokens(source_ids)
    result = translator.translate_batch([source_tokens], target_prefix=[[target_lang]])
    hypothesis_tokens = result[0].hypotheses[0]
    hypothesis_ids = tokenizer.convert_tokens_to_ids(hypothesis_tokens)
    return tokenizer.decode(hypothesis_ids, skip_special_tokens=True)


def transcribe_audio_bytes(audio_bytes: bytes):
    if BOB_TRANSLATOR_MOCK:
        return "mock transcript", DEFAULT_SOURCE_LANG

    ensure_models_loaded()

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=True) as tmp:
        tmp.write(audio_bytes)
        tmp.flush()
        segments, info = stt_model.transcribe(tmp.name, beam_size=5)
        text = " ".join([segment.text.strip() for segment in segments]).strip()
        detected_lang = info.language or DEFAULT_SOURCE_LANG
        return text, detected_lang


@app.get("/health")
async def health():
    model_ready = BOB_TRANSLATOR_MOCK or (
        stt_model is not None and translator is not None and tokenizer is not None
    )

    return {
        "status": "ok" if model_ready else "degraded",
        "mock_mode": BOB_TRANSLATOR_MOCK,
        "model_ready": model_ready,
        "model_init_error": model_init_error,
        "whisper_model": WHISPER_MODEL_NAME,
        "translator_model": TRANSLATOR_MODEL_PATH,
        "tokenizer_model": TOKENIZER_MODEL_NAME,
        "device": WHISPER_DEVICE,
    }


@app.post("/translate")
async def translate_endpoint(payload: TranslateRequest):
    if not payload.text.strip():
        return JSONResponse(status_code=400, content={"error": "text is required"})

    source_lang = payload.source_lang or DEFAULT_SOURCE_LANG
    target_lang = detect_target_lang(source_lang, payload.target_lang)
    translated = translate_text(payload.text, source_lang, target_lang)

    return {
        "original": payload.text,
        "translated": translated,
        "source_lang": source_lang,
        "target_lang": target_lang,
        "context": payload.context or DEFAULT_CONTEXT,
    }


@app.websocket("/ws/translate")
async def translate_stream(websocket: WebSocket):
    await websocket.accept()

    try:
        while True:
            audio_data = await websocket.receive_bytes()
            text, detected_lang = transcribe_audio_bytes(audio_data)

            if not text:
                await websocket.send_json({
                    "original": "",
                    "translated": "",
                    "source_lang": detected_lang,
                    "target_lang": detect_target_lang(detected_lang, None),
                    "context": DEFAULT_CONTEXT,
                    "warning": "empty_transcript",
                })
                continue

            source_lang = DEFAULT_SOURCE_LANG if detected_lang == "en" else detected_lang
            target_lang = detect_target_lang(source_lang, None)
            translated_text = translate_text(text, source_lang, target_lang)

            await websocket.send_json({
                "original": text,
                "translated": translated_text,
                "source_lang": source_lang,
                "target_lang": target_lang,
                "context": DEFAULT_CONTEXT,
            })
    except WebSocketDisconnect:
        return
    except Exception as exc:
        await websocket.send_json({
            "error": "translation_failed",
            "message": str(exc),
        })
        await websocket.close(code=1011)
