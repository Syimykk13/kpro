function normalizeSnapshot(snapshot) {
  return {
    ...snapshot,
    version: Math.max(2, Number(snapshot.version || 1)),
    accounts: (snapshot.accounts || []).map(normalizeAccount)
  };
}

function mergeArrayByIdPreservingExisting(previousItems, incomingItems, options = {}) {
  const previous = Array.isArray(previousItems) ? previousItems : [];
  const incoming = Array.isArray(incomingItems) ? incomingItems : [];
  if (previous.length && !incoming.length) {
    return previous;
  }
  if (!previous.length) {
    return incoming;
  }
  const idKey = options.idKey || "id";
  const incomingIds = new Set(incoming.map((item) => item && item[idKey]).filter(Boolean));
  const missing = previous.filter((item) => item && item[idKey] && !incomingIds.has(item[idKey]));
  return [...incoming, ...missing];
}

function preserveIfIncomingEmpty(previousItems, incomingItems) {
  const previous = Array.isArray(previousItems) ? previousItems : [];
  const incoming = Array.isArray(incomingItems) ? incomingItems : [];
  return previous.length && !incoming.length ? previous : incoming;
}

function mergeAccountForSafeWrite(previousAccount, incomingAccount) {
  if (!previousAccount) {
    return incomingAccount;
  }
  return {
    ...incomingAccount,
    stores: mergeArrayByIdPreservingExisting(previousAccount.stores, incomingAccount.stores),
    registers: mergeArrayByIdPreservingExisting(previousAccount.registers, incomingAccount.registers),
    employees: mergeArrayByIdPreservingExisting(previousAccount.employees, incomingAccount.employees),
    nomenclatureGroups: mergeArrayByIdPreservingExisting(previousAccount.nomenclatureGroups, incomingAccount.nomenclatureGroups),
    priceGroups: mergeArrayByIdPreservingExisting(previousAccount.priceGroups, incomingAccount.priceGroups),
    products: mergeArrayByIdPreservingExisting(previousAccount.products, incomingAccount.products),
    categories: mergeArrayByIdPreservingExisting(previousAccount.categories, incomingAccount.categories),
    stockOperations: mergeArrayByIdPreservingExisting(previousAccount.stockOperations, incomingAccount.stockOperations),
    stockDocuments: mergeArrayByIdPreservingExisting(previousAccount.stockDocuments, incomingAccount.stockDocuments),
    sales: mergeArrayByIdPreservingExisting(previousAccount.sales, incomingAccount.sales),
    customers: mergeArrayByIdPreservingExisting(previousAccount.customers, incomingAccount.customers),
    debtTransactions: mergeArrayByIdPreservingExisting(previousAccount.debtTransactions, incomingAccount.debtTransactions),
    shiftReports: mergeArrayByIdPreservingExisting(previousAccount.shiftReports, incomingAccount.shiftReports)
  };
}

function mergeSnapshotForSafeWrite(previousSnapshot, incomingSnapshot) {
  if (!previousSnapshot || !Array.isArray(previousSnapshot.accounts)) {
    return incomingSnapshot;
  }
  const previousById = new Map(previousSnapshot.accounts.map((account) => [account.id, account]));
  return {
    ...incomingSnapshot,
    accounts: (incomingSnapshot.accounts || []).map((account) => mergeAccountForSafeWrite(previousById.get(account.id), account))
  };
}

const UNCATEGORIZED_CATEGORY_ID = "uncategorized";
const ALL_ADMIN_PERMISSIONS = [
  "products", "stock", "sales", "employees", "stores", "reports", "settings",
  "viewPurchasePrice", "editProducts", "deleteProducts",
  "stockReceipt", "stockWriteoff", "stockInventory",
  "viewReports", "manageRegisters", "manageEmployees", "manageSettings"
];
const ROLE_PERMISSIONS = {
  owner: ALL_ADMIN_PERMISSIONS,
  admin: ALL_ADMIN_PERMISSIONS,
  manager: ["products", "stock", "sales", "reports", "viewPurchasePrice", "editProducts", "stockReceipt", "stockWriteoff", "stockInventory", "viewReports"],
  cashier: ["products", "stock", "editProducts", "stockReceipt", "stockWriteoff", "stockInventory"]
};
const UNCATEGORIZED_CATEGORY_NAME = "Без категории";

