import fs from "node:fs";
import path from "node:path";
import type {
  AdminAccount,
  AdminCustomer,
  DebtTransaction,
  AdminProduct,
  AdminRegister,
  AdminSale,
  AdminShiftReport,
  AdminSnapshot,
  CashImportSnapshot
} from "../shared/adminTypes";
import type { CreateQrPaymentInput, QrPaymentOrder } from "../shared/types";

type RegisterSyncPayload = {
  sale?: AdminSale;
  shiftReport?: AdminShiftReport;
  debtTransaction?: DebtTransaction;
  customer?: AdminCustomer;
  product?: AdminProduct & { storeId?: string; registerId?: string; createdFromCash?: boolean; createdAt?: string };
};

function assertRegisterDevice(register: AdminRegister, deviceId?: string) {
  if (register.deviceId && deviceId && register.deviceId !== deviceId) {
    throw new Error("Эта касса уже привязана к другому устройству. Сгенерируйте новый ключ в карточке кассы, если нужно заменить моноблок.");
  }
}

function lockRegisterDevice(register: AdminRegister, deviceId?: string, deviceName?: string) {
  if (!deviceId || register.deviceId) {
    return;
  }
  register.deviceId = deviceId;
  register.deviceLockedAt = new Date().toISOString();
  if (deviceName) {
    register.deviceName = deviceName;
  }
}

const projectRoot = process.cwd();
const dataFile = () =>
  process.env.KASSA_PRO_BRIDGE_FILE || path.join(projectRoot, "data", "admin-snapshot.json");
const seedFile = () => path.join(projectRoot, "src", "shared", "adminSeedData.json");
const UNCATEGORIZED_CATEGORY_ID = "uncategorized";
const UNCATEGORIZED_CATEGORY_NAME_SAFE = "Без категории";
const UNCATEGORIZED_CATEGORY_NAME = "Без категории";

function serverUrl() {
  const value = process.env.KASSA_PRO_SERVER_URL?.trim();
  return value ? value.replace(/\/+$/, "") : "";
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Ошибка сервера ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

async function postServer<T>(apiPath: string, payload: unknown): Promise<T> {
  const baseUrl = serverUrl();
  if (!baseUrl) {
    throw new Error("Сервер синхронизации не настроен.");
  }
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return readJsonResponse<T>(response);
}

function saleTimestampKey(value?: string) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? String(time) : String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function roundSaleMoney(value?: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function sameSale(left?: AdminSale, right?: AdminSale) {
  if (!left || !right) return false;
  return (
    String(left.number || "") === String(right.number || "") &&
    String(left.registerId || "") === String(right.registerId || "") &&
    String(left.storeId || "") === String(right.storeId || "") &&
    String(left.shiftId || "") === String(right.shiftId || "") &&
    String(left.type || "sale") === String(right.type || "sale") &&
    String(left.paymentMethod || "") === String(right.paymentMethod || "") &&
    saleTimestampKey(left.createdAt) === saleTimestampKey(right.createdAt) &&
    roundSaleMoney(left.total) === roundSaleMoney(right.total)
  );
}

function collisionSaleId(account: AdminAccount, sale: AdminSale) {
  const baseId = String(sale.id || `sale-${sale.registerId || "register"}-${sale.number || "receipt"}`);
  const numberPart = String(sale.number || "receipt").replace(/[^a-zA-Z0-9_-]/g, "-");
  const timePart = saleTimestampKey(sale.createdAt);
  const collisionBase = `${baseId}-at-${numberPart}-${timePart}`;
  let candidate = collisionBase;
  let index = 2;
  while ((account.sales ?? []).some((item) => item.id === candidate && !sameSale(item, sale))) {
    candidate = `${collisionBase}-${index}`;
    index += 1;
  }
  return candidate;
}

async function getServer<T>(apiPath: string): Promise<T> {
  const baseUrl = serverUrl();
  if (!baseUrl) {
    throw new Error("Сервер синхронизации не настроен.");
  }
  const response = await fetch(`${baseUrl}${apiPath}`);
  return readJsonResponse<T>(response);
}

export function readAdminSnapshot(): AdminSnapshot {
  return normalizeSnapshot(readRawAdminSnapshot());
}

function readRawAdminSnapshot(): AdminSnapshot {
  const filePath = dataFile();
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as AdminSnapshot;
  }
  return JSON.parse(fs.readFileSync(seedFile(), "utf8")) as AdminSnapshot;
}

export function writeAdminSnapshot(snapshot: AdminSnapshot) {
  const filePath = dataFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalizeSnapshot(snapshot), null, 2), "utf8");
}

