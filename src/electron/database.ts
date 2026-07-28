import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import initSqlJs, { Database } from "sql.js";
import {
  activateByKey,
  getAccountSnapshot,
  sendRegisterSyncPayload
} from "./accountBridge";
import type {
  CashBinding,
  CashEmployee,
  CashProductInput,
  CartItem,
  Category,
  CloseShiftInput,
  CreateReceiptInput,
  Customer,
  Device,
  DebtTransaction,
  OpenShiftInput,
  PayDebtInput,
  Product,
  ProductPriceUpdateInput,
  Receipt,
  ReceiptItem,
  ReturnReceiptInput,
  RestoreSuspendedResult,
  Shift,
  ShiftSummary,
  SyncStatus,
  SuspendReceiptInput,
  SuspendedReceipt
} from "../shared/types";
import type { AdminCustomer, AdminSale, AdminShiftReport, CashImportSnapshot, DebtTransaction as AdminDebtTransaction } from "../shared/adminTypes";

type SqlValue = string | number | Uint8Array | null;
type SyncEventType = "sale" | "shiftReport" | "debtTransaction" | "customer" | "product";
type SyncQueueRow = {
  id: number;
  eventId: string;
  eventType: SyncEventType;
  accountId: string;
  payload: string;
  attempts: number;
};

const now = () => new Date().toISOString();
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundQty = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;
const toBool = (value: unknown) => Boolean(Number(value));
const normalizeBarcode = (value: string) => value.trim().replace(/\s+/g, "");
const parseExtraBarcodes = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map(String).map(normalizeBarcode).filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).map(normalizeBarcode).filter(Boolean) : [];
  } catch {
    return value.split(/[,\n;]/).map(normalizeBarcode).filter(Boolean);
  }
};

function appendDatabaseLog(userDataPath: string, message: string) {
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.appendFileSync(path.join(userDataPath, "kassa-pro-startup.log"), `[${now()}] ${message}\n`, "utf8");
  } catch {
    // Logging must never block cash startup.
  }
}

export class KassaDatabase {
  private db: Database;
  private filePath: string;
  private syncInProgress = false;

  private constructor(db: Database, filePath: string) {
    this.db = db;
    this.filePath = filePath;
  }

  static async open(userDataPath: string) {
    const SQL = await initSqlJs({
      locateFile: (file) => (file === "sql-wasm.wasm" ? require.resolve("sql.js/dist/sql-wasm.wasm") : file)
    });

    fs.mkdirSync(userDataPath, { recursive: true });
    const filePath = path.join(userDataPath, "kassa-pro.sqlite");
    const backupPath = `${filePath}.bak`;
    let db: Database;
    try {
      db = fs.existsSync(filePath) ? new SQL.Database(fs.readFileSync(filePath)) : new SQL.Database();
    } catch (error) {
      appendDatabaseLog(userDataPath, `database:open-failed ${error instanceof Error ? error.message : String(error)}`);
      if (!fs.existsSync(backupPath)) {
        throw error;
      }
      db = new SQL.Database(fs.readFileSync(backupPath));
      fs.copyFileSync(backupPath, filePath);
      appendDatabaseLog(userDataPath, "database:restored-from-backup");
    }

    const store = new KassaDatabase(db, filePath);
    store.createSchema();
    store.migrateSchema();
    store.seedDevices();
    store.normalizeDevices();
    store.save();
    return store;
  }

  getBinding() {
    const accountId = this.getSetting("accountId");
    if (!accountId) {
      return null;
    }
    return {
      accountId,
      accountName: this.getSetting("accountName") || "Аккаунт",
      storeId: this.getSetting("storeId") || "store-main",
      storeName: this.getSetting("storeName") || "Магазин",
      registerId: this.getSetting("registerId") || "register-main",
      deviceId: this.getDeviceId(),
      activationKey: this.getSetting("activationKey") || "",
      activatedAt: this.getSetting("activatedAt") || now(),
      lastSyncAt: this.getSetting("lastSyncAt") || now()
    } satisfies CashBinding;
  }

  private getDeviceId() {
    const value = crypto
      .createHash("sha256")
      .update([os.hostname(), os.userInfo().username, os.homedir()].join("|"))
      .digest("hex")
      .slice(0, 32);
    const deviceId = `kpro-${value}`;
    if (this.getSetting("deviceId") !== deviceId) {
      this.setSetting("deviceId", deviceId);
      this.save();
    }
    return deviceId;
  }

  async activateWithKey(key: string) {
    const snapshot = await activateByKey(key, this.getDeviceId(), os.hostname());
    this.importSnapshot(snapshot);
    return this.getBinding();
  }

  async refreshSnapshot() {
    const binding = this.getBinding();
    if (!binding) {
      throw new Error("Касса не привязана к аккаунту.");
    }
    if (this.getSyncStatus().total > 0) {
      await this.flushSyncQueue();
      const status = this.getSyncStatus();
      if (status.total > 0) {
        throw new Error("Есть неотправленные данные. Сначала подключите интернет и синхронизируйте кассу.");
      }
    }
    const snapshot = await getAccountSnapshot(binding.accountId, binding.activationKey, binding.registerId, this.getDeviceId());
    this.importSnapshot(snapshot);
    return this.getBinding();
  }

  getSyncStatus(): SyncStatus {
    const totals = this.get<{ pending: number; failed: number; total: number }>(
      `SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        COUNT(*) as total
       FROM sync_queue
       WHERE status IN ('pending', 'failed')`
    ) ?? { pending: 0, failed: 0, total: 0 };
    const meta = this.get<{ lastError: string; lastAttemptAt: string; lastSyncedAt: string }>(
      `SELECT
        COALESCE((SELECT last_error FROM sync_queue WHERE status = 'failed' AND last_error != '' ORDER BY last_attempt_at DESC, id DESC LIMIT 1), '') as lastError,
        COALESCE((SELECT last_attempt_at FROM sync_queue WHERE last_attempt_at != '' ORDER BY last_attempt_at DESC, id DESC LIMIT 1), '') as lastAttemptAt,
        COALESCE((SELECT synced_at FROM sync_queue WHERE synced_at != '' ORDER BY synced_at DESC, id DESC LIMIT 1), '') as lastSyncedAt`
    ) ?? { lastError: "", lastAttemptAt: "", lastSyncedAt: "" };
    return {
      pending: Number(totals.pending ?? 0),
      failed: Number(totals.failed ?? 0),
      total: Number(totals.total ?? 0),
      syncing: this.syncInProgress,
      lastError: meta.lastError ?? "",
      lastAttemptAt: meta.lastAttemptAt ?? "",
      lastSyncedAt: meta.lastSyncedAt ?? ""
    };
  }

