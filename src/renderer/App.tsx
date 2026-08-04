import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { BarcodeFormat, QRCodeWriter } from "@zxing/library";
import {
  Apple,
  BadgePercent,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Croissant,
  CupSoda,
  Fish,
  History,
  Info,
  KeyRound,
  LockKeyhole,
  Milk,
  Monitor,
  ClipboardPaste,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  ScanBarcode,
  Search,
  Settings,
  Shirt,
  ShoppingBasket,
  ShoppingCart,
  SlidersHorizontal,
  SprayCan,
  Trash2,
  Undo2,
  UserRound,
  WalletCards,
  X
} from "lucide-react";
import type {
  CashBinding,
  CashEmployee,
  CashProductInput,
  CartItem,
  Category,
  Customer,
  CustomerDisplayState,
  Device,
  DeviceUpdateInput,
  DiscountType,
  PaymentMethod,
  Product,
  QrPaymentOrder,
  Receipt,
  ReceiptItem,
  RestoreSuspendedResult,
  Shift,
  ShiftSummary,
  SyncStatus,
  SuspendedReceipt
} from "../shared/types";
import { lookupProductByBarcode, normalizeBarcode } from "../shared/barcodeLookup";

type View = "activation" | "shift" | "sale" | "suspended" | "history" | "debtors" | "settings";
type SettingsTab = "equipment" | "payment" | "interface" | "print";
type BusyTask = { title: string; message?: string };

const CASHIER = "Елена Петрова";
const BRAND_NAME = "К-про";
const APP_LOGO_SRC = "../k-pro-logo.png";
const UNCATEGORIZED_CATEGORY_ID = "uncategorized";
const UNCATEGORIZED_CATEGORY_NAME = "Без категории";
const EMPTY_SYNC_STATUS: SyncStatus = {
  pending: 0,
  failed: 0,
  total: 0,
  syncing: false,
  lastError: "",
  lastAttemptAt: "",
  lastSyncedAt: ""
};

const categoryIcons: Record<string, LucideIcon> = {
  ShoppingBasket,
  CupSoda,
  Milk,
  Apple,
  Fish,
  BadgePercent,
  Croissant,
  SprayCan,
  Shirt
};

const deviceIcons: Record<string, LucideIcon> = {
  scale: SlidersHorizontal,
  display: Monitor,
  printer: Printer,
  scanner: ScanBarcode,
  terminal: CreditCard,
  qr: QrCode
};

const paymentLabels: Record<PaymentMethod, string> = {
  cash: "наличными",
  card: "картой",
  qr: "QR",
  debt: "в долг"
};

const cleanDisplayText = (value: unknown, fallback = "") =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/\uFFFD+/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim() || fallback;

const cleanCategory = (category: Category): Category => ({
  ...category,
  name: cleanDisplayText(category.name, "Категория")
});

const cleanProduct = (product: Product): Product => ({
  ...product,
  name: cleanDisplayText(product.name, "Товар без названия"),
  barcode: cleanDisplayText(product.barcode),
  sku: cleanDisplayText(product.sku),
  extraBarcodes: (product.extraBarcodes ?? []).map((barcode) => cleanDisplayText(barcode)).filter(Boolean)
});

const cleanProducts = (rows: Product[]) => rows.map(cleanProduct);