export async function activateByKey(key: string, deviceId?: string, deviceName?: string): Promise<CashImportSnapshot> {
  if (serverUrl()) {
    return postServer<CashImportSnapshot>("/api/activate", { key: key.trim(), deviceId, deviceName });
  }

  const snapshot = readAdminSnapshot();
  const found = findRegisterByKey(snapshot, key.trim());
  if (!found) {
    throw new Error("Ключ не найден. Проверьте ключ из карточки кассы в админке.");
  }
  const { account, register } = found;
  assertAccountAvailable(account);
  assertRegisterDevice(register, deviceId);
  if (register.activationKey.status !== "active" && register.deviceId !== deviceId) {
    throw new Error("Ключ уже использован. Перевыпустите ключ в карточке этой кассы.");
  }

  const timestamp = new Date().toISOString();
  lockRegisterDevice(register, deviceId, deviceName);
  if (register.activationKey.status === "active") {
    register.activationKey.status = "used";
    register.activationKey.usedAt = timestamp;
    register.activationKey.usedByRegisterId = register.id;
    register.activationKey.usedByDeviceId = deviceId;
  }
  register.status = "online";
  register.lastSyncAt = timestamp;
  register.activatedAt = register.activatedAt || timestamp;
  account.updatedAt = timestamp;
  snapshot.updatedAt = timestamp;
  writeAdminSnapshot(snapshot);
  return makeCashSnapshot(account.id, register.id, key.trim(), snapshot);
}