  async flushSyncQueue() {
    if (this.syncInProgress) {
      return this.getSyncStatus();
    }
    this.syncInProgress = true;
    try {
      const rows = this.all<SyncQueueRow>(
        `SELECT id, event_id as eventId, event_type as eventType, account_id as accountId, payload, attempts
         FROM sync_queue
         WHERE status IN ('pending', 'failed')
         ORDER BY id ASC
         LIMIT 50`
      );
      const deviceId = this.getDeviceId();

      for (const row of rows) {
        const attemptedAt = now();
        this.db.run(
          "UPDATE sync_queue SET attempts = attempts + 1, last_attempt_at = ?, status = 'pending', last_error = '' WHERE id = ?",
          [attemptedAt, row.id]
        );
        this.save();
        try {
          const payload = JSON.parse(row.payload);
          if (row.eventType === "sale") {
            await sendRegisterSyncPayload(row.accountId, { sale: payload }, deviceId);
          } else if (row.eventType === "shiftReport") {
            await sendRegisterSyncPayload(row.accountId, { shiftReport: payload }, deviceId);
          } else if (row.eventType === "debtTransaction") {
            await sendRegisterSyncPayload(row.accountId, { debtTransaction: payload }, deviceId);
          } else if (row.eventType === "customer") {
            await sendRegisterSyncPayload(row.accountId, { customer: payload }, deviceId);
          } else if (row.eventType === "product") {
            await sendRegisterSyncPayload(row.accountId, { product: payload }, deviceId);
          }
          this.db.run("UPDATE sync_queue SET status = 'sent', synced_at = ?, last_error = '' WHERE id = ?", [now(), row.id]);
          this.save();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.db.run(
            "UPDATE sync_queue SET status = 'failed', last_error = ?, last_attempt_at = ? WHERE id = ?",
            [message, now(), row.id]
          );
          this.save();
          break;
        }
      }
    } finally {
      this.syncInProgress = false;
    }
    return this.getSyncStatus();
  }

