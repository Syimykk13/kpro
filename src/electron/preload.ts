import { clipboard, contextBridge, ipcRenderer } from "electron";
import type {
  CashBinding,
  CashEmployee,
  CashProductInput,
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
  ProductPriceUpdateInput,
  QrPaymentOrder,
  Receipt,
  ReceiptItem,
  ReturnReceiptInput,
  SuspendReceiptInput,
  SyncStatus
} from "../shared/types";

contextBridge.exposeInMainWorld("kassaApi", {
  account: {
    getBinding: (): Promise<CashBinding | null> => ipcRenderer.invoke("account:getBinding"),
    activate: (key: string): Promise<CashBinding | null> => ipcRenderer.invoke("account:activate", key),
    refresh: (): Promise<CashBinding | null> => ipcRenderer.invoke("account:refresh"),
    logout: (force?: boolean): Promise<boolean> => ipcRenderer.invoke("account:logout", force)
  },
  shift: {
    getCurrent: () => ipcRenderer.invoke("shift:getCurrent"),
    open: (input: OpenShiftInput) => ipcRenderer.invoke("shift:open", input),
    close: (input: CloseShiftInput) => ipcRenderer.invoke("shift:close", input)
  },
  products: {
    categories: () => ipcRenderer.invoke("products:categories"),
    list: (search?: string) => ipcRenderer.invoke("products:list", search),
    createFromCash: (input: CashProductInput) => ipcRenderer.invoke("products:createFromCash", input),
    updatePrice: (input: ProductPriceUpdateInput) => ipcRenderer.invoke("products:updatePrice", input)
  },
  employees: {
    listCashiers: (): Promise<CashEmployee[]> => ipcRenderer.invoke("employees:listCashiers")
  },
  customers: {
    list: (search?: string): Promise<Customer[]> => ipcRenderer.invoke("customers:list", search),
    save: (input: CustomerInput): Promise<Customer | null> => ipcRenderer.invoke("customers:save", input)
  },
  debts: {
    list: (): Promise<Customer[]> => ipcRenderer.invoke("debts:list"),
    transactions: (customerId?: string): Promise<DebtTransaction[]> => ipcRenderer.invoke("debts:transactions", customerId),
    pay: (input: PayDebtInput) => ipcRenderer.invoke("debts:pay", input)
  },
  receipts: {
    getNextNumber: () => ipcRenderer.invoke("receipts:getNextNumber"),
    list: (): Promise<Receipt[]> => ipcRenderer.invoke("receipts:list"),
    items: (receiptId: number): Promise<ReceiptItem[]> => ipcRenderer.invoke("receipts:items", receiptId),
    print: (receiptId: number): Promise<boolean> => ipcRenderer.invoke("receipts:print", receiptId),
    listSuspended: (search?: string) => ipcRenderer.invoke("receipts:listSuspended", search),
    deleteSuspended: (id: number) => ipcRenderer.invoke("receipts:deleteSuspended", id)
  },
  cart: {
    createReceipt: (input: CreateReceiptInput) => ipcRenderer.invoke("cart:createReceipt", input),
    createReturn: (input: ReturnReceiptInput) => ipcRenderer.invoke("cart:createReturn", input),
    suspendReceipt: (input: SuspendReceiptInput) => ipcRenderer.invoke("cart:suspendReceipt", input),
    restoreSuspended: (id: number) => ipcRenderer.invoke("cart:restoreSuspended", id)
  },
  settings: {
    getDevices: () => ipcRenderer.invoke("settings:getDevices"),
    updateDevice: (input: DeviceUpdateInput) =>
      ipcRenderer.invoke("settings:updateDevice", input)
  },
  display: {
    update: (state: CustomerDisplayState): Promise<boolean> => ipcRenderer.invoke("display:update", state),
    listPorts: (): Promise<string[]> => ipcRenderer.invoke("display:listPorts"),
    testMini: (port: string, amount = 123.45): Promise<boolean> =>
      ipcRenderer.invoke("display:testMini", { port, amount })
  },
  sync: {
    getStatus: (): Promise<SyncStatus> => ipcRenderer.invoke("sync:getStatus"),
    flush: (): Promise<SyncStatus> => ipcRenderer.invoke("sync:flush")
  },
  qr: {
    createPayment: (input: CreateQrPaymentInput): Promise<QrPaymentOrder> =>
      ipcRenderer.invoke("qr:createPayment", input),
    getStatus: (txnId: string): Promise<QrPaymentOrder> => ipcRenderer.invoke("qr:getStatus", txnId)
  },
  window: {
    minimize: (): Promise<boolean> => ipcRenderer.invoke("window:minimize"),
    close: (): Promise<boolean> => ipcRenderer.invoke("window:close")
  },
  clipboard: {
    readText: (): string => clipboard.readText()
  }
});
