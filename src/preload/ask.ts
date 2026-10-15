import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AskApi, AskAttach, AskChunk, AskContext, AskState, AskTurn, ConversationSummary } from '../shared/askAi';
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
  clear: () => ipcRenderer.invoke(ASK_CH.clear),
  close: () => ipcRenderer.invoke(ASK_CH.close),
  copy: (text) => ipcRenderer.invoke(ASK_CH.copy, text),
  openSettings: () => ipcRenderer.invoke(ASK_CH.openSettings),
  attachScreenshot: () => ipcRenderer.invoke(ASK_CH.attach) as Promise<AskAttach>,
  history: () => ipcRenderer.invoke(ASK_CH.history) as Promise<ConversationSummary[]>,
  loadHistory: (id) => ipcRenderer.invoke(ASK_CH.historyLoad, id),
  removeHistory: (id) => ipcRenderer.invoke(ASK_CH.historyRemove, id) as Promise<ConversationSummary[]>,
  renameHistory: (id, title) => ipcRenderer.invoke(ASK_CH.historyRename, id, title) as Promise<ConversationSummary[]>,
  clearHistory: () => ipcRenderer.invoke(ASK_CH.historyClear),
  onChunk: (cb) => subscribe<AskChunk>(ASK_CH.delta, cb),
  onState: (cb) => subscribe<AskState>(ASK_CH.state, cb),
  onContext: (cb) => subscribe<AskContext>(ASK_CH.context, cb),
  onRestore: (cb) => subscribe<AskTurn[]>(ASK_CH.restore, cb),
};

contextBridge.exposeInMainWorld('askApi', api);
