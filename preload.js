const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listFonts: () => ipcRenderer.invoke('fonts:list'),
  readFont: (file) => ipcRenderer.invoke('fonts:read', file),
  importFonts: () => ipcRenderer.invoke('fonts:import'),
  importFontFolder: () => ipcRenderer.invoke('fonts:importFolder'),
  importFontPaths: (paths) => ipcRenderer.invoke('fonts:importPaths', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  saveImage: (dataUrl, defaultName) => ipcRenderer.invoke('image:save', dataUrl, defaultName),
  exportVideo: (job) => ipcRenderer.invoke('video:export', job),
  onExportProgress: (cb) => ipcRenderer.on('video:progress', (_e, f) => cb(f)),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  saveProject: (p) => ipcRenderer.invoke('projects:save', p),
  loadProject: (id) => ipcRenderer.invoke('projects:load', id),
  duplicateProject: (id) => ipcRenderer.invoke('projects:duplicate', id),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
});