  logoutAccount(force = false) {
    const openShift = this.getCurrentShift();
    if (openShift) {
      throw new Error("Сначала закройте смену, потом можно выйти из аккаунта.");
    }
    if (this.scalar("SELECT COUNT(*) FROM suspended_receipts") > 0) {
      throw new Error("Сначала откройте или удалите отложенные чеки.");
    }
    if (!force && this.getSyncStatus().total > 0) {
      throw new Error("Есть неотправленные данные. Сначала подключите интернет и синхронизируйте кассу.");
    }
    this.db.run("BEGIN TRANSACTION");
    try {
      this.db.run("DELETE FROM categories");
      this.db.run("DELETE FROM products");
      this.db.run("DELETE FROM employees");
      this.db.run("DELETE FROM customers");
      this.db.run("DELETE FROM debt_transactions");
      this.db.run("DELETE FROM sync_queue");
      this.db.run("DELETE FROM settings WHERE key IN ('accountId','accountName','storeId','storeName','registerId','registerName','activationKey','activatedAt','lastSyncAt','currency')");
      this.db.run("COMMIT");
      this.save();
      return true;
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }

  getCategories() {
    return this.all<Category>(
      `SELECT id, name, icon, color, sort_order as sortOrder, image_data as imageData
       FROM categories
       ORDER BY sort_order ASC`
    );
  }

  listProducts(search = "") {
    const trimmed = search.trim();
    const sql = `SELECT id, category_id as categoryId, name, unit, sale_price as price,
        purchase_price as purchasePrice, sale_price as salePrice, stock, barcode,
        extra_barcodes as extraBarcodes, sku, image_data as imageData
       FROM products`;
    const normalizeProduct = (product: Product) => ({
      ...product,
      extraBarcodes: parseExtraBarcodes(product.extraBarcodes)
    });
    const rows = trimmed
      ? this.all<Product>(
          `${sql}
           WHERE name LIKE ? OR barcode LIKE ? OR sku LIKE ? OR extra_barcodes LIKE ?
           ORDER BY name ASC`,
          [`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`]
        )
      : this.all<Product>(`${sql} ORDER BY name ASC`);
    return rows.map(normalizeProduct);
  }

  createProductFromCash(input: CashProductInput) {
    const binding = this.getBinding();
    if (!binding) {
      throw new Error("Касса не привязана к аккаунту.");
    }
    const barcode = normalizeBarcode(input.barcode);
    if (!barcode) {
      throw new Error("Укажите штрихкод товара.");
    }
    const name = input.name.trim();
    if (!name) {
      throw new Error("Укажите название товара.");
    }
    const salePrice = roundMoney(Number(input.salePrice || 0));
    if (salePrice <= 0) {
      throw new Error("Цена продажи должна быть больше 0.");
    }
    const duplicate = this.listProducts().find((product) =>
      product.barcode === barcode || product.sku === barcode || (product.extraBarcodes ?? []).includes(barcode)
    );
    if (duplicate) {
      throw new Error(`Штрихкод уже привязан к товару: ${duplicate.name}`);
    }
    const categories = this.getCategories();
    const categoryId = categories.some((category) => category.id === input.categoryId)
      ? input.categoryId
      : categories[0]?.id ?? "uncategorized";
    const id = `cash-prod-${Date.now()}`;
    const sku = `CASH-${String(this.scalar("SELECT COUNT(*) FROM products") + 1).padStart(5, "0")}`;
    const product: Product = {
      id,
      categoryId,
      name,
      unit: input.unit || "шт",
      price: salePrice,
      purchasePrice: roundMoney(Number(input.purchasePrice || 0)),
      salePrice,
      stock: 0,
      barcode,
      extraBarcodes: [],
      sku
    };
    this.db.run(
      `INSERT INTO products
        (id, category_id, name, unit, price, purchase_price, sale_price, stock, barcode, extra_barcodes, sku, image_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, '')`,
      [
        product.id,
        product.categoryId,
        product.name,
        product.unit,
        product.price,
        product.purchasePrice,
        product.salePrice,
        product.barcode,
        JSON.stringify(product.extraBarcodes),
        product.sku
      ]
    );
    this.save();
    this.syncProduct(product);
    return product;
  }

  updateProductPrice(input: ProductPriceUpdateInput) {
    const product = this.listProducts().find((item) => item.id === input.productId);
    if (!product) {
      throw new Error("Товар не найден.");
    }
    const salePrice = roundMoney(Number(input.salePrice || 0));
    if (salePrice <= 0) {
      throw new Error("Цена продажи должна быть больше 0.");
    }
    this.db.run("UPDATE products SET price = ?, sale_price = ? WHERE id = ?", [salePrice, salePrice, input.productId]);
    this.save();
    const updated = this.listProducts().find((item) => item.id === input.productId);
    if (!updated) {
      throw new Error("Не удалось обновить цену товара.");
    }
    this.syncProduct(updated);
    return updated;
  }

  getEmployees() {
    const binding = this.getBinding();
    const rows = this.all<CashEmployee>(
      `SELECT id, name, role, pin, can_login_cash as canLoginCash, allowed_store_ids as allowedStoreIds
       FROM employees
       ORDER BY name ASC`
    );
    return rows
      .map((employee) => ({
        ...employee,
        canLoginCash: toBool(employee.canLoginCash),
        allowedStoreIds: typeof employee.allowedStoreIds === "string"
          ? JSON.parse(employee.allowedStoreIds || "[]")
          : employee.allowedStoreIds
      }))
      .filter((employee) => employee.canLoginCash && (!binding || employee.allowedStoreIds.includes(binding.storeId)));
  }

  listCustomers(search = "") {
    const trimmed = search.trim();
    const sql = `SELECT id, name, phone, comment, debt_balance as debtBalance,
        created_at as createdAt, updated_at as updatedAt
       FROM customers`;
    if (!trimmed) {
      return this.all<Customer>(`${sql} ORDER BY name ASC`);
    }
    return this.all<Customer>(
      `${sql}
       WHERE name LIKE ? OR phone LIKE ?
       ORDER BY name ASC`,
      [`%${trimmed}%`, `%${trimmed}%`]
    );
  }

  saveCustomer(input: { id?: string; name: string; phone: string; comment: string }) {
    const timestamp = now();
    const id = input.id || `cust-${Date.now()}`;
    const current = input.id ? this.get<Customer>("SELECT id, name, phone, comment, debt_balance as debtBalance, created_at as createdAt, updated_at as updatedAt FROM customers WHERE id = ?", [input.id]) : null;
    this.db.run(
      `INSERT OR REPLACE INTO customers
        (id, name, phone, comment, debt_balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name.trim(),
        input.phone.trim(),
        input.comment.trim(),
        current?.debtBalance ?? 0,
        current?.createdAt ?? timestamp,
        timestamp
      ]
    );
    this.save();
    const saved = this.listCustomers().find((customer) => customer.id === id) ?? null;
    if (saved) {
      this.syncCustomer(saved);
    }
    return saved;
  }

  listDebtors() {
    return this.all<Customer>(
      `SELECT id, name, phone, comment, debt_balance as debtBalance,
        created_at as createdAt, updated_at as updatedAt
       FROM customers
       WHERE ABS(debt_balance) > 0.009
       ORDER BY debt_balance DESC, name ASC`
    );
  }

  listDebtTransactions(customerId?: string) {
    if (customerId) {
      return this.all<DebtTransaction>(
        `SELECT id, customer_id as customerId, customer_name as customerName, type, payment_method as paymentMethod,
          shift_id as shiftId, receipt_id as receiptId, amount, comment, created_at as createdAt
         FROM debt_transactions
         WHERE customer_id = ?
         ORDER BY created_at DESC`,
        [customerId]
      );
    }
    return this.all<DebtTransaction>(
      `SELECT id, customer_id as customerId, customer_name as customerName, type, payment_method as paymentMethod,
        shift_id as shiftId, receipt_id as receiptId, amount, comment, created_at as createdAt
       FROM debt_transactions
       ORDER BY created_at DESC`
    );
  }

  payDebt(input: PayDebtInput) {
    const shift = this.getCurrentShift();
    if (!shift) {
      throw new Error("Смена не открыта.");
    }
    const customer = this.listCustomers().find((item) => item.id === input.customerId);
    if (!customer) {
      throw new Error("Клиент не найден.");
    }
    const amount = roundMoney(Math.min(Math.max(0, input.amount), Math.max(0, customer.debtBalance)));
    if (amount <= 0) {
      throw new Error("Укажите сумму погашения.");
    }
    const timestamp = now();
    this.db.run(
      `INSERT INTO debt_transactions
        (customer_id, customer_name, type, payment_method, shift_id, receipt_id, amount, comment, created_at)
       VALUES (?, ?, 'payment', ?, ?, NULL, ?, ?, ?)`,
      [customer.id, customer.name, input.paymentMethod, shift.id, amount, input.comment, timestamp]
    );
    const transactionId = this.lastInsertId();
    this.db.run("UPDATE customers SET debt_balance = debt_balance - ?, updated_at = ? WHERE id = ?", [amount, timestamp, customer.id]);
    this.save();
    const transaction = this.listDebtTransactions(customer.id).find((item) => item.id === transactionId);
    if (transaction) {
      this.syncDebtTransaction(transaction, input.cashier);
      const updatedCustomer = this.listCustomers().find((item) => item.id === customer.id);
      if (updatedCustomer) {
        this.syncCustomer(updatedCustomer);
      }
      this.syncShiftReport(this.getShiftSummary(shift.id));
    }
    return {
      customer: this.listCustomers().find((item) => item.id === customer.id) ?? customer,
      transaction
    };
  }

  getCurrentShift() {
    return (
      this.get<Shift>(
        `SELECT id, cashier, cashier_id as cashierId, opening_cash as openingCash,
          closing_cash as closingCash, cash_difference as cashDifference, opened_at as openedAt,
          closed_at as closedAt, comment, status
         FROM shifts
         WHERE status = 'open'
         ORDER BY id DESC
         LIMIT 1`
      ) ?? null
    );
  }

  openShift(input: OpenShiftInput) {
    const current = this.getCurrentShift();
    if (current) {
      return current;
    }
    this.db.run(
      `INSERT INTO shifts (cashier, cashier_id, opening_cash, opened_at, closed_at, comment, status)
       VALUES (?, ?, ?, ?, NULL, ?, 'open')`,
      [input.cashier, input.cashierId ?? "", input.openingCash, now(), input.comment]
    );
    this.save();
    const opened = this.getCurrentShift();
    if (opened) {
      this.syncShiftReport(this.getShiftSummary(opened.id));
    }
    return opened;
  }

  closeShift(input: CloseShiftInput) {
    const shift = this.getCurrentShift();
    if (!shift) {
      throw new Error("Открытая смена не найдена.");
    }
    const preview = this.getShiftSummary(shift.id);
    const actualCash = roundMoney(input.actualCash);
    const difference = roundMoney(actualCash - preview.expectedCash);
    this.db.run(
      "UPDATE shifts SET closed_at = ?, status = 'closed', closing_cash = ?, cash_difference = ? WHERE id = ?",
      [now(), actualCash, difference, shift.id]
    );
    this.save();
    const summary = this.getShiftSummary(shift.id);
    this.syncShiftReport(summary);
    return summary;
  }

  getShiftSummary(shiftId: number) {
    const shift = this.get<Shift>(
      `SELECT id, cashier, cashier_id as cashierId, opening_cash as openingCash,
        closing_cash as closingCash, cash_difference as cashDifference, opened_at as openedAt,
        closed_at as closedAt, comment, status
       FROM shifts WHERE id = ?`,
      [shiftId]
    );
    if (!shift) {
      throw new Error("Смена не найдена.");
    }
    const rows = this.all<{ paymentMethod: string; total: number; status: string }>(
      `SELECT payment_method as paymentMethod, total, status FROM receipts WHERE shift_id = ? AND status IN ('paid', 'returned')`,
      [shiftId]
    );
    const debtRows = this.all<{ type: string; paymentMethod: string; amount: number }>(
      `SELECT type, payment_method as paymentMethod, amount
       FROM debt_transactions
       WHERE shift_id = ?`,
      [shiftId]
    );
    const paidRows = rows.filter((row) => row.status === "paid");
    const returnRows = rows.filter((row) => row.status === "returned");
    const paidSaleRows = paidRows.filter((row) => row.paymentMethod !== "debt");
    const nonDebtReturns = returnRows.filter((row) => row.paymentMethod !== "debt");
    const summary: ShiftSummary = {
      shift,
      revenue: roundMoney(
        paidSaleRows.reduce((sum, row) => sum + row.total, 0) -
        nonDebtReturns.reduce((sum, row) => sum + row.total, 0) +
        debtRows.filter((row) => row.type === "payment").reduce((sum, row) => sum + row.amount, 0)
      ),
      cash: roundMoney(
        paidRows.filter((row) => row.paymentMethod === "cash").reduce((sum, row) => sum + row.total, 0) -
        returnRows.filter((row) => row.paymentMethod === "cash").reduce((sum, row) => sum + row.total, 0)
      ),
      card: roundMoney(
        paidRows.filter((row) => row.paymentMethod === "card").reduce((sum, row) => sum + row.total, 0) -
        returnRows.filter((row) => row.paymentMethod === "card").reduce((sum, row) => sum + row.total, 0)
      ),
      qr: roundMoney(
        paidRows.filter((row) => row.paymentMethod === "qr").reduce((sum, row) => sum + row.total, 0) -
        returnRows.filter((row) => row.paymentMethod === "qr").reduce((sum, row) => sum + row.total, 0)
      ),
      debtIssued: roundMoney(
        paidRows.filter((row) => row.paymentMethod === "debt").reduce((sum, row) => sum + row.total, 0) -
        returnRows.filter((row) => row.paymentMethod === "debt").reduce((sum, row) => sum + row.total, 0)
      ),
      debtPaidCash: roundMoney(debtRows.filter((row) => row.type === "payment" && row.paymentMethod === "cash").reduce((sum, row) => sum + row.amount, 0)),
      debtPaidCard: roundMoney(debtRows.filter((row) => row.type === "payment" && row.paymentMethod === "card").reduce((sum, row) => sum + row.amount, 0)),
      debtPaidQr: roundMoney(debtRows.filter((row) => row.type === "payment" && row.paymentMethod === "qr").reduce((sum, row) => sum + row.amount, 0)),
      totalReceived: 0,
      receiptsCount: paidRows.length,
      returnsTotal: roundMoney(returnRows.reduce((sum, row) => sum + row.total, 0)),
      expectedCash: 0,
      actualCash: 0,
      difference: 0
    };
    summary.totalReceived = roundMoney(summary.cash + summary.card + summary.qr + summary.debtPaidCash + summary.debtPaidCard + summary.debtPaidQr);
    summary.expectedCash = roundMoney(shift.openingCash + summary.cash + summary.debtPaidCash);
    summary.actualCash = roundMoney(shift.closingCash ?? summary.expectedCash);
    summary.difference = roundMoney(shift.cashDifference ?? summary.actualCash - summary.expectedCash);
    return summary;
  }

  getNextReceiptNumber() {
    const row = this.get<{ maxNumber: number | null }>(
      `SELECT MAX(number_value) as maxNumber
       FROM (
        SELECT CAST(number AS INTEGER) as number_value FROM receipts
        UNION ALL
        SELECT CAST(number AS INTEGER) as number_value FROM suspended_receipts
        UNION ALL
        SELECT 10244 as number_value
       )`
    );
    return String((row?.maxNumber ?? 10244) + 1);
  }

  createReceipt(input: CreateReceiptInput) {
    const shift = this.getCurrentShift();
    if (!shift) {
      throw new Error("Смена не открыта.");
    }
    if (!input.items.length) {
      throw new Error("Чек пустой.");
    }
    const subtotal = roundMoney(input.items.reduce((sum, item) => sum + item.price * item.qty, 0));
    const itemDiscount = roundMoney(input.items.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0));
    const discount = roundMoney(input.discount);
    const total = roundMoney(Math.max(0, subtotal - itemDiscount - discount));
    const customer = input.customerId
      ? this.listCustomers().find((item) => item.id === input.customerId)
      : null;
    if (input.paymentMethod === "debt" && !customer) {
      throw new Error("Для продажи в долг выберите клиента.");
    }
    const number = input.number?.trim() || this.getNextReceiptNumber();
    const paidAmount = input.paymentMethod === "cash" ? roundMoney(input.paidAmount ?? total) : input.paymentMethod === "debt" ? 0 : total;
    const changeAmount = input.paymentMethod === "cash" ? roundMoney(input.changeAmount ?? Math.max(0, paidAmount - total)) : 0;

    this.db.run("BEGIN TRANSACTION");
    try {
      this.db.run(
        `INSERT INTO receipts
          (number, shift_id, cashier, payment_method, subtotal, discount, discount_type, discount_value,
           customer_id, customer_name, debt_amount, total, paid_amount, change_amount, status, created_at, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)`,
        [
          number,
          shift.id,
          input.cashier,
          input.paymentMethod,
          subtotal,
          discount + itemDiscount,
          input.discountType ?? "none",
          input.discountValue ?? 0,
          customer?.id ?? "",
          customer?.name ?? "",
          input.paymentMethod === "debt" ? total : 0,
          total,
          paidAmount,
          changeAmount,
          now(),
          input.comment
        ]
      );
      const receiptId = this.lastInsertId();
      for (const item of input.items) {
        this.db.run(
          `INSERT INTO receipt_items
            (receipt_id, product_id, name, qty, unit, price, discount_type, discount_value, discount_amount, total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            receiptId,
            item.productId,
            item.name,
            item.qty,
            item.unit,
            item.price,
            item.discountType ?? "none",
            item.discountValue ?? 0,
            item.discountAmount ?? 0,
            item.total
          ]
        );
        this.db.run("UPDATE products SET stock = stock - ? WHERE id = ?", [item.qty, item.productId]);
      }
      if (input.paymentMethod === "debt" && customer) {
        this.db.run(
          `INSERT INTO debt_transactions
            (customer_id, customer_name, type, payment_method, shift_id, receipt_id, amount, comment, created_at)
           VALUES (?, ?, 'sale', NULL, ?, ?, ?, ?, ?)`,
          [customer.id, customer.name, shift.id, receiptId, total, `Чек № ${number}`, now()]
        );
        this.db.run("UPDATE customers SET debt_balance = debt_balance + ?, updated_at = ? WHERE id = ?", [total, now(), customer.id]);
      }
      this.db.run("COMMIT");
      this.save();
      const receipt = this.getReceipt(receiptId);
      if (receipt) {
        this.syncSale(receipt, input.items);
        this.syncShiftReport(this.getShiftSummary(shift.id));
        if (input.paymentMethod === "debt" && customer) {
          const debtTransaction = this.listDebtTransactions(customer.id).find((item) => item.receiptId === receiptId);
          if (debtTransaction) {
            this.syncDebtTransaction(debtTransaction, input.cashier);
          }
          const updatedCustomer = this.listCustomers().find((item) => item.id === customer.id);
          if (updatedCustomer) {
            this.syncCustomer(updatedCustomer);
          }
        }
      }
      return receipt;
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }

