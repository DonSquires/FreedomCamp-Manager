/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Allow importing image files
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.jpeg" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}
declare module "*.gif" {
  const src: string;
  export default src;
}
declare module "*.webp" {
  const src: string;
  export default src;
}

// CDN-loaded SheetJS — typed loosely so dynamic imports succeed
declare module "https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs" {
  export * from "xlsx";
}
