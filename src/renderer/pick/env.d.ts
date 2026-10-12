import type { PickApi } from '../../shared/askAi';

declare global {
  interface Window {
    pickApi: PickApi;
  }
}

export {};
