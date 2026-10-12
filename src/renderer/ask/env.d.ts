import type { AskApi } from '../../shared/askAi';

declare global {
  interface Window {
    askApi: AskApi;
  }
}

export {};
