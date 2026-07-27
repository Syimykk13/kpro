import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const electronPath = require("electron");
const nodePath = process.execPath;
const devUrl = "http://127.0.0.1:5173/cash/";

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code}`));
      }
    });
  });

await run(nodePath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.electron.json"]);

const vite = spawn(nodePath, [viteBin, "--host", "127.0.0.1", "--port", "5173"], {
  stdio: "inherit"
});

for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const response = await fetch(devUrl);
    if (response.ok) {
      break;
    }
  } catch {
    await delay(250);
  }
}

const electron = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devUrl
  }
});

const cleanup = () => {
  vite.kill();
};

electron.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  cleanup();
  electron.kill();
});