export async function getAccountSnapshot(accountId: string, activationKey: string, registerId = "", deviceId = "") {
  if (serverUrl()) {
    const params = new URLSearchParams();
    if (activationKey) {
      params.set("activationKey", activationKey);
    }
    if (registerId) {
      params.set("registerId", registerId);
    }
    if (deviceId) {
      params.set("deviceId", deviceId);
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    return getServer<CashImportSnapshot>(`/api/account-snapshot/${encodeURIComponent(accountId)}${query}`);
  }

  const snapshot = readAdminSnapshot();
  const account = snapshot.accounts.find((item) => item.id === accountId);
  const register =
    account?.registers.find((item) => item.activationKey.key === activationKey) ?? account?.registers[0];
  if (account) {
    assertAccountAvailable(account);
  }
  if (register) {
    assertRegisterDevice(register, deviceId);
    lockRegisterDevice(register, deviceId);
    writeAdminSnapshot(snapshot);
  }
  return makeCashSnapshot(accountId, register?.id ?? "", activationKey, snapshot);
}

export async function sendRegisterSyncPayload(accountId: string, payload: RegisterSyncPayload, deviceId?: string) {
  if (serverUrl()) {
    await postServer("/api/register-sync", { accountId, deviceId, ...payload });
    return;
  }

  const snapshot = readAdminSnapshot();
  const account = snapshot.accounts.find((item) => item.id === accountId);
  if (!account) {
    throw new Error("РђРєРєР°СѓРЅС‚ РЅРµ РЅР°Р№РґРµРЅ.");
  }
  applyRegisterSyncPayload(account, payload, deviceId);
  const timestamp = new Date().toISOString();
  account.updatedAt = timestamp;
  snapshot.updatedAt = timestamp;
  writeAdminSnapshot(snapshot);
}

export async function createQrPayment(
  binding: { accountId: string; storeId: string; registerId: string; deviceId: string; storeName: string },
  input: CreateQrPaymentInput
): Promise<QrPaymentOrder> {
  const response = await postServer<{ order: QrPaymentOrder }>("/api/kompanion/qr/create", {
    accountId: binding.accountId,
    storeId: binding.storeId,
    registerId: binding.registerId,
    deviceId: binding.deviceId,
    storeName: binding.storeName,
    amount: input.amount,
    receiptNumber: input.receiptNumber,
    description: input.description
  });
  return response.order;
}

export async function getQrPaymentStatus(txnId: string): Promise<QrPaymentOrder> {
  const response = await getServer<{ order: QrPaymentOrder }>(
    `/api/kompanion/qr/status/${encodeURIComponent(txnId)}`
  );
  return response.order;
}

function applyRegisterSyncPayload(account: AdminAccount, payload: RegisterSyncPayload, deviceId?: string) {
  if (payload.customer) {
    const exists = account.customers.some((item) => item.id === payload.customer?.id);
    account.customers = exists
      ? account.customers.map((item) => (item.id === payload.customer?.id ? { ...item, ...payload.customer } : item))
      : [payload.customer, ...account.customers];
  }

  if (payload.product) {
    appendProductToAccount(account, payload.product);
  }

  if (payload.sale && !account.sales.some((item) => item.id === payload.sale?.id)) {
    account.sales.unshift(payload.sale);
    const stockSign = payload.sale.type === "return" ? 1 : -1;
    for (const saleItem of payload.sale.items) {
      const product = account.products.find((item) => item.id === saleItem.productId);
      if (product) {
        product.stockByStore[payload.sale.storeId] = (product.stockByStore[payload.sale.storeId] ?? 0) + stockSign * saleItem.qty;
      }
    }
  }

  if (payload.debtTransaction && !account.debtTransactions.some((item) => item.id === payload.debtTransaction?.id)) {
    account.debtTransactions.unshift(payload.debtTransaction);
    const customer = ensureCustomerForDebt(account, payload.debtTransaction);
    const sign = payload.debtTransaction.type === "sale" ? 1 : -1;
    customer.debtBalance = roundMoney((customer.debtBalance ?? 0) + sign * payload.debtTransaction.amount);
    customer.updatedAt = payload.debtTransaction.createdAt;
  }

  if (payload.shiftReport) {
    account.shiftReports = [
      payload.shiftReport,
      ...account.shiftReports.filter((item) => item.id !== payload.shiftReport?.id)
    ];
  }

  const registerId =
    payload.sale?.registerId ??
    payload.debtTransaction?.registerId ??
    payload.shiftReport?.registerId ??
    payload.product?.registerId;
  if (registerId) {
    const register = account.registers.find((item) => item.id === registerId);
    if (register) {
      assertRegisterDevice(register, deviceId);
      lockRegisterDevice(register, deviceId);
      register.lastSyncAt = new Date().toISOString();
      register.status = "online";
    }
  }
}

function appendProductToAccount(
  account: AdminAccount,
  product: AdminProduct & { storeId?: string; registerId?: string }
) {
  const store = account.stores.find((item) => item.id === product.storeId) ?? account.stores[0];
  const salePrice = Number(product.salePrice ?? 0);
  const purchasePrice = Number(product.purchasePrice ?? 0);
  const priceGroupId = store?.priceGroupId ?? "";
  const normalized: AdminProduct = {
    ...product,
    extraBarcodes: product.extraBarcodes ?? [],
    nomenclatureGroupId: product.nomenclatureGroupId || store?.nomenclatureGroupId,
    stockByStore: {
      ...(product.stockByStore ?? {}),
      ...(store ? { [store.id]: product.stockByStore?.[store.id] ?? 0 } : {})
    },
    salePriceByPriceGroup: {
      ...(product.salePriceByPriceGroup ?? {}),
      ...(priceGroupId ? { [priceGroupId]: salePrice } : {})
    },
    purchasePriceByPriceGroup: {
      ...(product.purchasePriceByPriceGroup ?? {}),
      ...(priceGroupId ? { [priceGroupId]: purchasePrice } : {})
    },
    salePriceByStore: {
      ...(product.salePriceByStore ?? {}),
      ...(store ? { [store.id]: salePrice } : {})
    },
    purchasePriceByStore: {
      ...(product.purchasePriceByStore ?? {}),
      ...(store ? { [store.id]: purchasePrice } : {})
    }
  };
  account.products = account.products.some((item) => item.id === normalized.id)
    ? account.products.map((item) => (item.id === normalized.id ? { ...item, ...normalized } : item))
    : [normalized, ...account.products];
}

export function appendSaleToAccount(accountId: string, sale: AdminSale) {
  try {
    if (serverUrl()) {
      void postServer("/api/register-sync", { accountId, sale }).catch(() => undefined);
      return;
    }

    const snapshot = readAdminSnapshot();
    const account = snapshot.accounts.find((item) => item.id === accountId);
    if (!account) {
      return;
    }
    const existingSame = account.sales.some((item) => sameSale(item, sale));
    if (existingSame) {
      return;
    }
    const idCollision = account.sales.some((item) => item.id === sale.id);
    const saleToStore = idCollision
      ? ({ ...sale, id: collisionSaleId(account, sale), originalSyncId: sale.id } as AdminSale)
      : sale;
    account.sales.unshift(saleToStore);
    const stockSign = saleToStore.type === "return" ? 1 : -1;
    for (const saleItem of saleToStore.items) {
      const product = account.products.find((item) => item.id === saleItem.productId);
      if (product) {
        product.stockByStore[saleToStore.storeId] = (product.stockByStore[saleToStore.storeId] ?? 0) + stockSign * saleItem.qty;
      }
    }
    const timestamp = new Date().toISOString();
    const register = account.registers.find((item) => item.id === saleToStore.registerId);
    if (register) {
      register.lastSyncAt = timestamp;
      register.status = "online";
    }
    account.updatedAt = timestamp;
    snapshot.updatedAt = timestamp;
    writeAdminSnapshot(snapshot);
  } catch {
    // Offline cash work must never fail because bridge sync is unavailable.
  }
}

export function appendShiftReportToAccount(accountId: string, report: AdminShiftReport) {
  try {
    if (serverUrl()) {
      void postServer("/api/register-sync", { accountId, shiftReport: report }).catch(() => undefined);
      return;
    }

    const snapshot = readAdminSnapshot();
    const account = snapshot.accounts.find((item) => item.id === accountId);
    if (!account) {
      return;
    }
    account.shiftReports = [report, ...account.shiftReports.filter((item) => item.id !== report.id)];
    const timestamp = new Date().toISOString();
    const register = account.registers.find((item) => item.id === report.registerId);
    if (register) {
      register.lastSyncAt = timestamp;
      register.status = "online";
    }
    account.updatedAt = timestamp;
    snapshot.updatedAt = timestamp;
    writeAdminSnapshot(snapshot);
  } catch {
    // Shift reporting must not block local shift closing.
  }
}

export function appendCustomerToAccount(accountId: string, customer: AdminCustomer) {
  try {
    if (serverUrl()) {
      void postServer("/api/register-sync", { accountId, customer }).catch(() => undefined);
      return;
    }

    const snapshot = readAdminSnapshot();
    const account = snapshot.accounts.find((item) => item.id === accountId);
    if (!account) {
      return;
    }
    const exists = account.customers.some((item) => item.id === customer.id);
    account.customers = exists
      ? account.customers.map((item) => (item.id === customer.id ? { ...item, ...customer } : item))
      : [customer, ...account.customers];
    const timestamp = new Date().toISOString();
    account.updatedAt = timestamp;
    snapshot.updatedAt = timestamp;
    writeAdminSnapshot(snapshot);
  } catch {
    // Customer sync must not block the local cash register.
  }
}

function ensureCustomerForDebt(account: AdminAccount, transaction: DebtTransaction) {
  let customer = account.customers.find((item) => item.id === transaction.customerId);
  if (!customer) {
    customer = {
      id: transaction.customerId,
      name: transaction.customerName,
      phone: "",
      comment: "Создано с кассы",
      debtBalance: 0,
      createdAt: transaction.createdAt,
      updatedAt: transaction.createdAt
    };
    account.customers.unshift(customer);
  }
  return customer;
}

function makeCashSnapshot(
  accountId: string,
  registerId: string,
  activationKey: string,
  snapshot: AdminSnapshot
): CashImportSnapshot {
  const account = snapshot.accounts.find((item) => item.id === accountId);
  if (!account) {
    throw new Error("Аккаунт не найден в локальном bridge.");
  }
  assertAccountAvailable(account);
  const register =
    account.registers.find((item) => item.id === registerId) ??
    account.registers.find((item) => item.activationKey.key === activationKey) ??
    account.registers[0];
  const store = account.stores.find((item) => item.id === register?.storeId) ?? account.stores[0];
  if (!store || !register) {
    throw new Error("В аккаунте нет магазина или кассы.");
  }
  return {
    account: {
      id: account.id,
      name: account.name,
      settings: account.settings
    },
    store,
    register,
    categories: sortCategories(account.categories).filter((category) => !isUncategorizedCategory(category) && category.nomenclatureGroupId === store.nomenclatureGroupId),
    products: account.products
      .filter((product) => productAvailableInStore(product, store))
      .map((product) => productForStore(product, store)),
    employees: account.employees.filter((employee) => !employee.allowedStoreIds?.length || employee.allowedStoreIds.includes(store.id)),
    customers: account.customers,
    activationKey,
    syncedAt: new Date().toISOString()
  };
}

function isUncategorizedCategory(category: AdminAccount["categories"][number]) {
  return (
    category.id === UNCATEGORIZED_CATEGORY_ID ||
    category.name.trim().toLowerCase() === UNCATEGORIZED_CATEGORY_NAME_SAFE.toLowerCase()
  );
}

function sortCategories<T extends { name: string; sortOrder?: number }>(categories: T[]) {
  return [...categories].sort((left, right) => {
    const leftOrder = Number.isFinite(left.sortOrder) ? Number(left.sortOrder) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.sortOrder) ? Number(right.sortOrder) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.name.localeCompare(right.name, "ru");
  });
}

