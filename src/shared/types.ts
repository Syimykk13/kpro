export type Category = {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  imageData?: string;
};

export type Product = {
  id: string;
  categoryId: string;
  name: string;
  unit: string;
  price: number;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  barcode: string;
  extraBarcodes?: string[];
  sku: string;
  imageData?: string;
};

export type Shift = {
  id: number;
  cashier: string;
  cashierId?: string;
  openingCash: number;
  closingCash?: number | null;
  cashDifference?: number | null;
  openedAt: string;
  closedAt: string | null;
  comment: string;
  status: "open" | "closed";
};

export type ShiftSummary = {
  shift: Shift;
  revenue: number;
  cash: number;
  card: number;
  qr: number;
  debtIssued: number;
  debtPaidCash: number;
  debtPaidCard: number;
  debtPaidQr: number;
  totalReceived: number;
  receiptsCount: number;
  returnsTotal: number;
  expectedCash: number;
  actualCash: number;
  difference: number;
};

export type CartItem = {
  productId: string;
  name: string;
  qty: number;
  unit: string;
  price: number;
  purchasePrice?: number;
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
  total: number;
  isUniversal?: boolean;
};

export type DiscountType = "none" | "percent" | "amount";

export type Receipt = {
  id: number;
  number: string;
  shiftId: number;
  cashier: string;
  paymentMethod: PaymentMethod;
  subtotal: number;
  discount: number;
  discountType?: DiscountType;
  discountValue?: number;
  customerId?: string;
  customerName?: string;
  debtAmount?: number;
  total: number;
  status: "paid" | "returned";
  createdAt: string;
  comment: string;
  paidAmount?: number;
  changeAmount?: number;
  originalReceiptId?: number | null;
  originalReceiptNumber?: string;
  returnReason?: string;
  returnPaymentMethod?: PaymentMethod;
};

export type ReceiptItem = {
  id: number;
  receiptId: number;
  productId: string;
  name: string;
  qty: number;
  unit: string;
  price: number;
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
  total: number;
};

export type SuspendedReceipt = {
  id: number;
  number: string;
  itemsCount: number;
  total: number;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

export type Device = {
  id: string;
  name: string;
  subtitle: string;
  port: string;
  status: "connected" | "offline" | "online";
  enabled: boolean;
  updatedAt: string;
};

export type DeviceUpdateInput = Partial<Device> & {
  id: string;
};

export type CustomerDisplayState = {
  storeName: string;
  receiptNumber: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  customerName?: string;
  status: "idle" | "editing" | "paid" | "return";
  message?: string;
};

export type QrPaymentOrder = {
  externalId: string;
  txnId: string;
  amount: number;
  amountTyiyn: number;
  status: "PENDING" | "SUCCESS" | "ERROR" | "EXPIRED" | string;
  paymentUrl: string;
  qrUrl: string;
  receiptNumber: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateQrPaymentInput = {
  amount: number;
  receiptNumber: string;
  description?: string;
};

export type PaymentMethod = "cash" | "card" | "qr" | "debt";

export type Customer = {
  id: string;
  name: string;
  phone: string;
  comment: string;
  debtBalance: number;
  createdAt: string;
  updatedAt: string;
};

export type DebtTransactionType = "sale" | "payment";

export type DebtTransaction = {
  id: number;
  customerId: string;
  customerName: string;
  type: DebtTransactionType;
  paymentMethod?: Exclude<PaymentMethod, "debt">;
  shiftId: number;
  receiptId?: number | null;
  amount: number;
  comment: string;
  createdAt: string;
};

export type OpenShiftInput = {
  cashier: string;
  cashierId?: string;
  openingCash: number;
  comment: string;
};

export type CloseShiftInput = {
  actualCash: number;
};

export type CreateReceiptInput = {
  number?: string;
  items: CartItem[];
  paymentMethod: PaymentMethod;
  discount: number;
  discountType?: DiscountType;
  discountValue?: number;
  customerId?: string;
  cashier: string;
  comment: string;
  paidAmount?: number;
  changeAmount?: number;
};

export type ReturnReceiptInput = {
  originalReceiptId: number;
  items: CartItem[];
  paymentMethod: PaymentMethod;
  cashier: string;
  reason: string;
};

export type CustomerInput = {
  id?: string;
  name: string;
  phone: string;
  comment: string;
};

export type CashProductInput = {
  barcode: string;
  name: string;
  categoryId: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
};

export type ProductPriceUpdateInput = {
  productId: string;
  salePrice: number;
};

export type PayDebtInput = {
  customerId: string;
  amount: number;
  paymentMethod: Exclude<PaymentMethod, "debt">;
  cashier: string;
  comment: string;
};

export type SuspendReceiptInput = {
  items: CartItem[];
  cashier: string;
  comment: string;
};

export type RestoreSuspendedResult = {
  number: string;
  items: CartItem[];
  cashier: string;
  comment: string;
};

export type CashBinding = {
  accountId: string;
  accountName: string;
  storeId: string;
  storeName: string;
  registerId: string;
  deviceId: string;
  activationKey: string;
  activatedAt: string;
  lastSyncAt: string;
};

export type CashEmployee = {
  id: string;
  name: string;
  role: string;
  pin: string;
  canLoginCash: boolean;
  allowedStoreIds: string[];
};

export type SyncStatus = {
  pending: number;
  failed: number;
  total: number;
  syncing: boolean;
  lastError: string;
  lastAttemptAt: string;
  lastSyncedAt: string;
};
