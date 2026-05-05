import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ctrlxHost", {
  getSnapshot: () => ipcRenderer.invoke("host:get-snapshot"),
  subscribeState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("host:state", listener);
    return () => ipcRenderer.removeListener("host:state", listener);
  },
  subscribeSignal: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on("host:signal", listener);
    return () => ipcRenderer.removeListener("host:signal", listener);
  },
  subscribeClientStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on("host:client-status", listener);
    return () => ipcRenderer.removeListener("host:client-status", listener);
  },
  sendSignal: (payload: unknown) => ipcRenderer.send("host:send-signal", payload),
  setMediaState: (state: unknown) => ipcRenderer.send("host:set-media-state", state),
  log: (level: string, message: string) => ipcRenderer.send("host:log", { level, message })
});
