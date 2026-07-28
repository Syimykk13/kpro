import type { PaymentMethod } from "./types";

export type ActivationKeyStatus = "active" | "used" | "revoked";
export type StockOperationType = "receipt" | "writeoff" | "inventory" | "transfer_in" | "transfer_out";
export type StockDocumentType = "receipt" | "writeoff" | "inventory" | "transfer";
export type NomenclatureMode = "shared_same_price" | "shared_store_price" | "separate";
export type AdminRole = "owner" | "admin" | "cashier" | "manager";
export type AdminPermission =
  | "products"
  | "stock"
  | "sales"
  | "employees"
  | "stores"
  | "reports"
  | "settings"
  | "viewPurchasePrice"
  | "editProducts"
  | "deleteProducts"
  | "stockReceipt"
  | "stockWriteoff"
  | "stockInventory"
  | "viewReports"
  | "manageRegisters"
  | "manageEmployees"
  | "manageSettings";
export type StockDocumentStatus = "draft" | "posted";
export type AdminAccountStatus = "active" | "blocked";
export type AdminSubscriptionStatus = "trial" | "active" | "expired" | "suspended";

export type AdminCategory = {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  nomenclatureGroupId?: string;
  imageData?: string;
};

export type AdminProduct = {
  id: string;
  categoryId: string;
  name: string;
  unit: string;
  barcode: string;
  extraBarcodes?: string[];
  sku: string;
  purchasePrice: number;
  salePrice: number;
  purchasePriceByStore?: Record<string, number>;
  salePriceByStore?: Record<string, number>;
  purchasePriceByPriceGroup?: Record<string, number>;
  salePriceByPriceGroup?: Record<string, number>;
  nomenclatureGroupId?: string;
  availableStoreIds?: string[];
  stockByStore: Record<string, number>;
  imageData?: string;
  isDeleted?: boolean;
};

export type NomenclatureGroup = {
  id: string;
  name: string;
  createdAt: string;
};

export type PriceGroup = {
  id: string;
  nomenclatureGroupId: string;
  name: string;
  createdAt: string;
};

export type AdminStore = {
  id: string;
  name: string;
  address: string;
  status: "online" | "offline";
  license: string;
  nomenclatureMode: NomenclatureMode;
  nomenclatureGroupId?: string;
  priceGroupId?: string;
};

export type AdminRegister = {
  id: string;
  storeId: string;
  name: string;
  device: string;
  status: "online" | "offline" | "not_activated";
  appVersion: string;
  lastSyncAt: string;
  platform?: string;
  deviceName?: string;
  deviceId?: string;
  deviceLockedAt?: string;
  activatedAt?: string;
  activationKey: ActivationKey;
  receiptSettings?: {
    template: string;
    showQr: boolean;
    header?: string;
    footer: string;
  };
};

export type ActivationKey = {
  key: string;
  status: ActivationKeyStatus;
  generatedAt: string;
  usedAt?: string;
  usedByRegisterId?: string;
  usedByDeviceId?: string;
};

export type AdminEmployee = {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  role: AdminRole;
  phone: string;
  email: string;
  storeId: string;
  allowedStoreIds: string[];
  canLoginCash: boolean;
  canLoginAdmin?: boolean;
  adminLogin?: string;
  adminPassword?: string;
  permissions?: AdminPermission[];
  pin: string;
  status: "active" | "offline";
  lastShiftAt: string;
};

export type AdminSession = {
  accountId: string;
  userId: string;
  name: string;
  role: AdminRole;
  permissions: AdminPermission[];
  allowedStoreIds: string[];
  loginMethod: "login" | "phone";
};

