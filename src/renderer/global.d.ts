import type {
  CashBinding,
  CashEmployee,
  CashProductInput,
  Category,
  CloseShiftInput,
  CreateQrPaymentInput,
  CreateReceiptInput,
  Customer,
  CustomerDisplayState,
  CustomerInput,
  Device,
  DebtTransaction,
  DeviceUpdateInput,
  OpenShiftInput,
  PayDebtInput,
  Product,
  ProductPriceUpdateInput,
  QrPaymentOrder,
  Receipt,
  ReceiptItem,
  RestoreSuspendedResult,
  ReturnReceiptInput,
  Shift,
  ShiftSummary,
  SyncStatus,
  SuspendReceiptInput,
  SuspendedReceipt
} from "../shared/types";

declare global {
  interface Window {
    kassaApi: {
      account: {
        getBinding: () => Promise<CashBinding | null>;
        activate: (key: string) => Promise<CashBinding | null>;
        refresh: () => Promise<CashBinding | null>;
        logout: (force?: boolean) => Promise<boolean>;
      };
      shift: {
        getCurrent: () => Promise<Shift | null>;
        open: (input: OpenShiftInput) => Promise<Shift | null>;
        close: (input: CloseShiftInput) => Promise<ShiftSummary>;
      };
      products: {
        categories: () => Promise<Category[]>;
        list: (search?: string) => Promise<Product[]>;
        createFromCash: (input: CashProductInput) => Promise<Product>;
        updatePrice: (input: ProductPriceUpdateInput) => Promise<Product>;
      };
      employees: {
        listCashiers: () => Promise<CashEmployee[]>;
      };
      customers: {
        list: (search?: string) => Promise<Customer[]>;
        save: (input: CustomerInput) => Promise<Customer | null>;
      };
      debts: {
        list: () => Promise<Customer[]>;
        transactions: (customerId?: string) => Promise<DebtTransaction[]>;
        pay: (input: PayDebtInput) => Promise<{ customer: Customer; transaction?: DebtTransaction }>;
      };
      receipts: {
        getNextNumber: () => Promise<string>;
        list: () => Promise<Receipt[]>;
        items: (receiptId: number) => Promise<ReceiptItem[]>;
        print: (receiptId: number) => Promise<boolean>;
        listSuspended: (search?: string) => Promise<SuspendedReceipt[]>;
        deleteSuspended: (id: number) => Promise<boolean>;
      };
      cart: {
        createReceipt: (input: CreateReceiptInput) => Promise<Receipt>;
        createReturn: (input: ReturnReceiptInput) => Promise<Receipt>;
        suspendReceipt: (input: SuspendReceiptInput) => Promise<SuspendedReceipt | null>;
        restoreSuspended: (id: number) => Promise<RestoreSuspendedResult>;
      };
      settings: {
        getDevices: () => Promise<Device[]>;
        updateDevice: (input: DeviceUpdateInput) => Promise<Device | null>;
      };
      display: {
        update: (state: CustomerDisplayState) => Promise<boolean>;
        listPorts: () => Promise<string[]>;
        testMini: (port: string, amount?: number) => Promise<boolean>;
      };
      sync: {
        getStatus: () => Promise<SyncStatus>;
        flush: () => Promise<SyncStatus>;
      };
      qr: {
        createPayment: (input: CreateQrPaymentInput) => Promise<QrPaymentOrder>;
        getStatus: (txnId: string) => Promise<QrPaymentOrder>;
      };
      window: {
        minimize: () => Promise<boolean>;
        close: () => Promise<boolean>;
      };
      clipboard: {
        readText: () => string;
      };
    };
  }
}

export {};
