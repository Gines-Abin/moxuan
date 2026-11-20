/// <reference types="vite/client" />

import type { InkForgeApi } from '../shared/ipc';

declare global {
  interface Window {
    inkforge: InkForgeApi;
  }
}

export {};