export function App() {
  const [view, setView] = useState<View>("activation");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("equipment");
  const [binding, setBinding] = useState<CashBinding | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [cashiers, setCashiers] = useState<CashEmployee[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [debtors, setDebtors] = useState<Customer[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [receiptDiscountType, setReceiptDiscountType] = useState<DiscountType>("none");
  const [receiptDiscountValue, setReceiptDiscountValue] = useState(0);
  const [receiptNumber, setReceiptNumber] = useState("10245");
  const [productSearch, setProductSearch] = useState("");
  const [suspendedSearch, setSuspendedSearch] = useState("");
  const [suspendedReceipts, setSuspendedReceipts] = useState<SuspendedReceipt[]>([]);
  const [salesHistory, setSalesHistory] = useState<Receipt[]>([]);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  const [cashPaymentOpen, setCashPaymentOpen] = useState(false);
  const [qrPaymentOrder, setQrPaymentOrder] = useState<QrPaymentOrder | null>(null);
  const [qrCompleting, setQrCompleting] = useState(false);
  const [quantityProduct, setQuantityProduct] = useState<Product | null>(null);
  const [unknownBarcode, setUnknownBarcode] = useState("");
  const [universalAmountOpen, setUniversalAmountOpen] = useState(false);
  const [priceEditItem, setPriceEditItem] = useState<CartItem | null>(null);
  const [returnTarget, setReturnTarget] = useState<Receipt | null>(null);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [accountLogoutOpen, setAccountLogoutOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(EMPTY_SYNC_STATUS);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [busyTask, setBusyTask] = useState<BusyTask | null>(null);
  const [displayOverride, setDisplayOverride] = useState<CustomerDisplayState | null>(null);
  const scannerRef = useRef({ buffer: "", startedAt: 0, lastAt: 0 });
  const syncDelayRef = useRef<number | null>(null);

  const loadData = async (showLoader = false) => {
    if (showLoader) {
      setLoading(true);
    }

    const cashBinding = await window.kassaApi.account.getBinding();
    if (!cashBinding) {
      setBinding(null);
      setShift(null);
      setCategories([]);
      setProducts([]);
      setDevices([]);
      setSerialPorts([]);
      setCashiers([]);
      setCustomers([]);
      setDebtors([]);
      setView("activation");
      setLoading(false);
      return;
    }

    const [
      currentShift,
      categoryRows,
      productRows,
      deviceRows,
      cashierRows,
      customerRows,
      debtorRows,
      nextNumber,
      suspendedRows,
      receiptRows,
      detectedSerialPorts
    ] = await Promise.all([
      window.kassaApi.shift.getCurrent(),
      window.kassaApi.products.categories(),
      window.kassaApi.products.list(),
      window.kassaApi.settings.getDevices(),
      window.kassaApi.employees.listCashiers(),
      window.kassaApi.customers.list(),
      window.kassaApi.debts.list(),
      window.kassaApi.receipts.getNextNumber(),
      window.kassaApi.receipts.listSuspended(suspendedSearch),
      window.kassaApi.receipts.list(),
      window.kassaApi.display.listPorts().catch(() => [])
    ]);

    const visibleCategoryRows = categoryRows.filter((category) => !isUncategorizedCategory(category)).map(cleanCategory);
    const visibleProductRows = cleanProducts(productRows);

    setBinding(cashBinding);
    setShift(currentShift);
    setCategories(visibleCategoryRows);
    setProducts(visibleProductRows);
    setDevices(deviceRows);
    setSerialPorts(detectedSerialPorts);
    setCashiers(cashierRows);
    setCustomers(customerRows);
    setDebtors(debtorRows);
    setReceiptNumber(nextNumber);
    setSuspendedReceipts(suspendedRows);
    setSalesHistory(receiptRows);
    setSelectedCategory((current) =>
      visibleCategoryRows.some((category) => category.id === current)
        ? current
        : visibleCategoryRows[0]?.id ?? ""
    );
    setView((current) => {
      if (current === "activation") {
        return currentShift ? "sale" : "shift";
      }
      if (!currentShift && current === "sale") {
        return "shift";
      }
      return current;
    });
    setLoading(false);
  };

  useEffect(() => {
    loadData(true).catch((error) => {
      setToast(error instanceof Error ? error.message : "Не удалось загрузить кассу.");
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!binding) {
      return;
    }
    window.kassaApi.receipts
      .listSuspended(suspendedSearch)
      .then(setSuspendedReceipts)
      .catch((error) => setToast(error instanceof Error ? error.message : "Ошибка поиска чеков."));
  }, [binding, suspendedSearch]);

  const filteredProducts = useMemo(() => {
    const normalized = productSearch.trim().toLowerCase();
    const base = normalized
      ? products
      : products.filter((product) => product.categoryId === selectedCategory);

    return base
      .filter((product) => {
        if (!normalized) {
          return true;
        }
        return (
          cleanDisplayText(product.name).toLowerCase().includes(normalized) ||
          product.barcode.toLowerCase().includes(normalized) ||
          (product.extraBarcodes ?? []).some((barcode) => barcode.toLowerCase().includes(normalized)) ||
          product.sku.toLowerCase().includes(normalized)
        );
      })
      .slice(0, 12);
  }, [productSearch, products, selectedCategory]);

  const subtotal = useMemo(
    () => roundMoney(cart.reduce((sum, item) => sum + item.price * item.qty, 0)),
    [cart]
  );
  const itemDiscount = useMemo(
    () => roundMoney(cart.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0)),
    [cart]
  );
  const receiptDiscount = useMemo(
    () => calcDiscount(Math.max(0, subtotal - itemDiscount), receiptDiscountType, receiptDiscountValue),
    [itemDiscount, receiptDiscountType, receiptDiscountValue, subtotal]
  );
  const discount = roundMoney(itemDiscount + receiptDiscount);
  const total = roundMoney(Math.max(0, subtotal - discount));
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const customerDisplayState = useMemo<CustomerDisplayState>(
    () => ({
      storeName: binding?.storeName ?? BRAND_NAME,
      receiptNumber,
      items: cart,
      subtotal,
      discount,
      total,
      customerName: selectedCustomer?.name,
      status: cart.length ? "editing" : "idle",
      message: cart.length ? "Проверьте товары и сумму" : "Добро пожаловать"
    }),
    [binding?.storeName, cart, discount, receiptNumber, selectedCustomer?.name, subtotal, total]
  );

  useEffect(() => {
    if (!binding) {
      return;
    }
    window.kassaApi.display.update(displayOverride ?? customerDisplayState).catch(() => undefined);
  }, [binding, customerDisplayState, displayOverride]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  };

  const refreshSyncStatus = useCallback(async () => {
    try {
      setSyncStatus(await window.kassaApi.sync.getStatus());
    } catch {
      // Status indicator is helpful, but it must not block cashier work.
    }
  }, []);

  const flushSyncQueue = useCallback(async (manual = false) => {
    if (syncingQueue) {
      return;
    }
    setSyncingQueue(true);
    setSyncStatus((current) => ({ ...current, syncing: true }));
    try {
      const status = await window.kassaApi.sync.flush();
      setSyncStatus(status);
      if (manual) {
        showToast(status.total > 0 ? "Не удалось отправить все данные. Проверьте интернет." : "Все данные отправлены на сервер.");
      }
    } catch (error) {
      await refreshSyncStatus();
      if (manual) {
        showToast(error instanceof Error ? error.message : "Не удалось синхронизировать кассу.");
      }
    } finally {
      setSyncingQueue(false);
    }
  }, [refreshSyncStatus, syncingQueue]);

  const scheduleSyncFlush = useCallback(() => {
    void refreshSyncStatus();
    if (syncDelayRef.current) {
      window.clearTimeout(syncDelayRef.current);
    }
    syncDelayRef.current = window.setTimeout(() => {
      void flushSyncQueue(false);
    }, 1800);
  }, [flushSyncQueue, refreshSyncStatus]);

  useEffect(() => {
    if (!binding) {
      setSyncStatus(EMPTY_SYNC_STATUS);
      return;
    }
    void refreshSyncStatus();
    const firstFlush = window.setTimeout(() => {
      void flushSyncQueue(false);
    }, 1800);
    const interval = window.setInterval(() => {
      void flushSyncQueue(false);
    }, 60000);
    return () => {
      window.clearTimeout(firstFlush);
      window.clearInterval(interval);
      if (syncDelayRef.current) {
        window.clearTimeout(syncDelayRef.current);
      }
    };
  }, [binding?.accountId, flushSyncQueue, refreshSyncStatus]);

  const runBusy = async <T,>(task: BusyTask, action: () => Promise<T>) => {
    setBusyTask(task);
    try {
      return await action();
    } finally {
      setBusyTask(null);
    }
  };

  const activateCash = async (key: string) => {
    try {
      await runBusy({ title: "Подключаем кассу", message: "Загружаем товары и настройки магазина." }, async () => {
        setSyncing(true);
        await window.kassaApi.account.activate(key);
        await loadData();
      });
      showToast("Касса привязана. Товары и настройки загружены локально.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось активировать кассу.");
    } finally {
      setSyncing(false);
    }
  };

  const refreshSnapshot = async () => {
    if (!binding) {
      setView("activation");
      return;
    }
    try {
      await runBusy({ title: "Обновляем данные", message: "Получаем свежие товары, цены и настройки из админки." }, async () => {
        setSyncing(true);
        await window.kassaApi.account.refresh();
        await loadData();
      });
      await refreshSyncStatus();
      showToast("Данные из админки обновлены на этой кассе.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось обновить данные.");
    } finally {
      setSyncing(false);
    }
  };

  const addProductWithQty = useCallback((product: Product, qty: number) => {
    const price = product.salePrice ?? product.price;
    const safeQty = roundQty(Math.max(0, qty));
    if (safeQty <= 0) {
      return;
    }
    setDisplayOverride(null);
    setCart((items) => {
      const existing = items.find((item) => item.productId === product.id);
      if (existing) {
        return [
          withQty(existing, roundQty(existing.qty + safeQty)),
          ...items.filter((item) => item.productId !== product.id)
        ];
      }
      return [
        withQty({
          productId: product.id,
          name: cleanDisplayText(product.name, "Товар без названия"),
          qty: safeQty,
          unit: product.unit,
          price,
          purchasePrice: product.purchasePrice,
          discountType: "none",
          discountValue: 0,
          discountAmount: 0,
          total: price
        }, safeQty),
        ...items
      ];
    });
  }, []);

  const addProduct = useCallback((product: Product) => {
    if (isMeasuredUnit(product.unit)) {
      setQuantityProduct(product);
      return;
    }
    addProductWithQty(product, 1);
  }, [addProductWithQty]);

  const findProductByCode = useCallback((code: string) => {
    const normalized = code.trim().toLowerCase();
    return products.find(
      (product) =>
        product.barcode.toLowerCase() === normalized ||
        product.sku.toLowerCase() === normalized ||
        (product.extraBarcodes ?? []).some((barcode) => barcode.toLowerCase() === normalized)
    );
  }, [products]);

  const createProductFromCash = async (input: CashProductInput) => {
    try {
      const product = await runBusy(
        { title: "Создаем товар", message: "Сохраняем товар локально и добавляем его в чек." },
        () => window.kassaApi.products.createFromCash(input)
      );
      const cleanCreated = cleanProduct(product);
      setProducts(cleanProducts(await window.kassaApi.products.list()));
      setUnknownBarcode("");
      addProduct(cleanCreated);
      scheduleSyncFlush();
      showToast(`Товар создан: ${product.name}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось создать товар.");
    }
  };

  const addUniversalProduct = (amount: number) => {
    const safeAmount = roundMoney(Math.max(0, amount));
    if (safeAmount <= 0) {
      return;
    }
    const id = `universal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setDisplayOverride(null);
    setCart((items) => [
      {
        productId: id,
        name: "Универсальный товар",
        qty: 1,
        unit: "шт",
        price: safeAmount,
        purchasePrice: 0,
        discountType: "none",
        discountValue: 0,
        discountAmount: 0,
        total: safeAmount,
        isUniversal: true
      },
      ...items
    ]);
    setUniversalAmountOpen(false);
  };

  useEffect(() => {
    if (view !== "sale" || !shift || cashPaymentOpen || closeShiftOpen || quantityProduct || unknownBarcode || universalAmountOpen || priceEditItem) {
      scannerRef.current = { buffer: "", startedAt: 0, lastAt: 0 };
      return;
    }

    const handleScannerKey = (event: KeyboardEvent) => {
      const state = scannerRef.current;
      const timestamp = Date.now();

      if (event.key === "Enter") {
        const code = state.buffer.trim();
        const duration = timestamp - state.startedAt;
        scannerRef.current = { buffer: "", startedAt: 0, lastAt: 0 };
        if (code.length >= 5 && duration <= 1500) {
          const found = findProductByCode(code);
          if (found) {
            addProduct(found);
            setProductSearch("");
            showToast(`Товар добавлен: ${found.name}`);
          } else {
            setProductSearch(code);
            setUnknownBarcode(code);
          }
          event.preventDefault();
        }
        return;
      }

      if (event.key === "Escape") {
        scannerRef.current = { buffer: "", startedAt: 0, lastAt: 0 };
        return;
      }

      if (event.key.length === 1 && /^[\p{L}\p{N}_-]$/u.test(event.key)) {
        if (!state.buffer || timestamp - state.lastAt > 120) {
          state.buffer = "";
          state.startedAt = timestamp;
        }
        state.buffer = `${state.buffer}${event.key}`.slice(-48);
        state.lastAt = timestamp;
      }
    };

    window.addEventListener("keydown", handleScannerKey, true);
    return () => window.removeEventListener("keydown", handleScannerKey, true);
  }, [addProduct, cashPaymentOpen, closeShiftOpen, findProductByCode, priceEditItem, quantityProduct, shift, unknownBarcode, universalAmountOpen, view]);

  const changeQty = (productId: string, delta: number) => {
    setDisplayOverride(null);
    setCart((items) =>
      items
        .map((item) =>
          item.productId === productId ? withQty(item, roundQty(item.qty + delta * qtyStep(item.unit))) : item
        )
        .filter((item) => item.qty > 0)
    );
  };

  const removeItem = (productId: string) => {
    setDisplayOverride(null);
    setCart((items) => items.filter((item) => item.productId !== productId));
  };

  const setItemDiscount = (productId: string, discountType: DiscountType, discountValue: number) => {
    setDisplayOverride(null);
    setCart((items) =>
      items.map((item) =>
        item.productId === productId
          ? withQty({ ...item, discountType, discountValue }, item.qty)
          : item
      )
    );
  };

  const confirmPriceEdit = async (item: CartItem, salePrice: number) => {
    const safePrice = roundMoney(Number(salePrice || 0));
    if (safePrice <= 0) {
      showToast("Цена должна быть больше 0.");
      return;
    }
    setDisplayOverride(null);
    try {
      if (item.isUniversal) {
        setCart((items) =>
          items.map((cartItem) =>
            cartItem.productId === item.productId
              ? withQty({ ...cartItem, price: safePrice }, cartItem.qty)
              : cartItem
          )
        );
      } else {
        const updated = await runBusy(
          { title: "Обновляем цену", message: "Сохраняем цену локально и отправляем изменение на сервер." },
          () => window.kassaApi.products.updatePrice({ productId: item.productId, salePrice: safePrice })
        );
        const cleanUpdated = cleanProduct(updated);
        setProducts((rows) => rows.map((product) => (product.id === cleanUpdated.id ? cleanUpdated : product)));
        setCart((items) =>
          items.map((cartItem) =>
            cartItem.productId === item.productId
              ? withQty({ ...cartItem, name: cleanUpdated.name, price: cleanUpdated.salePrice, purchasePrice: cleanUpdated.purchasePrice }, cartItem.qty)
              : cartItem
          )
        );
        scheduleSyncFlush();
      }
      setPriceEditItem(null);
      showToast("Цена обновлена.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось обновить цену.");
    }
  };

  const pay = async (paymentMethod: PaymentMethod) => {
    if (busyTask) {
      return;
    }
    if (!cart.length) {
      showToast("Добавьте товары в чек.");
      return;
    }
    if (paymentMethod === "cash") {
      setCashPaymentOpen(true);
      return;
    }
    if (paymentMethod === "debt" && !selectedCustomer) {
      showToast("Для продажи в долг выберите клиента.");
      return;
    }
    if (paymentMethod === "qr") {
      try {
        await runBusy({ title: "Создаем QR оплату", message: "Отправляем сумму в банк и получаем QR для клиента." }, async () => {
          const order = await window.kassaApi.qr.createPayment({
            amount: total,
            receiptNumber,
            description: cart.map((item) => `${item.name} x ${formatQty(item.qty)} ${item.unit}`).join(", ").slice(0, 240)
          });
          setQrPaymentOrder(order);
          setDisplayOverride({
            storeName: binding?.storeName ?? BRAND_NAME,
            receiptNumber,
            items: cart,
            subtotal,
            discount,
            total,
            customerName: selectedCustomer?.name,
            status: "editing",
            message: "Отсканируйте QR для оплаты"
          });
        });
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Не удалось создать QR оплату.");
      }
      return;
    }
    await completePayment(paymentMethod);
  };

  const completePayment = async (
    paymentMethod: PaymentMethod,
    paidAmount?: number,
    changeAmount?: number
  ) => {
    if (busyTask) {
      return;
    }
    try {
      const printer = devices.find((device) => device.id === "printer");
      const printerReady = Boolean(printer?.enabled && printer.status !== "offline");
      await runBusy({
        title: printerReady ? "Печатаем чек" : "Сохраняем продажу",
        message: printerReady ? "Не закрывайте кассу, чек отправляется на принтер." : "Принтер отключен, чек не будет напечатан."
      }, async () => {
        const receipt = await window.kassaApi.cart.createReceipt({
          number: receiptNumber,
          items: cart,
          paymentMethod,
          discount,
          discountType: receiptDiscountType,
          discountValue: receiptDiscountValue,
          customerId: selectedCustomer?.id,
          cashier: shift?.cashier ?? CASHIER,
          comment: "",
          paidAmount,
          changeAmount
        });
        const changeText = paymentMethod === "cash" ? ` Сдача: ${formatMoney(changeAmount ?? 0)}.` : "";
        const paidMessage =
          paymentMethod === "debt"
            ? "Продажа записана в долг"
            : `Оплачено ${paymentLabels[paymentMethod]}.${changeText}`;
        setDisplayOverride({
          storeName: binding?.storeName ?? BRAND_NAME,
          receiptNumber: receipt.number,
          items: cart,
          subtotal,
          discount,
          total,
          customerName: selectedCustomer?.name,
          status: "paid",
          message: paidMessage
        });
        window.setTimeout(() => setDisplayOverride(null), 4500);
        setCart([]);
        setReceiptDiscountType("none");
        setReceiptDiscountValue(0);
        setCashPaymentOpen(false);
        const [nextNumber, productRows, receipts] = await Promise.all([
          window.kassaApi.receipts.getNextNumber(),
          window.kassaApi.products.list(),
          window.kassaApi.receipts.list()
        ]);
        setReceiptNumber(nextNumber);
        setProducts(cleanProducts(productRows));
        setSalesHistory(receipts);
        setDebtors(await window.kassaApi.debts.list());
        showToast(`Чек № ${receipt.number} оплачен ${paymentLabels[paymentMethod]}.${changeText}`);
      });
      scheduleSyncFlush();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось оплатить чек.");
    }
  };

  const completeQrPayment = async () => {
    if (qrCompleting) {
      return;
    }
    setQrCompleting(true);
    try {
      setQrPaymentOrder(null);
      await completePayment("qr");
    } finally {
      setQrCompleting(false);
    }
  };

  const suspendCart = async () => {
    if (!cart.length) {
      showToast("Пустой чек нельзя отложить.");
      return;
    }
    try {
      await runBusy({ title: "Откладываем чек", message: "Сохраняем текущий чек в локальной базе." }, async () => {
        const receipt = await window.kassaApi.cart.suspendReceipt({
          items: cart,
          cashier: shift?.cashier ?? CASHIER,
          comment: "Клиент вернется"
        });
        setDisplayOverride(null);
        setCart([]);
        setReceiptNumber(await window.kassaApi.receipts.getNextNumber());
        setSuspendedReceipts(await window.kassaApi.receipts.listSuspended(suspendedSearch));
        setView("suspended");
        showToast(`Чек № ${receipt?.number ?? ""} отложен.`);
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось отложить чек.");
    }
  };

  const restoreSuspended = async (id: number) => {
    try {
      await runBusy({ title: "Открываем чек", message: "Возвращаем отложенные товары в корзину." }, async () => {
        const restored: RestoreSuspendedResult = await window.kassaApi.cart.restoreSuspended(id);
        setDisplayOverride(null);
        setCart(restored.items);
        setReceiptNumber(restored.number);
        setSuspendedReceipts(await window.kassaApi.receipts.listSuspended(suspendedSearch));
        setView("sale");
        showToast(`Чек № ${restored.number} открыт.`);
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось открыть чек.");
    }
  };

  const deleteSuspended = async (id: number) => {
    await window.kassaApi.receipts.deleteSuspended(id);
    setSuspendedReceipts(await window.kassaApi.receipts.listSuspended(suspendedSearch));
    showToast("Отложенный чек удален.");
  };

  const saveCustomer = async (input: { name: string; phone: string; comment: string }) => {
    try {
      const saved = await window.kassaApi.customers.save(input);
      const [customerRows, debtorRows] = await Promise.all([
        window.kassaApi.customers.list(),
        window.kassaApi.debts.list()
      ]);
      setCustomers(customerRows);
      setDebtors(debtorRows);
      if (saved) {
        setSelectedCustomerId(saved.id);
      }
      showToast("Клиент сохранен.");
      scheduleSyncFlush();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось сохранить клиента.");
    }
  };

  const payCustomerDebt = async (customerId: string, amount: number, paymentMethod: Exclude<PaymentMethod, "debt">) => {
    try {
      await runBusy({ title: "Погашаем долг", message: "Записываем оплату клиента в смену." }, async () => {
        await window.kassaApi.debts.pay({
          customerId,
          amount,
          paymentMethod,
          cashier: shift?.cashier ?? CASHIER,
          comment: "Погашение долга на кассе"
        });
        const [customerRows, debtorRows, receipts] = await Promise.all([
          window.kassaApi.customers.list(),
          window.kassaApi.debts.list(),
          window.kassaApi.receipts.list()
        ]);
        setCustomers(customerRows);
        setDebtors(debtorRows);
        setSalesHistory(receipts);
        showToast("Долг погашен.");
      });
      scheduleSyncFlush();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось погасить долг.");
    }
  };

  const processReturn = async (
    originalReceipt: Receipt,
    items: CartItem[],
    paymentMethod: PaymentMethod,
    reason: string
  ) => {
    if (busyTask) {
      return;
    }
    try {
      const printer = devices.find((device) => device.id === "printer");
      const printerReady = Boolean(printer?.enabled && printer.status !== "offline");
      await runBusy({
        title: "Проводим возврат",
        message: printerReady ? "Возвращаем остатки и печатаем чек возврата." : "Возвращаем остатки. Принтер отключен, чек не будет напечатан."
      }, async () => {
        const receipt = await window.kassaApi.cart.createReturn({
          originalReceiptId: originalReceipt.id,
          items,
          paymentMethod,
          cashier: shift?.cashier ?? CASHIER,
          reason
        });
        const returnTotal = roundMoney(items.reduce((sum, item) => sum + item.total, 0));
        setDisplayOverride({
          storeName: binding?.storeName ?? BRAND_NAME,
          receiptNumber: receipt.number,
          items,
          subtotal: returnTotal,
          discount: 0,
          total: returnTotal,
          customerName: originalReceipt.customerName,
          status: "return",
          message: `Возврат по чеку № ${originalReceipt.number}`
        });
        window.setTimeout(() => setDisplayOverride(null), 4500);
        const [productRows, receipts, debtorRows, customerRows] = await Promise.all([
          window.kassaApi.products.list(),
          window.kassaApi.receipts.list(),
          window.kassaApi.debts.list(),
          window.kassaApi.customers.list()
        ]);
        setProducts(cleanProducts(productRows));
        setSalesHistory(receipts);
        setDebtors(debtorRows);
        setCustomers(customerRows);
        setReturnTarget(null);
        showToast(`Возврат по чеку № ${originalReceipt.number} проведен. Чек возврата № ${receipt.number}.`);
      });
      scheduleSyncFlush();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось провести возврат.");
    }
  };

  const openShift = async (cashier: CashEmployee, openingCash: number, comment: string) => {
    try {
      await runBusy({ title: "Открываем смену", message: "Подготавливаем кассу к работе." }, async () => {
        const opened = await window.kassaApi.shift.open({
          cashier: cashier.name,
          cashierId: cashier.id,
          openingCash,
          comment
        });
        setShift(opened);
        setView("sale");
        showToast("Смена открыта.");
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось открыть смену.");
    }
  };

  const closeShift = async () => {
    if (cart.length) {
      showToast("Сначала оплатите, отложите или очистите текущий чек.");
      return;
    }
    setCloseShiftOpen(true);
  };

  const logoutAccount = async (force = false) => {
    try {
      if (cart.length) {
        showToast("Сначала оплатите, отложите или очистите текущий чек.");
        return;
      }
      await window.kassaApi.account.logout(force);
      setAccountLogoutOpen(false);
      setCart([]);
      setDisplayOverride(null);
      setReceiptDiscountType("none");
      setReceiptDiscountValue(0);
      setSelectedCustomerId("");
      await loadData(true);
      showToast(force ? "Очередь очищена, касса отвязана. Можно ввести новый ключ." : "Касса отвязана. Можно ввести ключ другого магазина.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось выйти из аккаунта.");
    }
  };

  const confirmCloseShift = async (actualCash: number) => {
    try {
      await runBusy({ title: "Закрываем смену", message: "Считаем итоги и сохраняем отчет." }, async () => {
        const summary = await window.kassaApi.shift.close({ actualCash });
        setShiftSummary(summary);
        setShift(null);
        setCloseShiftOpen(false);
        setView("shift");
        setSalesHistory(await window.kassaApi.receipts.list());
        showToast("Смена закрыта.");
      });
      scheduleSyncFlush();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось закрыть смену.");
    }
  };

  const updateDevice = async (input: DeviceUpdateInput) => {
    const updated = await window.kassaApi.settings.updateDevice(input);
    if (updated) {
      setDevices((items) => items.map((device) => (device.id === updated.id ? updated : device)));
    }
  };

  const testMiniDisplay = async (port: string) => {
    try {
      const ok = await window.kassaApi.display.testMini(port, 123.45);
      showToast(ok ? "На мини-экран отправлен тест 123.45." : "Не удалось отправить тест. Проверьте COM-порт.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось проверить мини-экран.");
    }
  };

  const refreshDevices = async () => {
    const refreshed = await Promise.all(
      devices.map((device) =>
        window.kassaApi.settings.updateDevice({
          id: device.id,
          status: device.enabled ? (device.id === "qr" ? "online" : "connected") : "offline",
          enabled: device.enabled
        })
      )
    );
    setDevices(refreshed.filter(Boolean) as Device[]);
    setSerialPorts(await window.kassaApi.display.listPorts().catch(() => []));
    showToast("Все устройства проверены.");
  };

  if (loading) {
    return <div className="loading-screen">Загрузка кассы...</div>;
  }

  return (
    <div className="app-shell">
      {view !== "activation" && (
        <TopBar
          binding={binding}
          shift={shift}
          view={view}
          syncing={syncing}
          syncStatus={{ ...syncStatus, syncing: syncStatus.syncing || syncingQueue }}
          onSale={() => setView(shift ? "sale" : "shift")}
          onSuspended={() => setView("suspended")}
          onHistory={() => setView("history")}
          onDebtors={() => setView("debtors")}
          onSettings={() => setView("settings")}
          onRefresh={refreshSnapshot}
          onFlushSync={() => flushSyncQueue(true)}
          onCloseShift={closeShift}
        />
      )}

      {view === "activation" && (
        <ActivationScreen syncing={syncing} onActivate={activateCash} />
      )}

      {view === "shift" && binding && (
        <ShiftScreen binding={binding} devices={devices} cashiers={cashiers} onOpenShift={openShift} />
      )}

      {view === "sale" && (
        <SaleScreen
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          products={filteredProducts}
          productSearch={productSearch}
          setProductSearch={setProductSearch}
          receiptNumber={receiptNumber}
          cart={cart}
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          onSelectCustomer={setSelectedCustomerId}
          onSaveCustomer={saveCustomer}
          subtotal={subtotal}
          discount={discount}
          receiptDiscountType={receiptDiscountType}
          receiptDiscountValue={receiptDiscountValue}
          onReceiptDiscountChange={(type, value) => {
            setReceiptDiscountType(type);
            setReceiptDiscountValue(value);
          }}
          total={total}
          onAddProduct={addProduct}
          onUniversalProduct={() => setUniversalAmountOpen(true)}
          onPay={pay}
          onSuspend={suspendCart}
          onRefresh={refreshSnapshot}
          onCloseShift={closeShift}
          onClear={() => {
            setDisplayOverride(null);
            setCart([]);
          }}
          onReturn={() => {
            setView("history");
            showToast("Выберите чек в истории и нажмите Возврат.");
          }}
          onChangeQty={changeQty}
          onItemDiscountChange={setItemDiscount}
          onEditPrice={(item) => setPriceEditItem(item)}
          onRemoveItem={removeItem}
        />
      )}

      {view === "suspended" && (
        <SuspendedScreen
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={(id) => {
            setSelectedCategory(id);
            setView("sale");
          }}
          search={suspendedSearch}
          setSearch={setSuspendedSearch}
          receipts={suspendedReceipts}
          onRefresh={async () =>
            setSuspendedReceipts(await window.kassaApi.receipts.listSuspended(suspendedSearch))
          }
          onOpen={restoreSuspended}
          onDelete={deleteSuspended}
        />
      )}

      {view === "history" && (
        <HistoryScreen
          receipts={salesHistory}
          onRefresh={async () => setSalesHistory(await window.kassaApi.receipts.list())}
          onReturn={(receipt) => setReturnTarget(receipt)}
        />
      )}

      {view === "debtors" && (
        <DebtorsScreen
          customers={debtors}
          onRefresh={async () => setDebtors(await window.kassaApi.debts.list())}
          onPayDebt={payCustomerDebt}
        />
      )}

      {view === "settings" && (
        <SettingsScreen
          tab={settingsTab}
          setTab={setSettingsTab}
          devices={devices}
          binding={binding}
          serialPorts={serialPorts}
          onUpdateDevice={updateDevice}
          onTestMiniDisplay={testMiniDisplay}
          onRefreshDevices={refreshDevices}
          onLogoutAccount={() => setAccountLogoutOpen(true)}
        />
      )}

      {shiftSummary && (
        <ShiftSummaryDialog summary={shiftSummary} onClose={() => setShiftSummary(null)} />
      )}

      {cashPaymentOpen && (
        <CashPaymentDialog
          total={total}
          onClose={() => setCashPaymentOpen(false)}
          onConfirm={(paidAmount) =>
            completePayment("cash", paidAmount, roundMoney(Math.max(0, paidAmount - total)))
          }
        />
      )}

      {qrPaymentOrder && (
        <QrPaymentDialog
          order={qrPaymentOrder}
          total={total}
          completing={qrCompleting}
          onClose={() => {
            setQrPaymentOrder(null);
            setDisplayOverride(null);
          }}
          onPaid={completeQrPayment}
        />
      )}

      {quantityProduct && (
        <QuantityDialog
          product={quantityProduct}
          onClose={() => setQuantityProduct(null)}
          onConfirm={(qty) => {
            addProductWithQty(quantityProduct, qty);
            setQuantityProduct(null);
          }}
        />
      )}

      {unknownBarcode && (
        <CashProductDialog
          barcode={unknownBarcode}
          categories={categories}
          onClose={() => setUnknownBarcode("")}
          onConfirm={createProductFromCash}
        />
      )}

      {universalAmountOpen && (
        <UniversalProductDialog
          onClose={() => setUniversalAmountOpen(false)}
          onConfirm={addUniversalProduct}
        />
      )}

      {priceEditItem && (
        <PriceEditDialog
          item={priceEditItem}
          onClose={() => setPriceEditItem(null)}
          onConfirm={(salePrice) => confirmPriceEdit(priceEditItem, salePrice)}
        />
      )}

      {closeShiftOpen && (
        <CloseShiftDialog
          onClose={() => setCloseShiftOpen(false)}
          onConfirm={confirmCloseShift}
        />
      )}

      {accountLogoutOpen && (
        <AccountLogoutDialog
          binding={binding}
          syncStatus={syncStatus}
          onClose={() => setAccountLogoutOpen(false)}
          onConfirm={logoutAccount}
        />
      )}

      {returnTarget && (
        <ReturnReceiptDialog
          receipt={returnTarget}
          products={products}
          onClose={() => setReturnTarget(null)}
          onConfirm={processReturn}
        />
      )}

      {busyTask && <BusyOverlay task={busyTask} />}
      {toast && <div className="toast" data-testid="toast">{toast}</div>}
    </div>
  );
}

function BusyOverlay({ task }: { task: BusyTask }) {
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-card">
        <div className="busy-spinner" />
        <strong>{task.title}</strong>
        {task.message && <span>{task.message}</span>}
      </div>
    </div>
  );
}

function TopBar({
  binding,
  shift,
  view,
  syncing,
  syncStatus,
  onSale,
  onSuspended,
  onHistory,
  onDebtors,
  onSettings,
  onRefresh,
  onFlushSync,
  onCloseShift
}: {
  binding: CashBinding | null;
  shift: Shift | null;
  view: View;
  syncing: boolean;
  syncStatus: SyncStatus;
  onSale: () => void;
  onSuspended: () => void;
  onHistory: () => void;
  onDebtors: () => void;
  onSettings: () => void;
  onRefresh: () => void;
  onFlushSync: () => void;
  onCloseShift: () => void;
}) {
  const [nowDate, setNowDate] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNowDate(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="topbar">
      <button className="brand-button" type="button" onClick={onSale} title="Продажа">
        <img src={APP_LOGO_SRC} alt="" />
      </button>
      <div className="brand-title">{BRAND_NAME}</div>
      <div className="top-separator" />
      <div className="store-name">{binding?.accountName ?? "Аккаунт не привязан"}</div>
      <div className="top-spacer" />
      <div className="cashier">Кассир: {shift?.cashier ?? CASHIER}</div>
      <div className="top-info">
        <CalendarDays size={17} />
        <span>{formatDate(nowDate)}</span>
      </div>
      <div className="top-info">
        <Clock3 size={17} />
        <span>{formatClock(nowDate)}</span>
      </div>
      <button className="top-action" type="button" onClick={onRefresh} disabled={syncing} title="Обновить данные из админки">
        <RefreshCw size={17} />
        <span>{syncing ? "Обновляем" : "Обновить"}</span>
      </button>
      <button
        className={`sync-pill ${syncStatus.total > 0 ? "pending" : "ok"} ${syncStatus.failed > 0 ? "failed" : ""}`}
        type="button"
        onClick={onFlushSync}
        disabled={syncStatus.syncing}
        title={syncStatus.lastError || "Синхронизация с сервером"}
      >
        <RefreshCw size={16} />
        <span>{syncStatus.syncing ? "Отправляем..." : syncStatus.total > 0 ? `Не отправлено: ${syncStatus.total}` : "Синхронизировано"}</span>
      </button>
      <button
        className={`icon-button ${view === "history" ? "active" : ""}`}
        type="button"
        onClick={onHistory}
        title="История продаж"
      >
        <History size={18} />
      </button>
      <button
        className={`icon-button ${view === "suspended" ? "active" : ""}`}
        type="button"
        onClick={onSuspended}
        title="Отложенные чеки"
      >
        <Undo2 size={18} />
      </button>
      <button
        className={`icon-button ${view === "debtors" ? "active" : ""}`}
        type="button"
        onClick={onDebtors}
        title="Должники"
      >
        <UserRound size={18} />
      </button>
      <button
        className={`icon-button ${view === "settings" ? "active" : ""}`}
        type="button"
        onClick={onSettings}
        title="Настройки"
        data-testid="open-settings"
      >
        <Settings size={18} />
      </button>
      {shift && (
        <button className="top-action close-shift" type="button" onClick={onCloseShift}>
          <LockKeyhole size={17} />
          <span>Закрыть</span>
        </button>
      )}
      <button className="window-control" type="button" title="Свернуть" onClick={() => window.kassaApi.window.minimize()}>
        -
      </button>
      <button className="window-control" type="button" title="Закрыть" onClick={() => window.kassaApi.window.close()}>
        <X size={17} />
      </button>
    </header>
  );
}

function ActivationScreen({
  syncing,
  onActivate
}: {
  syncing: boolean;
  onActivate: (key: string) => void;
}) {
  const [key, setKey] = useState("");
  const [pasteError, setPasteError] = useState("");
  const pasteKey = () => {
    const value = window.kassaApi.clipboard.readText().trim();
    if (!value) {
      setPasteError("В буфере обмена нет ключа. Сначала скопируйте ключ из админки.");
      return;
    }
    setKey(value.toUpperCase());
    setPasteError("");
  };

  return (
    <main className="activation-page" data-testid="activation-screen">
      <section className="activation-card">
        <div className="activation-logo">
          <img src={APP_LOGO_SRC} alt="" />
        </div>
        <h1>{BRAND_NAME}</h1>
        <p>Введите ключ первичного подключения из админки магазина. После активации товары, цены, категории и остатки сохранятся локально на этой кассе.</p>
        <label>
          Ключ кассы
          <div className="key-input">
            <KeyRound size={20} />
            <input
              data-testid="activation-key"
              value={key}
              placeholder="Например: UROJ-2026-0001"
              autoFocus
              onChange={(event) => setKey(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter" && key.trim()) {
                  onActivate(key);
                }
              }}
            />
            <button className="paste-key-button" type="button" onClick={pasteKey} disabled={syncing} title="Вставить скопированный ключ">
              <ClipboardPaste size={18} />
              Вставить
            </button>
          </div>
        </label>
        {pasteError && <div className="activation-error">{pasteError}</div>}
        <button
          className="primary-action activation-action"
          type="button"
          data-testid="activate-cash"
          disabled={!key.trim() || syncing}
          onClick={() => onActivate(key)}
        >
          <LockKeyhole size={21} />
          {syncing ? "Подключаем..." : "Подключить кассу"}
        </button>
        <div className="activation-hint">
          Демо-ключи: <strong>UROJ-2026-0001</strong> и <strong>TEXT-2026-0001</strong>
        </div>
      </section>
    </main>
  );
}

function StyledSelect({
  value,
  options,
  onChange
}: {
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className={`styled-select ${open ? "open" : ""}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setOpen(false);
      }
    }}>
      <button type="button" className="styled-select-trigger" onClick={() => setOpen((next) => !next)}>
        <span>{selected?.label ?? "Выберите"}</span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className="styled-select-menu">
          {options.map((option) => (
            <button
              type="button"
              className={option.value === value ? "active" : ""}
              disabled={option.disabled}
              key={option.value}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DiscountPicker({
  value,
  amount,
  compact = false,
  onChange
}: {
  value: DiscountType;
  amount: number;
  compact?: boolean;
  onChange: (type: DiscountType, amount: number) => void;
}) {
  const types: { value: DiscountType; label: string }[] = [
    { value: "none", label: compact ? "Без" : "Без скидки" },
    { value: "percent", label: "%" },
    { value: "amount", label: "сом" }
  ];

  return (
    <div className={`discount-picker ${compact ? "compact" : ""}`}>
      <div className="discount-picker-tabs">
        {types.map((type) => (
          <button
            type="button"
            className={value === type.value ? "active" : ""}
            key={type.value}
            onClick={() => onChange(type.value, type.value === "none" ? 0 : amount)}
          >
            {type.label}
          </button>
        ))}
      </div>
      {value !== "none" && (
        <input
          type="number"
          value={amount}
          onChange={(event) => onChange(value, Number(event.target.value))}
          title="Скидка"
        />
      )}
    </div>
  );
}

function ShiftScreen({
  binding,
  devices,
  cashiers,
  onOpenShift
}: {
  binding: CashBinding;
  devices: Device[];
  cashiers: CashEmployee[];
  onOpenShift: (cashier: CashEmployee, openingCash: number, comment: string) => void;
}) {
  const fallbackCashier: CashEmployee = {
    id: "local-default-cashier",
    name: CASHIER,
    role: "cashier",
    pin: "",
    canLoginCash: true,
    allowedStoreIds: [binding.storeId]
  };
  const availableCashiers = cashiers.length ? cashiers : [fallbackCashier];
  const [selectedCashierId, setSelectedCashierId] = useState(availableCashiers[0]?.id ?? "");
  const [openingCash, setOpeningCash] = useState(5000);
  const [comment, setComment] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const selectedCashier =
    availableCashiers.find((cashier) => cashier.id === selectedCashierId) ?? availableCashiers[0] ?? null;

  useEffect(() => {
    if (!availableCashiers.some((cashier) => cashier.id === selectedCashierId)) {
      setSelectedCashierId(availableCashiers[0]?.id ?? "");
    }
  }, [availableCashiers, selectedCashierId]);

  const submitShift = () => {
    if (!selectedCashier) {
      setError("В snapshot нет кассиров, которым разрешен вход на кассу.");
      return;
    }
    if (selectedCashier.pin && selectedCashier.pin !== pin.trim()) {
      setError("PIN кассира введен неверно.");
      return;
    }
    setError("");
    onOpenShift(selectedCashier, openingCash, comment);
  };

  return (
    <main className="shift-page" data-testid="shift-screen">
      <section className="shift-left">
        <div className="hello-icon">
          <UserRound size={35} />
        </div>
        <div>
          <h1>Вход на смену</h1>
          <p>{binding.storeName}. Начните работу, открыв смену.</p>
        </div>

        <div className="form-panel">
          <label>
            Кассир
            <div className="select-like">
              <UserRound size={18} />
              <StyledSelect
                value={selectedCashier?.id ?? ""}
                options={availableCashiers.map((cashier) => ({
                  value: cashier.id,
                  label: `${cashier.name} - ${roleTitle(cashier.role)}`
                }))}
                onChange={(value) => {
                  setSelectedCashierId(value);
                  setPin("");
                  setError("");
                }}
              />
            </div>
          </label>
          <label>
            PIN / пароль кассы
            <input
              value={pin}
              type="password"
              inputMode="numeric"
              placeholder={selectedCashier?.pin ? "Введите PIN из админки" : "PIN не требуется"}
              onChange={(event) => {
                setPin(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitShift();
                }
              }}
            />
          </label>
          <label>
            Сумма в кассе
            <div className="money-input">
              <input
                value={openingCash}
                type="number"
                min={0}
                onChange={(event) => setOpeningCash(Number(event.target.value))}
              />
              <span>сом</span>
            </div>
          </label>
          <label>
            Комментарий
            <input
              value={comment}
              placeholder="Например: утренняя смена"
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          {error && <div className="shift-error">{error}</div>}
        </div>

        <button className="primary-action" type="button" data-testid="open-shift" onClick={submitShift}>
          <LockKeyhole size={21} />
          Открыть смену
        </button>
      </section>

      <aside className="shift-right">
        <div className="date-card">
          <div>
            <CalendarDays size={25} />
            <span>Сегодня</span>
            <strong>{formatLongDate(new Date())}</strong>
          </div>
          <div>
            <Clock3 size={25} />
            <span>Время</span>
            <strong>{formatClock(new Date())}</strong>
          </div>
        </div>

        <div className="info-panel">
          <h3>Информация о кассе</h3>
          <InfoLine label="Магазин:" value={binding.storeName} />
          <InfoLine label="Касса:" value={binding.registerId} />
          <InfoLine label="Последнее обновление:" value={formatReceiptTime(binding.lastSyncAt)} />
          <InfoLine label="Статус:" value="Готова к смене" positive />
        </div>

        <div className="info-panel">
          <h3>Состояние оборудования</h3>
          {devices.slice(0, 4).map((device) => (
            <div className="device-summary" key={device.id}>
              <CheckCircle2 size={17} />
              <span>{device.name}</span>
              <strong>{device.enabled ? statusLabel(device.status) : "Отключено"}</strong>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}

function SaleScreen({
  categories,
  selectedCategory,
  onCategoryChange,
  products,
  productSearch,
  setProductSearch,
  receiptNumber,
  cart,
  customers,
  selectedCustomerId,
  onSelectCustomer,
  onSaveCustomer,
  subtotal,
  discount,
  receiptDiscountType,
  receiptDiscountValue,
  onReceiptDiscountChange,
  total,
  onAddProduct,
  onUniversalProduct,
  onPay,
  onSuspend,
  onRefresh,
  onCloseShift,
  onClear,
  onReturn,
  onChangeQty,
  onItemDiscountChange,
  onEditPrice,
  onRemoveItem
}: {
  categories: Category[];
  selectedCategory: string;
  onCategoryChange: (id: string) => void;
  products: Product[];
  productSearch: string;
  setProductSearch: (value: string) => void;
  receiptNumber: string;
  cart: CartItem[];
  customers: Customer[];
  selectedCustomerId: string;
  onSelectCustomer: (id: string) => void;
  onSaveCustomer: (input: { name: string; phone: string; comment: string }) => void;
  subtotal: number;
  discount: number;
  receiptDiscountType: DiscountType;
  receiptDiscountValue: number;
  onReceiptDiscountChange: (type: DiscountType, value: number) => void;
  total: number;
  onAddProduct: (product: Product) => void;
  onUniversalProduct: () => void;
  onPay: (method: PaymentMethod) => void;
  onSuspend: () => void;
  onRefresh: () => void;
  onCloseShift: () => void;
  onClear: () => void;
  onReturn: () => void;
  onChangeQty: (productId: string, delta: number) => void;
  onItemDiscountChange: (productId: string, type: DiscountType, value: number) => void;
  onEditPrice: (item: CartItem) => void;
  onRemoveItem: (productId: string) => void;
}) {
  const currentCategory = categories.find((category) => category.id === selectedCategory);
  const hasSearch = Boolean(productSearch.trim());
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", comment: "" });
  const [customerQuery, setCustomerQuery] = useState("");
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const customerMatches = customerQuery.trim()
    ? customers
        .filter((customer) => {
          const value = customerQuery.trim().toLowerCase();
          return customer.name.toLowerCase().includes(value) || customer.phone.toLowerCase().includes(value);
        })
        .slice(0, 4)
    : [];

  return (
    <main className="sale-layout" data-testid="sale-screen">
      <CategoryRail
        categories={categories}
        selectedCategory={selectedCategory}
        onCategoryChange={onCategoryChange}
      />

      <section className="catalog-panel">
        <h1>{hasSearch ? "Поиск по всем товарам" : currentCategory?.name ?? "Товары"}</h1>
        <div className="catalog-tools">
          <div className="product-search">
            <Search size={21} />
            <input
              ref={productSearchRef}
              data-testid="product-search"
              placeholder="Поиск товара / штрихкод / SKU"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && products[0]) {
                  onAddProduct(products[0]);
                  setProductSearch("");
                  event.preventDefault();
                }
              }}
            />
            {productSearch.trim() && (
              <button
                className="search-clear-button"
                type="button"
                aria-label="Очистить поиск"
                onClick={() => {
                  setProductSearch("");
                  productSearchRef.current?.focus();
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>
          <button className="loyalty-button" type="button" onClick={onRefresh}>
            <RefreshCw size={22} />
            Обновить товары из админки
          </button>
          <button className="universal-product-button" type="button" onClick={onUniversalProduct}>
            <ShoppingBasket size={22} />
            Универсальный товар
          </button>
        </div>

        <div className="catalog-grid">
          {products.map((product) => (
            <button
              className="product-card"
              type="button"
              key={product.id}
              data-product-id={product.id}
              onClick={() => onAddProduct(product)}
            >
              <ProductArt product={product} />
              <span>{product.name}</span>
              <div className="product-card-meta">
                <strong>{formatMoneyCompact(product.salePrice ?? product.price)}</strong>
                <small>Остаток: {formatQty(product.stock)} {product.unit}</small>
              </div>
            </button>
          ))}
          {products.length === 0 && (
            <div className="catalog-empty">Товаров не найдено</div>
          )}
        </div>
      </section>

      <section className="compact-receipt-panel">
        <h2>Чек №: {receiptNumber}</h2>
        <div className="customer-box">
          <div className="customer-box-title">Клиент</div>
          <div className="customer-search-line">
            <UserRound size={16} />
            <input
              value={customerQuery}
              placeholder={selectedCustomer ? selectedCustomer.name : "Клиент: имя или телефон"}
              onChange={(event) => {
                setCustomerQuery(event.target.value);
                if (!event.target.value.trim()) {
                  onSelectCustomer("");
                }
              }}
            />
            {selectedCustomer && (
              <button type="button" onClick={() => { onSelectCustomer(""); setCustomerQuery(""); }}>
                ×
              </button>
            )}
          </div>
          {selectedCustomer && (
            <div className="selected-customer-chip">
              <span>{selectedCustomer.name}</span>
              {selectedCustomer.debtBalance > 0 && <strong>долг {formatMoneyCompact(selectedCustomer.debtBalance)}</strong>}
            </div>
          )}
          {customerMatches.length > 0 && (
            <div className="customer-suggestions">
              {customerMatches.map((customer) => (
                <button
                  type="button"
                  key={customer.id}
                  onClick={() => {
                    onSelectCustomer(customer.id);
                    setCustomerQuery("");
                  }}
                >
                  <span>{customer.name}</span>
                  <small>{customer.phone || "без телефона"} {customer.debtBalance > 0 ? ` · долг ${formatMoneyCompact(customer.debtBalance)}` : ""}</small>
                </button>
              ))}
            </div>
          )}
          <div className="new-customer-compact">
            <input placeholder="Новый клиент" value={newCustomer.name} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} />
            <input placeholder="Телефон" value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} />
            <button
              type="button"
              onClick={() => {
                if (!newCustomer.name.trim()) return;
                onSaveCustomer(newCustomer);
                setNewCustomer({ name: "", phone: "", comment: "" });
              }}
            >
              Добавить
            </button>
          </div>
        </div>
        <div className="compact-receipt-list">
          {cart.length === 0 ? (
            <div className="compact-empty">Добавьте товар нажатием на карточку</div>
          ) : (
            cart.map((item) => (
              <div className="compact-receipt-item" key={item.productId}>
                <div className="compact-item-top">
                  <strong>{item.name}</strong>
                  <span>{formatMoneyCompact(item.total)}</span>
                </div>
                <div className="compact-item-bottom">
                  <div className="qty-control small">
                    <button type="button" onClick={() => onChangeQty(item.productId, -1)} title="Уменьшить">
                      <ChevronLeft size={14} />
                    </button>
                    <span>
                      {formatQty(item.qty)} {item.unit}
                    </span>
                    <button type="button" onClick={() => onChangeQty(item.productId, 1)} title="Увеличить">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <button className="receipt-price-button" type="button" onClick={() => onEditPrice(item)} title="Изменить цену">
                    {formatMoneyCompact(item.price)}/{item.unit}
                  </button>
                  <DiscountPicker
                    value={item.discountType ?? "none"}
                    amount={item.discountValue ?? 0}
                    compact
                    onChange={(type, value) => onItemDiscountChange(item.productId, type, value)}
                  />
                  <button type="button" onClick={() => onRemoveItem(item.productId)} title="Удалить">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <aside className="payment-column">
        <div className="summary-panel">
          <div className="summary-line total-title">
            <span>Итого:</span>
            <strong>{formatMoney(subtotal)}</strong>
          </div>
          <div className="summary-line">
            <span>Скидка:</span>
            <strong>{formatMoney(discount)}</strong>
          </div>
          <div className="discount-controls">
            <DiscountPicker value={receiptDiscountType} amount={receiptDiscountValue} onChange={onReceiptDiscountChange} />
          </div>
          <div className="summary-line pay-total">
            <span>К оплате:</span>
            <strong>{formatMoney(total)}</strong>
          </div>
        </div>

        <button className="payment-button cash" type="button" data-testid="pay-cash" onClick={() => onPay("cash")}>
          <Banknote size={35} />
          <span>Оплатить наличными</span>
        </button>
        <button className="payment-button card" type="button" onClick={() => onPay("card")}>
          <CreditCard size={35} />
          <span>Оплатить картой</span>
        </button>
        <button className="payment-button qr" type="button" onClick={() => onPay("qr")}>
          <QrCode size={35} />
          <span>QR оплата</span>
        </button>
        <button className="payment-button debt" type="button" onClick={() => onPay("debt")}>
          <UserRound size={35} />
          <span>В долг</span>
        </button>

        <div className="side-actions">
          <button type="button" data-testid="suspend-check" onClick={onSuspend}>
            <Clock3 size={23} />
            Отложить чек
          </button>
          <button type="button" onClick={onReturn}>
            <RotateCcw size={23} />
            Возврат
          </button>
          <button type="button" onClick={onCloseShift}>
            <LockKeyhole size={23} />
            Закрыть смену
          </button>
          <button type="button" className="danger-outline" onClick={onClear}>
            <Trash2 size={23} />
            Очистить
          </button>
        </div>
      </aside>
    </main>
  );
}

function SuspendedScreen({
  categories,
  selectedCategory,
  onCategoryChange,
  search,
  setSearch,
  receipts,
  onRefresh,
  onOpen,
  onDelete
}: {
  categories: Category[];
  selectedCategory: string;
  onCategoryChange: (id: string) => void;
  search: string;
  setSearch: (value: string) => void;
  receipts: SuspendedReceipt[];
  onRefresh: () => void;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <main className="suspended-layout" data-testid="suspended-screen">
      <CategoryRail
        categories={categories}
        selectedCategory={selectedCategory}
        onCategoryChange={onCategoryChange}
      />
      <section className="list-panel">
        <div className="list-header">
          <h1>Отложенные чеки</h1>
          <div className="list-tools">
            <div className="search-box">
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по чекам или комментариям"
              />
            </div>
            <button type="button" onClick={onRefresh}>
              <RefreshCw size={18} />
              Обновить
            </button>
          </div>
        </div>

        <div className="suspended-table">
          <div className="table-head suspended-cols">
            <span>№ чека</span>
            <span>Комментарий</span>
            <span>Товаров</span>
            <span>Сумма</span>
            <span>Время</span>
            <span />
          </div>
          {receipts.map((receipt) => (
            <div className="suspended-row suspended-cols" key={receipt.id}>
              <strong>{receipt.number}</strong>
              <span>{receipt.comment || "Без комментария"}</span>
              <span>{receipt.itemsCount}</span>
              <span>{formatMoney(receipt.total)}</span>
              <span>{formatReceiptTime(receipt.createdAt)}</span>
              <div className="row-actions">
                <button className="blue-small" type="button" data-testid="open-suspended" onClick={() => onOpen(receipt.id)}>
                  Открыть
                </button>
                <button className="red-small" type="button" onClick={() => onDelete(receipt.id)} title="Удалить">
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="pagination-row">
          <span>Показано: {receipts.length} из {receipts.length} чеков</span>
          <div>
            <button type="button" title="Назад">
              <ChevronLeft size={18} />
            </button>
            <strong>1</strong>
            <button type="button" title="Вперед">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function HistoryScreen({
  receipts,
  onRefresh,
  onReturn
}: {
  receipts: Receipt[];
  onRefresh: () => void;
  onReturn: (receipt: Receipt) => void;
}) {
  const total = receipts.reduce((sum, receipt) => sum + (receipt.status === "returned" ? -receipt.total : receipt.total), 0);
  const [previewReceipt, setPreviewReceipt] = useState<Receipt | null>(null);
  const [previewItems, setPreviewItems] = useState<ReceiptItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMessage, setPreviewMessage] = useState("");

  const openPreview = async (receipt: Receipt) => {
    setPreviewReceipt(receipt);
    setPreviewItems([]);
    setPreviewMessage("");
    setPreviewLoading(true);
    try {
      setPreviewItems(await window.kassaApi.receipts.items(receipt.id));
    } catch (error) {
      setPreviewMessage(error instanceof Error ? error.message : "Не удалось открыть чек.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const printPreview = async () => {
    if (!previewReceipt) {
      return;
    }
    setPreviewMessage("Печатаем чек...");
    try {
      await window.kassaApi.receipts.print(previewReceipt.id);
      setPreviewMessage("Чек отправлен на принтер.");
    } catch (error) {
      setPreviewMessage(error instanceof Error ? error.message : "Не удалось напечатать чек.");
    }
  };

  return (
    <main className="history-layout" data-testid="history-screen">
      <section className="list-panel">
        <div className="list-header">
          <div>
            <h1>История продаж</h1>
            <p>{receipts.length} чеков на сумму {formatMoney(total)}</p>
          </div>
          <div className="list-tools">
            <button type="button" onClick={onRefresh}>
              <RefreshCw size={18} />
              Обновить
            </button>
          </div>
        </div>
        <div className="history-table">
          <div className="table-head history-cols">
            <span>№ чека</span>
            <span>Дата</span>
            <span>Кассир</span>
            <span>Оплата</span>
            <span>Сумма</span>
            <span>Статус</span>
            <span />
          </div>
          {receipts.map((receipt) => (
            <div className="history-row history-cols" key={receipt.id}>
              <button className="receipt-number-link" type="button" onClick={() => openPreview(receipt)}>
                {receipt.number}
              </button>
              <span>{formatReceiptTime(receipt.createdAt)}</span>
              <span>{receipt.cashier}</span>
              <span>{paymentLabels[receipt.paymentMethod]}</span>
              <span>{receipt.status === "returned" ? "-" : ""}{formatMoney(receipt.total)}</span>
              <span className={receipt.status === "paid" ? "positive" : "danger-text"}>
                {receipt.status === "paid" ? "Оплачен" : `Возврат${receipt.originalReceiptNumber ? ` к № ${receipt.originalReceiptNumber}` : ""}`}
              </span>
              <div className="row-actions">
                {receipt.status === "paid" && (
                  <button className="blue-small" type="button" onClick={() => onReturn(receipt)}>
                    Возврат
                  </button>
                )}
              </div>
            </div>
          ))}
          {receipts.length === 0 && <div className="history-empty">Продаж пока нет</div>}
        </div>
      </section>
      {previewReceipt && (
        <div className="modal-backdrop">
          <section className="receipt-preview-card">
            <button className="modal-close" type="button" onClick={() => setPreviewReceipt(null)} title="Закрыть">
              <X size={18} />
            </button>
            <div className="receipt-preview-head">
              <div>
                <h2>Чек № {previewReceipt.number}</h2>
                <p>{formatReceiptTime(previewReceipt.createdAt)} · {previewReceipt.cashier}</p>
              </div>
              <span className={previewReceipt.status === "paid" ? "positive" : "danger-text"}>
                {previewReceipt.status === "paid" ? "Оплачен" : "Возврат"}
              </span>
            </div>
            <div className="receipt-preview-items">
              {previewLoading && <div className="history-empty">Загрузка чека...</div>}
              {!previewLoading && previewItems.map((item) => (
                <div className="receipt-preview-item" key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{formatQty(item.qty)} {item.unit} x {formatMoneyCompact(item.price)}</span>
                  <b>{formatMoney(item.total)}</b>
                </div>
              ))}
              {!previewLoading && previewItems.length === 0 && !previewMessage && (
                <div className="history-empty">Позиций в чеке не найдено</div>
              )}
            </div>
            <div className="receipt-preview-summary">
              <InfoLine label="Оплата:" value={paymentLabels[previewReceipt.paymentMethod]} />
              <InfoLine label="Скидка:" value={formatMoney(previewReceipt.discount)} />
              <InfoLine label={previewReceipt.status === "returned" ? "К возврату:" : "Итого:"} value={formatMoney(previewReceipt.total)} />
            </div>
            {previewMessage && <div className="entry-error neutral">{previewMessage}</div>}
            <div className="receipt-preview-actions">
              <button className="ghost-action" type="button" onClick={() => setPreviewReceipt(null)}>Закрыть</button>
              <button className="primary-action" type="button" onClick={printPreview}>
                <Printer size={18} />
                Печать
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function DebtorsScreen({
  customers,
  onRefresh,
  onPayDebt
}: {
  customers: Customer[];
  onRefresh: () => void;
  onPayDebt: (customerId: string, amount: number, paymentMethod: Exclude<PaymentMethod, "debt">) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const totalDebt = customers.reduce((sum, customer) => sum + customer.debtBalance, 0);

  return (
    <main className="history-layout" data-testid="debtors-screen">
      <section className="list-panel">
        <div className="list-header">
          <div>
            <h1>Должники</h1>
            <p>{customers.length} клиентов на сумму {formatMoney(totalDebt)}</p>
          </div>
          <div className="list-tools">
            <button type="button" onClick={onRefresh}>
              <RefreshCw size={18} />
              Обновить
            </button>
          </div>
        </div>
        <div className="history-table">
          <div className="table-head debt-cols">
            <span>Клиент</span>
            <span>Телефон</span>
            <span>Долг</span>
            <span>Сумма</span>
            <span>Погасить</span>
          </div>
          {customers.map((customer) => {
            const amount = Number(amounts[customer.id] || customer.debtBalance || 0);
            return (
              <div className="history-row debt-cols" key={customer.id}>
                <strong>{customer.name}</strong>
                <span>{customer.phone || "-"}</span>
                <span className="danger-text">{formatMoney(customer.debtBalance)}</span>
                <input
                  type="number"
                  value={amounts[customer.id] ?? String(customer.debtBalance)}
                  onChange={(event) => setAmounts({ ...amounts, [customer.id]: event.target.value })}
                />
                <div className="debt-pay-actions">
                  <button type="button" onClick={() => onPayDebt(customer.id, amount, "cash")}>Нал</button>
                  <button type="button" onClick={() => onPayDebt(customer.id, amount, "card")}>Карта</button>
                  <button type="button" onClick={() => onPayDebt(customer.id, amount, "qr")}>QR</button>
                </div>
              </div>
            );
          })}
          {customers.length === 0 && <div className="history-empty">Должников пока нет</div>}
        </div>
      </section>
    </main>
  );
}

function SettingsScreen({
  tab,
  setTab,
  devices,
  binding,
  serialPorts,
  onUpdateDevice,
  onTestMiniDisplay,
  onRefreshDevices,
  onLogoutAccount
}: {
  tab: SettingsTab;
  setTab: (tab: SettingsTab) => void;
  devices: Device[];
  binding: CashBinding | null;
  serialPorts: string[];
  onUpdateDevice: (input: DeviceUpdateInput) => void;
  onTestMiniDisplay: (port: string) => void;
  onRefreshDevices: () => void;
  onLogoutAccount: () => void;
}) {
  return (
    <main className="settings-layout" data-testid="settings-screen">
      <aside className="settings-menu">
        <h2>Настройки</h2>
        <SettingsMenuButton active={tab === "equipment"} icon={CreditCard} label="Оборудование" onClick={() => setTab("equipment")} />
        <SettingsMenuButton active={tab === "payment"} icon={WalletCards} label="Оплата" onClick={() => setTab("payment")} />
        <SettingsMenuButton active={tab === "interface"} icon={SlidersHorizontal} label="Интерфейс" onClick={() => setTab("interface")} />
        <SettingsMenuButton active={tab === "print"} icon={Printer} label="Печать" onClick={() => setTab("print")} />
        <button className="about-button" type="button">
          <Info size={18} />
          О программе
        </button>
      </aside>

      <section className="settings-content">
        <div className="settings-title">
          <div>
            <h1>{settingsTitle(tab)}</h1>
            <p>
              {tab === "equipment"
                ? "Настройка и подключение оборудования"
                : "Раздел подготовлен для следующей версии"}
            </p>
          </div>
          <button className="ghost-save" type="button" disabled>
            <Save size={18} />
            Сохранить изменения
          </button>
        </div>

        {tab === "equipment" ? (
          <div className="equipment-panel">
            <div className="binding-strip">
              <strong>{binding?.accountName}</strong>
              <span>Касса привязана: {binding?.registerId}</span>
              <span>Последнее обновление: {binding ? formatReceiptTime(binding.lastSyncAt) : ""}</span>
            </div>
            {devices.map((device) => {
              const Icon = deviceIcons[device.id] ?? CreditCard;
              return (
                <div className="device-row" key={device.id}>
                  <div className="device-main">
                    <Icon size={28} />
                    <div>
                      <strong>{device.name}</strong>
                      <span>{device.subtitle}</span>
                    </div>
                  </div>
                  <div className="select-like device-port-select">
                    <StyledSelect
                      value={device.port}
                      options={portOptions(device, serialPorts).map((port) => ({ value: port, label: port }))}
                      onChange={(port) => onUpdateDevice({ id: device.id, port })}
                    />
                  </div>
                  <button
                    className={`device-toggle ${device.enabled ? "enabled" : "disabled"}`}
                    type="button"
                    onClick={() =>
                      onUpdateDevice({
                        id: device.id,
                        enabled: !device.enabled,
                        status: !device.enabled ? (device.id === "qr" ? "online" : "connected") : "offline"
                      })
                    }
                  >
                    {device.enabled ? "Включено" : "Отключено"}
                  </button>
                  <button
                    className={`status-pill ${device.status}`}
                    type="button"
                    onClick={() =>
                      onUpdateDevice({
                        id: device.id,
                        status: device.status === "offline" ? (device.id === "qr" ? "online" : "connected") : "offline"
                      })
                    }
                    disabled={!device.enabled}
                  >
                    <CheckCircle2 size={17} />
                    {device.enabled ? statusLabel(device.status) : "Отключено"}
                  </button>
                  <button
                    className={device.id === "display" ? "device-test-button" : "icon-button"}
                    type="button"
                    title={device.id === "display" ? "Отправить 123.45 на мини-экран" : "Параметры"}
                    onClick={device.id === "display" ? () => onTestMiniDisplay(device.port) : undefined}
                    disabled={device.id === "display" && !/^COM\d+$/i.test(device.port)}
                  >
                    {device.id === "display" ? "Тест" : <Settings size={18} />}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="placeholder-panel">
            <SlidersHorizontal size={36} />
            <h3>{settingsTitle(tab)}</h3>
          </div>
        )}

        <div className="settings-actions">
          <button type="button" data-testid="refresh-devices" onClick={onRefreshDevices}>
            <RefreshCw size={18} />
            Проверить все устройства
          </button>
          <button className="danger-service-button" type="button" onClick={onLogoutAccount}>
            <LockKeyhole size={18} />
            Сервисный выход из аккаунта
          </button>
        </div>
      </section>
    </main>
  );
}

function ReturnReceiptDialog({
  receipt,
  products,
  onConfirm,
  onClose
}: {
  receipt: Receipt;
  products: Product[];
  onConfirm: (receipt: Receipt, items: CartItem[], paymentMethod: PaymentMethod, reason: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [qtyById, setQtyById] = useState<Record<number, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(receipt.paymentMethod === "debt" ? "debt" : receipt.paymentMethod);
  const [reason, setReason] = useState("Возврат товара");
  const [loadingItems, setLoadingItems] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoadingItems(true);
    window.kassaApi.receipts.items(receipt.id)
      .then((rows) => {
        if (!alive) return;
        setItems(rows);
        setQtyById(Object.fromEntries(rows.map((item) => [item.id, String(item.qty)])));
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoadingItems(false);
      });
    return () => {
      alive = false;
    };
  }, [receipt.id]);

  const selectedItems = items
    .map((item) => {
      const qty = roundQty(Math.min(Number(qtyById[item.id] || 0), item.qty));
      const product = products.find((row) => row.id === item.productId);
      const discountPerUnit = item.qty > 0 ? (item.discountAmount ?? 0) / item.qty : 0;
      const discountAmount = roundMoney(discountPerUnit * qty);
      return {
        productId: item.productId,
        name: item.name,
        qty,
        unit: item.unit,
        price: item.price,
        purchasePrice: product?.purchasePrice ?? 0,
        discountType: item.discountType ?? "none",
        discountValue: item.discountValue ?? 0,
        discountAmount,
        total: roundMoney(Math.max(0, item.price * qty - discountAmount))
      };
    })
    .filter((item) => item.qty > 0);
  const returnTotal = roundMoney(selectedItems.reduce((sum, item) => sum + item.total, 0));
  const canReturn = selectedItems.length > 0 && returnTotal > 0 && (paymentMethod !== "debt" || Boolean(receipt.customerId));

  return (
    <div className="modal-backdrop">
      <section className="return-card" data-testid="return-dialog">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>
        <div className="return-head">
          <div>
            <h2>Возврат по чеку № {receipt.number}</h2>
            <p>{formatReceiptTime(receipt.createdAt)} · {paymentLabels[receipt.paymentMethod]} · {formatMoney(receipt.total)}</p>
          </div>
          <strong>{formatMoney(returnTotal)}</strong>
        </div>
        {loadingItems ? (
          <div className="compact-empty">Загружаем позиции чека...</div>
        ) : (
          <div className="return-items">
            {items.map((item) => (
              <div className="return-item-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{formatMoneyCompact(item.price)}/{item.unit} · в чеке {formatQty(item.qty)} {item.unit}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={item.qty}
                  step={qtyStep(item.unit)}
                  value={qtyById[item.id] ?? "0"}
                  onChange={(event) => setQtyById({ ...qtyById, [item.id]: event.target.value })}
                />
              </div>
            ))}
          </div>
        )}
        <div className="return-controls">
          <label>
            Способ возврата
            <div className="select-like">
              <StyledSelect
                value={paymentMethod}
                options={[
                  { value: "cash", label: "Наличные" },
                  { value: "card", label: "Карта" },
                  { value: "qr", label: "QR" },
                  { value: "debt", label: "Корректировка долга", disabled: !receipt.customerId }
                ]}
                onChange={(value) => setPaymentMethod(value as PaymentMethod)}
              />
            </div>
          </label>
          <label>
            Причина
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        </div>
        {paymentMethod === "debt" && !receipt.customerId && (
          <div className="entry-error">Корректировка долга доступна только для чека с клиентом.</div>
        )}
        <button
          className="danger-action modal-action"
          type="button"
          disabled={!canReturn}
          onClick={() => onConfirm(receipt, selectedItems, paymentMethod, reason.trim() || "Возврат товара")}
        >
          Провести возврат
        </button>
      </section>
    </div>
  );
}

function CashPaymentDialog({
  total,
  onConfirm,
  onClose
}: {
  total: number;
  onConfirm: (paidAmount: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(String(Math.ceil(total)));
  const paidAmount = Number(value || 0);
  const change = roundMoney(Math.max(0, paidAmount - total));

  return (
    <div className="modal-backdrop">
      <section className="cash-entry-card" data-testid="cash-payment-dialog">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>
        <h2>Оплата наличными</h2>
        <div className="cash-entry-totals">
          <InfoLine label="К оплате:" value={formatMoney(total)} />
          <InfoLine label="Клиент дал:" value={formatMoney(paidAmount)} />
          <InfoLine label="Сдача:" value={formatMoney(change)} positive={paidAmount >= total} />
        </div>
        <TouchMoneyInput value={value} onChange={setValue} />
        {paidAmount < total && <div className="entry-error">Сумма меньше итога чека.</div>}
        <button
          className="primary-action modal-action"
          type="button"
          disabled={paidAmount < total}
          onClick={() => onConfirm(roundMoney(paidAmount))}
        >
          Подтвердить оплату
        </button>
      </section>
    </div>
  );
}

function getQrPaymentPayload(order: QrPaymentOrder): string {
  const rawQrUrl = String(order.qrUrl || "").trim();
  if (!rawQrUrl) {
    return String(order.paymentUrl || "").trim();
  }

  const hashIndex = rawQrUrl.indexOf("#");
  if (hashIndex >= 0 && hashIndex < rawQrUrl.length - 1) {
    return normalizeEmvQrPayload(rawQrUrl.slice(hashIndex + 1));
  }

  return rawQrUrl;
}

function getQrPaymentLinkPayload(order: QrPaymentOrder): string {
  return String(order.qrUrl || order.paymentUrl || "").trim();
}

function normalizeEmvQrPayload(fragment: string): string {
  const raw = fragment.trim();
  const variants = uniqueStrings([
    raw,
    safeDecodeUriComponent(raw),
    raw.replace(/\+/g, " "),
    safeDecodeUriComponent(raw.replace(/\+/g, "%20"))
  ]).filter(Boolean);

  const validVariant = variants.find(hasValidEmvCrc);
  if (validVariant) {
    return validVariant;
  }

  const repairableVariant = variants.find(canRepairEmvCrc);
  return repairableVariant ? repairEmvCrc(repairableVariant) : variants[0] || raw;
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function hasValidEmvCrc(payload: string): boolean {
  const marker = payload.lastIndexOf("6304");
  if (marker < 0 || marker + 8 > payload.length) {
    return false;
  }
  const expected = payload.slice(marker + 4, marker + 8).toUpperCase();
  if (!/^[0-9A-F]{4}$/.test(expected)) {
    return false;
  }
  const calculated = emvCrc16(payload.slice(0, marker + 4));
  return calculated === expected;
}

function canRepairEmvCrc(payload: string): boolean {
  const marker = payload.lastIndexOf("6304");
  return marker >= 0 && marker + 8 <= payload.length;
}

function repairEmvCrc(payload: string): string {
  const marker = payload.lastIndexOf("6304");
  if (marker < 0 || marker + 8 > payload.length) {
    return payload;
  }
  const calculated = emvCrc16(payload.slice(0, marker + 4));
  return `${payload.slice(0, marker + 4)}${calculated}${payload.slice(marker + 8)}`;
}

function emvCrc16(value: string): string {
  let crc = 0xffff;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function QrPaymentDialog({
  order,
  total,
  completing,
  onPaid,
  onClose
}: {
  order: QrPaymentOrder;
  total: number;
  completing: boolean;
  onPaid: () => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState(order.status || "PENDING");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paymentUrl = order.paymentUrl || order.qrUrl;
  const qrPayload = getQrPaymentLinkPayload(order);

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas || !qrPayload) {
      return;
    }

    try {
      const writer = new QRCodeWriter();
      const matrix = writer.encode(qrPayload, BarcodeFormat.QR_CODE, 420, 420, new Map());
      const size = matrix.getWidth();
      const scale = Math.max(1, Math.floor(420 / size));
      const canvasSize = size * scale;
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      context.imageSmoothingEnabled = false;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvasSize, canvasSize);
      context.fillStyle = "#020617";
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (matrix.get(x, y)) {
            context.fillRect(x * scale, y * scale, scale, scale);
          }
        }
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось нарисовать QR-код.");
    }
  }, [qrPayload]);

  const checkStatus = useCallback(async () => {
    if (checkingRef.current || completing) {
      return;
    }
    checkingRef.current = true;
    setChecking(true);
    try {
      const fresh = await window.kassaApi.qr.getStatus(order.txnId);
      const freshStatus = String(fresh.status || "").toUpperCase();
      setStatus(freshStatus);
      setError("");
      if (freshStatus === "SUCCESS") {
        onPaid();
      }
      if (freshStatus === "ERROR" || freshStatus === "EXPIRED") {
        setError(freshStatus === "EXPIRED" ? "Срок QR оплаты истек." : "Банк вернул ошибку оплаты.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось проверить QR оплату.");
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [completing, onPaid, order.txnId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void checkStatus();
    }, 1000);
    void checkStatus();
    return () => window.clearInterval(timer);
  }, [checkStatus]);

  return (
    <div className="modal-backdrop">
      <section className="qr-payment-card" data-testid="qr-payment-dialog">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть" disabled={completing}>
          <X size={18} />
        </button>
        <h2>QR оплата</h2>
        <p>Попросите клиента отсканировать QR-ссылку банка с экрана.</p>
        <div className="qr-payment-frame">
          {qrPayload ? (
            <canvas ref={qrCanvasRef} className="qr-payment-canvas" aria-label="QR код оплаты" />
          ) : (
            <div className="qr-payment-empty">Банк не вернул QR-код.</div>
          )}
        </div>
        <div className="qr-payment-info">
          <InfoLine label="Сумма:" value={formatMoney(total)} />
          <InfoLine label="Статус:" value={status} positive={status === "SUCCESS"} />
          <InfoLine label="Транзакция:" value={order.txnId} />
        </div>
        {paymentUrl && (
          <a className="qr-payment-link" href={paymentUrl} target="_blank" rel="noreferrer">
            Открыть ссылку оплаты
          </a>
        )}
        {error && <div className="entry-error">{error}</div>}
        <button
          className="primary-action modal-action"
          type="button"
          disabled={checking || completing}
          onClick={() => void checkStatus()}
        >
          {completing ? "Пробиваем чек..." : checking ? "Проверяем..." : "Проверить статус"}
        </button>
      </section>
    </div>
  );
}

function QuantityDialog({
  product,
  onConfirm,
  onClose
}: {
  product: Product;
  onConfirm: (qty: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const qty = Number(value || 0);

  return (
    <div className="modal-backdrop">
      <section className="cash-entry-card" data-testid="quantity-dialog">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>
        <h2>Количество товара</h2>
        <p className="entry-note">{product.name}</p>
        <div className="cash-entry-totals">
          <InfoLine label="Ед. изм.:" value={product.unit} />
          <InfoLine label="Цена:" value={`${formatMoneyCompact(product.salePrice ?? product.price)}/${product.unit}`} />
          <InfoLine label="Количество:" value={`${formatQty(qty)} ${product.unit}`} positive={qty > 0} />
        </div>
        <TouchMoneyInput value={value} onChange={setValue} />
        {qty <= 0 && <div className="entry-error">Введите количество больше 0.</div>}
        <button
          className="primary-action modal-action"
          type="button"
          disabled={qty <= 0}
          onClick={() => onConfirm(roundQty(qty))}
        >
          Добавить в чек
        </button>
      </section>
    </div>
  );
}

function CashProductDialog({
  barcode,
  categories,
  onConfirm,
  onClose
}: {
  barcode: string;
  categories: Category[];
  onConfirm: (input: CashProductInput) => void;
  onClose: () => void;
}) {
  const lookup = lookupProductByBarcode(barcode);
  const [draft, setDraft] = useState<CashProductInput>({
    barcode: normalizeBarcode(barcode),
    name: lookup?.name ?? "",
    categoryId: categories[0]?.id ?? UNCATEGORIZED_CATEGORY_ID,
    unit: lookup?.unit ?? "шт",
    purchasePrice: lookup?.purchasePrice ?? 0,
    salePrice: lookup?.salePrice ?? 0
  });
  const canSave = draft.name.trim() && draft.barcode.trim() && Number(draft.salePrice) > 0;

  return (
    <div className="modal-backdrop">
      <section className="cash-entry-card cash-product-card" data-testid="cash-product-dialog">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>
        <h2>Создать товар</h2>
        <p className="entry-note">Штрихкод не найден в базе этой кассы. Заполните товар, и он сразу попадет в чек.</p>
        <label className="cash-form-field">
          Штрихкод
          <input value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: normalizeBarcode(event.target.value) })} />
        </label>
        <label className="cash-form-field">
          Название
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
        </label>
        <div className="cash-form-grid">
          <label className="cash-form-field">
            Цена закуп
            <input type="number" value={draft.purchasePrice || ""} onChange={(event) => setDraft({ ...draft, purchasePrice: Number(event.target.value) })} />
          </label>
          <label className="cash-form-field">
            Цена продажи
            <input type="number" value={draft.salePrice || ""} onChange={(event) => setDraft({ ...draft, salePrice: Number(event.target.value) })} />
          </label>
        </div>
        <div className="cash-form-grid">
          <label className="cash-form-field">
            Категория
            <select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
              {categories.map((category) => (
                <option value={category.id} key={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label className="cash-form-field">
            Ед. изм.
            <select value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })}>
              {["шт", "кг", "литр", "метр"].map((unit) => (
                <option value={unit} key={unit}>{unit}</option>
              ))}
            </select>
          </label>
        </div>
        {lookup && <div className="entry-success">Название найдено в общей базе, его можно изменить.</div>}
        {!canSave && <div className="entry-error">Название и цена продажи обязательны.</div>}
        <button
          className="primary-action modal-action"
          type="button"
          disabled={!canSave}
          onClick={() => onConfirm({ ...draft, salePrice: roundMoney(Number(draft.salePrice)), purchasePrice: roundMoney(Number(draft.purchasePrice || 0)) })}
        >
          Создать и добавить
        </button>
      </section>
    </div>
  );
}

function UniversalProductDialog({
  onConfirm,
  onClose
}: {
  onConfirm: (amount: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const amount = Number(value || 0);

  return (
    <div className="modal-backdrop">
      <section className="cash-entry-card" data-testid="universal-product-dialog">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>
        <h2>Универсальный товар</h2>
        <p className="entry-note">Введите сумму мелкого товара. Остаток по складу не меняется.</p>
        <div className="cash-entry-totals">
          <InfoLine label="Сумма:" value={formatMoney(amount)} positive={amount > 0} />
        </div>
        <TouchMoneyInput value={value} onChange={setValue} />
        {amount <= 0 && <div className="entry-error">Введите сумму больше 0.</div>}
        <button
          className="primary-action modal-action"
          type="button"
          disabled={amount <= 0}
          onClick={() => onConfirm(roundMoney(amount))}
        >
          Добавить в чек
        </button>
      </section>
    </div>
  );
}

function PriceEditDialog({
  item,
  onConfirm,
  onClose
}: {
  item: CartItem;
  onConfirm: (salePrice: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(String(item.price || ""));
  const salePrice = Number(value || 0);

  return (
    <div className="modal-backdrop">
      <section className="cash-entry-card" data-testid="price-edit-dialog">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>
        <h2>Изменить цену</h2>
        <p className="entry-note">{item.name}</p>
        <div className="cash-entry-totals">
          <InfoLine label="Новая цена:" value={`${formatMoneyCompact(salePrice)}/${item.unit}`} positive={salePrice > 0} />
          {!item.isUniversal && <InfoLine label="Синхронизация:" value="Цена обновится в админке" />}
        </div>
        <TouchMoneyInput value={value} onChange={setValue} suppressSystemKeyboard />
        {salePrice <= 0 && <div className="entry-error">Введите цену больше 0.</div>}
        <button
          className="primary-action modal-action"
          type="button"
          disabled={salePrice <= 0}
          onClick={() => onConfirm(roundMoney(salePrice))}
        >
          Сохранить цену
        </button>
      </section>
    </div>
  );
}

function CloseShiftDialog({
  onConfirm,
  onClose
}: {
  onConfirm: (actualCash: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const actualCash = Number(value || 0);

  return (
    <div className="modal-backdrop">
      <section className="cash-entry-card" data-testid="close-shift-dialog">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>
        <h2>Закрытие смены</h2>
        <p className="entry-note">
          Посчитайте фактическую наличку в кассе и введите сумму. Сколько должно быть, касса покажет только после закрытия.
        </p>
        <div className="cash-entry-totals">
          <InfoLine label="Фактически в кассе:" value={formatMoney(actualCash)} />
        </div>
        <TouchMoneyInput value={value} onChange={setValue} />
        <button
          className="primary-action modal-action"
          type="button"
          disabled={!value.trim()}
          onClick={() => onConfirm(roundMoney(actualCash))}
        >
          Закрыть смену
        </button>
      </section>
    </div>
  );
}

function AccountLogoutDialog({
  binding,
  syncStatus,
  onConfirm,
  onClose
}: {
  binding: CashBinding | null;
  syncStatus: SyncStatus;
  onConfirm: (force?: boolean) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const canConfirm = value.trim().toUpperCase() === "ВЫЙТИ";
  const canForceConfirm = value.trim().toUpperCase() === "СБРОС";
  const hasUnsent = syncStatus.total > 0;

  return (
    <div className="modal-backdrop">
      <section className="cash-entry-card danger-confirm-card" data-testid="account-logout-dialog">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>
        <h2>Сервисный выход из аккаунта</h2>
        <p className="entry-note">
          Касса будет отвязана от аккаунта {binding?.accountName || "магазина"} и вернется к вводу ключа.
          Продажи и смены останутся в локальной истории, но товары и настройки загрузятся заново после активации другим ключом.
        </p>
        <div className="danger-warning">
          Используйте только при настройке новой торговой точки или замене аккаунта магазина.
        </div>
        {hasUnsent && (
          <div className="danger-warning strong-warning">
            На кассе есть неотправленные данные: {syncStatus.total}. Если сервер больше не принимает старую привязку,
            напишите СБРОС, чтобы очистить очередь и отвязать кассу. Эти события не попадут в админку.
          </div>
        )}
        <label className="confirm-word-field">
          Для обычного выхода напишите ВЫЙТИ{hasUnsent ? ", для аварийного сброса - СБРОС" : ""}
          <input value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
        </label>
        <button
          className="danger-action modal-action"
          type="button"
          disabled={!canConfirm && !canForceConfirm}
          onClick={() => onConfirm(canForceConfirm)}
        >
          {canForceConfirm ? "Аварийно очистить и отвязать" : "Отвязать кассу и выйти"}
        </button>
      </section>
    </div>
  );
}

function TouchMoneyInput({
  value,
  onChange,
  suppressSystemKeyboard = true
}: {
  value: string;
  onChange: (value: string) => void;
  suppressSystemKeyboard?: boolean;
}) {
  const append = (chunk: string) => {
    if (chunk === "." && value.includes(".")) {
      return;
    }
    const next = `${value}${chunk}`.replace(/^0+(?=\d)/, "");
    onChange(next);
  };
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "00", "0", "."];

  return (
    <div className="touch-money">
      <input
        value={value}
        inputMode={suppressSystemKeyboard ? "none" : "decimal"}
        readOnly={suppressSystemKeyboard}
        tabIndex={suppressSystemKeyboard ? -1 : 0}
        autoFocus={!suppressSystemKeyboard}
        onChange={(event) => onChange(event.target.value.replace(",", "."))}
        onPointerDown={(event) => {
          if (suppressSystemKeyboard) {
            event.preventDefault();
          }
        }}
        placeholder="0"
      />
      <div className="numeric-keypad">
        {keys.map((key) => (
          <button type="button" key={key} onClick={() => append(key)}>
            {key}
          </button>
        ))}
        <button type="button" className="key-muted" onClick={() => onChange(value.slice(0, -1))}>
          ⌫
        </button>
        <button type="button" className="key-muted" onClick={() => onChange("")}>
          С
        </button>
      </div>
    </div>
  );
}

function ShiftSummaryDialog({ summary, onClose }: { summary: ShiftSummary; onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="shift-summary-card" data-testid="shift-summary">
        <button className="modal-close" type="button" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>
        <h2>Смена закрыта</h2>
        <p>
          {formatReceiptTime(summary.shift.openedAt)} -{" "}
          {summary.shift.closedAt ? formatReceiptTime(summary.shift.closedAt) : formatReceiptTime(new Date().toISOString())}
        </p>
        <div className="summary-grid">
          <InfoLine label="Выручка:" value={formatMoney(summary.revenue)} />
          <InfoLine label="Наличные:" value={formatMoney(summary.cash)} />
          <InfoLine label="Карта:" value={formatMoney(summary.card)} />
          <InfoLine label="QR:" value={formatMoney(summary.qr)} />
          <InfoLine label="Продажи в долг:" value={formatMoney(summary.debtIssued)} />
          <InfoLine label="Погашение долгов наличными:" value={formatMoney(summary.debtPaidCash)} />
          <InfoLine label="Погашение долгов картой:" value={formatMoney(summary.debtPaidCard)} />
          <InfoLine label="Погашение долгов QR:" value={formatMoney(summary.debtPaidQr)} />
          <InfoLine label="Итого получено:" value={formatMoney(summary.totalReceived)} />
          <InfoLine label="Должно быть в кассе:" value={formatMoney(summary.expectedCash)} />
          <InfoLine label="Кассир посчитал:" value={formatMoney(summary.actualCash)} />
          <InfoLine label="Разница:" value={formatMoney(summary.difference)} positive={summary.difference >= 0} />
          <InfoLine label="Чеков:" value={String(summary.receiptsCount)} />
          <InfoLine label="Возвраты:" value={formatMoney(summary.returnsTotal)} />
        </div>
        <button className="primary-action modal-action" type="button" onClick={onClose}>
          Понятно
        </button>
      </section>
    </div>
  );
}

function ProductArt({ product }: { product: Product }) {
  if (product.imageData) {
    return (
      <div className="product-art image-art" aria-hidden="true">
        <img src={product.imageData} alt="" />
      </div>
    );
  }

  const artClass = productArtClass(product.id, product.categoryId);
  const label = productArtLabel(product);

  return (
    <div className={`product-art ${artClass}`} aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}

function CategoryRail({
  categories,
  selectedCategory,
  onCategoryChange
}: {
  categories: Category[];
  selectedCategory: string;
  onCategoryChange: (id: string) => void;
}) {
  const visibleCategories = categories.filter((category) => !isUncategorizedCategory(category));

  return (
    <aside className="category-rail">
      {visibleCategories.map((category) => {
        const Icon = categoryIcons[category.icon] ?? ShoppingBasket;
        return (
          <button
            className={category.id === selectedCategory ? "active" : ""}
            style={{ "--category-color": category.color } as CSSProperties}
            key={category.id}
            type="button"
            onClick={() => onCategoryChange(category.id)}
          >
            {category.imageData ? <img src={category.imageData} alt="" /> : <Icon size={27} />}
            <span>{category.name}</span>
          </button>
        );
      })}
    </aside>
  );
}

function SettingsMenuButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      <Icon size={20} />
      {label}
    </button>
  );
}

function InfoLine({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="info-line">
      <span>{label}</span>
      <strong className={positive ? "positive" : ""}>{value}</strong>
    </div>
  );
}

function withQty(item: CartItem, qty: number): CartItem {
  const normalizedQty = roundQty(qty);
  const gross = roundMoney(normalizedQty * item.price);
  const discountAmount = calcDiscount(gross, item.discountType ?? "none", item.discountValue ?? 0);
  return {
    ...item,
    qty: normalizedQty,
    discountAmount,
    total: roundMoney(Math.max(0, gross - discountAmount))
  };
}

function calcDiscount(base: number, type: DiscountType, value: number) {
  if (type === "percent") {
    return roundMoney(Math.min(base, Math.max(0, base * (value || 0) / 100)));
  }
  if (type === "amount") {
    return roundMoney(Math.min(base, Math.max(0, value || 0)));
  }
  return 0;
}

function settingsTitle(tab: SettingsTab) {
  const titles: Record<SettingsTab, string> = {
    equipment: "Оборудование",
    payment: "Оплата",
    interface: "Интерфейс",
    print: "Печать"
  };
  return titles[tab];
}

function roleTitle(role: string) {
  if (role === "owner") {
    return "владелец";
  }
  if (role === "admin") {
    return "администратор";
  }
  if (role === "manager") {
    return "менеджер";
  }
  return "кассир";
}

function portOptions(device: Device, serialPorts: string[] = []) {
  if (device.id === "display") {
    const manualPorts = [
      "COM1",
      "COM2",
      "COM3",
      "COM4",
      "COM5",
      "COM6",
      "COM7",
      "COM8",
      "COM9",
      "COM10",
      "COM11",
      "COM12"
    ];
    return Array.from(new Set([
      "Авто",
      "Второй экран",
      "CY62K LED8N (COM2)",
      ...serialPorts,
      ...serialPorts.map((port) => `CY62K LED8N (${port})`),
      ...serialPorts.map((port) => `VFD текст 9600 (${port})`),
      ...manualPorts
    ]));
  }
  if (device.id === "printer") {
    return ["Windows", "Принтер по умолчанию"];
  }
  if (device.id === "terminal") {
    return ["LAN (192.168.1.55)", "LAN (192.168.1.56)", "USB (COM7)"];
  }
  if (device.id === "qr") {
    return ["Интернет", "MBANK API", "Локальный шлюз"];
  }
  return ["USB (COM3)", "USB (COM4)", "USB (COM5)", "USB (COM6)", "USB (COM7)"];
}

function statusLabel(status: Device["status"]) {
  if (status === "online") {
    return "Онлайн";
  }
  if (status === "offline") {
    return "Нет связи";
  }
  return "Подключено";
}

function isUncategorizedCategory(category: Category) {
  return (
    category.id === UNCATEGORIZED_CATEGORY_ID ||
    category.name.trim().toLowerCase() === UNCATEGORIZED_CATEGORY_NAME.toLowerCase()
  );
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat("ru-KG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)} сом`;
}

function formatMoneyCompact(value: number) {
  return `${new Intl.NumberFormat("ru-KG", {
    maximumFractionDigits: 0
  }).format(value)} сом`;
}

function formatQty(value: number) {
  return new Intl.NumberFormat("ru-KG", {
    maximumFractionDigits: 3
  }).format(value);
}

function isMeasuredUnit(unit: string) {
  return unit !== "шт";
}

function qtyStep(unit: string) {
  return isMeasuredUnit(unit) ? 0.1 : 1;
}

function roundQty(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function formatReceiptTime(value: string) {
  return `${formatDate(new Date(value))}, ${formatClock(new Date(value))}`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function productArtClass(productId: string, categoryId: string) {
  if (productId.includes("bread")) {
    return "art-bread";
  }
  if (productId.includes("milk") || productId.includes("kefir")) {
    return "art-milk";
  }
  if (productId.includes("coffee")) {
    return "art-coffee";
  }
  if (productId.includes("sugar")) {
    return "art-sugar";
  }
  if (productId.includes("tea")) {
    return "art-tea";
  }
  if (
    productId.includes("rice") ||
    productId.includes("buckwheat") ||
    productId.includes("pasta") ||
    productId.includes("flour")
  ) {
    return "art-grain";
  }
  if (productId.includes("oil")) {
    return "art-oil";
  }
  if (categoryId === "drinks") {
    return "art-drink";
  }
  if (categoryId === "produce") {
    return "art-produce";
  }
  if (categoryId === "meat") {
    return "art-meat";
  }
  if (categoryId === "household") {
    return "art-household";
  }
  if (categoryId === "clothes") {
    return "art-clothes";
  }
  return "art-box";
}

function productArtLabel(product: Product) {
  const words = product.name
    .replace(/["В«В»]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 2).join("\n");
}

