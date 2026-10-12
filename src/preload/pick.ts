import { contextBridge, ipcRenderer } from 'electron';
import type { PickApi, PickContext, PickRect } from '../shared/askAi';
import { PICK_CH } from '../shared/pickChannels';

const api: PickApi = {
  getContext: () => ipcRenderer.invoke(PICK_CH.context) as Promise<PickContext>,
  done: (rect: PickRect | null) => ipcRenderer.invoke(PICK_CH.done, rect),
  cancel: () => ipcRenderer.invoke(PICK_CH.cancel),
};

contextBridge.exposeInMainWorld('pickApi', api);