  createReturn(input: ReturnReceiptInput) {
    const shift = this.getCurrentShift();
    if (!shift) {
      throw new Error("Смена не открыта.");
    }
    if (!input.items.length) {
      throw new Error("Выберите товары для возврата.");
    }
    const original = this.getReceipt(input.originalReceiptId);
    if (!original || original.status !== "paid") {
      throw new Error("Исходный чек не найден или уже является возвратом.");
    }
    const subtotal = roundMoney(input.items.reduce((sum, item) => sum + item.price * item.qty, 0));
    const discount = roundMoney(input.items.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0));
    const total = roundMoney(Math.max(0, input.items.reduce((sum, item) => sum + item.total, 0)));
    const originalItems = this.getReceiptItems(original.id);
    const returnedByProduct = new Map(
      this.all<{ productId: string; qty: number }>(
        `SELECT ri.product_id as productId, COALESCE(SUM(ri.qty), 0) as qty
         FROM receipt_items ri
         JOIN receipts r ON r.id = ri.receipt_id
         WHERE r.original_receipt_id = ? AND r.status = 'returned'
         GROUP BY ri.product_id`,
        [original.id]
      ).map((row) => [row.productId, Number(row.qty || 0)])
    );
    for (const item of input.items) {
      const originalItem = originalItems.find((row) => row.productId === item.productId);
      const returnedQty = returnedByProduct.get(item.productId) ?? 0;
      const remaining = roundQty((originalItem?.qty ?? 0) - returnedQty);
      if (!originalItem || item.qty <= 0 || item.qty > remaining + 0.0001) {
        throw new Error("Количество возврата больше доступного остатка по исходному чеку.");
      }
    }
    const number = this.getNextReceiptNumber();
    this.db.run("BEGIN TRANSACTION");
    try {
      this.db.run(
        `INSERT INTO receipts
          (number, shift_id, cashier, payment_method, subtotal, discount, discount_type, discount_value,
           customer_id, customer_name, debt_amount, total, paid_amount, change_amount, status, created_at, comment,
           original_receipt_id, original_receipt_number, return_reason, return_payment_method)
         VALUES (?, ?, ?, ?, ?, ?, 'none', 0, ?, ?, ?, ?, ?, 0, 'returned', ?, ?, ?, ?, ?, ?)`,
        [
          number,
          shift.id,
          input.cashier,
          input.paymentMethod,
          subtotal,
          discount,
          original.customerId ?? "",
          original.customerName ?? "",
          input.paymentMethod === "debt" ? total : 0,
          total,
          input.paymentMethod === "cash" ? total : 0,
          now(),
          input.reason,
          original.id,
          original.number,
          input.reason,
          input.paymentMethod
        ]
      );
      const receiptId = this.lastInsertId();
      for (const item of input.items) {
        this.db.run(
          `INSERT INTO receipt_items
            (receipt_id, product_id, name, qty, unit, price, discount_type, discount_value, discount_amount, total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            receiptId,
            item.productId,
            item.name,
            item.qty,
            item.unit,
            item.price,
            item.discountType ?? "none",
            item.discountValue ?? 0,
            item.discountAmount ?? 0,
            item.total
          ]
        );
        this.db.run("UPDATE products SET stock = stock + ? WHERE id = ?", [item.qty, item.productId]);
      }
      if (input.paymentMethod === "debt" && original.customerId) {
        const customer = this.listCustomers().find((item) => item.id === original.customerId);
        if (customer) {
          this.db.run(
            `INSERT INTO debt_transactions
              (customer_id, customer_name, type, payment_method, shift_id, receipt_id, amount, comment, created_at)
             VALUES (?, ?, 'payment', NULL, ?, ?, ?, ?, ?)`,
            [customer.id, customer.name, shift.id, receiptId, total, `Возврат по чеку № ${original.number}`, now()]
          );
          this.db.run("UPDATE customers SET debt_balance = debt_balance - ?, updated_at = ? WHERE id = ?", [total, now(), customer.id]);
        }
      }
      this.db.run("COMMIT");
      this.save();
      const receipt = this.getReceipt(receiptId);
      if (receipt) {
        this.syncSale(receipt, input.items);
        this.syncShiftReport(this.getShiftSummary(shift.id));
        if (input.paymentMethod === "debt" && original.customerId) {
          const debtTransaction = this.listDebtTransactions(original.customerId).find((item) => item.receiptId === receiptId);
          if (debtTransaction) {
            this.syncDebtTransaction(debtTransaction, input.cashier);
          }
          const customer = this.listCustomers().find((item) => item.id === original.customerId);
          if (customer) {
            this.syncCustomer(customer);
          }
        }
      }
      return receipt;
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }

  listReceipts() {
    return this.all<Receipt>(
      `SELECT id, number, shift_id as shiftId, cashier, payment_method as paymentMethod,
        subtotal, discount, discount_type as discountType, discount_value as discountValue,
        customer_id as customerId, customer_name as customerName, debt_amount as debtAmount,
        total, paid_amount as paidAmount, change_amount as changeAmount,
        status, created_at as createdAt, comment,
        original_receipt_id as originalReceiptId, original_receipt_number as originalReceiptNumber,
        return_reason as returnReason, return_payment_method as returnPaymentMethod
       FROM receipts
       ORDER BY created_at DESC`
    );
  }

  getReceiptItems(receiptId: number) {
    return this.all<ReceiptItem>(
      `SELECT id, receipt_id as receiptId, product_id as productId, name, qty, unit, price,
        discount_type as discountType, discount_value as discountValue,
        discount_amount as discountAmount, total
       FROM receipt_items
       WHERE receipt_id = ?
       ORDER BY id ASC`,
      [receiptId]
    );
  }

  suspendReceipt(input: SuspendReceiptInput) {
    if (!input.items.length) {
      throw new Error("Нельзя отложить пустой чек.");
    }
    const number = this.getNextReceiptNumber();
    const total = roundMoney(input.items.reduce((sum, item) => sum + item.total, 0));
    const payload: RestoreSuspendedResult = { number, items: input.items, cashier: input.cashier, comment: input.comment };
    const timestamp = now();
    this.db.run(
      `INSERT INTO suspended_receipts
        (number, payload, items_count, total, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [number, JSON.stringify(payload), input.items.length, total, input.comment, timestamp, timestamp]
    );
    this.save();
    return this.listSuspendedReceipts().find((receipt) => receipt.number === number) ?? null;
  }

  listSuspendedReceipts(search = "") {
    const trimmed = search.trim();
    if (!trimmed) {
      return this.all<SuspendedReceipt>(
        `SELECT id, number, items_count as itemsCount, total, comment, created_at as createdAt,
          updated_at as updatedAt
         FROM suspended_receipts
         ORDER BY created_at DESC`
      );
    }
    return this.all<SuspendedReceipt>(
      `SELECT id, number, items_count as itemsCount, total, comment, created_at as createdAt,
        updated_at as updatedAt
       FROM suspended_receipts
       WHERE number LIKE ? OR comment LIKE ?
       ORDER BY created_at DESC`,
      [`%${trimmed}%`, `%${trimmed}%`]
    );
  }

  restoreSuspendedReceipt(id: number) {
    const row = this.get<{ payload: string }>("SELECT payload FROM suspended_receipts WHERE id = ?", [id]);
    if (!row) {
      throw new Error("Отложенный чек не найден.");
    }
    this.db.run("DELETE FROM suspended_receipts WHERE id = ?", [id]);
    this.save();
    return JSON.parse(row.payload) as RestoreSuspendedResult;
  }

  deleteSuspendedReceipt(id: number) {
    this.db.run("DELETE FROM suspended_receipts WHERE id = ?", [id]);
    this.save();
    return true;
  }

  getDevices() {
    return this.all<Device>(
      `SELECT id, name, subtitle, port, status, enabled, updated_at as updatedAt
       FROM devices
       ORDER BY sort_order ASC`
    ).map((device) => ({ ...device, enabled: toBool(device.enabled) }));
  }

  updateDevice(input: Partial<Device> & { id: string }) {
    const current = this.getDevices().find((device) => device.id === input.id);
    if (!current) {
      throw new Error("Устройство не найдено.");
    }
    const enabled = input.enabled ?? current.enabled;
    this.db.run(
      `UPDATE devices SET port = ?, status = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      [input.port ?? current.port, input.status ?? current.status, enabled ? 1 : 0, now(), input.id]
    );
    this.save();
    return this.getDevices().find((device) => device.id === input.id) ?? null;
  }

  private importSnapshot(snapshot: CashImportSnapshot) {
    this.db.run("BEGIN TRANSACTION");
    try {
      this.db.run("DELETE FROM categories");
      this.db.run("DELETE FROM products");
      this.db.run("DELETE FROM employees");
      this.db.run("DELETE FROM customers");
      for (const category of snapshot.categories) {
        this.db.run(
          `INSERT INTO categories (id, name, icon, color, sort_order, image_data)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [category.id, category.name, category.icon, category.color, category.sortOrder, category.imageData ?? ""]
        );
      }
      for (const product of snapshot.products) {
        const stock = product.stockByStore[snapshot.store.id] ?? 0;
        this.db.run(
          `INSERT INTO products
            (id, category_id, name, unit, price, purchase_price, sale_price, stock, barcode, extra_barcodes, sku, image_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            product.id,
            product.categoryId,
            product.name,
            product.unit,
            product.salePrice,
            product.purchasePrice,
            product.salePrice,
            stock,
            product.barcode,
            JSON.stringify(parseExtraBarcodes(product.extraBarcodes)),
            product.sku,
            product.imageData ?? ""
          ]
        );
      }
      for (const employee of snapshot.employees) {
        this.db.run(
          `INSERT INTO employees (id, name, role, pin, can_login_cash, allowed_store_ids)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            employee.id,
            employee.name,
            employee.role,
            employee.pin,
            employee.canLoginCash ? 1 : 0,
            JSON.stringify(employee.allowedStoreIds)
          ]
        );
      }
      for (const customer of snapshot.customers ?? []) {
        this.db.run(
          `INSERT INTO customers (id, name, phone, comment, debt_balance, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            customer.id,
            customer.name,
            customer.phone,
            customer.comment,
            customer.debtBalance ?? 0,
            customer.createdAt,
            customer.updatedAt
          ]
        );
      }
      this.setSetting("accountId", snapshot.account.id);
      this.setSetting("accountName", snapshot.account.name);
      this.setSetting("storeId", snapshot.store.id);
      this.setSetting("storeName", snapshot.store.name);
      this.setSetting("registerId", snapshot.register.id);
      this.setSetting("registerName", snapshot.register.name);
      this.setSetting("deviceId", this.getDeviceId());
      this.setSetting("activationKey", snapshot.activationKey);
      this.setSetting("activatedAt", this.getSetting("activatedAt") || now());
      this.setSetting("lastSyncAt", snapshot.syncedAt);
      this.setSetting("currency", snapshot.account.settings.currency);
      const receiptSettings = snapshot.register.receiptSettings;
      this.setSetting("receiptTemplate", receiptSettings?.template || snapshot.account.settings.receiptTemplate || "Стандартный");
      this.setSetting("receiptShowQr", "0");
      this.setSetting("receiptHeader", receiptSettings?.header || snapshot.store.name || snapshot.account.name);
      this.setSetting("receiptFooter", receiptSettings?.footer || "Спасибо за покупку");
      this.db.run("COMMIT");
      this.save();
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }

  private syncSale(receipt: Receipt, items: CartItem[]) {
    const binding = this.getBinding();
    if (!binding) {
      return;
    }
    const costTotal = roundMoney(items.reduce((sum, item) => sum + (item.purchasePrice ?? 0) * item.qty, 0));
    const isReturn = receipt.status === "returned";
    const saleTime = Number.isFinite(Date.parse(receipt.createdAt)) ? Date.parse(receipt.createdAt) : Date.now();
    const saleId = `sale-${binding.registerId}-${receipt.number}-${saleTime}-${receipt.id}`;
    const sale: AdminSale = {
      id: saleId,
      number: receipt.number,
      shiftId: `${binding.registerId}-${receipt.shiftId}`,
      accountId: binding.accountId,
      storeId: binding.storeId,
      registerId: binding.registerId,
      cashier: receipt.cashier,
      paymentMethod: receipt.paymentMethod,
      total: receipt.total,
      discount: receipt.discount,
      customerId: receipt.customerId,
      customerName: receipt.customerName,
      debtAmount: receipt.debtAmount,
      costTotal,
      paidAmount: receipt.paidAmount,
      changeAmount: receipt.changeAmount,
      type: isReturn ? "return" : "sale",
      originalSaleId: receipt.originalReceiptId ? `sale-${binding.registerId}-${receipt.originalReceiptId}` : undefined,
      returnReason: receipt.returnReason,
      returnPaymentMethod: receipt.returnPaymentMethod,
      createdAt: receipt.createdAt,
      items: items.map((item) => ({
        productId: item.productId,
        name: item.name,
        qty: item.qty,
        purchasePrice: item.purchasePrice ?? 0,
        salePrice: item.price,
        discountAmount: item.discountAmount ?? 0,
        costTotal: roundMoney((item.purchasePrice ?? 0) * item.qty),
        total: item.total
      }))
    };
    this.enqueueSyncEvent("sale", binding.accountId, sale);
  }

  private syncDebtTransaction(transaction: DebtTransaction, cashier: string) {
    const binding = this.getBinding();
    if (!binding) {
      return;
    }
    const adminTransaction: AdminDebtTransaction = {
      id: `${binding.registerId}-debt-${transaction.id}`,
      customerId: transaction.customerId,
      customerName: transaction.customerName,
      type: transaction.type,
      paymentMethod: transaction.paymentMethod === "cash" || transaction.paymentMethod === "card" || transaction.paymentMethod === "qr"
        ? transaction.paymentMethod
        : undefined,
      shiftId: `${binding.registerId}-${transaction.shiftId}`,
      receiptId: transaction.receiptId ? `${transaction.receiptId}` : undefined,
      accountId: binding.accountId,
      storeId: binding.storeId,
      registerId: binding.registerId,
      cashier,
      amount: transaction.amount,
      comment: transaction.comment,
      createdAt: transaction.createdAt
    };
    this.enqueueSyncEvent("debtTransaction", binding.accountId, adminTransaction);
  }

  private syncCustomer(customer: Customer) {
    const binding = this.getBinding();
    if (!binding) {
      return;
    }
    const adminCustomer: AdminCustomer = {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      comment: customer.comment,
      debtBalance: customer.debtBalance,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt
    };
    this.enqueueSyncEvent("customer", binding.accountId, adminCustomer);
  }

  private syncProduct(product: Product) {
    const binding = this.getBinding();
    if (!binding) {
      return;
    }
    this.enqueueSyncEvent("product", binding.accountId, {
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      unit: product.unit,
      barcode: product.barcode,
      extraBarcodes: product.extraBarcodes ?? [],
      sku: product.sku,
      purchasePrice: product.purchasePrice,
      salePrice: product.salePrice,
      stockByStore: { [binding.storeId]: product.stock },
      createdFromCash: true,
      storeId: binding.storeId,
      registerId: binding.registerId,
      createdAt: now()
    });
  }

  private syncShiftReport(summary: ShiftSummary) {
    const binding = this.getBinding();
    if (!binding) {
      return;
    }
    const sales = this.all<{ costTotal: number; total: number }>(
      `SELECT
        COALESCE(SUM(CASE WHEN r.status = 'returned' THEN -ri.qty * p.purchase_price ELSE ri.qty * p.purchase_price END), 0) as costTotal,
        COALESCE(SUM(CASE WHEN r.status = 'returned' THEN -ri.total ELSE ri.total END), 0) as total
       FROM receipt_items ri
       JOIN receipts r ON r.id = ri.receipt_id
       LEFT JOIN products p ON p.id = ri.product_id
       WHERE r.shift_id = ? AND r.status IN ('paid', 'returned')`,
      [summary.shift.id]
    )[0] ?? { costTotal: 0, total: 0 };
    const profit = roundMoney(summary.revenue - Number(sales.costTotal || 0));
    const report: AdminShiftReport = {
      id: `${binding.registerId}-${summary.shift.id}`,
      localShiftId: summary.shift.id,
      accountId: binding.accountId,
      storeId: binding.storeId,
      registerId: binding.registerId,
      registerName: this.getSetting("registerName") || binding.registerId,
      cashier: summary.shift.cashier,
      openingCash: summary.shift.openingCash,
      openedAt: summary.shift.openedAt,
      closedAt: summary.shift.closedAt,
      status: summary.shift.status,
      revenue: summary.revenue,
      cash: summary.cash,
      card: summary.card,
      qr: summary.qr,
      debtIssued: summary.debtIssued,
      debtPaidCash: summary.debtPaidCash,
      debtPaidCard: summary.debtPaidCard,
      debtPaidQr: summary.debtPaidQr,
      totalReceived: summary.totalReceived,
      expenses: 0,
      closingCash: summary.actualCash,
      difference: summary.difference,
      profit,
      receiptsCount: summary.receiptsCount,
      returnsTotal: summary.returnsTotal
    };
    this.enqueueSyncEvent("shiftReport", binding.accountId, report);
  }

  private enqueueSyncEvent(eventType: SyncEventType, accountId: string, payload: { id: string | number; [key: string]: unknown }) {
    const eventId = `${eventType}:${String(payload.id)}`;
    this.db.run(
      `INSERT INTO sync_queue
        (event_id, event_type, account_id, payload, status, attempts, last_error, created_at, last_attempt_at, synced_at)
       VALUES (?, ?, ?, ?, 'pending', 0, '', ?, '', '')
       ON CONFLICT(event_id) DO UPDATE SET
        payload = excluded.payload,
        status = 'pending',
        last_error = '',
        last_attempt_at = '',
        synced_at = ''`,
      [eventId, eventType, accountId, JSON.stringify(payload), now()]
    );
    this.save();
  }

  private getReceipt(id: number) {
    return (
      this.get<Receipt>(
        `SELECT id, number, shift_id as shiftId, cashier, payment_method as paymentMethod,
          subtotal, discount, discount_type as discountType, discount_value as discountValue,
          customer_id as customerId, customer_name as customerName, debt_amount as debtAmount,
          total, paid_amount as paidAmount, change_amount as changeAmount,
          status, created_at as createdAt, comment,
          original_receipt_id as originalReceiptId, original_receipt_number as originalReceiptNumber,
          return_reason as returnReason, return_payment_method as returnPaymentMethod
         FROM receipts
         WHERE id = ?`,
        [id]
      ) ?? null
    );
  }

  private createSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        color TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        image_data TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL,
        name TEXT NOT NULL,
        unit TEXT NOT NULL,
        price REAL NOT NULL,
        purchase_price REAL NOT NULL DEFAULT 0,
        sale_price REAL NOT NULL DEFAULT 0,
        stock REAL NOT NULL DEFAULT 0,
        barcode TEXT NOT NULL,
        extra_barcodes TEXT NOT NULL DEFAULT '[]',
        sku TEXT NOT NULL,
        image_data TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cashier TEXT NOT NULL,
        cashier_id TEXT NOT NULL DEFAULT '',
        opening_cash REAL NOT NULL,
        closing_cash REAL,
        cash_difference REAL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        comment TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL UNIQUE,
        shift_id INTEGER NOT NULL,
        cashier TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        subtotal REAL NOT NULL,
        discount REAL NOT NULL,
        discount_type TEXT NOT NULL DEFAULT 'none',
        discount_value REAL NOT NULL DEFAULT 0,
        customer_id TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        debt_amount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        paid_amount REAL NOT NULL DEFAULT 0,
        change_amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        comment TEXT NOT NULL,
        original_receipt_id INTEGER,
        original_receipt_number TEXT NOT NULL DEFAULT '',
        return_reason TEXT NOT NULL DEFAULT '',
        return_payment_method TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS receipt_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_id INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        name TEXT NOT NULL,
        qty REAL NOT NULL,
        unit TEXT NOT NULL,
        price REAL NOT NULL,
        discount_type TEXT NOT NULL DEFAULT 'none',
        discount_value REAL NOT NULL DEFAULT 0,
        discount_amount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS suspended_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        items_count INTEGER NOT NULL,
        total REAL NOT NULL,
        comment TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        pin TEXT NOT NULL,
        can_login_cash INTEGER NOT NULL,
        allowed_store_ids TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        comment TEXT NOT NULL,
        debt_balance REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS debt_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        type TEXT NOT NULL,
        payment_method TEXT,
        shift_id INTEGER NOT NULL,
        receipt_id INTEGER,
        amount REAL NOT NULL,
        comment TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        account_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_attempt_at TEXT NOT NULL DEFAULT '',
        synced_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subtitle TEXT NOT NULL,
        port TEXT NOT NULL,
        status TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private migrateSchema() {
    this.tryRun("ALTER TABLE categories ADD COLUMN image_data TEXT NOT NULL DEFAULT ''");
    this.tryRun("ALTER TABLE products ADD COLUMN purchase_price REAL NOT NULL DEFAULT 0");
    this.tryRun("ALTER TABLE products ADD COLUMN sale_price REAL NOT NULL DEFAULT 0");
    this.tryRun("ALTER TABLE products ADD COLUMN stock REAL NOT NULL DEFAULT 0");
    this.tryRun("ALTER TABLE products ADD COLUMN extra_barcodes TEXT NOT NULL DEFAULT '[]'");
    this.tryRun("ALTER TABLE products ADD COLUMN image_data TEXT NOT NULL DEFAULT ''");
    this.tryRun("ALTER TABLE shifts ADD COLUMN cashier_id TEXT NOT NULL DEFAULT ''");
    this.tryRun("ALTER TABLE shifts ADD COLUMN closing_cash REAL");
    this.tryRun("ALTER TABLE shifts ADD COLUMN cash_difference REAL");
    this.tryRun("ALTER TABLE receipts ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0");
    this.tryRun("ALTER TABLE receipts ADD COLUMN change_amount REAL NOT NULL DEFAULT 0");
    this.tryRun("ALTER TABLE receipts ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'none'");
    this.tryRun("ALTER TABLE receipts ADD COLUMN discount_value REAL NOT NULL DEFAULT 0");
    this.tryRun("ALTER TABLE receipts ADD COLUMN customer_id TEXT NOT NULL DEFAULT ''");
    this.tryRun("ALTER TABLE receipts ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''");
    this.tryRun("ALTER TABLE receipts ADD COLUMN debt_amount REAL NOT NULL DEFAULT 0");
    this.tryRun("ALTER TABLE receipts ADD COLUMN original_receipt_id INTEGER");
    this.tryRun("ALTER TABLE receipts ADD COLUMN original_receipt_number TEXT NOT NULL DEFAULT ''");
    this.tryRun("ALTER TABLE receipts ADD COLUMN return_reason TEXT NOT NULL DEFAULT ''");
    this.tryRun("ALTER TABLE receipts ADD COLUMN return_payment_method TEXT NOT NULL DEFAULT ''");
    this.tryRun("ALTER TABLE receipt_items ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'none'");
    this.tryRun("ALTER TABLE receipt_items ADD COLUMN discount_value REAL NOT NULL DEFAULT 0");
    this.tryRun("ALTER TABLE receipt_items ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0");
    this.db.run("UPDATE products SET sale_price = price WHERE sale_price = 0");
  }

  private seedDevices() {
    if (this.scalar("SELECT COUNT(*) FROM devices") > 0) {
      return;
    }
    const devices = [
      ["scale", "Весы", "Весы Масса-К (USB)", "USB (COM3)", "connected", 1, 1],
      ["display", "Экран покупателя", "Второй экран или LED/VFD мини-дисплей", "Авто", "offline", 0, 2],
      ["printer", "Принтер чеков", "Windows-принтер по умолчанию", "Windows", "connected", 1, 3],
      ["scanner", "Сканер штрихкодов", "Клавиатурный USB-сканер", "USB (COM6)", "connected", 1, 4],
      ["terminal", "POS-терминал", "Безналичная оплата", "LAN (192.168.1.55)", "connected", 1, 5],
      ["qr", "QR-оплата", "Сервис QR-оплаты", "Интернет", "online", 1, 6]
    ];
    for (const device of devices) {
      this.db.run(
        `INSERT INTO devices (id, name, subtitle, port, status, enabled, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [...device, now()]
      );
    }
  }

  private normalizeDevices() {
    const labels = [
      ["scale", "Весы", "Весы Масса-К (USB)"],
      ["display", "Экран покупателя", "Второй экран или LED/VFD мини-дисплей"],
      ["printer", "Принтер чеков", "Windows-принтер по умолчанию"],
      ["scanner", "Сканер штрихкодов", "Клавиатурный USB-сканер"],
      ["terminal", "POS-терминал", "Безналичная оплата"],
      ["qr", "QR-оплата", "Сервис QR-оплаты"]
    ];
    for (const [id, name, subtitle] of labels) {
      this.db.run("UPDATE devices SET name = ?, subtitle = ? WHERE id = ?", [name, subtitle, id]);
    }
  }

  private setSetting(key: string, value: string) {
    this.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
  }

  private getSetting(key: string) {
    return this.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key])?.value ?? "";
  }

  getReceiptSettings() {
    return {
      template: this.getSetting("receiptTemplate") || "Стандартный",
      header: this.getSetting("receiptHeader") || this.getSetting("storeName") || this.getSetting("accountName") || "К-про",
      footer: this.getSetting("receiptFooter") || "Спасибо за покупку"
    };
  }

  private all<T>(sql: string, params: SqlValue[] = []) {
    const stmt = this.db.prepare(sql, params);
    const rows: T[] = [];
    try {
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private get<T>(sql: string, params: SqlValue[] = []) {
    return this.all<T>(sql, params)[0];
  }

  private scalar(sql: string, params: SqlValue[] = []) {
    const row = this.get<Record<string, number>>(sql, params);
    return Number(Object.values(row ?? { value: 0 })[0] ?? 0);
  }

  private lastInsertId() {
    return this.scalar("SELECT last_insert_rowid() as id");
  }

  private tryRun(sql: string) {
    try {
      this.db.run(sql);
    } catch {
      // Old local databases may already have the migration applied.
    }
  }

  private save() {
    const tmpPath = `${this.filePath}.tmp`;
    const backupPath = `${this.filePath}.bak`;
    fs.writeFileSync(tmpPath, Buffer.from(this.db.export()));
    if (fs.existsSync(this.filePath)) {
      fs.copyFileSync(this.filePath, backupPath);
    }
    try {
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      fs.copyFileSync(tmpPath, this.filePath);
      fs.unlinkSync(tmpPath);
    }
  }
}
