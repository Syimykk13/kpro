const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function qrOrdersFile(dataDir) {
  return path.join(dataDir, "kompanion-qr-orders.json");
}

function readQrOrders(dataDir) {
  const file = qrOrdersFile(dataDir);
  if (!fs.existsSync(file)) {
    return [];
  }
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeQrOrders(dataDir, orders) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(qrOrdersFile(dataDir), JSON.stringify(orders, null, 2), "utf8");
}

function qrWebhookLogFile(dataDir) {
  return path.join(dataDir, "kompanion-qr-webhooks.log");
}

function appendWebhookLog(dataDir, entry) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(qrWebhookLogFile(dataDir), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
  } catch {
    // Webhook logging is diagnostic only.
  }
}

function getConfig() {
  return {
    baseUrl: (process.env.KOMPANION_QR_BASE_URL || "").replace(/\/+$/, ""),
    merchantId: process.env.KOMPANION_QR_MERCHANT_ID || "",
    apiKey: process.env.KOMPANION_QR_API_KEY || "",
    secret: process.env.KOMPANION_QR_SECRET || "",
    returnUrl: process.env.KOMPANION_QR_RETURN_URL || "https://kpro.kg/",
    ttl: process.env.KOMPANION_QR_TTL || "15m"
  };
}

function assertConfigured(config) {
  const missing = Object.entries({
    KOMPANION_QR_BASE_URL: config.baseUrl,
    KOMPANION_QR_MERCHANT_ID: config.merchantId,
    KOMPANION_QR_API_KEY: config.apiKey,
    KOMPANION_QR_SECRET: config.secret
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    const error = new Error(`QR-оплата не настроена на сервере: ${missing.join(", ")}`);
    error.statusCode = 503;
    throw error;
  }
}

function amountToTyiyn(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    const error = new Error("Сумма QR-оплаты должна быть больше нуля.");
    error.statusCode = 400;
    throw error;
  }
  return Math.round(value * 100);
}

function sign(config, txnId, amountTyiyn) {
  return crypto
    .createHash("sha256")
    .update(`${config.merchantId}${txnId}${amountTyiyn}${config.secret}`)
    .digest("hex");
}

function uniqueTruthy(values) {
  return values.map((value) => String(value || "").trim()).filter((value, index, list) => value && list.indexOf(value) === index);
}

function normalizeOrderStatus(status) {
  const value = String(status || "").trim().toUpperCase();
  if (["PAID", "PAYED", "COMPLETED", "COMPLETE", "APPROVED"].includes(value)) return "SUCCESS";
  if (["FAILED", "FAIL", "DECLINED", "CANCELED", "CANCELLED"].includes(value)) return "ERROR";
  return value || "PENDING";
}

function makeExternalId(registerId) {
  const safeRegister = String(registerId || "reg").replace(/[^a-zA-Z0-9]/g, "").slice(-18) || "reg";
  const stamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString("hex");
  return `KPRO-${safeRegister}-${stamp}-${random}`.slice(0, 64);
}

function asciiPaymentText(value, fallback) {
  const text = String(value || fallback || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

async function createKompanionQrOrder(dataDir, input) {
  const config = getConfig();
  assertConfigured(config);
  const amountTyiyn = amountToTyiyn(input.amount);
  const externalId = input.externalId || makeExternalId(input.registerId);
  const receiptLabel = asciiPaymentText(input.receiptNumber || externalId, externalId);
  const body = {
    externalId,
    amount: amountTyiyn,
    purpose: asciiPaymentText(`K-pro receipt ${receiptLabel}`, `K-pro receipt ${externalId}`),
    description: asciiPaymentText(input.description, "K-pro payment"),
    returnUrl: config.returnUrl,
    sign: sign(config, externalId, amountTyiyn),
    details: {
      accountId: String(input.accountId || ""),
      storeId: String(input.storeId || ""),
      registerId: String(input.registerId || ""),
      receiptNumber: String(input.receiptNumber || ""),
      ttl: config.ttl
    }
  };

  const response = await fetch(`${config.baseUrl}/merchant/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "ru",
      "X-Merchant-Id": config.merchantId,
      "X-Api-Key": config.apiKey
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Банк вернул ошибку ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.details = payload;
    throw error;
  }

  const now = new Date().toISOString();
  const order = {
    externalId,
    txnId: payload.txnId || externalId,
    accountId: input.accountId || "",
    storeId: input.storeId || "",
    registerId: input.registerId || "",
    deviceId: input.deviceId || "",
    receiptNumber: input.receiptNumber || "",
    amount: Number(input.amount),
    amountTyiyn,
    status: "PENDING",
    paymentUrl: payload.paymentUrl || "",
    qrUrl: payload.qrUrl || payload.paymentUrl || "",
    createdAt: now,
    updatedAt: now,
    bankResponse: payload
  };
  const orders = readQrOrders(dataDir).filter((item) => item.txnId !== order.txnId && item.externalId !== externalId);
  orders.unshift(order);
  writeQrOrders(dataDir, orders.slice(0, 1000));
  return order;
}

function getQrOrderStatus(dataDir, txnId) {
  const order = readQrOrders(dataDir).find((item) => item.txnId === txnId || item.externalId === txnId);
  if (!order) {
    const error = new Error("QR-заказ не найден.");
    error.statusCode = 404;
    throw error;
  }
  return order;
}

function handleKompanionWebhook(dataDir, payload) {
  const txnId = String(payload?.txnId || "");
  const status = normalizeOrderStatus(payload?.status);
  const receivedSign = String(payload?.sign || "");
  const orders = readQrOrders(dataDir);
  const index = orders.findIndex((item) => item.txnId === txnId || item.externalId === txnId);
  if (index < 0) {
    appendWebhookLog(dataDir, { ok: false, reason: "order_not_found", txnId, payload });
    const error = new Error("QR-заказ не найден.");
    error.statusCode = 404;
    throw error;
  }
  const config = getConfig();
  assertConfigured(config);
  const order = orders[index];
  const signTxnIds = uniqueTruthy([txnId, order.txnId, order.externalId]);
  const signAmounts = uniqueTruthy([payload?.amount, payload?.amountTyiyn, order.amountTyiyn]);
  const expectedSigns = signTxnIds.flatMap((id) => signAmounts.map((amount) => sign(config, id, amount)));
  if (!receivedSign || !expectedSigns.some((expectedSign) => expectedSign.toLowerCase() === receivedSign.toLowerCase())) {
    appendWebhookLog(dataDir, {
      ok: false,
      reason: "bad_signature",
      txnId,
      expectedTxnIds: signTxnIds,
      expectedAmounts: signAmounts,
      payload
    });
    const error = new Error("Неверная подпись QR webhook.");
    error.statusCode = 403;
    throw error;
  }
  const now = new Date().toISOString();
  orders[index] = {
    ...order,
    status: status || order.status,
    webhookPayload: payload,
    updatedAt: now
  };
  writeQrOrders(dataDir, orders);
  appendWebhookLog(dataDir, { ok: true, txnId, status, orderId: order.externalId });
  return orders[index];
}

module.exports = {
  createKompanionQrOrder,
  getQrOrderStatus,
  handleKompanionWebhook,
  signKompanionQr: sign
};
