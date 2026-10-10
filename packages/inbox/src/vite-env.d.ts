/// <reference types="vite/client" />

interface ImportMetaEnv {
   readonly VITE_SQUAWK_VERSION?: string
}

interface ImportMeta {
   readonly env: ImportMetaEnv
}
