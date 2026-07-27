import seedSnapshot from "../shared/adminSeedData.json";
import type {
  AdminAccount,
  AdminCategory,
  AdminPermission,
  AdminProduct,
  AdminRole,
  AdminSession,
  NomenclatureGroup,
  AdminRegister,
  AdminSnapshot,
  AdminStore,
  NomenclatureMode,
  PriceGroup,
  StockDocument,
  StockDocumentItem,
  StockDocumentType,
  StockOperation,
  StockOperationType
} from "../shared/adminTypes";

const STORAGE_KEY = "kassa-pro-admin-v1";
const IDB_NAME = "kassa-pro-admin";
const IDB_STORE = "snapshots";
const ALLOWED_PRODUCT_UNITS = ["шт", "кг", "литр", "метр"];
const DEFAULT_NOMENCLATURE_MODE: NomenclatureMode = "shared_same_price";
const UNCATEGORIZED_CATEGORY_ID = "uncategorized";
const UNCATEGORIZED_CATEGORY_NAME = "Без категории";
const bridgeUrls = (apiPath = "/api/snapshot") => {
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const urls = [path];
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      urls.push(`http://127.0.0.1:5174${path}`);
    } else if (hostname) {
      urls.push(`${protocol}//${hostname}:5174${path}`);
    }
  }
  return urls;
};

type AdminLoginResult =
  | { ok: true; accountId: string; session: AdminSession; snapshot: AdminSnapshot }
  | { ok: false; reason: string };

const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [
  "products",
  "stock",
  "sales",
  "employees",
  "stores",
  "reports",
  "settings",
  "viewPurchasePrice",
  "editProducts",
  "deleteProducts",
  "stockReceipt",
  "stockWriteoff",
  "stockInventory",
  "viewReports",
  "manageRegisters",
  "manageEmployees",
  "manageSettings"
];

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  owner: ALL_ADMIN_PERMISSIONS,
  admin: ALL_ADMIN_PERMISSIONS,
  manager: ["products", "stock", "sales", "reports", "viewPurchasePrice", "editProducts", "stockReceipt", "stockWriteoff", "stockInventory", "viewReports"],
  cashier: ["products", "stock", "editProducts", "stockReceipt", "stockWriteoff", "stockInventory"]
};

export function loadLocalSnapshot(): AdminSnapshot {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return normalizeSnapshot(structuredClone(seedSnapshot as unknown as AdminSnapshot));
  }
  try {
    return normalizeSnapshot(JSON.parse(raw) as AdminSnapshot);
  } catch {
    return normalizeSnapshot(structuredClone(seedSnapshot as unknown as AdminSnapshot));
  }
}

export async function loadSnapshot() {
  for (const url of bridgeUrls()) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const snapshot = normalizeSnapshot((await response.json()) as AdminSnapshot);
        await saveBrowserSnapshot(snapshot);
        return snapshot;
      }
    } catch {
      // Try the next local bridge option.
    }
  }
  const indexed = await loadIndexedSnapshot();
  return indexed ? normalizeSnapshot(indexed) : loadLocalSnapshot();
}

export async function adminLogin(login: string, password: string): Promise<AdminLoginResult> {
  const normalizedLogin = login.trim().toLowerCase();
  const normalizedPhone = normalizeKyrgyzPhone(login);
  const normalizedPassword = password.trim();

  for (const url of bridgeUrls("/api/admin-login")) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: normalizedLogin, password: normalizedPassword }),
        cache: "no-store"
      });
      if (response.ok) {
        const payload = (await response.json()) as { accountId: string; session?: AdminSession; snapshot: AdminSnapshot };
        const snapshot = normalizeSnapshot(payload.snapshot);
        await saveBrowserSnapshot(snapshot);
        const session = payload.session ?? findAdminSession(snapshot, normalizedLogin, normalizedPhone, normalizedPassword)?.session;
        if (!session) {
          return { ok: false, reason: "Не удалось определить права пользователя." };
        }
        return { ok: true, accountId: payload.accountId, session, snapshot };
      }
      if (response.status === 401 || response.status === 403) {
        const payload = await response.json().catch(() => ({}));
        return { ok: false, reason: String(payload.error || "Неверный логин или пароль") };
      }
    } catch {
      // Try the next bridge URL, then fall back to browser data.
    }
  }

  const snapshot = await loadSnapshot();
  const found = findAdminSession(snapshot, normalizedLogin, normalizedPhone, normalizedPassword);
  if (!found) {
    return { ok: false, reason: "Неверный логин или пароль. Если входите с телефона, перезапустите ADMIN-KASSA-PRO.bat и обновите страницу." };
  }
  return { ok: true, accountId: found.account.id, session: found.session, snapshot };
}

export async function saveSnapshot(snapshot: AdminSnapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const next: AdminSnapshot = {
    ...normalized,
    updatedAt: new Date().toISOString(),
    accounts: normalized.accounts.map((account) => ({
      ...account,
      updatedAt: new Date().toISOString()
    }))
  };
  await saveBrowserSnapshot(next);
  const urls = bridgeUrls();
  let lastSaveError = "";
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (payload?.snapshot) {
          const saved = normalizeSnapshot(payload.snapshot as AdminSnapshot);
          await saveBrowserSnapshot(saved);
          return saved;
        }
        break;
      }
      const details = await response.text().catch(() => "");
      lastSaveError = `Сервер не сохранил изменения (${response.status}). ${details.slice(0, 180)}`.trim();
    } catch {
      lastSaveError = "Не удалось соединиться с сервером сохранения.";
    }
  }
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isRemoteHost = host && host !== "localhost" && host !== "127.0.0.1";
  if (isRemoteHost && lastSaveError) {
    throw new Error(`${lastSaveError} Изменения не подтверждены сервером.`);
  }
  return next;
}

