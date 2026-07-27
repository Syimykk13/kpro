const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const dataDir = path.join(projectRoot, "data");
const dataFile = path.join(dataDir, "admin-snapshot.json");
const seedFile = path.join(projectRoot, "src", "shared", "adminSeedData.json");
const port = Number(process.env.KASSA_PRO_ADMIN_PORT || 5173);
const {
  appendCustomer,
  appendProduct,
  appendSale,
  appendDebtTransaction,
  appendShiftReport,
  assertRegisterDevice,
  assertAccountAvailable,
  findAdminLogin,
  findRegisterByKey,
  lockRegisterDevice,
  makeCashSnapshot,
  mergeSnapshotForSafeWrite,
  normalizeSnapshot,
  registerIdFromPayload
} = require("./admin-data-utils.cjs");
const {
  createKompanionQrOrder,
  getQrOrderStatus,
  handleKompanionWebhook
} = require("./kompanion-qr.cjs");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function ensureSnapshot() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    fs.copyFileSync(seedFile, dataFile);
  }
}

function readSnapshot() {
  ensureSnapshot();
  return normalizeSnapshot(JSON.parse(fs.readFileSync(dataFile, "utf8")));
}

function writeSnapshot(snapshot) {
  fs.mkdirSync(dataDir, { recursive: true });
  let nextSnapshot = snapshot;
  if (fs.existsSync(dataFile)) {
    try {
      const currentSnapshot = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      nextSnapshot = mergeSnapshotForSafeWrite(currentSnapshot, snapshot);
    } catch {
      nextSnapshot = snapshot;
    }
  }
  const normalized = normalizeSnapshot(nextSnapshot);
  fs.writeFileSync(dataFile, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/snapshot") {
    sendJson(res, 200, readSnapshot());
    return true;
  }

  if (req.method === "POST" && pathname === "/api/snapshot") {
    const snapshot = await readBody(req);
    const savedSnapshot = writeSnapshot(snapshot);
    sendJson(res, 200, { ok: true, snapshot: savedSnapshot });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/admin-login") {
    const { login, password } = await readBody(req);
    const snapshot = readSnapshot();
    const found = findAdminLogin(snapshot, login, password);
    if (!found) {
      sendJson(res, 401, { error: "Неверный логин или пароль" });
      return true;
    }
    try {
      assertAccountAvailable(found.account);
    } catch (error) {
      sendJson(res, 403, { error: error.message });
      return true;
    }
    sendJson(res, 200, { accountId: found.account.id, session: found.session, snapshot });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/activate") {
    const { key, deviceId, deviceName } = await readBody(req);
    const snapshot = readSnapshot();
    const found = findRegisterByKey(snapshot, key);
    if (!found) {
      sendJson(res, 404, { error: "Ключ не найден." });
      return true;
    }
    const { account, register } = found;
    try {
      assertAccountAvailable(account);
    } catch (error) {
      sendJson(res, 403, { error: error.message });
      return true;
    }
    try {
      assertRegisterDevice(register, deviceId);
    } catch (error) {
      sendJson(res, 409, { error: error.message });
      return true;
    }
    if (register.activationKey.status !== "active" && register.deviceId !== deviceId) {
      sendJson(res, 409, { error: "Ключ уже использован или отозван." });
      return true;
    }
    const now = new Date().toISOString();
    lockRegisterDevice(register, deviceId, deviceName);
    register.activationKey.status = "used";
    register.activationKey.usedAt = now;
    register.activationKey.usedByRegisterId = register.id;
    register.activationKey.usedByDeviceId = deviceId;
    register.status = "online";
    register.lastSyncAt = now;
    register.activatedAt = register.activatedAt || now;
    snapshot.updatedAt = now;
    account.updatedAt = now;
    writeSnapshot(snapshot);
    sendJson(res, 200, makeCashSnapshot(account, register, key));
    return true;
  }

  if (req.method === "POST" && pathname === "/api/register-sync") {
    const { accountId, sale, shiftReport, debtTransaction, customer, product, deviceId } = await readBody(req);
    const snapshot = readSnapshot();
    const account = snapshot.accounts.find((item) => item.id === accountId);
    if (!account) {
      sendJson(res, 404, { error: "Аккаунт не найден." });
      return true;
    }
    const registerId = registerIdFromPayload({ sale, shiftReport, debtTransaction, customer, product });
    if (registerId) {
      const register = account.registers.find((item) => item.id === registerId);
      try {
        if (register) {
          assertRegisterDevice(register, deviceId);
          lockRegisterDevice(register, deviceId);
        }
      } catch (error) {
        sendJson(res, 409, { error: error.message });
        return true;
      }
    }
    appendCustomer(account, customer);
    appendProduct(account, product);
    appendSale(account, sale);
    appendDebtTransaction(account, debtTransaction);
    appendShiftReport(account, shiftReport);
    const now = new Date().toISOString();
    account.updatedAt = now;
    snapshot.updatedAt = now;
    writeSnapshot(snapshot);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/kompanion/qr/create") {
    const input = await readBody(req);
    const snapshot = readSnapshot();
    const account = snapshot.accounts.find((item) => item.id === input.accountId);
    if (!account) {
      sendJson(res, 404, { error: "Аккаунт не найден." });
      return true;
    }
    const register = account.registers.find((item) => item.id === input.registerId);
    try {
      if (register) {
        assertRegisterDevice(register, input.deviceId);
        lockRegisterDevice(register, input.deviceId);
      }
    } catch (error) {
      sendJson(res, 409, { error: error.message });
      return true;
    }
    try {
      const order = await createKompanionQrOrder(dataDir, input);
      sendJson(res, 201, { ok: true, order });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message, details: error.details || null });
    }
    return true;
  }

  if (req.method === "GET" && pathname.startsWith("/api/kompanion/qr/status/")) {
    const txnId = decodeURIComponent(pathname.split("/").pop() || "");
    try {
      sendJson(res, 200, { ok: true, order: getQrOrderStatus(dataDir, txnId) });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/kompanion/qr/callback") {
    try {
      const payload = await readBody(req);
      const order = handleKompanionWebhook(dataDir, payload);
      sendJson(res, 200, { ok: true, txnId: order.txnId, status: order.status });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message });
    }
    return true;
  }

  if (req.method === "GET" && pathname.startsWith("/api/account-snapshot/")) {
    const accountId = decodeURIComponent(pathname.split("/").pop() || "");
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const registerId = requestUrl.searchParams.get("registerId") || "";
    const activationKey = requestUrl.searchParams.get("activationKey") || "";
    const deviceId = requestUrl.searchParams.get("deviceId") || "";
    const snapshot = readSnapshot();
    const account = snapshot.accounts.find((item) => item.id === accountId);
    if (!account) {
      sendJson(res, 404, { error: "Аккаунт не найден." });
      return true;
    }
    try {
      assertAccountAvailable(account);
    } catch (error) {
      sendJson(res, 403, { error: error.message });
      return true;
    }
    const register =
      account.registers.find((item) => item.id === registerId) ||
      account.registers.find((item) => item.activationKey?.key === activationKey) ||
      account.registers[0];
    try {
      assertRegisterDevice(register, deviceId);
      lockRegisterDevice(register, deviceId);
    } catch (error) {
      sendJson(res, 409, { error: error.message });
      return true;
    }
    writeSnapshot(snapshot);
    sendJson(res, 200, makeCashSnapshot(account, register, register.activationKey.key));
    return true;
  }

  return false;
}

function sendStatic(res, filePath) {
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/") || pathname === "/api/snapshot") {
      const handled = await handleApi(req, res, pathname);
      if (!handled) {
        sendJson(res, 404, { error: "Not found" });
      }
      return;
    }

    if (pathname === "/") {
      sendStatic(res, path.join(distDir, "index.html"));
      return;
    }

    if (pathname === "/admin" || pathname === "/admin/") {
      sendStatic(res, path.join(distDir, "admin", "index.html"));
      return;
    }

    if (pathname === "/control" || pathname === "/control/") {
      sendStatic(res, path.join(distDir, "control", "index.html"));
      return;
    }

    const normalized = path.normalize(path.join(distDir, pathname.replace(/^\/+/, "")));
    sendStatic(res, normalized);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Admin server error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  ensureSnapshot();
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);

  console.log(`ADMIN_URL_LOCAL http://localhost:${port}/admin/`);
  console.log(`CONTROL_URL_LOCAL http://localhost:${port}/control/`);
  for (const address of addresses) {
    console.log(`ADMIN_URL_PHONE http://${address}:${port}/admin/`);
  }
  console.log(`ADMIN_DATA ${dataFile}`);
});
