const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {
  appendCustomer,
  appendProduct,
  appendSale,
  appendDebtTransaction,
  appendShiftReport,
  assertRegisterDevice,
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

const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, "data");
const dataFile = path.join(dataDir, "admin-snapshot.json");
const seedFile = path.join(projectRoot, "src", "shared", "adminSeedData.json");
const port = Number(process.env.KASSA_PRO_BRIDGE_PORT || 5174);

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
  fs.writeFileSync(dataFile, JSON.stringify(normalizeSnapshot(nextSnapshot), null, 2), "utf8");
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

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 200, { ok: true });
    return;
  }

  try {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathname = requestUrl.pathname;

    if (req.method === "GET" && req.url === "/api/snapshot") {
      send(res, 200, readSnapshot());
      return;
    }

    if (req.method === "POST" && req.url === "/api/snapshot") {
      writeSnapshot(await readBody(req));
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin-login") {
      const { login, password } = await readBody(req);
      const snapshot = readSnapshot();
      const found = findAdminLogin(snapshot, login, password);
      if (!found) {
        send(res, 401, { error: "Неверный логин или пароль" });
        return;
      }
      send(res, 200, { accountId: found.account.id, session: found.session, snapshot });
      return;
    }

    if (req.method === "POST" && req.url === "/api/activate") {
      const { key, deviceId, deviceName } = await readBody(req);
      const snapshot = readSnapshot();
      const found = findRegisterByKey(snapshot, key);
      if (!found) {
        send(res, 404, { error: "Ключ не найден." });
        return;
      }
      const { account, register } = found;
      try {
        assertRegisterDevice(register, deviceId);
      } catch (error) {
        send(res, 409, { error: error.message });
        return;
      }
      if (register.activationKey.status !== "active" && register.deviceId !== deviceId) {
        send(res, 409, { error: "Ключ уже использован или отозван." });
        return;
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
      send(res, 200, makeCashSnapshot(account, register, key));
      return;
    }

    if (req.method === "POST" && req.url === "/api/register-sync") {
      const { accountId, sale, shiftReport, debtTransaction, customer, product, deviceId } = await readBody(req);
      const snapshot = readSnapshot();
      const account = snapshot.accounts.find((item) => item.id === accountId);
      if (!account) {
        send(res, 404, { error: "Аккаунт не найден." });
        return;
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
          send(res, 409, { error: error.message });
          return;
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
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/kompanion/qr/create") {
      const input = await readBody(req);
      const snapshot = readSnapshot();
      const account = snapshot.accounts.find((item) => item.id === input.accountId);
      if (!account) {
        send(res, 404, { error: "Аккаунт не найден." });
        return;
      }
      const register = account.registers.find((item) => item.id === input.registerId);
      try {
        if (register) {
          assertRegisterDevice(register, input.deviceId);
          lockRegisterDevice(register, input.deviceId);
        }
      } catch (error) {
        send(res, 409, { error: error.message });
        return;
      }
      try {
        const order = await createKompanionQrOrder(dataDir, input);
        send(res, 201, { ok: true, order });
      } catch (error) {
        send(res, error.statusCode || 500, { error: error.message, details: error.details || null });
      }
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/kompanion/qr/status/")) {
      const txnId = decodeURIComponent(requestUrl.pathname.split("/").pop() || "");
      try {
        send(res, 200, { ok: true, order: getQrOrderStatus(dataDir, txnId) });
      } catch (error) {
        send(res, error.statusCode || 500, { error: error.message });
      }
      return;
    }

    if (
      req.method === "POST" &&
      (pathname === "/api/kompanion/qr/callback" || pathname === "/api/payments/kompanion/webhook")
    ) {
      try {
        const payload = await readBody(req);
        const order = handleKompanionWebhook(dataDir, payload);
        send(res, 200, { ok: true, txnId: order.txnId, status: order.status });
      } catch (error) {
        send(res, error.statusCode || 500, { error: error.message });
      }
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/account-snapshot/")) {
      const accountId = decodeURIComponent(requestUrl.pathname.split("/").pop() || "");
      const registerId = requestUrl.searchParams.get("registerId") || "";
      const activationKey = requestUrl.searchParams.get("activationKey") || "";
      const deviceId = requestUrl.searchParams.get("deviceId") || "";
      const snapshot = readSnapshot();
      const account = snapshot.accounts.find((item) => item.id === accountId);
      if (!account) {
        send(res, 404, { error: "Аккаунт не найден." });
        return;
      }
      const register =
        account.registers.find((item) => item.id === registerId) ||
        account.registers.find((item) => item.activationKey?.key === activationKey) ||
        account.registers[0];
      try {
        assertRegisterDevice(register, deviceId);
        lockRegisterDevice(register, deviceId);
      } catch (error) {
        send(res, 409, { error: error.message });
        return;
      }
      writeSnapshot(snapshot);
      send(res, 200, makeCashSnapshot(account, register, register.activationKey.key));
      return;
    }

    send(res, 404, { error: "Not found" });
  } catch (error) {
    send(res, 500, { error: error.message || "Bridge error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  ensureSnapshot();
  console.log(`KASSA_PRO_BRIDGE http://127.0.0.1:${port}`);
  console.log(`KASSA_PRO_BRIDGE_FILE ${dataFile}`);
});