const DEFAULT_NOMENCLATURE_MODE = "shared_same_price";

function isUncategorizedCategory(category) {
  return category?.id === UNCATEGORIZED_CATEGORY_ID ||
    String(category?.name || "").trim().toLowerCase() === UNCATEGORIZED_CATEGORY_NAME.toLowerCase();
}

function ensureUncategorizedCategory(categories) {
  const safeCategories = categories || [];
  const existing = safeCategories.find(isUncategorizedCategory);
  if (existing) {
    return normalizeCategorySortOrders(safeCategories.map((category) =>
      category.id === existing.id
        ? { ...category, name: UNCATEGORIZED_CATEGORY_NAME, icon: category.icon || "ShoppingBasket", color: category.color || "#9aa8b8" }
        : category
    ));
  }
  return normalizeCategorySortOrders([
    ...safeCategories,
    {
      id: UNCATEGORIZED_CATEGORY_ID,
      name: UNCATEGORIZED_CATEGORY_NAME,
      icon: "ShoppingBasket",
      color: "#9aa8b8",
      sortOrder: safeCategories.length + 1
    }
  ]);
}

function normalizeCategorySortOrders(categories) {
  return sortCategories(categories).map((category, index) => ({
    ...category,
    sortOrder: index + 1
  }));
}

function sortCategories(categories) {
  return [...categories].sort((left, right) => {
    const leftOrder = Number.isFinite(left.sortOrder) ? Number(left.sortOrder) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.sortOrder) ? Number(right.sortOrder) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || String(left.name || "").localeCompare(String(right.name || ""), "ru");
  });
}

