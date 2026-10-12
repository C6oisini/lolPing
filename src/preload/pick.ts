import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PickApi, PickContext, PickRect } from '../shared/askAi';
import { PICK_CH } from '../shared/pickChannels';

const api: PickApi = {
  onContext(cb: (c: PickContext) => void): () => void {
    const handler = (_e: IpcRendererEvent, c: PickContext) => cb(c);
    ipcRenderer.on(PICK_CH.context, handler);
    return () => ipcRenderer.removeListener(PICK_CH.context, handler);
  },
  ready: () => ipcRenderer.send(PICK_CH.ready),
  done: (rect: PickRect | null) => ipcRenderer.invoke(PICK_CH.done, rect),
  cancel: () => ipcRenderer.invoke(PICK_CH.cancel),
};

contextBridge.exposeInMainWorld('pickApi', api);
