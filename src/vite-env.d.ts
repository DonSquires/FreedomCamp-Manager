/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_PTT_MOCK_MODE?: string
	readonly VITE_API_MOCK_MODE?: string
	readonly VITE_BOB_MANAGER_URL?: string
	readonly VITE_WHISPER_PROXY_URL?: string
	readonly VITE_RAILWAY_STT_URL?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