function productAvailableInStore(product: AdminAccount["products"][number], store: AdminAccount["stores"][number] | string) {
  if (product.isDeleted) return false;
  return typeof store !== "string" && product.nomenclatureGroupId === store.nomenclatureGroupId;
}

function salePriceForStore(product: AdminAccount["products"][number], store: AdminAccount["stores"][number] | string) {
  const storeId = typeof store === "string" ? store : store.id;
  const priceGroupId = typeof store === "string" ? "" : store.priceGroupId;
  return Number((priceGroupId ? product.salePriceByPriceGroup?.[priceGroupId] : undefined) ?? product.salePriceByStore?.[storeId] ?? product.salePrice ?? 0);
}

function purchasePriceForStore(product: AdminAccount["products"][number], store: AdminAccount["stores"][number] | string) {
  const storeId = typeof store === "string" ? store : store.id;
  const priceGroupId = typeof store === "string" ? "" : store.priceGroupId;
  return Number((priceGroupId ? product.purchasePriceByPriceGroup?.[priceGroupId] : undefined) ?? product.purchasePriceByStore?.[storeId] ?? product.purchasePrice ?? 0);
}

function productForStore(product: AdminAccount["products"][number], store: AdminAccount["stores"][number] | string): AdminAccount["products"][number] {
  const storeId = typeof store === "string" ? store : store.id;
  return {
    ...product,
    salePrice: salePriceForStore(product, store),
    purchasePrice: purchasePriceForStore(product, store),
    stockByStore: { ...product.stockByStore, [storeId]: product.stockByStore?.[storeId] ?? 0 }
  };
}

