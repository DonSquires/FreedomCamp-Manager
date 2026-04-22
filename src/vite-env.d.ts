/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_PTT_MOCK_MODE?: string
	readonly VITE_API_MOCK_MODE?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