function cashCategories(categories) {
  return sortCategories(categories || []).filter((category) => !isUncategorizedCategory(category));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUniqueAccountContacts(snapshot) {
  const phones = new Map();
  const emails = new Map();
  for (const account of snapshot.accounts || []) {
    const phone = normalizeKyrgyzPhone(account.ownerPhone);
    if (phone) {
      const existing = phones.get(phone);
      if (existing) return { field: "phone", message: `Account with this phone already exists: ${existing}` };
      phones.set(phone, account.name);
    }
    const email = normalizeEmail(account.ownerEmail);
    if (email) {
      const existing = emails.get(email);
      if (existing) return { field: "email", message: `Account with this email already exists: ${existing}` };
      emails.set(email, account.name);
    }
  }
  return null;
}

function productAvailableInStore(product, store) {
  if (!product || product.isDeleted) return false;
  return product.nomenclatureGroupId === store?.nomenclatureGroupId;
}

function salePriceForStore(product, store) {
  const storeId = store?.id || store;
  const priceGroupId = store?.priceGroupId;
  return Number((priceGroupId ? product.salePriceByPriceGroup?.[priceGroupId] : undefined) ?? product.salePriceByStore?.[storeId] ?? product.salePrice ?? 0);
}

function purchasePriceForStore(product, store) {
  const storeId = store?.id || store;
  const priceGroupId = store?.priceGroupId;
  return Number((priceGroupId ? product.purchasePriceByPriceGroup?.[priceGroupId] : undefined) ?? product.purchasePriceByStore?.[storeId] ?? product.purchasePrice ?? 0);
}

function productForStore(product, store) {
  const storeId = store?.id || store;
  return {
    ...product,
    salePrice: salePriceForStore(product, store),
    purchasePrice: purchasePriceForStore(product, store),
    stockByStore: { ...(product.stockByStore || {}), [storeId]: product.stockByStore?.[storeId] || 0 }
  };
}

function makeNomenclatureGroupId(accountId, suffix) {
  return `nom-${accountId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function makePriceGroupId(accountId, suffix) {
  return `price-${accountId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function normalizePriceGroupValues(byPriceGroup, byStore, fallback, stores) {
  const next = { ...(byPriceGroup || {}) };
  for (const store of stores) {
    if (!store.priceGroupId || next[store.priceGroupId] !== undefined) continue;
    next[store.priceGroupId] = Number(byStore?.[store.id] ?? fallback ?? 0);
  }
  return next;
}

function inferProductNomenclatureGroup(product, stores, defaultGroupId) {
  if (product.availableStoreIds?.length === 1) {
    const store = stores.find((item) => item.id === product.availableStoreIds[0]);
    if (store?.nomenclatureMode === "separate" && store.nomenclatureGroupId) {
      return store.nomenclatureGroupId;
    }
  }
  return defaultGroupId;
}

function normalizeAccount(account) {
  const legacyKey = account.activationKey;
  const categories = sortCategories(ensureUncategorizedCategory(account.categories));
  const categoryIds = new Set(categories.map((category) => category.id));
  const uncategorizedId = categories.find(isUncategorizedCategory)?.id || UNCATEGORIZED_CATEGORY_ID;
  const stores = (account.stores || []).map((store) => ({
    ...store,
    nomenclatureMode: store.nomenclatureMode || DEFAULT_NOMENCLATURE_MODE
  }));
  const defaultNomenclatureGroupId = account.nomenclatureGroups?.[0]?.id || makeNomenclatureGroupId(account.id, "main");
  const defaultPriceGroupId = account.priceGroups?.[0]?.id || makePriceGroupId(account.id, "main");
  for (const store of stores) {
    const legacyMode = store.nomenclatureMode || DEFAULT_NOMENCLATURE_MODE;
    store.nomenclatureGroupId = store.nomenclatureGroupId || (legacyMode === "separate" ? makeNomenclatureGroupId(account.id, store.id) : defaultNomenclatureGroupId);
    store.priceGroupId = store.priceGroupId || (legacyMode === "shared_same_price" ? defaultPriceGroupId : makePriceGroupId(account.id, store.id));
  }
  const storeIds = new Set(stores.map((store) => store.id));
  const now = new Date().toISOString();
  const nomenclatureGroupIds = new Set(stores.map((store) => store.nomenclatureGroupId));
  const existingNomIds = new Set((account.nomenclatureGroups || []).map((group) => group.id));
  const existingPriceIds = new Set((account.priceGroups || []).map((group) => group.id));
  const nomenclatureGroups = [
    ...(account.nomenclatureGroups || []),
    ...stores
      .filter((store) => !existingNomIds.has(store.nomenclatureGroupId))
      .map((store) => ({ id: store.nomenclatureGroupId, name: store.nomenclatureMode === "separate" ? `Номенклатура ${store.name}` : "Основная номенклатура", createdAt: now }))
  ];
  const priceGroups = [
    ...(account.priceGroups || []),
    ...stores
      .filter((store) => !existingPriceIds.has(store.priceGroupId))
      .map((store) => ({ id: store.priceGroupId, nomenclatureGroupId: store.nomenclatureGroupId, name: store.nomenclatureMode === "shared_same_price" ? "Основные цены" : `Цены ${store.name}`, createdAt: now }))
  ];
  const registers = (account.registers || []).map((register, index) => ({
    ...register,
    platform: register.platform || "Windows / Electron",
    deviceName: register.deviceName || register.device || "POS-терминал",
    activationKey:
      register.activationKey ||
      (index === 0 && legacyKey
        ? legacyKey
        : {
            key: `${account.id === "acc-textile" ? "TEXT" : "UROJ"}-${new Date().getFullYear()}-${String(index + 1).padStart(4, "0")}`,
            status: "active",
            generatedAt: new Date().toISOString()
          }),
    receiptSettings: register.receiptSettings || {
      template: account.settings?.receiptTemplate || "Стандартный",
      showQr: false,
      header: stores.find((store) => store.id === register.storeId)?.name || account.name,
      footer: "Спасибо за покупку"
    }
  }));

  return {
    ...account,
    status: account.status || "active",
    createdAt: account.createdAt || account.updatedAt || new Date().toISOString(),
    ownerPhone: normalizeKyrgyzPhone(account.ownerPhone) || account.ownerPhone || "",
    ownerEmail: normalizeEmail(account.ownerEmail),
    adminLogin: account.adminLogin || (account.id === "acc-urozhai" ? "urozhai" : account.id === "acc-textile" ? "textile" : account.id),
    adminPassword: account.adminPassword || "1234",
    subscription: account.subscription || {
      plan: account.id === "acc-textile" ? "Базовый" : "Профессиональный",
      status: "active",
      startsAt: account.updatedAt || new Date().toISOString(),
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
    categories: categories.map((category) => ({ ...category, nomenclatureGroupId: category.nomenclatureGroupId || defaultNomenclatureGroupId })),
    employees: (account.employees || []).map((employee, index) => ({
      ...employee,
      firstName: employee.firstName || employee.name?.split(" ")[0] || employee.name,
      lastName: employee.lastName || employee.name?.split(" ").slice(1).join(" ") || "",
      email: employee.email || `employee${index + 1}@kassa-pro.local`,
      phone: normalizeKyrgyzPhone(employee.phone) || employee.phone || "",
      allowedStoreIds: employee.allowedStoreIds?.length
        ? employee.allowedStoreIds
        : [employee.storeId || stores[0]?.id || "store-main"],
      canLoginCash: employee.canLoginCash ?? employee.role === "cashier",
      canLoginAdmin: Boolean(employee.canLoginAdmin),
      adminLogin: employee.adminLogin || slugify(employee.name || `employee-${index + 1}`),
      adminPassword: employee.adminPassword || "",
      permissions: normalizePermissions(employee.permissions, employee.role || "cashier"),
      pin: employee.pin || String(1000 + index).padStart(4, "0")
    })),
    products: (account.products || []).map((product) => ({
      ...product,
      categoryId: product.categoryId && categoryIds.has(product.categoryId) ? product.categoryId : uncategorizedId,
      unit: ["шт", "кг", "литр", "метр"].includes(product.unit) ? product.unit : "шт",
      extraBarcodes: Array.isArray(product.extraBarcodes) ? product.extraBarcodes.filter(Boolean) : [],
      purchasePriceByStore: product.purchasePriceByStore || {},
      salePriceByStore: product.salePriceByStore || {},
      purchasePriceByPriceGroup: normalizePriceGroupValues(product.purchasePriceByPriceGroup, product.purchasePriceByStore, product.purchasePrice, stores),
      salePriceByPriceGroup: normalizePriceGroupValues(product.salePriceByPriceGroup, product.salePriceByStore, product.salePrice, stores),
      nomenclatureGroupId: product.nomenclatureGroupId && nomenclatureGroupIds.has(product.nomenclatureGroupId)
        ? product.nomenclatureGroupId
        : inferProductNomenclatureGroup(product, stores, defaultNomenclatureGroupId),
      availableStoreIds: product.availableStoreIds?.length ? product.availableStoreIds.filter((storeId) => storeIds.has(storeId)) : undefined,
      stockByStore: product.stockByStore || {},
      isDeleted: Boolean(product.isDeleted)
    })),
    stockOperations: account.stockOperations || [],
    stockDocuments: account.stockDocuments || [],
    customers: account.customers || [],
    debtTransactions: account.debtTransactions || [],
    sales: (account.sales || []).map((sale) => ({
      ...sale,
      type: sale.type || "sale",
      shiftId: sale.shiftId || "unknown-shift",
      discount: sale.discount || 0,
      debtAmount: sale.debtAmount || (sale.paymentMethod === "debt" ? sale.total : 0),
      costTotal:
        sale.costTotal ??
        (sale.items || []).reduce((sum, item) => sum + (item.costTotal ?? (item.purchasePrice ?? 0) * item.qty), 0),
      items: (sale.items || []).map((item) => ({
        ...item,
        purchasePrice: item.purchasePrice ?? 0,
        discountAmount: item.discountAmount || 0,
        costTotal: item.costTotal ?? (item.purchasePrice ?? 0) * item.qty
      }))
    })),
    shiftReports: (account.shiftReports || []).map((shift) => ({
      ...shift,
      debtIssued: shift.debtIssued || 0,
      debtPaidCash: shift.debtPaidCash || 0,
      debtPaidCard: shift.debtPaidCard || 0,
      debtPaidQr: shift.debtPaidQr || 0,
      totalReceived:
        shift.totalReceived ??
        (shift.cash || 0) + (shift.card || 0) + (shift.qr || 0) + (shift.debtPaidCash || 0) + (shift.debtPaidCard || 0) + (shift.debtPaidQr || 0)
    })),
    activationKey: legacyKey || registers[0]?.activationKey
  };
}

function assertAccountAvailable(account) {
  if (account.status === "blocked") {
    throw new Error("Аккаунт закрыт в контрольной панели.");
  }
  if (account.subscription?.status === "expired" || account.subscription?.status === "suspended") {
    throw new Error("Подписка аккаунта не активна.");
  }
}

function findRegisterByKey(snapshot, key) {
  for (const account of snapshot.accounts || []) {
    for (const register of account.registers || []) {
      if (register.activationKey?.key === key) {
        return { account, register };
      }
    }
  }
  return null;
}

function assertRegisterDevice(register, deviceId) {
  if (register?.deviceId && deviceId && register.deviceId !== deviceId) {
    throw new Error("Эта касса уже привязана к другому устройству. Сгенерируйте новый ключ в карточке кассы, если нужно заменить моноблок.");
  }
}

function lockRegisterDevice(register, deviceId, deviceName) {
  if (!register || !deviceId || register.deviceId) return;
  register.deviceId = deviceId;
  register.deviceLockedAt = new Date().toISOString();
  if (deviceName) {
    register.deviceName = deviceName;
  }
}

function registerIdFromPayload(payload) {
  return payload.sale?.registerId || payload.debtTransaction?.registerId || payload.shiftReport?.registerId || payload.product?.registerId || "";
}

function makeCashSnapshot(account, register, activationKey) {
  assertAccountAvailable(account);
  const store = account.stores.find((item) => item.id === register.storeId) || account.stores[0];
  return {
    account: {
      id: account.id,
      name: account.name,
      settings: account.settings
    },
    store,
    register,
    categories: cashCategories((account.categories || []).filter((category) => isUncategorizedCategory(category) || category.nomenclatureGroupId === store.nomenclatureGroupId)),
    products: (account.products || [])
      .filter((product) => productAvailableInStore(product, store))
      .map((product) => productForStore(product, store)),
    employees: (account.employees || []).filter((employee) => !employee.allowedStoreIds?.length || employee.allowedStoreIds.includes(store.id)),
    customers: account.customers || [],
    activationKey,
    syncedAt: new Date().toISOString()
  };
}

function appendSale(account, sale) {
  if (sale && !account.sales.some((item) => item.id === sale.id)) {
    account.sales.unshift(sale);
    const stockSign = sale.type === "return" ? 1 : -1;
    for (const saleItem of sale.items || []) {
      const product = account.products.find((item) => item.id === saleItem.productId);
      if (product) {
        product.stockByStore[sale.storeId] = (product.stockByStore[sale.storeId] || 0) + stockSign * saleItem.qty;
      }
    }
  }
}

function appendDebtTransaction(account, transaction) {
  if (!transaction || account.debtTransactions.some((item) => item.id === transaction.id)) {
    return;
  }
  account.debtTransactions.unshift(transaction);
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
  const sign = transaction.type === "sale" ? 1 : -1;
  customer.debtBalance = Math.round(((customer.debtBalance || 0) + sign * transaction.amount + Number.EPSILON) * 100) / 100;
  customer.updatedAt = transaction.createdAt;
}

function appendCustomer(account, customer) {
  if (!customer) {
    return;
  }
  const exists = account.customers.some((item) => item.id === customer.id);
  account.customers = exists
    ? account.customers.map((item) => (item.id === customer.id ? { ...item, ...customer } : item))
    : [customer, ...account.customers];
}

function appendProduct(account, product) {
  if (!product) {
    return;
  }
  const store = (account.stores || []).find((item) => item.id === product.storeId) || account.stores?.[0];
  const priceGroupId = store?.priceGroupId || "";
  const salePrice = Number(product.salePrice || 0);
  const purchasePrice = Number(product.purchasePrice || 0);
  const normalized = {
    ...product,
    extraBarcodes: Array.isArray(product.extraBarcodes) ? product.extraBarcodes : [],
    nomenclatureGroupId: product.nomenclatureGroupId || store?.nomenclatureGroupId,
    stockByStore: {
      ...(product.stockByStore || {}),
      ...(store ? { [store.id]: product.stockByStore?.[store.id] || 0 } : {})
    },
    salePriceByPriceGroup: {
      ...(product.salePriceByPriceGroup || {}),
      ...(priceGroupId ? { [priceGroupId]: salePrice } : {})
    },
    purchasePriceByPriceGroup: {
      ...(product.purchasePriceByPriceGroup || {}),
      ...(priceGroupId ? { [priceGroupId]: purchasePrice } : {})
    },
    salePriceByStore: {
      ...(product.salePriceByStore || {}),
      ...(store ? { [store.id]: salePrice } : {})
    },
    purchasePriceByStore: {
      ...(product.purchasePriceByStore || {}),
      ...(store ? { [store.id]: purchasePrice } : {})
    }
  };
  account.products = (account.products || []).some((item) => item.id === normalized.id)
    ? account.products.map((item) => (item.id === normalized.id ? { ...item, ...normalized } : item))
    : [normalized, ...(account.products || [])];
}

function appendShiftReport(account, shiftReport) {
  if (!shiftReport) {
    return;
  }
  account.shiftReports = [
    shiftReport,
    ...account.shiftReports.filter((item) => item.id !== shiftReport.id)
  ];
}

function normalizeKyrgyzPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("996") ? digits.slice(3) : digits;
  const nine = local.slice(-9);
  return nine.length === 9 ? `+996${nine}` : "";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "") || "employee";
}

function normalizePermissions(value, role) {
  const allowed = new Set(ALL_ADMIN_PERMISSIONS);
  const source = value?.length ? value : ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.cashier;
  return Array.from(new Set(source.filter((permission) => allowed.has(permission))));
}

function findAdminLogin(snapshot, login, password) {
  const normalizedLogin = String(login || "").trim().toLowerCase();
  const normalizedPhone = normalizeKyrgyzPhone(login);
  const normalizedPassword = String(password || "").trim();
  for (const account of snapshot.accounts || []) {
    const ownerPhone = normalizeKyrgyzPhone(account.ownerPhone);
    const ownerLoginMatches = String(account.adminLogin || "").trim().toLowerCase() === normalizedLogin;
    const ownerPhoneMatches = Boolean(normalizedPhone && ownerPhone === normalizedPhone);
    if ((ownerLoginMatches || ownerPhoneMatches) && String(account.adminPassword || "").trim() === normalizedPassword) {
      return {
        account,
        session: {
          accountId: account.id,
          userId: "owner",
          name: account.ownerName || account.name,
          role: "owner",
          permissions: ALL_ADMIN_PERMISSIONS,
          allowedStoreIds: (account.stores || []).map((store) => store.id),
          loginMethod: ownerPhoneMatches ? "phone" : "login"
        }
      };
    }
    for (const employee of account.employees || []) {
      if (!employee.canLoginAdmin || employee.status !== "active") continue;
      const employeeLoginMatches = String(employee.adminLogin || "").trim().toLowerCase() === normalizedLogin;
      const employeePhoneMatches = Boolean(normalizedPhone && normalizeKyrgyzPhone(employee.phone) === normalizedPhone);
      if ((employeeLoginMatches || employeePhoneMatches) && String(employee.adminPassword || "").trim() === normalizedPassword) {
        return {
          account,
          session: {
            accountId: account.id,
            userId: employee.id,
            name: employee.name,
            role: employee.role,
            permissions: normalizePermissions(employee.permissions, employee.role),
            allowedStoreIds: employee.allowedStoreIds?.length ? employee.allowedStoreIds : [employee.storeId],
            loginMethod: employeePhoneMatches ? "phone" : "login"
          }
        };
      }
    }
  }
  return null;
}

module.exports = {
  appendSale,
  appendCustomer,
  appendProduct,
  appendDebtTransaction,
  appendShiftReport,
  findAdminLogin,
  assertAccountAvailable,
  assertRegisterDevice,
  findRegisterByKey,
  lockRegisterDevice,
  makeCashSnapshot,
  mergeSnapshotForSafeWrite,
  normalizeSnapshot,
  registerIdFromPayload,
  validateUniqueAccountContacts
};
