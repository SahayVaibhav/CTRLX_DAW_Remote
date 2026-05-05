const { app, BrowserWindow, desktopCapturer, screen, ipcMain, session, dialog } = require("electron");

if (typeof app.requestSingleInstanceLock === "function" && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  import("./dist/apps/host/src/main/index.js")
    .then(({ startHost }) => startHost({ app, BrowserWindow, desktopCapturer, screen, ipcMain, session, dialog }))
    .catch((error) => {
      console.error("Failed to start CTRLX host", error);
      app.quit();
    });
}
