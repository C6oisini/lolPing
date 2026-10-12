import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AskApi, AskChunk, AskContext, AskState } from '../shared/askAi';
import { ASK_CH } from '../shared/askChannels';

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: AskApi = {
  getContext: () => ipcRenderer.invoke(ASK_CH.context),
  submit: (question) => ipcRenderer.invoke(ASK_CH.submit, question),
  cancel: () => ipcRenderer.invoke(ASK_CH.cancel),
  close: () => ipcRenderer.invoke(ASK_CH.close),
  copy: (text) => ipcRenderer.invoke(ASK_CH.copy, text),
  openSettings: () => ipcRenderer.invoke(ASK_CH.openSettings),
  onChunk: (cb) => subscribe<AskChunk>(ASK_CH.delta, cb),
  onState: (cb) => subscribe<AskState>(ASK_CH.state, cb),
  onContext: (cb) => subscribe<AskContext>(ASK_CH.context, cb),
};

contextBridge.exposeInMainWorld('askApi', api);