export type AdminCustomer = {
  id: string;
  name: string;
  phone: string;
  comment: string;
  debtBalance: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminSettings = {
  companyName: string;
  inn: string;
  address: string;
  currency: string;
  receiptTemplate: string;
  showQr: boolean;
  taxRate: number;
  mbankEnabled: boolean;
  telegramEnabled: boolean;
};

export type AdminSubscription = {
  plan: "Базовый" | "Профессиональный" | "Премиум";
  status: AdminSubscriptionStatus;
  startsAt: string;
  expiresAt: string;
  maxStores: number;
  maxRegisters: number;
  monthlyPrice: number;
  note: string;
};

export type StockOperation = {
  id: string;
  type: StockOperationType;
  productId: string;
  storeId: string;
  qty: number;
  previousQty: number;
  nextQty: number;
  purchasePrice?: number;
  reason: string;
  createdAt: string;
  userName: string;
};

export type StockDocumentItem = {
  id: string;
  productId: string;
  name: string;
  barcode: string;
  qty: number;
  currentStock: number;
  unit: string;
  price: number;
  purchasePrice: number;
  markupPercent: number;
  salePrice: number;
  total: number;
  comment: string;
  differenceQty?: number;
  movementType?: "receipt" | "writeoff" | "none";
};

export type StockDocument = {
  id: string;
  number: string;
  type: StockDocumentType;
  status: StockDocumentStatus;
  storeId: string;
  sourceStoreId?: string;
  targetStoreId?: string;
  createdAt: string;
  updatedAt: string;
  postedAt?: string;
  userName: string;
  createdByUserId?: string;
  createdByUserName?: string;
  postedByUserId?: string;
  postedByUserName?: string;
  comment: string;
  items: StockDocumentItem[];
};

export type AdminSaleItem = {
  productId: string;
  name: string;
  qty: number;
  purchasePrice: number;
  salePrice: number;
  discountAmount?: number;
  costTotal: number;
  total: number;
};

export type AdminSale = {
  id: string;
  originalSyncId?: string;
  number: string;
  shiftId: string;
  accountId: string;
  storeId: string;
  registerId: string;
  cashier: string;
  paymentMethod: PaymentMethod;
  total: number;
  costTotal: number;
  discount?: number;
  customerId?: string;
  customerName?: string;
  debtAmount?: number;
  paidAmount?: number;
  changeAmount?: number;
  type?: "sale" | "return";
  originalSaleId?: string;
  returnReason?: string;
  returnPaymentMethod?: PaymentMethod;
  createdAt: string;
  items: AdminSaleItem[];
};

export type DebtTransaction = {
  id: string;
  customerId: string;
  customerName: string;
  type: "sale" | "payment";
  paymentMethod?: Exclude<PaymentMethod, "debt">;
  shiftId: string;
  receiptId?: string;
  accountId: string;
  storeId: string;
  registerId: string;
  cashier: string;
  amount: number;
  comment: string;
  createdAt: string;
};

export type AdminShiftReport = {
  id: string;
  localShiftId: number;
  accountId: string;
  storeId: string;
  registerId: string;
  registerName: string;
  cashier: string;
  openingCash: number;
  openedAt: string;
  closedAt: string | null;
  status: "open" | "closed";
  revenue: number;
  cash: number;
  card: number;
  qr: number;
  debtIssued: number;
  debtPaidCash: number;
  debtPaidCard: number;
  debtPaidQr: number;
  totalReceived: number;
  expenses: number;
  closingCash: number;
  difference: number;
  profit: number;
  receiptsCount: number;
  returnsTotal: number;
};

export type AdminAccount = {
  id: string;
  name: string;
  ownerName: string;
  ownerPhone?: string;
  ownerEmail?: string;
  adminLogin: string;
  adminPassword: string;
  status: AdminAccountStatus;
  createdAt: string;
  subscription: AdminSubscription;
  activationKey: ActivationKey;
  nomenclatureGroups: NomenclatureGroup[];
  priceGroups: PriceGroup[];
  categories: AdminCategory[];
  products: AdminProduct[];
  stores: AdminStore[];
  registers: AdminRegister[];
  employees: AdminEmployee[];
  customers: AdminCustomer[];
  settings: AdminSettings;
  stockOperations: StockOperation[];
  stockDocuments: StockDocument[];
  sales: AdminSale[];
  debtTransactions: DebtTransaction[];
  shiftReports: AdminShiftReport[];
  updatedAt: string;
};

export type AdminSnapshot = {
  version: number;
  updatedAt: string;
  accounts: AdminAccount[];
};

export type CashActivation = {
  accountId: string;
  accountName: string;
  storeId: string;
  storeName: string;
  registerId: string;
  activationKey: string;
  activatedAt: string;
  lastSyncAt: string;
};

export type CashImportSnapshot = {
  account: Pick<AdminAccount, "id" | "name" | "settings">;
  store: AdminStore;
  register: AdminRegister;
  categories: AdminCategory[];
  products: AdminProduct[];
  employees: AdminEmployee[];
  customers: AdminCustomer[];
  activationKey: string;
  syncedAt: string;
};