export function validateUniqueAccountContacts(snapshot: AdminSnapshot) {
  const phones = new Map<string, string>();
  const emails = new Map<string, string>();
  for (const account of snapshot.accounts) {
    const phone = normalizeKyrgyzPhone(account.ownerPhone);
    if (phone) {
      const existingName = phones.get(phone);
      if (existingName) {
        return { field: "phone" as const, value: phone, message: `Аккаунт с таким телефоном уже существует: ${existingName}` };
      }
      phones.set(phone, account.name);
    }
    const email = normalizeEmail(account.ownerEmail);
    if (email) {
      const existingName = emails.get(email);
      if (existingName) {
        return { field: "email" as const, value: email, message: `Аккаунт с таким email уже существует: ${existingName}` };
      }
      emails.set(email, account.name);
    }
  }
  return null;
}

export function findAccountContactConflict(snapshot: AdminSnapshot, accountId: string, phone?: string, email?: string) {
  const normalizedPhone = normalizeKyrgyzPhone(phone);
  const normalizedEmail = normalizeEmail(email);
  for (const account of snapshot.accounts) {
    if (account.id === accountId) continue;
    if (normalizedPhone && normalizeKyrgyzPhone(account.ownerPhone) === normalizedPhone) {
      return { field: "phone" as const, message: `Аккаунт с таким телефоном уже существует: ${account.name}` };
    }
    if (normalizedEmail && normalizeEmail(account.ownerEmail) === normalizedEmail) {
      return { field: "email" as const, message: `Аккаунт с таким email уже существует: ${account.name}` };
    }
  }
  return null;
}

export function saveLocalSnapshot(snapshot: AdminSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Mobile browsers can reject large snapshots with product photos.
    // IndexedDB or the live server snapshot will still be used.
  }
}

async function saveBrowserSnapshot(snapshot: AdminSnapshot) {
  saveLocalSnapshot(snapshot);
  await saveIndexedSnapshot(snapshot).catch(() => undefined);
}

function openIndexedDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadIndexedSnapshot() {
  const db = await openIndexedDb();
  return new Promise<AdminSnapshot | null>((resolve) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const request = tx.objectStore(IDB_STORE).get(STORAGE_KEY);
    request.onsuccess = () => resolve((request.result as AdminSnapshot | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

async function saveIndexedSnapshot(snapshot: AdminSnapshot) {
  const db = await openIndexedDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(snapshot, STORAGE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function updateAccount(
  snapshot: AdminSnapshot,
  accountId: string,
  updater: (account: AdminAccount) => AdminAccount
): AdminSnapshot {
  return {
    ...snapshot,
    updatedAt: new Date().toISOString(),
    accounts: snapshot.accounts.map((account) =>
      account.id === accountId ? { ...updater(account), updatedAt: new Date().toISOString() } : account
    )
  };
}

export function normalizeSnapshot(snapshot: AdminSnapshot): AdminSnapshot {
  return {
    ...snapshot,
    version: Math.max(2, Number(snapshot.version || 1)),
    accounts: snapshot.accounts.map(normalizeAccount)
  };
}

function normalizeAccount(account: AdminAccount): AdminAccount {
  const legacyKey = (account as AdminAccount & { activationKey?: AdminAccount["activationKey"] }).activationKey;
  const now = new Date().toISOString();
  const legacyAccount = account as AdminAccount & {
    nomenclatureGroups?: NomenclatureGroup[];
    priceGroups?: PriceGroup[];
  };
  const defaultNomenclatureGroupId = legacyAccount.nomenclatureGroups?.[0]?.id || makeNomenclatureGroupId(account.id, "main");
  const defaultPriceGroupId = legacyAccount.priceGroups?.[0]?.id || makePriceGroupId(account.id, "main");
  const rawStores = account.stores ?? [];
  const stores = rawStores.map((store) => {
    const legacyMode = store.nomenclatureMode || DEFAULT_NOMENCLATURE_MODE;
    const nomenclatureGroupId =
      store.nomenclatureGroupId ||
      (legacyMode === "separate" ? makeNomenclatureGroupId(account.id, store.id) : defaultNomenclatureGroupId);
    const priceGroupId =
      store.priceGroupId ||
      (legacyMode === "shared_same_price" ? defaultPriceGroupId : makePriceGroupId(account.id, store.id));
    return {
      ...store,
      nomenclatureMode: legacyMode,
      nomenclatureGroupId,
      priceGroupId
    };
  });
  const storeIds = new Set(stores.map((store) => store.id));
  const nomenclatureGroups = ensureNomenclatureGroups(account, stores, now, defaultNomenclatureGroupId);
  const priceGroups = ensurePriceGroups(account, stores, nomenclatureGroups, now, defaultPriceGroupId);
  const nomenclatureGroupIds = new Set(nomenclatureGroups.map((group) => group.id));
  const categories = normalizeCategoriesForGroups(account.categories ?? [], nomenclatureGroups, defaultNomenclatureGroupId);
  const categoryIds = new Set(categories.map((category) => category.id));
  const uncategorizedId = findUncategorizedCategoryId(categories);
  const registers = (account.registers ?? []).map((register, index) => ({
    ...register,
    platform: register.platform || "Windows / Electron",
    deviceName: register.deviceName || register.device || "POS-терминал",
    activationKey:
      register.activationKey ||
      (index === 0 && legacyKey
        ? legacyKey
        : {
            key: makeRegisterKey(account.id, index),
            status: "active" as const,
            generatedAt: new Date().toISOString()
          }),
    receiptSettings: {
      template: register.receiptSettings?.template || account.settings?.receiptTemplate || "Стандартный",
      showQr: false,
      header: register.receiptSettings?.header || stores.find((store) => store.id === register.storeId)?.name || account.name,
      footer: register.receiptSettings?.footer || "Спасибо за покупку"
    }
  }));

  return {
    ...account,
    status: account.status ?? "active",
    createdAt: account.createdAt ?? account.updatedAt ?? new Date().toISOString(),
    ownerPhone: normalizeKyrgyzPhone(account.ownerPhone) || account.ownerPhone || "",
    ownerEmail: normalizeEmail(account.ownerEmail),
    adminLogin: account.adminLogin ?? defaultAdminLogin(account),
    adminPassword: account.adminPassword ?? "1234",
    subscription: account.subscription ?? makeDefaultSubscription((account.id === "acc-textile" ? "Базовый" : "Профессиональный") as AdminAccount["subscription"]["plan"]),
    stores,
    registers,
    nomenclatureGroups,
    priceGroups,
    categories,
    products: (account.products ?? []).map((product) => ({
      ...product,
      categoryId: product.categoryId && categoryIds.has(product.categoryId) ? product.categoryId : uncategorizedId,
      unit: ALLOWED_PRODUCT_UNITS.includes(product.unit) ? product.unit : "шт",
      extraBarcodes: Array.isArray(product.extraBarcodes) ? product.extraBarcodes.filter(Boolean) : [],
      purchasePriceByStore: product.purchasePriceByStore ?? {},
      salePriceByStore: product.salePriceByStore ?? {},
      purchasePriceByPriceGroup: normalizePriceGroupValues(product.purchasePriceByPriceGroup, product.purchasePriceByStore, product.purchasePrice, stores),
      salePriceByPriceGroup: normalizePriceGroupValues(product.salePriceByPriceGroup, product.salePriceByStore, product.salePrice, stores),
      nomenclatureGroupId: product.nomenclatureGroupId && nomenclatureGroupIds.has(product.nomenclatureGroupId)
        ? product.nomenclatureGroupId
        : inferProductNomenclatureGroup(product, stores, defaultNomenclatureGroupId),
      availableStoreIds: product.availableStoreIds?.length
        ? product.availableStoreIds.filter((storeId) => storeIds.has(storeId))
        : undefined,
      stockByStore: product.stockByStore ?? {},
      isDeleted: Boolean(product.isDeleted)
    })),
    employees: (account.employees ?? []).map((employee, index) => normalizeEmployee(employee, stores[0]?.id, index)),
    customers: account.customers ?? [],
    stockOperations: account.stockOperations ?? [],
    stockDocuments: (account.stockDocuments ?? []).map((document) => ({
      ...document,
      type: document.type ?? "receipt",
      storeId: document.storeId || document.sourceStoreId || stores[0]?.id || "store-main",
      sourceStoreId: document.sourceStoreId || document.storeId || stores[0]?.id || "store-main",
      targetStoreId: document.targetStoreId || (document.type === "transfer" ? stores.find((store) => store.id !== (document.sourceStoreId || document.storeId))?.id : undefined),
      createdByUserName: document.createdByUserName || document.userName || "Администратор",
      postedByUserName: document.postedByUserName || (document.postedAt ? document.userName || "Администратор" : undefined),
      items: (document.items ?? []).map((item) => ({
        ...item,
        differenceQty: item.differenceQty ?? item.qty - item.currentStock,
        movementType:
          item.movementType ??
          (document.type === "inventory"
            ? item.qty > item.currentStock
              ? "receipt"
              : item.qty < item.currentStock
                ? "writeoff"
                : "none"
            : document.type === "writeoff"
              ? "writeoff"
              : "receipt")
      }))
    })),
    debtTransactions: account.debtTransactions ?? [],
    sales: (account.sales ?? []).map((sale) => ({
      ...sale,
      type: sale.type ?? "sale",
      shiftId: sale.shiftId || "unknown-shift",
      discount: sale.discount ?? 0,
      debtAmount: sale.debtAmount ?? (sale.paymentMethod === "debt" ? sale.total : 0),
      costTotal:
        sale.costTotal ??
        (sale.items ?? []).reduce((sum, item) => sum + (item.costTotal ?? (item.purchasePrice ?? 0) * item.qty), 0),
      items: (sale.items ?? []).map((item) => ({
        ...item,
        purchasePrice: item.purchasePrice ?? 0,
        discountAmount: item.discountAmount ?? 0,
        costTotal: item.costTotal ?? (item.purchasePrice ?? 0) * item.qty
      }))
    })),
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
    activationKey: legacyKey || registers[0]?.activationKey
  };
}

function ensureUncategorizedCategory(categories: AdminCategory[]) {
  const existing = categories.find((category) => isUncategorizedCategory(category));
  if (existing) {
    return normalizeCategorySortOrders(categories.map((category) =>
      category.id === existing.id
        ? { ...category, name: UNCATEGORIZED_CATEGORY_NAME, icon: category.icon || "ShoppingBasket", color: category.color || "#9aa8b8" }
        : category
    ));
  }
  return normalizeCategorySortOrders([
    ...categories,
    {
      id: UNCATEGORIZED_CATEGORY_ID,
      name: UNCATEGORIZED_CATEGORY_NAME,
      icon: "ShoppingBasket",
      color: "#9aa8b8",
      sortOrder: categories.length + 1
    }
  ]);
}

function normalizeCategorySortOrders(categories: AdminCategory[]) {
  return sortCategories(categories).map((category, index) => ({
    ...category,
    sortOrder: index + 1
  }));
}

function sortCategories<T extends { name: string; sortOrder?: number }>(categories: T[]) {
  return [...categories].sort((left, right) => {
    const leftOrder = Number.isFinite(left.sortOrder) ? Number(left.sortOrder) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.sortOrder) ? Number(right.sortOrder) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.name.localeCompare(right.name, "ru");
  });
}

function findUncategorizedCategoryId(categories: AdminCategory[]) {
  return categories.find((category) => isUncategorizedCategory(category))?.id ?? UNCATEGORIZED_CATEGORY_ID;
}

function isUncategorizedCategory(category: AdminCategory) {
  return category.id === UNCATEGORIZED_CATEGORY_ID || category.name.trim().toLowerCase() === UNCATEGORIZED_CATEGORY_NAME.toLowerCase();
}

function makeNomenclatureGroupId(accountId: string, suffix: string) {
  return `nom-${accountId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function makePriceGroupId(accountId: string, suffix: string) {
  return `price-${accountId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function ensureNomenclatureGroups(
  account: AdminAccount & { nomenclatureGroups?: NomenclatureGroup[] },
  stores: AdminStore[],
  now: string,
  defaultGroupId: string
) {
  const groups = new Map<string, NomenclatureGroup>();
  for (const group of account.nomenclatureGroups ?? []) {
    groups.set(group.id, { ...group, createdAt: group.createdAt || now });
  }
  groups.set(defaultGroupId, groups.get(defaultGroupId) ?? {
    id: defaultGroupId,
    name: "Основная номенклатура",
    createdAt: now
  });
  for (const store of stores) {
    const groupId = store.nomenclatureGroupId || defaultGroupId;
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        id: groupId,
        name: store.nomenclatureMode === "separate" ? `Номенклатура ${store.name}` : "Основная номенклатура",
        createdAt: now
      });
    }
  }
  return Array.from(groups.values());
}

function ensurePriceGroups(
  account: AdminAccount & { priceGroups?: PriceGroup[] },
  stores: AdminStore[],
  nomenclatureGroups: NomenclatureGroup[],
  now: string,
  defaultPriceGroupId: string
) {
  const groups = new Map<string, PriceGroup>();
  const defaultNomenclatureGroupId = nomenclatureGroups[0]?.id || makeNomenclatureGroupId(account.id, "main");
  for (const group of account.priceGroups ?? []) {
    groups.set(group.id, {
      ...group,
      nomenclatureGroupId: group.nomenclatureGroupId || defaultNomenclatureGroupId,
      createdAt: group.createdAt || now
    });
  }
  groups.set(defaultPriceGroupId, groups.get(defaultPriceGroupId) ?? {
    id: defaultPriceGroupId,
    nomenclatureGroupId: defaultNomenclatureGroupId,
    name: "Основные цены",
    createdAt: now
  });
  for (const store of stores) {
    const priceGroupId = store.priceGroupId || defaultPriceGroupId;
    if (!groups.has(priceGroupId)) {
      groups.set(priceGroupId, {
        id: priceGroupId,
        nomenclatureGroupId: store.nomenclatureGroupId || defaultNomenclatureGroupId,
        name: store.nomenclatureMode === "shared_same_price" ? "Основные цены" : `Цены ${store.name}`,
        createdAt: now
      });
    }
  }
  return Array.from(groups.values());
}

function normalizeCategoriesForGroups(categories: AdminCategory[], groups: NomenclatureGroup[], defaultGroupId: string) {
  const groupIds = new Set(groups.map((group) => group.id));
  return sortCategories(ensureUncategorizedCategory(categories)).map((category) => ({
    ...category,
    nomenclatureGroupId:
      category.nomenclatureGroupId && groupIds.has(category.nomenclatureGroupId)
        ? category.nomenclatureGroupId
        : defaultGroupId
  }));
}

function normalizePriceGroupValues(
  byPriceGroup: Record<string, number> | undefined,
  byStore: Record<string, number> | undefined,
  fallback: number,
  stores: AdminStore[]
) {
  const next = { ...(byPriceGroup ?? {}) };
  for (const store of stores) {
    const priceGroupId = store.priceGroupId;
    if (!priceGroupId || next[priceGroupId] !== undefined) continue;
    next[priceGroupId] = Number(byStore?.[store.id] ?? fallback ?? 0);
  }
  return next;
}

function inferProductNomenclatureGroup(product: AdminProduct, stores: AdminStore[], defaultGroupId: string) {
  if (product.availableStoreIds?.length === 1) {
    const store = stores.find((item) => item.id === product.availableStoreIds?.[0]);
    if (store?.nomenclatureMode === "separate" && store.nomenclatureGroupId) {
      return store.nomenclatureGroupId;
    }
  }
  return defaultGroupId;
}

function makeDefaultSubscription(plan: AdminAccount["subscription"]["plan"] = "Базовый" as AdminAccount["subscription"]["plan"]) {
  const now = new Date();
  const expires = new Date(now);
  expires.setFullYear(expires.getFullYear() + 1);
  const planText = String(plan);
  const isBasic = planText.includes("Баз");
  const isPro = planText.includes("Проф");
  return {
    plan,
    status: "active" as const,
    startsAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    maxStores: isBasic ? 1 : isPro ? 5 : 20,
    maxRegisters: isBasic ? 2 : isPro ? 10 : 50,
    monthlyPrice: isBasic ? 1200 : isPro ? 2500 : 5900,
    note: ""
  };
}

function defaultAdminLogin(account: AdminAccount) {
  if (account.id === "acc-urozhai") return "urozhai";
  if (account.id === "acc-textile") return "textile";
  return slugify(account.name || account.id || "account");
}

export function normalizeKyrgyzPhone(value?: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("996") ? digits.slice(3) : digits;
  const nine = local.slice(-9);
  return nine.length === 9 ? `+996${nine}` : "";
}

export function normalizeEmail(value?: string) {
  return String(value || "").trim().toLowerCase();
}

export function defaultPermissionsForRole(role: AdminRole): AdminPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.cashier)];
}

export function normalizePermissions(value: AdminPermission[] | undefined, role: AdminRole): AdminPermission[] {
  const allowed = new Set(ALL_ADMIN_PERMISSIONS);
  const source = value?.length ? value : defaultPermissionsForRole(role);
  return Array.from(new Set(source.filter((permission) => allowed.has(permission))));
}

function findAdminSession(snapshot: AdminSnapshot, normalizedLogin: string, normalizedPhone: string, password: string) {
  for (const account of snapshot.accounts) {
    const ownerPhone = normalizeKyrgyzPhone(account.ownerPhone);
    const ownerLoginMatches = account.adminLogin.trim().toLowerCase() === normalizedLogin;
    const ownerPhoneMatches = Boolean(normalizedPhone && ownerPhone === normalizedPhone);
    if ((ownerLoginMatches || ownerPhoneMatches) && account.adminPassword.trim() === password) {
      return {
        account,
        session: {
          accountId: account.id,
          userId: "owner",
          name: account.ownerName || account.name,
          role: "owner" as const,
          permissions: ALL_ADMIN_PERMISSIONS,
          allowedStoreIds: account.stores.map((store) => store.id),
          loginMethod: ownerPhoneMatches ? "phone" as const : "login" as const
        }
      };
    }

    for (const employee of account.employees ?? []) {
      if (!employee.canLoginAdmin || employee.status !== "active") continue;
      const employeeLoginMatches = String(employee.adminLogin || "").trim().toLowerCase() === normalizedLogin;
      const employeePhoneMatches = Boolean(normalizedPhone && normalizeKyrgyzPhone(employee.phone) === normalizedPhone);
      if ((employeeLoginMatches || employeePhoneMatches) && String(employee.adminPassword || "").trim() === password) {
        return {
          account,
          session: {
            accountId: account.id,
            userId: employee.id,
            name: employee.name,
            role: employee.role,
            permissions: normalizePermissions(employee.permissions, employee.role),
            allowedStoreIds: employee.allowedStoreIds?.length ? employee.allowedStoreIds : [employee.storeId],
            loginMethod: employeePhoneMatches ? "phone" as const : "login" as const
          }
        };
      }
    }
  }
  return null;
}

function normalizeEmployee(employee: AdminAccount["employees"][number], defaultStoreId = "store-main", index = 0) {
  const [firstName = employee.name, ...lastParts] = employee.name.split(" ");
  const role = employee.role || "cashier";
  return {
    ...employee,
    firstName: employee.firstName || firstName,
    lastName: employee.lastName || lastParts.join(" "),
    role,
    phone: normalizeKyrgyzPhone(employee.phone) || employee.phone || "",
    email: employee.email || `employee${index + 1}@kassa-pro.local`,
    allowedStoreIds: employee.allowedStoreIds?.length ? employee.allowedStoreIds : [employee.storeId || defaultStoreId],
    canLoginCash: employee.canLoginCash ?? employee.role === "cashier",
    canLoginAdmin: Boolean(employee.canLoginAdmin),
    adminLogin: employee.adminLogin || slugify(employee.name || `employee-${index + 1}`),
    adminPassword: employee.adminPassword || "",
    permissions: normalizePermissions(employee.permissions, role),
    pin: employee.pin || String(1000 + index).padStart(4, "0")
  };
}

function makeRegisterKey(accountId: string, index: number) {
  const prefix = accountId === "acc-textile" ? "TEXT" : "UROJ";
  return `${prefix}-${new Date().getFullYear()}-${String(index + 1).padStart(4, "0")}`;
}

type ProductDraftInput = Partial<AdminProduct> & {
  storePurchasePrice?: number;
  storeSalePrice?: number;
};

export function makeProduct(account: AdminAccount, input: ProductDraftInput, storeId = account.stores[0]?.id ?? "store-main"): AdminProduct {
  const id = input.id || `prod-${Date.now()}`;
  const store = account.stores.find((item) => item.id === storeId) ?? account.stores[0];
  const nomenclatureGroupId = nomenclatureGroupIdForStore(account, storeId);
  const priceGroupId = priceGroupIdForStore(account, storeId);
  const storeSalePrice = Number(input.storeSalePrice ?? input.salePrice ?? 0);
  const storePurchasePrice = Number(input.storePurchasePrice ?? input.purchasePrice ?? 0);
  const categories = categoriesForStore(account, storeId);
  const salePriceByStore = { ...(input.salePriceByStore ?? {}) };
  const purchasePriceByStore = { ...(input.purchasePriceByStore ?? {}) };
  const salePriceByPriceGroup = { ...(input.salePriceByPriceGroup ?? {}) };
  const purchasePriceByPriceGroup = { ...(input.purchasePriceByPriceGroup ?? {}) };
  if (priceGroupId) {
    salePriceByPriceGroup[priceGroupId] = storeSalePrice;
    purchasePriceByPriceGroup[priceGroupId] = storePurchasePrice;
    salePriceByStore[storeId] = storeSalePrice;
    purchasePriceByStore[storeId] = storePurchasePrice;
  }
  return {
    id,
    categoryId: input.categoryId && categories.some((category) => category.id === input.categoryId) ? input.categoryId : findUncategorizedCategoryId(categories),
    name: input.name || "Новый товар",
    unit: input.unit && ALLOWED_PRODUCT_UNITS.includes(input.unit) ? input.unit : "шт",
    barcode: input.barcode?.trim() || "",
    extraBarcodes: Array.isArray(input.extraBarcodes) ? input.extraBarcodes.map((barcode) => barcode.trim()).filter(Boolean) : [],
    sku: input.sku || `SKU-${String(account.products.length + 1).padStart(3, "0")}`,
    purchasePrice: storePurchasePrice,
    salePrice: storeSalePrice,
    purchasePriceByStore,
    salePriceByStore,
    purchasePriceByPriceGroup,
    salePriceByPriceGroup,
    nomenclatureGroupId,
    availableStoreIds: input.availableStoreIds,
    stockByStore: input.stockByStore || { [storeId]: 0 },
    imageData: input.imageData,
    isDeleted: Boolean(input.isDeleted)
  };
}

export function productAvailableInStore(account: AdminAccount, product: AdminProduct, storeId: string) {
  if (product.isDeleted) return false;
  return product.nomenclatureGroupId === nomenclatureGroupIdForStore(account, storeId);
}

export function salePriceForStore(product: Pick<AdminProduct, "salePrice" | "salePriceByStore" | "salePriceByPriceGroup">, storeId: string, account?: AdminAccount) {
  const priceGroupId = account ? priceGroupIdForStore(account, storeId) : "";
  return Number((priceGroupId ? product.salePriceByPriceGroup?.[priceGroupId] : undefined) ?? product.salePriceByStore?.[storeId] ?? product.salePrice ?? 0);
}

export function purchasePriceForStore(product: Pick<AdminProduct, "purchasePrice" | "purchasePriceByStore" | "purchasePriceByPriceGroup">, storeId: string, account?: AdminAccount) {
  const priceGroupId = account ? priceGroupIdForStore(account, storeId) : "";
  return Number((priceGroupId ? product.purchasePriceByPriceGroup?.[priceGroupId] : undefined) ?? product.purchasePriceByStore?.[storeId] ?? product.purchasePrice ?? 0);
}

export function productForStore(account: AdminAccount, product: AdminProduct, storeId: string): AdminProduct {
  return {
    ...product,
    purchasePrice: purchasePriceForStore(product, storeId, account),
    salePrice: salePriceForStore(product, storeId, account),
    stockByStore: {
      ...product.stockByStore,
      [storeId]: product.stockByStore?.[storeId] ?? 0
    }
  };
}

export function nomenclatureGroupIdForStore(account: AdminAccount, storeId: string) {
  const store = account.stores.find((item) => item.id === storeId) || account.stores[0];
  return store?.nomenclatureGroupId || account.nomenclatureGroups[0]?.id || makeNomenclatureGroupId(account.id, "main");
}

export function priceGroupIdForStore(account: AdminAccount, storeId: string) {
  const store = account.stores.find((item) => item.id === storeId) || account.stores[0];
  return store?.priceGroupId || account.priceGroups[0]?.id || makePriceGroupId(account.id, "main");
}

export function categoriesForStore(account: AdminAccount, storeId: string) {
  const groupId = nomenclatureGroupIdForStore(account, storeId);
  return sortCategories(account.categories.filter((category) => isUncategorizedCategory(category) || category.nomenclatureGroupId === groupId));
}

export function makeCategory(account: AdminAccount, input: Partial<AdminCategory>): AdminCategory {
  return {
    id: input.id || `cat-${Date.now()}`,
    name: input.name || "Новая категория",
    icon: input.icon || "ShoppingBasket",
    color: input.color || "#147adf",
    sortOrder: input.sortOrder ?? account.categories.length + 1,
    nomenclatureGroupId: input.nomenclatureGroupId,
    imageData: input.imageData
  };
}

export function makeAdminAccount(input: Partial<AdminAccount>): AdminAccount {
  const now = new Date().toISOString();
  const slug = slugify(input.name || "account");
  const accountId = `acc-${slug}-${Date.now()}`;
  const storeId = `store-${slug}-main-${Date.now()}`;
  const registerId = `reg-${slug}-1-${Date.now()}`;
  const nomenclatureGroupId = makeNomenclatureGroupId(accountId, "main");
  const priceGroupId = makePriceGroupId(accountId, "main");
  const key = `${slug.slice(0, 4).toUpperCase()}-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const ownerName = input.ownerName || "Владелец магазина";
  const store: AdminStore = {
    id: storeId,
    name: input.name || "Новый магазин",
    address: input.settings?.address || "",
    status: "offline",
    license: "Подписка настраивается",
    nomenclatureMode: DEFAULT_NOMENCLATURE_MODE,
    nomenclatureGroupId,
    priceGroupId
  };
  const register: AdminRegister = {
    id: registerId,
    storeId,
    name: "Касса 1",
    device: "POS-терминал",
    status: "not_activated",
    appVersion: "1.1.0",
    lastSyncAt: now,
    platform: "Windows / Electron",
    deviceName: "Новая касса",
    activationKey: { key, status: "active", generatedAt: now },
    receiptSettings: { template: "Стандартный", showQr: false, header: input.name || "Новый аккаунт", footer: "Спасибо за покупку" }
  };
  return {
    id: input.id || accountId,
    name: input.name || "Новый аккаунт",
    ownerName,
    ownerPhone: normalizeKyrgyzPhone(input.ownerPhone) || input.ownerPhone || "",
    ownerEmail: normalizeEmail(input.ownerEmail),
    adminLogin: input.adminLogin || slug,
    adminPassword: input.adminPassword || "1234",
    status: input.status || "active",
    createdAt: input.createdAt || now,
    subscription: input.subscription || makeDefaultSubscription("Базовый" as AdminAccount["subscription"]["plan"]),
    activationKey: { key, status: "active", generatedAt: now },
    nomenclatureGroups: [{ id: nomenclatureGroupId, name: "Основная номенклатура", createdAt: now }],
    priceGroups: [{ id: priceGroupId, nomenclatureGroupId, name: "Основные цены", createdAt: now }],
    categories: [],
    products: [],
    stores: [store],
    registers: [register],
    employees: [
      {
        id: `emp-owner-${Date.now()}`,
        name: ownerName,
        firstName: ownerName.split(" ")[0] || ownerName,
        lastName: ownerName.split(" ").slice(1).join(" "),
        role: "owner",
        phone: normalizeKyrgyzPhone(input.ownerPhone) || input.ownerPhone || "",
        email: normalizeEmail(input.ownerEmail),
        storeId,
        allowedStoreIds: [storeId],
        canLoginCash: false,
        canLoginAdmin: true,
        adminLogin: input.adminLogin || slug,
        adminPassword: input.adminPassword || "1234",
        permissions: ALL_ADMIN_PERMISSIONS,
        pin: "0000",
        status: "active",
        lastShiftAt: now
      }
    ],
    customers: [],
    settings: {
      companyName: input.name || "Новый аккаунт",
      inn: input.settings?.inn || "",
      address: input.settings?.address || "",
      currency: "сом",
      receiptTemplate: "Стандартный",
      showQr: false,
      taxRate: 12,
      mbankEnabled: false,
      telegramEnabled: false
    },
    stockOperations: [],
    stockDocuments: [],
    sales: [],
    debtTransactions: [],
    shiftReports: [],
    updatedAt: now
  };
}

export function makeAdminStore(account: AdminAccount, input: Partial<AdminStore>): AdminStore {
  const slug = slugify(input.name || `store-${account.stores.length + 1}`);
  const sourceStore = account.stores[0];
  return {
    id: input.id || `store-${slug}-${Date.now()}`,
    name: input.name || `Точка ${account.stores.length + 1}`,
    address: input.address || "",
    status: input.status || "offline",
    license: input.license || subscriptionLabel(account),
    nomenclatureMode: input.nomenclatureMode || DEFAULT_NOMENCLATURE_MODE,
    nomenclatureGroupId: input.nomenclatureGroupId || sourceStore?.nomenclatureGroupId || account.nomenclatureGroups[0]?.id,
    priceGroupId: input.priceGroupId || sourceStore?.priceGroupId || account.priceGroups[0]?.id
  };
}

export type StoreGroupCreationMode = "same_nomenclature_same_price" | "same_nomenclature_new_price" | "new_empty_nomenclature";

export function addAdminStoreWithGroups(
  account: AdminAccount,
  input: Partial<AdminStore>,
  sourceStoreId: string,
  mode: StoreGroupCreationMode
): AdminAccount {
  const now = new Date().toISOString();
  const sourceStore = account.stores.find((store) => store.id === sourceStoreId) || account.stores[0];
  const store = makeAdminStore(account, input);
  let nomenclatureGroups = [...account.nomenclatureGroups];
  let priceGroups = [...account.priceGroups];
  let products = [...account.products];
  let nomenclatureGroupId = sourceStore?.nomenclatureGroupId || account.nomenclatureGroups[0]?.id || makeNomenclatureGroupId(account.id, "main");
  let priceGroupId = sourceStore?.priceGroupId || account.priceGroups[0]?.id || makePriceGroupId(account.id, "main");

  if (mode === "same_nomenclature_new_price") {
    priceGroupId = makePriceGroupId(account.id, store.id);
    priceGroups = [
      ...priceGroups,
      {
        id: priceGroupId,
        nomenclatureGroupId,
        name: `Цены ${store.name}`,
        createdAt: now
      }
    ];
    const sourcePriceGroupId = sourceStore?.priceGroupId;
    products = products.map((product) => {
      if (product.nomenclatureGroupId !== nomenclatureGroupId) return product;
      const sourceSale = sourcePriceGroupId ? product.salePriceByPriceGroup?.[sourcePriceGroupId] : undefined;
      const sourcePurchase = sourcePriceGroupId ? product.purchasePriceByPriceGroup?.[sourcePriceGroupId] : undefined;
      return {
        ...product,
        salePriceByPriceGroup: { ...(product.salePriceByPriceGroup ?? {}), [priceGroupId]: Number(sourceSale ?? product.salePrice ?? 0) },
        purchasePriceByPriceGroup: { ...(product.purchasePriceByPriceGroup ?? {}), [priceGroupId]: Number(sourcePurchase ?? product.purchasePrice ?? 0) },
        salePriceByStore: { ...(product.salePriceByStore ?? {}), [store.id]: Number(sourceSale ?? product.salePrice ?? 0) },
        purchasePriceByStore: { ...(product.purchasePriceByStore ?? {}), [store.id]: Number(sourcePurchase ?? product.purchasePrice ?? 0) }
      };
    });
  }

  if (mode === "new_empty_nomenclature") {
    nomenclatureGroupId = makeNomenclatureGroupId(account.id, store.id);
    priceGroupId = makePriceGroupId(account.id, store.id);
    nomenclatureGroups = [
      ...nomenclatureGroups,
      {
        id: nomenclatureGroupId,
        name: `Номенклатура ${store.name}`,
        createdAt: now
      }
    ];
    priceGroups = [
      ...priceGroups,
      {
        id: priceGroupId,
        nomenclatureGroupId,
        name: `Цены ${store.name}`,
        createdAt: now
      }
    ];
  }

  return {
    ...account,
    nomenclatureGroups,
    priceGroups,
    products,
    stores: [
      ...account.stores,
      {
        ...store,
        nomenclatureGroupId,
        priceGroupId,
        nomenclatureMode:
          mode === "new_empty_nomenclature"
            ? "separate"
            : mode === "same_nomenclature_new_price"
              ? "shared_store_price"
              : "shared_same_price"
      }
    ]
  };
}

export function makeAdminRegister(account: AdminAccount, storeId: string, input: Partial<AdminRegister> = {}): AdminRegister {
  const now = new Date().toISOString();
  const key = `${account.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "KPRO"}-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  return {
    id: input.id || `reg-${Date.now()}`,
    storeId,
    name: input.name || `Касса ${account.registers.length + 1}`,
    device: input.device || "POS-терминал",
    status: input.status || "not_activated",
    appVersion: input.appVersion || "1.1.0",
    lastSyncAt: input.lastSyncAt || now,
    platform: input.platform || "Windows / Electron",
    deviceName: input.deviceName || "Новая касса",
    activationKey: input.activationKey || { key, status: "active", generatedAt: now },
    receiptSettings: input.receiptSettings || { template: "Стандартный", showQr: false, header: account.name, footer: "Спасибо за покупку" }
  };
}

export function subscriptionLabel(account: AdminAccount) {
  return `${account.subscription.plan} до ${new Date(account.subscription.expiresAt).toLocaleDateString("ru-RU")}`;
}

function slugify(value: string) {
  const fallback = value
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  return fallback || "account";
}

function roundAdmin(value: number) {
  return Math.round(value * 100) / 100;
}

export function applyStockOperation(
  account: AdminAccount,
  productId: string,
  type: StockOperationType,
  qty: number,
  reason: string,
  purchasePrice?: number,
  storeId = account.stores[0]?.id ?? "store-main",
  userName = "Администратор"
) {
  const product = account.products.find((item) => item.id === productId);
  if (!product) {
    return account;
  }
  const previousQty = product.stockByStore[storeId] ?? 0;
  const nextQty =
    type === "receipt" || type === "transfer_in"
      ? previousQty + qty
      : type === "writeoff" || type === "transfer_out"
        ? previousQty - qty
        : qty;
  const operation: StockOperation = {
    id: `op-${Date.now()}`,
    type,
    productId,
    storeId,
    qty,
    previousQty,
    nextQty,
    purchasePrice,
    reason,
    createdAt: new Date().toISOString(),
    userName
  };

  return {
    ...account,
    products: account.products.map((item) =>
      item.id === productId
        ? {
            ...item,
            purchasePrice: purchasePrice ?? item.purchasePrice,
            stockByStore: { ...item.stockByStore, [storeId]: nextQty }
          }
        : item
    ),
    stockOperations: [operation, ...account.stockOperations]
  };
}

export function issueNewKey(account: AdminAccount) {
  return issueRegisterKey(account, account.registers[0]?.id ?? "");
}

export function issueRegisterKey(account: AdminAccount, registerId: string) {
  const prefix = account.id === "acc-textile" ? "TEXT" : "UROJ";
  const key = `${prefix}-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  return {
    ...account,
    activationKey: account.activationKey?.key ? account.activationKey : { key, status: "active" as const, generatedAt: new Date().toISOString() },
    registers: account.registers.map((register) =>
      register.id === registerId
        ? {
            ...register,
            status: "not_activated" as const,
            deviceId: undefined,
            deviceLockedAt: undefined,
            activatedAt: undefined,
            activationKey: { key, status: "active" as const, generatedAt: new Date().toISOString() }
          }
        : register
    )
  };
}

function stockDocumentPrefix(type: StockDocumentType) {
  if (type === "transfer") return 6970000;
  if (type === "writeoff") return 4970000;
  if (type === "inventory") return 5970000;
  return 3970000;
}

export function makeStockDocument(
  account: AdminAccount,
  type: StockDocumentType = "receipt",
  storeId = account.stores[0]?.id ?? "store-main",
  user?: Pick<AdminSession, "userId" | "name">
): StockDocument {
  const now = new Date().toISOString();
  const sameTypeCount = account.stockDocuments?.filter((document) => document.type === type).length ?? 0;
  const targetStoreId = type === "transfer" ? account.stores.find((store) => store.id !== storeId)?.id : undefined;
  return {
    id: `doc-${Date.now()}`,
    number: String(stockDocumentPrefix(type) + sameTypeCount + 1),
    type,
    status: "draft",
    storeId,
    sourceStoreId: type === "transfer" ? storeId : storeId,
    targetStoreId,
    createdAt: now,
    updatedAt: now,
    userName: user?.name || "Администратор",
    createdByUserId: user?.userId,
    createdByUserName: user?.name || "Администратор",
    comment: "",
    items: []
  };
}

export function makeStockDocumentItem(
  account: AdminAccount,
  product: AdminProduct,
  type: StockDocumentType = "receipt",
  storeId = account.stores[0]?.id ?? "store-main"
): StockDocumentItem {
  const currentStock = product.stockByStore[storeId] ?? 0;
  const purchasePrice = purchasePriceForStore(product, storeId, account);
  const salePrice = salePriceForStore(product, storeId, account);
  const qty = type === "inventory" ? currentStock : 1;
  const differenceQty = type === "inventory" ? 0 : qty;
  return {
    id: `item-${product.id}-${Date.now()}`,
    productId: product.id,
    name: product.name,
    barcode: product.barcode,
    qty,
    currentStock,
    unit: product.unit,
    price: purchasePrice,
    purchasePrice,
    markupPercent: purchasePrice > 0 ? Math.round(((salePrice - purchasePrice) / purchasePrice) * 10000) / 100 : 0,
    salePrice,
    total: roundAdmin((type === "inventory" ? differenceQty : qty) * purchasePrice),
    differenceQty,
    movementType: type === "writeoff" || type === "transfer" ? "writeoff" : type === "inventory" ? "none" : "receipt",
    comment: ""
  };
}

export function saveStockDocument(account: AdminAccount, document: StockDocument) {
  const updated = { ...document, updatedAt: new Date().toISOString() };
  const exists = account.stockDocuments.some((item) => item.id === document.id);
  return {
    ...account,
    stockDocuments: exists
      ? account.stockDocuments.map((item) => (item.id === document.id ? updated : item))
      : [updated, ...account.stockDocuments]
  };
}

export function postStockDocument(account: AdminAccount, document: StockDocument, user?: Pick<AdminSession, "userId" | "name">) {
  if (document.status === "posted") {
    return saveStockDocument(account, document);
  }
  const now = new Date().toISOString();
  let next = account;
  for (const item of document.items) {
    if (document.type === "transfer") {
      const sourceStoreId = document.sourceStoreId || document.storeId;
      const targetStoreId = document.targetStoreId;
      if (!targetStoreId || targetStoreId === sourceStoreId) {
        continue;
      }
      next = applyStockOperation(next, item.productId, "transfer_out", item.qty, `Перемещение №${document.number}`, item.purchasePrice, sourceStoreId, user?.name || document.createdByUserName || document.userName);
      next = applyStockOperation(next, item.productId, "transfer_in", item.qty, `Перемещение №${document.number}`, item.purchasePrice, targetStoreId, user?.name || document.createdByUserName || document.userName);
      continue;
    }
    const reason =
      document.type === "writeoff"
        ? `Списание №${document.number}`
        : document.type === "inventory"
          ? `Инвентаризация №${document.number}`
          : `Оприходование №${document.number}`;
    next = applyStockOperation(
      next,
      item.productId,
      document.type === "writeoff" ? "writeoff" : document.type === "inventory" ? "inventory" : "receipt",
      item.qty,
      reason,
      item.purchasePrice,
      document.storeId,
      user?.name || document.createdByUserName || document.userName
    );
    next = {
      ...next,
      products: next.products.map((product) =>
        product.id === item.productId
          ? makeProduct(next, { ...product, storeSalePrice: item.salePrice, storePurchasePrice: item.purchasePrice }, document.storeId)
          : product
      )
    };
  }
  return saveStockDocument(next, {
    ...document,
    status: "posted",
    postedAt: now,
    postedByUserId: user?.userId,
    postedByUserName: user?.name || document.createdByUserName || document.userName,
    updatedAt: now
  });
}


