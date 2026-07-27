const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const bridge = path.join(projectRoot, "scripts", "admin-bridge.cjs");

const children = [];
const run = (command, args) => {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });
  children.push(child);
  return child;
};

run(node, [bridge]);
run(node, [viteBin, "--host", "0.0.0.0", "--port", "5173"]);

const addresses = Object.values(os.networkInterfaces())
  .flat()
  .filter(Boolean)
  .filter((item) => item.family === "IPv4" && !item.internal)
  .map((item) => item.address);

console.log("ADMIN_URL_LOCAL http://localhost:5173/admin/");
for (const address of addresses) {
  console.log(`ADMIN_URL_PHONE http://${address}:5173/admin/`);
}

process.on("SIGINT", () => {
  for (const child of children) {
    child.kill();
  }
  process.exit(0);
});
