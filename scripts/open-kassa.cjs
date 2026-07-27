const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const projectRoot = path.resolve(__dirname, "..");
const logPath = path.join(projectRoot, "open-kassa.log");
const log = (message) => {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
};
const bundledPlaywright = path.join(
  os.homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "node",
  "node_modules",
  "playwright"
);

const { _electron: electron } = require(bundledPlaywright);
const electronPath = require("electron");

(async () => {
  log("launcher:start");
  log(`launcher:electronPath ${electronPath}`);
  const app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env
    }
  });
  log("launcher:electron-launched");

  const page = await app.firstWindow();
  log(`launcher:first-window ${page.url()}`);
  await page.bringToFront();
  log("launcher:brought-to-front");
  console.log("KASSA_PRO_OPEN");

  await new Promise((resolve) => {
    app.on("close", () => {
      log("launcher:app-close");
      resolve();
    });
  });
})().catch((error) => {
  log(`launcher:error ${error.stack || error.message}`);
  console.error(error);
  process.exit(1);
});