function makeNomenclatureGroupId(accountId: string, suffix: string) {
  return `nom-${accountId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function makePriceGroupId(accountId: string, suffix: string) {
  return `price-${accountId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function normalizePriceGroupValues(
  byPriceGroup: Record<string, number> | undefined,
  byStore: Record<string, number> | undefined,
  fallback: number,
  stores: AdminAccount["stores"]
) {
  const next = { ...(byPriceGroup ?? {}) };
  for (const store of stores) {
    if (!store.priceGroupId || next[store.priceGroupId] !== undefined) continue;
    next[store.priceGroupId] = Number(byStore?.[store.id] ?? fallback ?? 0);
  }
  return next;
}

function inferProductNomenclatureGroup(product: AdminAccount["products"][number], stores: AdminAccount["stores"], defaultGroupId: string) {
  if (product.availableStoreIds?.length === 1) {
    const store = stores.find((item) => item.id === product.availableStoreIds?.[0]);
    if (store?.nomenclatureMode === "separate" && store.nomenclatureGroupId) {
      return store.nomenclatureGroupId;
    }
  }
  return defaultGroupId;
}

function assertAccountAvailable(account: AdminAccount) {
  if (account.status === "blocked") {
    throw new Error("Аккаунт заблокирован в контрольной панели. Обратитесь к владельцу системы.");
  }
  if (account.subscription?.status === "suspended" || account.subscription?.status === "expired") {
    throw new Error("Подписка аккаунта не активна. Продлите подписку в контрольной панели.");
  }
}

function findRegisterByKey(snapshot: AdminSnapshot, key: string) {
  for (const account of snapshot.accounts) {
    for (const register of account.registers) {
      if (register.activationKey.key === key) {
        return { account, register };
      }
    }
  }
  return null;
}

function normalizeSnapshot(snapshot: AdminSnapshot): AdminSnapshot {
  return {
    ...snapshot,
    version: Math.max(2, Number(snapshot.version || 1)),
    accounts: snapshot.accounts.map(normalizeAccount)
  };
}

function normalizeAccount(account: AdminAccount): AdminAccount {
  const legacyKey = account.activationKey;
  const stores = (account.stores ?? []).map((store) => ({
    ...store,
    nomenclatureMode: store.nomenclatureMode || "shared_same_price" as const
  }));
  const defaultNomenclatureGroupId = account.nomenclatureGroups?.[0]?.id || makeNomenclatureGroupId(account.id, "main");
  const defaultPriceGroupId = account.priceGroups?.[0]?.id || makePriceGroupId(account.id, "main");
  for (const store of stores) {
    const legacyMode = store.nomenclatureMode || "shared_same_price";
    store.nomenclatureGroupId = store.nomenclatureGroupId || (legacyMode === "separate" ? makeNomenclatureGroupId(account.id, store.id) : defaultNomenclatureGroupId);
    store.priceGroupId = store.priceGroupId || (legacyMode === "shared_same_price" ? defaultPriceGroupId : makePriceGroupId(account.id, store.id));
  }
  const storeIds = new Set(stores.map((store) => store.id));
  const now = new Date().toISOString();
  const nomenclatureGroupIds = new Set(stores.map((store) => store.nomenclatureGroupId));
  const existingNomIds = new Set((account.nomenclatureGroups ?? []).map((group) => group.id));
  const existingPriceIds = new Set((account.priceGroups ?? []).map((group) => group.id));
  const nomenclatureGroups = [
    ...(account.nomenclatureGroups ?? []),
    ...stores
      .filter((store) => !existingNomIds.has(store.nomenclatureGroupId || ""))
      .map((store) => ({ id: store.nomenclatureGroupId || defaultNomenclatureGroupId, name: store.nomenclatureMode === "separate" ? `Номенклатура ${store.name}` : "Основная номенклатура", createdAt: now }))
  ];
  const priceGroups = [
    ...(account.priceGroups ?? []),
    ...stores
      .filter((store) => !existingPriceIds.has(store.priceGroupId || ""))
      .map((store) => ({ id: store.priceGroupId || defaultPriceGroupId, nomenclatureGroupId: store.nomenclatureGroupId || defaultNomenclatureGroupId, name: store.nomenclatureMode === "shared_same_price" ? "Основные цены" : `Цены ${store.name}`, createdAt: now }))
  ];
  const registers = (account.registers ?? []).map((register, index) => ({
    ...register,
    platform: register.platform || "Windows / Electron",
    deviceName: register.deviceName || register.device || "POS-терминал",
    activationKey:
      register.activationKey ||
      (index === 0 && legacyKey
        ? legacyKey
        : {
            key: `${account.id === "acc-textile" ? "TEXT" : "UROJ"}-${new Date().getFullYear()}-${String(index + 1).padStart(4, "0")}`,
            status: "active" as const,
            generatedAt: new Date().toISOString()
          }),
    receiptSettings: register.receiptSettings || {
      template: account.settings.receiptTemplate,
      showQr: false,
      header: stores.find((store) => store.id === register.storeId)?.name || account.name,
      footer: "Спасибо за покупку"
    }
  })) as AdminRegister[];

  return {
    ...account,
    status: account.status ?? "active",
    createdAt: account.createdAt ?? account.updatedAt ?? new Date().toISOString(),
    ownerPhone: account.ownerPhone ?? "",
    ownerEmail: String(account.ownerEmail ?? "").trim().toLowerCase(),
    adminLogin: account.adminLogin ?? (account.id === "acc-urozhai" ? "urozhai" : account.id === "acc-textile" ? "textile" : account.id),
    adminPassword: account.adminPassword ?? "1234",
    subscription: account.subscription ?? {
      plan: account.id === "acc-textile" ? "Базовый" : "Профессиональный",
      status: "active" as const,
      startsAt: account.updatedAt ?? new Date().toISOString(),
      expiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
      maxStores: account.id === "acc-textile" ? 1 : 5,
      maxRegisters: account.id === "acc-textile" ? 2 : 10,
      monthlyPrice: account.id === "acc-textile" ? 1200 : 2500,
      note: ""
    },
    stores,
    registers,
    nomenclatureGroups,
    priceGroups,
    categories: (account.categories ?? []).map((category) => ({ ...category, nomenclatureGroupId: category.nomenclatureGroupId || defaultNomenclatureGroupId })),
    products: (account.products ?? []).map((product) => ({
      ...product,
      unit: ["шт", "кг", "литр", "метр"].includes(product.unit) ? product.unit : "шт",
      extraBarcodes: Array.isArray(product.extraBarcodes) ? product.extraBarcodes.filter(Boolean) : [],
      purchasePriceByStore: product.purchasePriceByStore ?? {},
      salePriceByStore: product.salePriceByStore ?? {},
      purchasePriceByPriceGroup: normalizePriceGroupValues(product.purchasePriceByPriceGroup, product.purchasePriceByStore, product.purchasePrice, stores),
      salePriceByPriceGroup: normalizePriceGroupValues(product.salePriceByPriceGroup, product.salePriceByStore, product.salePrice, stores),
      nomenclatureGroupId: product.nomenclatureGroupId && nomenclatureGroupIds.has(product.nomenclatureGroupId)
        ? product.nomenclatureGroupId
        : inferProductNomenclatureGroup(product, stores, defaultNomenclatureGroupId),
      availableStoreIds: product.availableStoreIds?.length ? product.availableStoreIds.filter((storeId) => storeIds.has(storeId)) : undefined,
      stockByStore: product.stockByStore ?? {},
      isDeleted: Boolean(product.isDeleted)
    })),
    employees: (account.employees ?? []).map((employee, index) => ({
      ...employee,
      firstName: employee.firstName || employee.name.split(" ")[0] || employee.name,
      lastName: employee.lastName || employee.name.split(" ").slice(1).join(" "),
      email: employee.email || `employee${index + 1}@kassa-pro.local`,
      allowedStoreIds: employee.allowedStoreIds?.length
        ? employee.allowedStoreIds
        : [employee.storeId || stores[0]?.id || "store-main"],
      canLoginCash: employee.canLoginCash ?? employee.role === "cashier",
      pin: employee.pin || String(1000 + index).padStart(4, "0")
    })),
    customers: account.customers ?? [],
    stockOperations: account.stockOperations ?? [],
    stockDocuments: account.stockDocuments ?? [],
    debtTransactions: account.debtTransactions ?? [],
    shiftReports: (account.shiftReports ?? []).map((shift) => ({
      ...shift,
      debtIssued: shift.debtIssued ?? 0,
      debtPaidCash: shift.debtPaidCash ?? 0,
      debtPaidCard: shift.debtPaidCard ?? 0,
      debtPaidQr: shift.debtPaidQr ?? 0,
      totalReceived:
        shift.totalReceived ??
        (shift.cash ?? 0) + (shift.card ?? 0) + (shift.qr ?? 0) + (shift.debtPaidCash ?? 0) + (shift.debtPaidCard ?? 0) + (shift.debtPaidQr ?? 0)
    })),
    sales: (account.sales ?? []).map((sale) => ({
      ...sale,
      type: sale.type ?? "sale",
      shiftId: sale.shiftId || "unknown-shift",
      discount: sale.discount ?? 0,
      debtAmount: sale.debtAmount ?? (sale.paymentMethod === "debt" ? sale.total : 0),
      costTotal:
        sale.costTotal ??
        sale.items.reduce((sum, item) => sum + (item.costTotal ?? (item.purchasePrice ?? 0) * item.qty), 0),
      items: sale.items.map((item) => ({
        ...item,
        purchasePrice: item.purchasePrice ?? 0,
        discountAmount: item.discountAmount ?? 0,
        costTotal: item.costTotal ?? (item.purchasePrice ?? 0) * item.qty
      }))
    }))
  };
}

export function appendDebtTransactionToAccount(accountId: string, transaction: DebtTransaction) {
  try {
    if (serverUrl()) {
      void postServer("/api/register-sync", { accountId, debtTransaction: transaction }).catch(() => undefined);
      return;
    }

    const snapshot = readAdminSnapshot();
    const account = snapshot.accounts.find((item) => item.id === accountId);
    if (!account || account.debtTransactions.some((item) => item.id === transaction.id)) {
      return;
    }
    account.debtTransactions.unshift(transaction);
    const customer = ensureCustomerForDebt(account, transaction);
    const sign = transaction.type === "sale" ? 1 : -1;
    customer.debtBalance = roundMoney((customer.debtBalance ?? 0) + sign * transaction.amount);
    customer.updatedAt = transaction.createdAt;
    const timestamp = new Date().toISOString();
    const register = account.registers.find((item) => item.id === transaction.registerId);
    if (register) {
      register.lastSyncAt = timestamp;
      register.status = "online";
    }
    account.updatedAt = timestamp;
    snapshot.updatedAt = timestamp;
    writeAdminSnapshot(snapshot);
  } catch {
    // Debt sync must not block the local cash register.
  }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
