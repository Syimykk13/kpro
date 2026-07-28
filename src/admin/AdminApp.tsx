import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as XLSX from "xlsx";
import { BrowserMultiFormatOneDReader, BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import {
  Apple,
  BadgePercent,
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Copy,
  Croissant,
  CupSoda,
  Download,
  Fish,
  Home,
  KeyRound,
  LogOut,
  Menu,
  Milk,
  PackagePlus,
  Plus,
  Printer,
  RefreshCw,
  Save,
  ScanBarcode,
  Search,
  Settings,
  Shirt,
  ShoppingBasket,
  ShoppingCart,
  SprayCan,
  Store,
  Trash2,
  Upload,
  Users,
  X
} from "lucide-react";
import type {
  AdminAccount,
  AdminCategory,
  AdminEmployee,
  AdminPermission,
  AdminProduct,
  AdminRegister,
  AdminSale,
  AdminSession,
  AdminStore,
  AdminSnapshot,
  StockDocument,
  StockDocumentItem,
  StockOperationType,
  StockDocumentType
} from "../shared/adminTypes";
import { lookupProductByBarcode, normalizeBarcode } from "../shared/barcodeLookup";
import { generateInternalEan13 } from "../shared/ean13";
import {
  adminLogin,
  addAdminStoreWithGroups,
  categoriesForStore,
  defaultPermissionsForRole,
  findAccountContactConflict,
  issueRegisterKey,
  loadSnapshot,
  makeAdminAccount,
  makeAdminRegister,
  makeAdminStore,
  makeCategory,
  makeProduct,
  makeStockDocument,
  makeStockDocumentItem,
  normalizeEmail,
  normalizeKyrgyzPhone,
  normalizePermissions,
  postStockDocument,
  productAvailableInStore,
  productForStore,
  purchasePriceForStore,
  saveStockDocument,
  saveSnapshot,
  salePriceForStore,
  subscriptionLabel,
  updateAccount
} from "./adminStore";
import type { StoreGroupCreationMode } from "./adminStore";

type AdminView =
  | "home"
  | "products"
  | "stock"
  | "sales"
  | "employees"
  | "stores"
  | "reports"
  | "settings"
  | "clients";
type StockSection = "receipt" | "acceptance" | "writeoff" | "inventory" | "transfer" | "balances";
type ImportField = "ignore" | "name" | "barcode" | "extraBarcodes" | "category" | "stock" | "purchasePrice" | "salePrice" | "unit" | "sku";

const importFieldLabels: Record<ImportField, string> = {
  ignore: "Не импортировать",
  name: "Наименование",
  barcode: "Штрихкод",
  extraBarcodes: "Доп. штрихкоды",
  category: "Группа / категория",
  stock: "Остаток",
  purchasePrice: "Цена закуп",
  salePrice: "Цена продажи",
  unit: "Ед. изм.",
  sku: "Артикул / SKU"
};

const stockSections: { id: StockSection; label: string }[] = [
  { id: "receipt", label: "Оприходование" },
  { id: "acceptance", label: "Приемка" },
  { id: "writeoff", label: "Списание" },
  { id: "inventory", label: "Инвентаризация" },
  { id: "transfer", label: "Перемещение" },
  { id: "balances", label: "Остатки" }
];

const productUnits = ["шт", "кг", "литр", "метр"] as const;

const categoryIconOptions = [
  { id: "ShoppingBasket", label: "Бакалея", Icon: ShoppingBasket },
  { id: "CupSoda", label: "Напитки", Icon: CupSoda },
  { id: "Milk", label: "Молочное", Icon: Milk },
  { id: "Apple", label: "Овощи", Icon: Apple },
  { id: "Fish", label: "Мясо/рыба", Icon: Fish },
  { id: "BadgePercent", label: "Акции", Icon: BadgePercent },
  { id: "Croissant", label: "Хлеб", Icon: Croissant },
  { id: "SprayCan", label: "Хозтовары", Icon: SprayCan },
  { id: "Shirt", label: "Одежда", Icon: Shirt }
] as const;

const stockSectionLabels: Record<StockSection, string> = Object.fromEntries(
  stockSections.map((item) => [item.id, item.label])
) as Record<StockSection, string>;

function stockDocumentTypeFromSection(section: StockSection): StockDocumentType {
  if (section === "writeoff") return "writeoff";
  if (section === "inventory") return "inventory";
  if (section === "transfer") return "transfer";
  return "receipt";
}

const nav = [
  { id: "home", label: "Главная", icon: Home },
  { id: "products", label: "Товары", icon: ShoppingCart },
  { id: "stock", label: "Склад", icon: Boxes },
  { id: "sales", label: "Продажи", icon: BarChart3 },
  { id: "employees", label: "Сотрудники", icon: Users },
  { id: "stores", label: "Магазины", icon: Store },
  { id: "clients", label: "Клиенты", icon: Building2 },
  { id: "reports", label: "Отчеты", icon: BarChart3 },
  { id: "settings", label: "Настройки", icon: Settings }
] as const;

const ADMIN_AUTH_KEY = "kassa-pro-admin-auth-account";
const ADMIN_SESSION_KEY = "kassa-pro-admin-session";
const ADMIN_STORE_KEY = "kassa-pro-admin-store";
const UNCATEGORIZED_CATEGORY_ID = "uncategorized";
const UNCATEGORIZED_CATEGORY_NAME = "Без категории";

const permissionLabels: Record<AdminPermission, string> = {
  products: "Товары",
  stock: "Склад",
  sales: "Продажи",
  employees: "Сотрудники",
  stores: "Магазины и кассы",
  reports: "Отчеты",
  settings: "Настройки",
  viewPurchasePrice: "Видеть закупочную цену",
  editProducts: "Создавать и менять товары",
  deleteProducts: "Удалять товары",
  stockReceipt: "Оприходование / приемка",
  stockWriteoff: "Списание",
  stockInventory: "Инвентаризация",
  viewReports: "Смотреть отчеты",
  manageRegisters: "Управлять кассами",
  manageEmployees: "Управлять сотрудниками",
  manageSettings: "Менять настройки"
};

const permissionGroups: { title: string; permissions: AdminPermission[] }[] = [
  { title: "Разделы", permissions: ["products", "stock", "sales", "employees", "stores", "reports", "settings"] },
  { title: "Товары", permissions: ["viewPurchasePrice", "editProducts", "deleteProducts"] },
  { title: "Склад", permissions: ["stockReceipt", "stockWriteoff", "stockInventory"] },
  { title: "Управление", permissions: ["viewReports", "manageRegisters", "manageEmployees", "manageSettings"] }
];

export function AdminApp() {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [accountId, setAccountId] = useState("");
  const [authAccountId, setAuthAccountId] = useState(() => sessionStorage.getItem(ADMIN_AUTH_KEY) || "");
  const [adminSession, setAdminSession] = useState<AdminSession | null>(() => readAdminSession());
  const [view, setView] = useState<AdminView>("home");
  const [stockSection, setStockSection] = useState<StockSection>("receipt");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState(() => sessionStorage.getItem(ADMIN_STORE_KEY) || "");

  useEffect(() => {
    loadSnapshot().then((loaded) => {
      setSnapshot(loaded);
      const authorized = sessionStorage.getItem(ADMIN_AUTH_KEY) || "";
      const nextAccountId = loaded.accounts.some((account) => account.id === authorized) ? authorized : "";
      setAuthAccountId(nextAccountId);
      setAccountId(nextAccountId);
      if (!nextAccountId || adminSession?.accountId !== nextAccountId) {
        const restored = readAdminSession();
        setAdminSession(restored?.accountId === nextAccountId ? restored : null);
      }
    });
  }, []);

  useEffect(() => {
    if (!authAccountId) {
      return;
    }
    const timer = window.setInterval(() => {
      loadSnapshot().then(setSnapshot).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authAccountId]);

  useEffect(() => {
    navigator.serviceWorker?.getRegistrations?.().then((registrations) => {
      registrations
        .filter((registration) => registration.scope.includes("/admin") || registration.scope === `${window.location.origin}/`)
        .forEach((registration) => registration.unregister().catch(() => undefined));
    }).catch(() => undefined);
    window.caches?.keys?.().then((keys) => {
      keys.filter((key) => key.toLowerCase().includes("admin")).forEach((key) => window.caches.delete(key));
    }).catch(() => undefined);
  }, []);

  const account = snapshot?.accounts.find((item) => item.id === (authAccountId || accountId)) ?? null;
  const permissions = adminSession && adminSession.accountId === account?.id ? adminSession.permissions : [];
  const can = (permission: AdminPermission) => permissions.includes(permission);
  const availableNav = nav.filter((item) => canViewAdminNav(item.id, permissions));
  const availableStockSections = getAvailableStockSections(permissions);
  const allowedStoreIds = account ? allowedStoreIdsForSession(account, adminSession) : [];
  const activeStoreId = account
    ? allowedStoreIds.includes(selectedStoreId)
      ? selectedStoreId
      : allowedStoreIds[0] || account.stores[0]?.id || ""
    : "";
  const activeStore = account?.stores.find((store) => store.id === activeStoreId) ?? account?.stores[0] ?? null;

  useEffect(() => {
    if (!account || !activeStoreId || selectedStoreId === activeStoreId) {
      return;
    }
    setSelectedStoreId(activeStoreId);
    sessionStorage.setItem(ADMIN_STORE_KEY, activeStoreId);
  }, [account?.id, activeStoreId, selectedStoreId]);

  const persist = async (next: AdminSnapshot, message = "Сохранено") => {
    try {
      const saved = await saveSnapshot(next);
      setSnapshot(saved);
      setToast(message);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось сохранить изменения");
    }
    window.setTimeout(() => setToast(""), 3600);
  };

  const patchAccount = (updater: (account: AdminAccount) => AdminAccount, message?: string) => {
    if (!snapshot || !account) {
      return;
    }
    persist(updateAccount(snapshot, account.id, updater), message);
  };

  if (!snapshot) {
    return <div className="admin-loading">Загрузка админки...</div>;
  }

  if (!authAccountId || !account || !adminSession) {
    return (
      <AdminLoginPage
        snapshot={snapshot}
        onLogin={(id, session, loadedSnapshot) => {
          if (loadedSnapshot) {
            setSnapshot(loadedSnapshot);
          }
          sessionStorage.setItem(ADMIN_AUTH_KEY, id);
          writeAdminSession(session);
          setAdminSession(session);
          setAuthAccountId(id);
          setAccountId(id);
        }}
      />
    );
  }

  const accessReason = adminAccessBlockedReason(account);
  if (accessReason) {
    return (
      <div className="control-login-screen">
        <section className="control-login-card">
          <LogoMark />
          <h1>Доступ к админке ограничен</h1>
          <p>{accessReason}</p>
          <button
            className="primary-admin"
            type="button"
            onClick={() => {
              sessionStorage.removeItem(ADMIN_AUTH_KEY);
              setAuthAccountId("");
              setAccountId("");
            }}
          >
            Выйти
          </button>
        </section>
      </div>
    );
  }

  const activeNav = nav.find((item) => item.id === view);
  const mobileNav = (["home", "sales", "products", "stores", "settings", "stock"] as AdminView[])
    .map((id) => availableNav.find((item) => item.id === id))
    .filter(Boolean)
    .slice(0, 5) as typeof availableNav;
  if (!canViewAdminNav(view, permissions)) {
    const fallback = availableNav[0]?.id ?? "products";
    window.setTimeout(() => setView(fallback), 0);
  }

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${drawerOpen ? "open" : ""}`}>
        <div className="admin-brand">
          <LogoMark />
          <strong>К-про</strong>
          <button type="button" className="mobile-only icon-only" onClick={() => setDrawerOpen(false)}>
            <X size={19} />
          </button>
        </div>
        <nav>
          {availableNav.map(({ id, label, icon: Icon }) => (
            <div className="nav-group" key={id}>
              <button
                type="button"
                className={view === id ? "active" : ""}
                onClick={() => {
                  setView(id);
                  if (id !== "stock") {
                    setDrawerOpen(false);
                  }
                }}
              >
                <Icon size={18} />
                {label}
              </button>
              {id === "stock" && view === "stock" && (
                <div className="stock-subnav">
                  {availableStockSections.map((section) => (
                    <button
                      type="button"
                      className={stockSection === section.id ? "active" : ""}
                      key={section.id}
                      onClick={() => {
                        setStockSection(section.id);
                        setDrawerOpen(false);
                      }}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <LogOut size={17} />
          Рабочий режим
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <button type="button" className="mobile-only icon-only" onClick={() => setDrawerOpen(true)}>
            <Menu size={21} />
          </button>
          <div>
            <span>{activeNav?.label}</span>
            <strong>{activeStore?.name ?? account?.name ?? "Нет аккаунтов"}</strong>
          </div>
          <label className="admin-store-switch">
            <span>Торговая точка</span>
            <AdminStyledSelect
              value={activeStoreId}
              options={account.stores.filter((store) => allowedStoreIds.includes(store.id)).map((store) => ({
                value: store.id,
                label: store.name
              }))}
              onChange={(nextStoreId) => {
                setSelectedStoreId(nextStoreId);
                sessionStorage.setItem(ADMIN_STORE_KEY, nextStoreId);
                window.location.reload();
              }}
            />
          </label>
          <div className="admin-account-chip">{account.name}</div>
          <button
            className="ghost-admin"
            type="button"
            onClick={() => {
              sessionStorage.removeItem(ADMIN_AUTH_KEY);
              sessionStorage.removeItem(ADMIN_SESSION_KEY);
              setAdminSession(null);
              setAuthAccountId("");
              setAccountId("");
            }}
          >
            Выйти
          </button>
          <div className="top-date">
            <CalendarDays size={17} />
            05.05.2026
          </div>
        </header>

        <section className="admin-content" key={`${account.id}-${activeStoreId}-${view}-${stockSection}`}>
          {account && view === "home" && <HomeDashboard account={account} storeId={activeStoreId} setView={setView} />}
          {account && view === "products" && can("products") && <ProductsPage account={account} patchAccount={patchAccount} permissions={permissions} storeId={activeStoreId} />}
          {account && view === "stock" && can("stock") && availableStockSections.length > 0 && <StockPage account={account} patchAccount={patchAccount} section={stockSectionAllowed(stockSection, availableStockSections)} permissions={permissions} storeId={activeStoreId} adminSession={adminSession} />}
          {account && view === "sales" && can("sales") && <SalesPage account={account} storeId={activeStoreId} />}
          {account && view === "employees" && can("employees") && can("manageEmployees") && <EmployeesPage account={account} patchAccount={patchAccount} storeId={activeStoreId} />}
          {account && view === "stores" && can("stores") && can("manageRegisters") && <StoresPage account={account} patchAccount={patchAccount} storeId={activeStoreId} />}
          {account && view === "reports" && can("reports") && can("viewReports") && <ReportsPage account={account} storeId={activeStoreId} />}
          {account && view === "settings" && can("settings") && can("manageSettings") && <SettingsPage account={account} patchAccount={patchAccount} />}
          {account && !canViewAdminNav(view, permissions) && <NoAccessPage />}
          {view === "clients" && <PlaceholderPage title={activeNav?.label ?? "Раздел"} />}
        </section>

        <nav className="mobile-bottom-nav" aria-label="Мобильное меню">
          {mobileNav.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              className={view === id ? "active" : ""}
              key={id}
              onClick={() => {
                setView(id);
                setDrawerOpen(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </main>

      {toast && <div className="admin-toast">{toast}</div>}
    </div>
  );
}

function AdminLoginPage({
  snapshot,
  onLogin
}: {
  snapshot: AdminSnapshot;
  onLogin: (accountId: string, session: AdminSession, loadedSnapshot?: AdminSnapshot) => void;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loginMode, setLoginMode] = useState<"login" | "phone">("login");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setError("");
    const loginValue = loginMode === "phone" ? normalizeKyrgyzPhone(login) : login;
    const result = await adminLogin(loginValue, password).catch(() => ({ ok: false as const, reason: "Не удалось подключиться к базе админки. Перезапустите ADMIN-KASSA-PRO.bat." }));
    setChecking(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    const freshSnapshot = result.snapshot;
    const account = freshSnapshot.accounts.find((item) => item.id === result.accountId);
    if (!account) {
      setError("Аккаунт найден, но не загрузился. Обновите страницу и попробуйте еще раз.");
      return;
    }
    const blockedReason = adminAccessBlockedReason(account);
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    onLogin(result.accountId, result.session, freshSnapshot);
  };

  return (
    <div className="control-login-screen">
      <form className="control-login-card" onSubmit={submit}>
        <LogoMark />
        <h1>Вход в админку магазина</h1>
        <p>Введите логин или телефон и пароль, который выдал владелец К-про.</p>
        <div className="login-mode-switch">
          <button className={loginMode === "login" ? "active" : ""} type="button" onClick={() => { setLoginMode("login"); setLogin(""); }}>
            Логин
          </button>
          <button className={loginMode === "phone" ? "active" : ""} type="button" onClick={() => { setLoginMode("phone"); setLogin(""); }}>
            Телефон
          </button>
        </div>
        <label className="admin-field">
          {loginMode === "phone" ? "Телефон" : "Логин"}
          {loginMode === "phone" ? (
            <PhoneInput value={login} onChange={setLogin} autoFocus />
          ) : (
            <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" autoFocus />
          )}
        </label>
        <label className="admin-field">
          Пароль
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        {error && <span className="login-error">{error}</span>}
        <button className="primary-admin" type="submit" disabled={checking}>
          <KeyRound size={17} />
          {checking ? "Проверка..." : "Войти"}
        </button>
      </form>
    </div>
  );
}

const CONTROL_LOGIN = "admin";
const CONTROL_PASSWORD = "KassaPro-110";
const CONTROL_AUTH_KEY = "kassa-pro-control-auth";
const ADMIN_LOGO_SRC = "/k-pro-logo.png";

function LogoMark() {
  return (
    <div className="admin-logo">
      <img src={ADMIN_LOGO_SRC} alt="" />
    </div>
  );
}

function readAdminSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    return { ...parsed, allowedStoreIds: parsed.allowedStoreIds ?? [] };
  } catch {
    return null;
  }
}

function writeAdminSession(session: AdminSession) {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

function canViewAdminNav(view: AdminView, permissions: AdminPermission[]) {
  if (view === "home" || view === "clients") return true;
  if (view === "employees") return permissions.includes("employees") && permissions.includes("manageEmployees");
  if (view === "stores") return permissions.includes("stores") && permissions.includes("manageRegisters");
  if (view === "reports") return permissions.includes("reports") && permissions.includes("viewReports");
  if (view === "settings") return permissions.includes("settings") && permissions.includes("manageSettings");
  return permissions.includes(view as AdminPermission);
}

function getAvailableStockSections(permissions: AdminPermission[]) {
  return stockSections.filter((section) => {
    if (section.id === "receipt" || section.id === "acceptance") return permissions.includes("stockReceipt");
    if (section.id === "writeoff") return permissions.includes("stockWriteoff");
    if (section.id === "inventory") return permissions.includes("stockInventory");
    if (section.id === "transfer") return permissions.includes("stockReceipt") && permissions.includes("stockWriteoff");
    return permissions.includes("stock");
  });
}

function stockSectionAllowed(section: StockSection, available: { id: StockSection; label: string }[]) {
  return available.some((item) => item.id === section) ? section : available[0]?.id ?? "balances";
}

function allowedStoreIdsForSession(account: AdminAccount, session: AdminSession | null) {
  if (!session || session.role === "owner") {
    return account.stores.map((store) => store.id);
  }
  const allowed = new Set(session.allowedStoreIds?.length ? session.allowedStoreIds : account.stores.map((store) => store.id));
  return account.stores.filter((store) => allowed.has(store.id)).map((store) => store.id);
}

function nomenclatureModeLabel(mode?: AdminStore["nomenclatureMode"]) {
  if (mode === "shared_store_price") return "единая номенклатура, разные цены";
  if (mode === "separate") return "раздельная номенклатура";
  return "единая цена";
}

function storeGroupLabel(account: AdminAccount, store?: AdminStore) {
  if (!store) return "точка не выбрана";
  const sameNomenclatureStores = account.stores.filter((item) => item.nomenclatureGroupId === store.nomenclatureGroupId);
  const samePriceStores = account.stores.filter((item) => item.priceGroupId === store.priceGroupId);
  if (sameNomenclatureStores.length === samePriceStores.length && sameNomenclatureStores.every((item) => item.priceGroupId === store.priceGroupId)) {
    return "та же номенклатура и цены";
  }
  if (sameNomenclatureStores.length > 1) {
    return "та же номенклатура, свои цены";
  }
  return "отдельная номенклатура";
}

function AdminStyledSelect({
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
    <div className={`admin-styled-select ${open ? "open" : ""}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setOpen(false);
      }
    }}>
      <button type="button" className="admin-styled-select-trigger" onClick={() => setOpen((next) => !next)}>
        <span>{selected?.label ?? "Выберите"}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="admin-styled-select-menu">
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

function PhoneInput({
  value,
  onChange,
  autoFocus
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const local = value.replace(/\D/g, "").replace(/^996/, "").slice(-9);
  return (
    <div className="phone-input">
      <span>+996</span>
      <input
        value={local}
        inputMode="numeric"
        maxLength={9}
        autoFocus={autoFocus}
        placeholder="700123456"
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 9))}
      />
    </div>
  );
}

function NoAccessPage() {
  return (
    <section className="admin-card placeholder-admin">
      <h1>Нет доступа к этому разделу</h1>
      <p>Попросите владельца магазина включить нужное право в карточке сотрудника.</p>
    </section>
  );
}

export function ControlApp() {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(() => sessionStorage.getItem(CONTROL_AUTH_KEY) === "yes");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!isAuthorized) {
      return;
    }
    loadSnapshot().then(setSnapshot);
  }, [isAuthorized]);

  const persist = async (next: AdminSnapshot, message = "Сохранено") => {
    const saved = await saveSnapshot(next);
    setSnapshot(saved);
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (login.trim() === CONTROL_LOGIN && password === CONTROL_PASSWORD) {
      sessionStorage.setItem(CONTROL_AUTH_KEY, "yes");
      setIsAuthorized(true);
      setError("");
      return;
    }
    setError("Неверный логин или пароль");
  };

  if (!isAuthorized) {
    return (
      <div className="control-login-screen">
        <form className="control-login-card" onSubmit={submit}>
          <LogoMark />
          <h1>Контрольная панель</h1>
          <p>Вход только для владельца К-про.</p>
          <label className="admin-field">
            Логин
            <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" autoFocus />
          </label>
          <label className="admin-field">
            Пароль
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {error && <span className="login-error">{error}</span>}
          <button className="primary-admin" type="submit">
            <KeyRound size={17} />
            Войти
          </button>
        </form>
      </div>
    );
  }

  if (!snapshot) {
    return <div className="admin-loading">Загрузка контрольной панели...</div>;
  }

  return (
    <div className="control-shell">
      <header className="control-topbar">
        <div className="admin-brand">
          <LogoMark />
          <strong>К-про Контроль</strong>
        </div>
        <span>Суперадмин: управление клиентами и подписками</span>
        <button
          className="ghost-admin"
          type="button"
          onClick={() => {
            sessionStorage.removeItem(CONTROL_AUTH_KEY);
            setIsAuthorized(false);
            setSnapshot(null);
            setPassword("");
          }}
        >
          Выйти
        </button>
      </header>
      <main className="admin-content">
        <ControlPanelPage
          snapshot={snapshot}
          persist={persist}
          openAccount={(id) => {
            localStorage.setItem("kassa-pro-last-admin-account", id);
            window.open("../admin/", "_blank");
          }}
        />
      </main>
      {toast && <div className="admin-toast">{toast}</div>}
    </div>
  );
}

function ControlPanelPage({
  snapshot,
  persist,
  openAccount
}: {
  snapshot: AdminSnapshot;
  persist: (next: AdminSnapshot, message?: string) => Promise<void>;
  openAccount: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(snapshot.accounts[0]?.id ?? "");
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountDraft, setAccountDraft] = useState({
    name: "",
    ownerName: "",
    ownerPhone: "",
    ownerEmail: "",
    adminLogin: "",
    adminPassword: "",
    inn: "",
    address: ""
  });
  const [storeDraft, setStoreDraft] = useState<Partial<AdminStore>>({});
  const [storeGroupMode, setStoreGroupMode] = useState<StoreGroupCreationMode>("same_nomenclature_same_price");
  const [storeSourceId, setStoreSourceId] = useState("");
  const [registerDraft, setRegisterDraft] = useState<Partial<AdminRegister>>({});
  const selected = snapshot.accounts.find((account) => account.id === selectedId) ?? snapshot.accounts[0] ?? null;
  const sourceStoreId = storeSourceId || selected?.stores[0]?.id || "";

  useEffect(() => {
    if (!snapshot.accounts.some((account) => account.id === selectedId)) {
      setSelectedId(snapshot.accounts[0]?.id ?? "");
    }
  }, [snapshot.accounts, selectedId]);

  const patchSnapshot = (updater: (current: AdminSnapshot) => AdminSnapshot, message: string) => {
    persist(updater(snapshot), message);
  };

  const patchSelected = (updater: (account: AdminAccount) => AdminAccount, message: string) => {
    if (!selected) return;
    patchSnapshot((current) => updateAccount(current, selected.id, updater), message);
  };

  const createAccount = () => {
    const account = makeAdminAccount({
      name: accountDraft.name.trim() || "Новый аккаунт",
      ownerName: accountDraft.ownerName.trim() || "Владелец магазина",
      ownerPhone: accountDraft.ownerPhone,
      ownerEmail: normalizeEmail(accountDraft.ownerEmail),
      adminLogin: accountDraft.adminLogin.trim(),
      adminPassword: accountDraft.adminPassword,
      settings: {
        companyName: accountDraft.name.trim() || "Новый аккаунт",
        inn: accountDraft.inn,
        address: accountDraft.address,
        currency: "сом",
        receiptTemplate: "Стандартный",
        showQr: false,
        taxRate: 12,
        mbankEnabled: false,
        telegramEnabled: false
      }
    });
    const duplicate = findAccountContactConflict(snapshot, account.id, account.ownerPhone, account.ownerEmail);
    if (duplicate) {
      window.alert(duplicate.message);
      return;
    }
    patchSnapshot(
      (current) => ({ ...current, accounts: [account, ...current.accounts] }),
      "Аккаунт магазина создан"
    );
    setSelectedId(account.id);
    setAccountDraft({ name: "", ownerName: "", ownerPhone: "", ownerEmail: "", adminLogin: "", adminPassword: "", inn: "", address: "" });
    setAccountModalOpen(false);
  };

  const extendSubscription = (months: number) => {
    patchSelected((account) => {
      const base = new Date(account.subscription.expiresAt) > new Date() ? new Date(account.subscription.expiresAt) : new Date();
      base.setMonth(base.getMonth() + months);
      return {
        ...account,
        status: "active",
        subscription: {
          ...account.subscription,
          status: "active",
          expiresAt: base.toISOString()
        },
        stores: account.stores.map((store) => ({ ...store, license: subscriptionLabel({ ...account, subscription: { ...account.subscription, expiresAt: base.toISOString(), status: "active" } }) }))
      };
    }, `Подписка продлена на ${months} мес.`);
  };

  const accountsTotal = snapshot.accounts.length;
  const activeAccounts = snapshot.accounts.filter((account) => account.status === "active" && account.subscription.status !== "suspended").length;
  const expiringSoon = snapshot.accounts.filter((account) => {
    const days = (new Date(account.subscription.expiresAt).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 14;
  }).length;
  const registersTotal = snapshot.accounts.reduce((sum, account) => sum + account.registers.length, 0);

  return (
    <div className="control-panel">
      <div className="reports-grid control-metrics">
        <Metric title="Аккаунтов" value={String(accountsTotal)} />
        <Metric title="Активных" value={String(activeAccounts)} />
        <Metric title="Истекают до 14 дней" value={String(expiringSoon)} />
        <Metric title="Касс всего" value={String(registersTotal)} />
      </div>

      <div className="control-layout">
        <section className="admin-card wide">
          <div className="card-head">
            <div>
              <h1>Контрольная панель</h1>
              <p>Аккаунты клиентов, подписки, торговые точки и кассы.</p>
            </div>
            <button className="primary-admin" type="button" onClick={() => setAccountModalOpen(true)}>
              <Plus size={17} />
              Аккаунт
            </button>
          </div>
          <div className="admin-table control-accounts-table">
            <div className="admin-row head">
              <span>Аккаунт</span><span>Владелец</span><span>Статус</span><span>Подписка</span><span>Точки</span><span>Кассы</span><span>Обновлен</span><span />
            </div>
            {snapshot.accounts.map((account) => (
              <div className={`admin-row ${selected?.id === account.id ? "selected-row" : ""}`} key={account.id}>
                <button className="link-button" type="button" onClick={() => setSelectedId(account.id)}>
                  {account.name}
                </button>
                <span>{account.ownerName}</span>
                <span className={account.status === "active" ? "green-badge" : "red-badge"}>{accountStatusLabel(account.status)}</span>
                <span>{account.subscription.plan} · {subscriptionStatusLabel(account.subscription.status)} до {formatDateOnly(account.subscription.expiresAt)}</span>
                <span>{account.stores.length} / {account.subscription.maxStores}</span>
                <span>{account.registers.length} / {account.subscription.maxRegisters}</span>
                <span>{formatDateTime(account.updatedAt)}</span>
                <div className="row-actions">
                  <button type="button" onClick={() => openAccount(account.id)}>Открыть</button>
                  <button type="button" onClick={() => setSelectedId(account.id)}>Упр.</button>
                </div>
              </div>
            ))}
            {snapshot.accounts.length === 0 && <div className="empty-admin">Аккаунтов пока нет. Создайте первый магазин.</div>}
          </div>
        </section>

        <section className="admin-card control-detail-card">
          {!selected ? (
            <div className="empty-admin">Выберите аккаунт для управления.</div>
          ) : (
            <>
              <div className="card-head">
                <div>
                  <h2>{selected.name}</h2>
                  <span>{selected.ownerName} · {selected.ownerPhone || "телефон не указан"}</span>
                </div>
                <span className={selected.status === "active" ? "green-badge" : "red-badge"}>{accountStatusLabel(selected.status)}</span>
              </div>

              <div className="control-section">
                <h2>Доступ клиента в админку</h2>
                <div className="modal-form-grid">
                  <FormInput
                    label="Логин для /admin"
                    value={selected.adminLogin}
                    onChange={(adminLogin) =>
                      patchSelected(
                        (account) => ({ ...account, adminLogin }),
                        "Логин админки сохранен"
                      )
                    }
                  />
                  <label className="admin-field">
                    Телефон владельца
                    <PhoneInput
                      value={selected.ownerPhone ?? ""}
                      onChange={(ownerPhone) => {
                        const normalizedPhone = normalizeKyrgyzPhone(ownerPhone) || ownerPhone;
                        const conflict = findAccountContactConflict(snapshot, selected.id, normalizedPhone, selected.ownerEmail);
                        if (conflict) {
                          window.alert(conflict.message);
                          return;
                        }
                        patchSelected(
                          (account) => ({ ...account, ownerPhone: normalizedPhone }),
                          "Телефон владельца сохранен"
                        );
                      }}
                    />
                  </label>
                  <FormInput
                    label="Email владельца"
                    value={selected.ownerEmail ?? ""}
                    onChange={(ownerEmail) => {
                      const normalizedEmail = normalizeEmail(ownerEmail);
                      const conflict = findAccountContactConflict(snapshot, selected.id, selected.ownerPhone, normalizedEmail);
                      if (conflict) {
                        window.alert(conflict.message);
                        return;
                      }
                      patchSelected(
                        (account) => ({ ...account, ownerEmail: normalizedEmail }),
                        "Email владельца сохранен"
                      );
                    }}
                  />
                  <FormInput
                    label="Пароль для /admin"
                    value={selected.adminPassword}
                    onChange={(adminPassword) =>
                      patchSelected(
                        (account) => ({ ...account, adminPassword }),
                        "Пароль админки сохранен"
                      )
                    }
                  />
                </div>
                <span>Эти данные выдаются клиенту. По ним он войдет только в свой аккаунт магазина.</span>
              </div>

              <div className="control-section">
                <h2>Подписка</h2>
                <div className="modal-form-grid">
                  <label className="admin-field">
                    Тариф
                    <AdminStyledSelect
                      value={selected.subscription.plan}
                      options={[
                        { value: "Базовый", label: "Базовый" },
                        { value: "Профессиональный", label: "Профессиональный" },
                        { value: "Премиум", label: "Премиум" }
                      ]}
                      onChange={(event) =>
                        patchSelected(
                          (account) => ({ ...account, subscription: { ...account.subscription, plan: event as AdminAccount["subscription"]["plan"] } }),
                          "Тариф изменен"
                        )
                      }
                    />
                  </label>
                  <label className="admin-field">
                    Статус подписки
                    <AdminStyledSelect
                      value={selected.subscription.status}
                      options={[
                        { value: "trial", label: "Тест" },
                        { value: "active", label: "Активна" },
                        { value: "expired", label: "Истекла" },
                        { value: "suspended", label: "Остановлена" }
                      ]}
                      onChange={(event) =>
                        patchSelected(
                          (account) => ({ ...account, subscription: { ...account.subscription, status: event as AdminAccount["subscription"]["status"] } }),
                          "Статус подписки изменен"
                        )
                      }
                    />
                  </label>
                  <FormInput
                    label="Дата окончания"
                    type="date"
                    value={toDateOnlyInput(selected.subscription.expiresAt)}
                    onChange={(expiresAt) =>
                      patchSelected(
                        (account) => ({ ...account, subscription: { ...account.subscription, expiresAt: fromDateOnlyInput(expiresAt) } }),
                        "Дата подписки сохранена"
                      )
                    }
                  />
                  <FormInput
                    label="Цена в месяц"
                    type="number"
                    value={String(selected.subscription.monthlyPrice)}
                    onChange={(monthlyPrice) =>
                      patchSelected(
                        (account) => ({ ...account, subscription: { ...account.subscription, monthlyPrice: Number(monthlyPrice) } }),
                        "Цена подписки сохранена"
                      )
                    }
                  />
                  <FormInput
                    label="Лимит торговых точек"
                    type="number"
                    value={String(selected.subscription.maxStores)}
                    onChange={(maxStores) =>
                      patchSelected(
                        (account) => ({ ...account, subscription: { ...account.subscription, maxStores: Number(maxStores) } }),
                        "Лимит точек сохранен"
                      )
                    }
                  />
                  <FormInput
                    label="Лимит касс"
                    type="number"
                    value={String(selected.subscription.maxRegisters)}
                    onChange={(maxRegisters) =>
                      patchSelected(
                        (account) => ({ ...account, subscription: { ...account.subscription, maxRegisters: Number(maxRegisters) } }),
                        "Лимит касс сохранен"
                      )
                    }
                  />
                </div>
                <div className="admin-inline-actions">
                  <button className="secondary-admin" type="button" onClick={() => extendSubscription(1)}>Продлить на 1 месяц</button>
                  <button className="secondary-admin" type="button" onClick={() => extendSubscription(12)}>Продлить на 1 год</button>
                  <button
                    className={selected.status === "active" ? "danger-admin" : "primary-admin"}
                    type="button"
                    onClick={() =>
                      patchSelected(
                        (account) => ({ ...account, status: account.status === "active" ? "blocked" : "active" }),
                        selected.status === "active" ? "Аккаунт закрыт" : "Аккаунт разрешен"
                      )
                    }
                  >
                    {selected.status === "active" ? "Закрыть доступ" : "Разрешить доступ"}
                  </button>
                  <button
                    className="danger-admin"
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Удалить аккаунт "${selected.name}"? Данные этого магазина будут удалены из локального snapshot.`)) {
                        return;
                      }
                      patchSnapshot(
                        (current) => ({ ...current, accounts: current.accounts.filter((account) => account.id !== selected.id) }),
                        "Аккаунт удален"
                      );
                    }}
                  >
                    Удалить аккаунт
                  </button>
                </div>
              </div>

              <div className="control-section">
                <h2>Торговые точки</h2>
                <div className="control-list">
                  {selected.stores.map((store) => (
                    <div className="control-list-row" key={store.id}>
                      <strong>{store.name}</strong>
                      <span>{store.address || "Адрес не указан"}</span>
                      <span>{storeGroupLabel(selected, store)}</span>
                      <span>{store.license}</span>
                      <button type="button" onClick={() => setStoreDraft(store)}>Изм.</button>
                      <button
                        type="button"
                        disabled={selected.stores.length <= 1}
                        onClick={() => {
                          if (storeHasData(selected, store.id)) {
                            window.alert("Торговую точку нельзя удалить: к ней привязаны кассы, продажи, складские документы или остатки. Отключите точку, если она больше не работает.");
                            return;
                          }
                          patchSelected(
                            (account) => ({
                              ...account,
                              stores: account.stores.filter((item) => item.id !== store.id),
                              registers: account.registers.filter((register) => register.storeId !== store.id)
                            }),
                            "Торговая точка удалена"
                          );
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
                </div>
                <div className="control-add-grid">
                  <FormInput label="Название точки" value={storeDraft.name ?? ""} onChange={(name) => setStoreDraft({ ...storeDraft, name })} />
                  <FormInput label="Адрес" value={storeDraft.address ?? ""} onChange={(address) => setStoreDraft({ ...storeDraft, address })} />
                  {!storeDraft.id && (
                    <>
                      <label className="admin-field">
                        Брать за основу
                        <AdminStyledSelect
                          value={sourceStoreId}
                          options={selected.stores.map((store) => ({ value: store.id, label: store.name }))}
                          onChange={setStoreSourceId}
                        />
                      </label>
                      <label className="admin-field">
                        Группы товаров и цен
                        <AdminStyledSelect
                          value={storeGroupMode}
                          options={[
                            { value: "same_nomenclature_same_price", label: "Та же номенклатура и те же цены" },
                            { value: "same_nomenclature_new_price", label: "Та же номенклатура, другие цены" },
                            { value: "new_empty_nomenclature", label: "Новая пустая номенклатура" }
                          ]}
                          onChange={(value) => setStoreGroupMode(value as StoreGroupCreationMode)}
                        />
                      </label>
                    </>
                  )}
                  {storeDraft.id && (
                    <label className="admin-field">
                      Статус точки
                      <AdminStyledSelect
                        value={storeDraft.status ?? "offline"}
                        options={[
                          { value: "online", label: "Активна" },
                          { value: "offline", label: "Отключена" }
                        ]}
                        onChange={(value) => setStoreDraft({ ...storeDraft, status: value as AdminStore["status"] })}
                      />
                    </label>
                  )}
                  <button
                    className="secondary-admin"
                    type="button"
                    disabled={!storeDraft.id && selected.stores.length >= selected.subscription.maxStores}
                    onClick={() => {
                      if (!storeDraft.id && selected.stores.length >= selected.subscription.maxStores) {
                        return;
                      }
                      patchSelected((account) => {
                        const store = makeAdminStore(account, storeDraft);
                        if (storeDraft.id) {
                          return {
                            ...account,
                            stores: account.stores.map((item) => (item.id === store.id ? store : item))
                          };
                        }
                        return addAdminStoreWithGroups(account, storeDraft, sourceStoreId, storeGroupMode);
                      }, storeDraft.id ? "Торговая точка сохранена" : "Торговая точка добавлена");
                      setStoreDraft({});
                      setStoreGroupMode("same_nomenclature_same_price");
                      setStoreSourceId("");
                    }}
                  >
                    {storeDraft.id ? "Сохранить точку" : "Добавить точку"}
                  </button>
                  {storeDraft.id && <button className="ghost-admin" type="button" onClick={() => setStoreDraft({})}>Отмена</button>}
                </div>
              </div>

              <div className="control-section">
                <h2>Кассы аккаунта</h2>
                <div className="control-list">
                  {selected.registers.map((register) => (
                    <div className="control-register-row" key={register.id}>
                      <strong>{register.name}</strong>
                      <span>{selected.stores.find((store) => store.id === register.storeId)?.name ?? register.storeId}</span>
                      <span>{registerStatus(register.status)}</span>
                      <code>{register.activationKey.key}</code>
                      <button type="button" onClick={() => navigator.clipboard?.writeText(register.activationKey.key)}>Копировать</button>
                      <button
                        type="button"
                        onClick={() => patchSelected((account) => issueRegisterKey(account, register.id), "Ключ кассы сгенерирован")}
                      >
                        Новый ключ
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patchSelected(
                            (account) => ({ ...account, registers: account.registers.filter((item) => item.id !== register.id) }),
                            "Касса удалена"
                          )
                        }
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
                </div>
                <div className="control-add-grid register-add-grid">
                  <label className="admin-field">
                    Торговая точка
                    <AdminStyledSelect
                      value={registerDraft.storeId ?? selected.stores[0]?.id ?? ""}
                      options={selected.stores.map((store) => ({ value: store.id, label: store.name }))}
                      onChange={(storeId) => setRegisterDraft({ ...registerDraft, storeId })}
                    />
                  </label>
                  <FormInput label="Название кассы" value={registerDraft.name ?? ""} onChange={(name) => setRegisterDraft({ ...registerDraft, name })} />
                  <button
                    className="secondary-admin"
                    type="button"
                    disabled={selected.registers.length >= selected.subscription.maxRegisters}
                    onClick={() => {
                      if (selected.registers.length >= selected.subscription.maxRegisters) {
                        return;
                      }
                      patchSelected(
                        (account) => ({
                          ...account,
                          registers: [...account.registers, makeAdminRegister(account, registerDraft.storeId || account.stores[0]?.id || "", registerDraft)]
                        }),
                        "Касса добавлена"
                      );
                      setRegisterDraft({});
                    }}
                  >
                    Добавить кассу
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {accountModalOpen && (
        <div className="admin-modal-backdrop">
          <section className="product-modal">
            <div className="card-head">
              <h2>Создать аккаунт магазина</h2>
              <button className="icon-only" type="button" onClick={() => setAccountModalOpen(false)}><X size={18} /></button>
            </div>
            <FormInput label="Название аккаунта / магазина" value={accountDraft.name} onChange={(name) => setAccountDraft({ ...accountDraft, name })} />
            <FormInput label="Владелец" value={accountDraft.ownerName} onChange={(ownerName) => setAccountDraft({ ...accountDraft, ownerName })} />
            <label className="admin-field">
              Телефон владельца
              <PhoneInput value={accountDraft.ownerPhone} onChange={(ownerPhone) => setAccountDraft({ ...accountDraft, ownerPhone: normalizeKyrgyzPhone(ownerPhone) || ownerPhone })} />
            </label>
            <FormInput label="Email владельца" value={accountDraft.ownerEmail} onChange={(ownerEmail) => setAccountDraft({ ...accountDraft, ownerEmail })} />
            <FormInput label="Логин клиента для /admin" value={accountDraft.adminLogin} onChange={(adminLogin) => setAccountDraft({ ...accountDraft, adminLogin })} />
            <FormInput label="Пароль клиента для /admin" value={accountDraft.adminPassword} onChange={(adminPassword) => setAccountDraft({ ...accountDraft, adminPassword })} />
            <FormInput label="ИНН" value={accountDraft.inn} onChange={(inn) => setAccountDraft({ ...accountDraft, inn })} />
            <FormInput label="Адрес первой точки" value={accountDraft.address} onChange={(address) => setAccountDraft({ ...accountDraft, address })} />
            <div className="modal-actions">
              <button className="primary-admin" type="button" onClick={createAccount}>Создать аккаунт</button>
              <button className="ghost-admin" type="button" onClick={() => setAccountModalOpen(false)}>Отмена</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ProductsPage({
  account,
  patchAccount,
  permissions,
  storeId
}: {
  account: AdminAccount;
  patchAccount: (updater: (account: AdminAccount) => AdminAccount, message?: string) => void;
  permissions: AdminPermission[];
  storeId: string;
}) {
  const canViewPurchasePrice = permissions.includes("viewPurchasePrice");
  const canEditProducts = permissions.includes("editProducts");
  const canDeleteProducts = permissions.includes("deleteProducts");
  const currentStoreId = account.stores.some((store) => store.id === storeId) ? storeId : account.stores[0]?.id ?? "";
  const currentStore = account.stores.find((store) => store.id === currentStoreId);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Partial<AdminProduct>>({});
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<Partial<AdminCategory>>({});
  const [scannerTarget, setScannerTarget] = useState<null | { title: string; onScan: (barcode: string) => void }>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [extraBarcodeInput, setExtraBarcodeInput] = useState("");
  const [lastProductCategoryId, setLastProductCategoryId] = useState(
    categoriesForStore(account, currentStoreId).find((category) => !isUncategorizedCategory(category))?.id ??
      categoriesForStore(account, currentStoreId)[0]?.id ??
      UNCATEGORIZED_CATEGORY_ID
  );

  const products = account.products.filter((product) => {
    const value = query.toLowerCase();
    const extraBarcodes = product.extraBarcodes ?? [];
    return (
      !product.isDeleted &&
      productAvailableInStore(account, product, currentStoreId) &&
      (product.name.toLowerCase().includes(value) ||
        product.barcode.includes(value) ||
        extraBarcodes.some((barcode) => barcode.includes(value)) ||
        product.sku.toLowerCase().includes(value))
    );
  });
  const selectedProducts = products.filter((product) => selectedProductIds.includes(product.id));
  const allVisibleSelected = products.length > 0 && products.every((product) => selectedProductIds.includes(product.id));
  const orderedCategories = categoriesForStore(account, currentStoreId);

  const saveProduct = () => {
    const barcode = normalizeBarcode(draft.barcode ?? "");
    if (!barcode) {
      window.alert("Укажите штрихкод или нажмите «Сгенерировать ШК» для внутреннего штрихкода товара.");
      return;
    }
    const extraBarcodes = normalizeExtraBarcodes(draft.extraBarcodes ?? []);
    const duplicateBarcode = findDuplicateProductBarcode(account.products, barcode, extraBarcodes, draft.id);
    if (duplicateBarcode) {
      window.alert(`Штрихкод уже привязан к товару: ${duplicateBarcode.name}`);
      return;
    }
    let savedCategoryId = draft.categoryId || lastProductCategoryId;
    patchAccount((current) => {
      const existing = current.products.find((item) => item.id === draft.id);
      const product = makeProduct(current, {
        ...(existing ?? {}),
        ...draft,
        categoryId: savedCategoryId,
        barcode,
        extraBarcodes,
        name: draft.name?.trim() || "Новый товар",
        storePurchasePrice: Number(draft.purchasePrice ?? 0),
        storeSalePrice: Number(draft.salePrice ?? 0)
      }, currentStoreId);
      savedCategoryId = product.categoryId;
      const exists = current.products.some((item) => item.id === product.id);
      return {
        ...current,
        products: exists
          ? current.products.map((item) => (item.id === product.id ? product : item))
          : [product, ...current.products]
      };
    }, "Товар сохранен");
    setLastProductCategoryId(savedCategoryId);
    setDraft({ categoryId: savedCategoryId });
    setProductModalOpen(false);
    setExtraBarcodeInput("");
  };

  const addExtraBarcode = (barcode: string) => {
    const normalized = normalizeBarcode(barcode);
    if (!normalized) {
      return;
    }
    const nextExtraBarcodes = normalizeExtraBarcodes([...(draft.extraBarcodes ?? []), normalized]);
    const duplicate = findDuplicateProductBarcode(account.products, draft.barcode ?? "", nextExtraBarcodes, draft.id);
    if (duplicate) {
      window.alert(`Штрихкод уже привязан к товару: ${duplicate.name}`);
      return;
    }
    setDraft({ ...draft, extraBarcodes: nextExtraBarcodes });
    setExtraBarcodeInput("");
  };

  const removeExtraBarcode = (barcode: string) => {
    setDraft({
      ...draft,
      extraBarcodes: normalizeExtraBarcodes(draft.extraBarcodes ?? []).filter((item) => item !== barcode)
    });
  };

  const toggleProductSelection = (productId: string, checked: boolean) => {
    setSelectedProductIds((ids) =>
      checked ? Array.from(new Set([...ids, productId])) : ids.filter((id) => id !== productId)
    );
  };

  const toggleAllVisibleProducts = (checked: boolean) => {
    setSelectedProductIds(checked ? products.map((product) => product.id) : []);
  };

  const deleteSelectedProducts = () => {
    if (selectedProductIds.length === 0) {
      return;
    }
    const selected = account.products.filter((product) => selectedProductIds.includes(product.id));
    const blocked = selected.filter((product) => Math.abs(totalStockOf(product)) > 0.0009);
    if (blocked.length > 0) {
      window.alert(
        `Товар нельзя удалить: остаток должен быть 0. Сначала выполните списание или инвентаризацию.\n\n${blocked
          .slice(0, 8)
          .map((product) => `${product.name}: ${formatQty(totalStockOf(product))} ${product.unit}`)
          .join("\n")}`
      );
      return;
    }
    patchAccount((current) => ({
      ...current,
      products: current.products.map((product) =>
        selectedProductIds.includes(product.id) ? { ...product, isDeleted: true } : product
      )
    }), `Удалено товаров: ${selected.length}`);
    setSelectedProductIds([]);
  };

  const printSelectedLabels = () => {
    const selected = account.products.filter((product) => selectedProductIds.includes(product.id) && !product.isDeleted);
    if (selected.length === 0) {
      return;
    }
    openLabelPrintWindow(account, selected, currentStoreId);
  };

  const applyBarcodeLookup = (barcode: string) => {
    const normalized = normalizeBarcode(barcode);
    const found = lookupProductByBarcode(normalized);
    const canReplaceName = (value?: string) => !value?.trim() || value.trim().toLowerCase() === "новый товар";
    if (!found) {
      setDraft((current) => ({
        ...current,
        barcode: normalized,
        name: canReplaceName(current.name) ? "Новый товар" : current.name
      }));
      return;
    }
    const categoryId =
      account.categories.find((category) => category.id === found.categoryHint)?.id ??
      account.categories.find((category) => category.name.toLowerCase().includes(found.categoryHint ?? ""))?.id ??
      draft.categoryId ??
      account.categories[0]?.id;
    setDraft((current) => ({
      ...current,
      barcode: normalized,
      name: canReplaceName(current.name) ? found.name : current.name,
      unit: current.unit || found.unit || "шт",
      categoryId,
      purchasePrice: current.purchasePrice ?? found.purchasePrice ?? 0,
      salePrice: current.salePrice ?? found.salePrice ?? 0
    }));
  };

  const generateProductBarcode = () => {
    const existingBarcodes = account.products
      .filter((product) => product.id !== draft.id)
      .flatMap((product) => [product.barcode, ...(product.extraBarcodes ?? [])]);
    const barcode = generateInternalEan13(account.id, existingBarcodes);
    setDraft((current) => ({
      ...current,
      barcode,
      name: current.name?.trim() ? current.name : "Новый товар"
    }));
  };

  const saveCategory = () => {
    if (!categoryDraft.name?.trim()) {
      return;
    }
    patchAccount((current) => {
      const currentStore = current.stores.find((store) => store.id === currentStoreId) || current.stores[0];
      const category = makeCategory(current, { ...categoryDraft, nomenclatureGroupId: currentStore?.nomenclatureGroupId });
      const exists = current.categories.some((item) => item.id === category.id);
      return {
        ...current,
        categories: exists
          ? current.categories.map((item) => (item.id === category.id ? category : item))
          : [...current.categories, category]
      };
    }, categoryDraft.id ? "Категория сохранена" : "Категория добавлена");
    setCategoryDraft({});
  };

  const moveCategory = (categoryId: string, direction: -1 | 1) => {
    const ordered = categoriesForStore(account, currentStoreId);
    const index = ordered.findIndex((category) => category.id === categoryId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) {
      return;
    }
    const next = [...ordered];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    patchAccount((current) => ({
      ...current,
      categories: current.categories.map((category) => {
        const orderIndex = next.findIndex((item) => item.id === category.id);
        return orderIndex >= 0 ? { ...category, sortOrder: orderIndex + 1 } : category;
      })
    }), "Порядок категорий сохранен");
  };

  const exportProducts = (withStock: boolean) => {
    const header = withStock
      ? ["Наименование", "Штрихкод", "Доп. штрихкоды", "Группа", "Остаток", ...(canViewPurchasePrice ? ["Цена закуп"] : []), "Цена продажи", "Ед. изм.", "Артикул"]
      : ["Наименование", "Штрихкод", "Доп. штрихкоды", "Группа", ...(canViewPurchasePrice ? ["Цена закуп"] : []), "Цена продажи", "Ед. изм.", "Артикул"];
    const rows = account.products.filter((product) => !product.isDeleted && productAvailableInStore(account, product, currentStoreId)).map((product) => {
      const category = account.categories.find((item) => item.id === product.categoryId)?.name ?? "";
      const extraBarcodes = (product.extraBarcodes ?? []).join(", ");
      return withStock
        ? [product.name, product.barcode, extraBarcodes, category, stockOf(account, product, currentStoreId), ...(canViewPurchasePrice ? [purchasePriceForStore(product, currentStoreId, account)] : []), salePriceForStore(product, currentStoreId, account), product.unit, product.sku]
        : [product.name, product.barcode, extraBarcodes, category, ...(canViewPurchasePrice ? [purchasePriceForStore(product, currentStoreId, account)] : []), salePriceForStore(product, currentStoreId, account), product.unit, product.sku];
    });
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, withStock ? "Товары и остатки" : "Товары");
    XLSX.writeFile(workbook, `${account.name.replace(/[\\/:*?"<>|]/g, "_")}_${withStock ? "tovary_ostatki" : "tovary"}.xlsx`);
  };

  return (
    <div className="page-grid products-page">
      <section className="admin-card wide">
        <div className="card-head">
          <h1>Товары</h1>
          <span className="store-context-note">{currentStore?.name ?? "Точка"} · {storeGroupLabel(account, currentStore)}</span>
          <div className="admin-search">
            <Search size={17} />
            <button
              className="scanner-button"
              type="button"
              aria-label="scan barcode"
              onClick={() => setScannerTarget({ title: "Поиск товара", onScan: setQuery })}
            >
              <ScanBarcode size={18} />
            </button>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, ШК или SKU" />
          </div>
          <div className="admin-inline-actions">
            <button className="secondary-admin" type="button" onClick={() => setImportModalOpen(true)}>
              <Upload size={17} />
              Импорт
            </button>
            <button className="secondary-admin" type="button" onClick={() => exportProducts(false)}>
              <Download size={17} />
              Экспорт товаров
            </button>
            <button className="secondary-admin" type="button" onClick={() => exportProducts(true)}>
              <Download size={17} />
              Экспорт с остатками
            </button>
            <button className="secondary-admin" type="button" disabled={selectedProductIds.length === 0} onClick={printSelectedLabels}>
              <Printer size={17} />
              Печать
            </button>
            {canDeleteProducts && <button className="danger-admin" type="button" disabled={selectedProductIds.length === 0} onClick={deleteSelectedProducts}>
              <Trash2 size={17} />
              Удалить
            </button>}
            {canEditProducts && <button className="primary-admin" type="button" onClick={() => { setDraft({ categoryId: lastProductCategoryId, extraBarcodes: [] }); setExtraBarcodeInput(""); setProductModalOpen(true); }}>
              <Plus size={17} />
              Товар
            </button>}
          </div>
        </div>
        <div className={`admin-table products-table ${canViewPurchasePrice ? "" : "no-purchase"}`}>
          <div className="admin-row head">
            <span>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(event) => toggleAllVisibleProducts(event.target.checked)}
              />
            </span>
            <span>Товар</span>
            <span>Штрихкод</span>
            {canViewPurchasePrice && <span>Закуп</span>}
            <span>Продажа</span>
            <span>Остаток</span>
            <span />
          </div>
          {products.map((product) => (
            <div className="admin-row" key={product.id}>
              <span>
                <input
                  type="checkbox"
                  checked={selectedProductIds.includes(product.id)}
                  onChange={(event) => toggleProductSelection(product.id, event.target.checked)}
                />
              </span>
              <strong>{product.name}</strong>
              <span>{product.barcode}</span>
              {canViewPurchasePrice && <span>{money(purchasePriceForStore(product, currentStoreId, account))}</span>}
              <span>{money(salePriceForStore(product, currentStoreId, account))}</span>
              <span>{formatQty(stockOf(account, product, currentStoreId))}</span>
              <button type="button" disabled={!canEditProducts} onClick={() => { setDraft(productForStore(account, product, currentStoreId)); setExtraBarcodeInput(""); setProductModalOpen(true); }}>
                Изменить
              </button>
            </div>
          ))}
        </div>
      </section>

      {productModalOpen && (
        <div className="admin-modal-backdrop">
      <section className="admin-card product-modal">
        <div className="card-head">
        <h2>{draft.id ? "Редактировать товар" : "Создать товар"}</h2>
          <button className="icon-only" type="button" onClick={() => { setProductModalOpen(false); setDraft({ categoryId: lastProductCategoryId }); setExtraBarcodeInput(""); }}>
            <X size={18} />
          </button>
        </div>
        <FormInput label="Название" value={draft.name ?? ""} onChange={(name) => setDraft({ ...draft, name })} />
        <label className="admin-field">
          Категория
          <AdminStyledSelect
            value={draft.categoryId ?? orderedCategories[0]?.id}
            options={orderedCategories.map((category) => ({ value: category.id, label: category.name }))}
            onChange={(categoryId) => setDraft({ ...draft, categoryId })}
          />
        </label>
        <FormInput
          label="Штрихкод"
          value={draft.barcode ?? ""}
          placeholder="Отсканируйте, введите или сгенерируйте"
          onChange={(barcode) => {
            setDraft({ ...draft, barcode });
            if (barcode.replace(/\D/g, "").length >= 8) {
              applyBarcodeLookup(barcode);
            }
          }}
        />
        <button
          className="secondary-admin scan-inline-button"
          type="button"
          onClick={() =>
            setScannerTarget({
              title: "Штрихкод",
              onScan: (barcode) => {
                setDraft((current) => ({ ...current, barcode }));
                applyBarcodeLookup(barcode);
              }
            })
          }
        >
          <ScanBarcode size={17} />
          Сканер
        </button>
        <button
          className="secondary-admin scan-inline-button"
          type="button"
          onClick={generateProductBarcode}
        >
          Сгенерировать ШК
        </button>
        {draft.barcode && lookupProductByBarcode(draft.barcode) && (
          <span>Название найдено по штрихкоду, его можно изменить вручную.</span>
        )}
        <div className="extra-barcodes-box">
          <div className="extra-barcodes-title">Доп. штрихкоды</div>
          <div className="extra-barcodes-row">
            <input
              value={extraBarcodeInput}
              placeholder="Отсканируйте или введите доп. ШК"
              onChange={(event) => setExtraBarcodeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  addExtraBarcode(extraBarcodeInput);
                  event.preventDefault();
                }
              }}
            />
            <button className="secondary-admin" type="button" onClick={() => addExtraBarcode(extraBarcodeInput)}>
              <Plus size={16} />
              Добавить
            </button>
            <button
              className="secondary-admin"
              type="button"
              onClick={() =>
                setScannerTarget({
                  title: "Доп. штрихкод",
                  onScan: (barcode) => addExtraBarcode(barcode)
                })
              }
            >
              <ScanBarcode size={16} />
            </button>
          </div>
          <div className="extra-barcodes-list">
            {normalizeExtraBarcodes(draft.extraBarcodes ?? []).map((barcode) => (
              <span key={barcode}>
                {barcode}
                <button type="button" onClick={() => removeExtraBarcode(barcode)} title="Удалить доп. штрихкод">
                  <X size={13} />
                </button>
              </span>
            ))}
            {normalizeExtraBarcodes(draft.extraBarcodes ?? []).length === 0 && (
              <small>Дополнительных штрихкодов пока нет.</small>
            )}
          </div>
        </div>
        {canViewPurchasePrice && <FormInput label="Цена закуп" type="number" value={String(draft.purchasePrice ?? "")} onChange={(purchasePrice) => setDraft({ ...draft, purchasePrice: Number(purchasePrice) })} />}
        <FormInput label="Цена продажи" type="number" value={String(draft.salePrice ?? "")} onChange={(salePrice) => setDraft({ ...draft, salePrice: Number(salePrice) })} />
        <label className="admin-field">
          Ед. изм.
          <AdminStyledSelect
            value={draft.unit ?? "шт"}
            options={productUnits.map((unit) => ({ value: unit, label: unit }))}
            onChange={(unit) => setDraft({ ...draft, unit })}
          />
        </label>
        <ImageInput
          label="Фото товара"
          value={draft.imageData}
          onChange={(imageData) => setDraft({ ...draft, imageData })}
        />
        <button className="primary-admin" type="button" onClick={saveProduct}>
          <Save size={17} />
          Сохранить товар
        </button>
      </section>
        </div>
      )}

      {importModalOpen && (
        <ProductImportModal
          account={account}
          onClose={() => setImportModalOpen(false)}
          onImport={(rows, mapping, skipFirstRow) => {
            const result = importProductsFromRows(account, rows, mapping, skipFirstRow, currentStoreId);
            patchAccount(() => result.account, `Импортировано: ${result.imported}, пропущено: ${result.skipped}`);
            setImportModalOpen(false);
          }}
        />
      )}

      {scannerTarget && (
        <BarcodeScannerModal
          title={scannerTarget.title}
          onClose={() => setScannerTarget(null)}
          onDetected={(barcode) => {
            scannerTarget.onScan(barcode);
            setScannerTarget(null);
          }}
        />
      )}

      <section className="admin-card">
        <h2>Категории кассы</h2>
        <div className="category-list">
          {orderedCategories.map((category, index) => (
            <div key={category.id} className="category-pill" style={{ borderColor: category.color }}>
              {category.imageData && <img src={category.imageData} alt="" />}
              <span>{category.name}</span>
              <button type="button" title="Выше" disabled={index === 0} onClick={() => moveCategory(category.id, -1)}>
                <ChevronUp size={15} />
              </button>
              <button type="button" title="Ниже" disabled={index === orderedCategories.length - 1} onClick={() => moveCategory(category.id, 1)}>
                <ChevronDown size={15} />
              </button>
              <button className="category-edit-button" type="button" onClick={() => setCategoryDraft(category)}>
                Изм.
              </button>
              {!isUncategorizedCategory(category) && (
                <button
                  type="button"
                  onClick={() =>
                    patchAccount((current) => ({
                      ...current,
                      categories: current.categories.filter((item) => item.id !== category.id),
                      products: current.products.map((item) => item.categoryId === category.id ? { ...item, categoryId: UNCATEGORIZED_CATEGORY_ID } : item)
                    }), "Категория удалена")
                  }
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        <FormInput label={categoryDraft.id ? "Название категории" : "Новая категория"} value={categoryDraft.name ?? ""} onChange={(name) => setCategoryDraft({ ...categoryDraft, name })} />
        <FormInput label="Цвет" type="color" value={categoryDraft.color ?? "#147adf"} onChange={(color) => setCategoryDraft({ ...categoryDraft, color })} />
        <label className="admin-field">
          Иконка
          <div className="category-icon-picker" role="radiogroup" aria-label="Иконка категории">
            {categoryIconOptions.map(({ id, label, Icon }) => {
              const active = (categoryDraft.icon ?? "ShoppingBasket") === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`category-icon-option ${active ? "active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setCategoryDraft({ ...categoryDraft, icon: id })}
                >
                  <Icon size={24} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </label>
        <ImageInput
          label="Фото категории"
          value={categoryDraft.imageData}
          onChange={(imageData) => setCategoryDraft({ ...categoryDraft, imageData })}
        />
        <div className="admin-inline-actions">
          <button className="secondary-admin" type="button" onClick={saveCategory}>
            <Plus size={17} />
            {categoryDraft.id ? "Сохранить категорию" : "Добавить категорию"}
          </button>
          {categoryDraft.id && (
            <button className="ghost-admin" type="button" onClick={() => setCategoryDraft({})}>
              Отмена
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ProductImportModal({
  account,
  onClose,
  onImport
}: {
  account: AdminAccount;
  onClose: () => void;
  onImport: (rows: string[][], mapping: Record<number, ImportField>, skipFirstRow: boolean) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, ImportField>>({});
  const [skipFirstRow, setSkipFirstRow] = useState(true);
  const [error, setError] = useState("");

  const preview = rows.slice(0, 10);
  const columnCount = Math.max(0, ...preview.map((row) => row.length));
  const hasRequired = ["name", "barcode", "salePrice"].every((field) =>
    Object.values(mapping).includes(field as ImportField)
  );

  const readFile = async (file: File) => {
    setError("");
    setFileName(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
        header: 1,
        raw: true,
        defval: ""
      });
      const normalized = rawRows
        .map((row) => row.map((cell) => excelCellToImportText(cell)))
        .filter((row) => row.some(Boolean));
      if (normalized.length === 0) {
        setRows([]);
        setError("В файле не найдено строк для импорта.");
        return;
      }
      setRows(normalized);
      setMapping(guessImportMapping(normalized));
      setSkipFirstRow(looksLikeHeader(normalized[0]));
    } catch {
      setRows([]);
      setError("Не удалось прочитать Excel-файл. Проверьте формат .xlsx или .xls.");
    }
  };

  return (
    <div className="admin-modal-backdrop">
      <section className="import-modal">
        <div className="card-head">
          <div>
            <h2>Импорт товаров из Excel</h2>
            <p>Обязательные поля: наименование, штрихкод и цена продажи.</p>
          </div>
          <button className="icon-only" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <label className="admin-file import-file-picker">
          <Upload size={18} />
          {fileName || "Выбрать Excel-файл"}
          <input accept=".xlsx,.xls" type="file" onChange={(event) => event.target.files?.[0] && readFile(event.target.files[0])} />
        </label>

        {error && <div className="import-error">{error}</div>}

        {rows.length > 0 && (
          <>
            <label className="check-row">
              <input type="checkbox" checked={skipFirstRow} onChange={(event) => setSkipFirstRow(event.target.checked)} />
              Первая строка содержит заголовки, не импортировать ее как товар
            </label>

            <div className="import-preview-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    {Array.from({ length: columnCount }).map((_, index) => (
                      <th key={index}>
                        <span>Столбец {index + 1}</span>
                        <AdminStyledSelect
                          value={mapping[index] ?? "ignore"}
                          options={Object.entries(importFieldLabels).map(([value, label]) => ({ value, label }))}
                          onChange={(value) => setMapping({ ...mapping, [index]: value as ImportField })}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, rowIndex) => (
                    <tr className={skipFirstRow && rowIndex === 0 ? "header-row-preview" : ""} key={rowIndex}>
                      {Array.from({ length: columnCount }).map((_, columnIndex) => (
                        <td key={columnIndex}>{row[columnIndex] || ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="import-summary">
              <span>Показаны первые {Math.min(10, rows.length)} строк из {rows.length}.</span>
              <span>Будет импортировано в аккаунт: {account.name}</span>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button
            className="primary-admin"
            type="button"
            disabled={!rows.length || !hasRequired}
            onClick={() => onImport(rows, mapping, skipFirstRow)}
          >
            Импортировать
          </button>
          <button className="ghost-admin" type="button" onClick={onClose}>Отмена</button>
        </div>

        {rows.length > 0 && !hasRequired && (
          <div className="import-error">Выберите столбцы: наименование, штрихкод и цена продажи.</div>
        )}
      </section>
    </div>
  );
}

function StockPage({
  account,
  patchAccount,
  section,
  permissions,
  storeId,
  adminSession
}: {
  account: AdminAccount;
  patchAccount: (updater: (account: AdminAccount) => AdminAccount, message?: string) => void;
  section: StockSection;
  permissions: AdminPermission[];
  storeId: string;
  adminSession: AdminSession | null;
}) {
  const canViewPurchasePrice = permissions.includes("viewPurchasePrice");
  const currentStoreId = account.stores.some((store) => store.id === storeId) ? storeId : account.stores[0]?.id ?? "";
  const [mode, setMode] = useState<"list" | "document">("list");
  const [document, setDocument] = useState<StockDocument | null>(null);
  const [search, setSearch] = useState("");
  const [showNomenclature, setShowNomenclature] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<null | { title: string; onScan: (barcode: string) => void }>(null);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productDraft, setProductDraft] = useState<Partial<AdminProduct>>({});
  const [lastProductCategoryId, setLastProductCategoryId] = useState(
    categoriesForStore(account, currentStoreId).find((category) => !isUncategorizedCategory(category))?.id ??
      categoriesForStore(account, currentStoreId)[0]?.id ??
      UNCATEGORIZED_CATEGORY_ID
  );
  const documentType = stockDocumentTypeFromSection(section);
  const sectionTitle = stockSectionLabels[section];
  const orderedCategories = categoriesForStore(account, currentStoreId);
  const currentStoreName = storeName(account, currentStoreId);

  const enforceCurrentStoreAsTransferSource = (doc: StockDocument) => {
    if (doc.type !== "transfer") {
      return doc;
    }
    return {
      ...doc,
      storeId: currentStoreId,
      sourceStoreId: currentStoreId,
      targetStoreId: doc.targetStoreId === currentStoreId ? "" : doc.targetStoreId
    };
  };

  const openDocument = (doc?: StockDocument) => {
    const nextDocument = doc ? structuredClone(doc) : makeStockDocument(account, documentType, currentStoreId, adminSession ?? undefined);
    setDocument(enforceCurrentStoreAsTransferSource(nextDocument));
    setMode("document");
  };

  const updateItem = (itemId: string, patch: Partial<StockDocumentItem>) => {
    setDocument((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) => {
          if (item.id !== itemId) return item;
          const next = { ...item, ...patch };
          const markupPercent =
            next.purchasePrice > 0
              ? Math.round(((next.salePrice - next.purchasePrice) / next.purchasePrice) * 10000) / 100
              : 0;
          return {
            ...next,
            price: next.purchasePrice,
            markupPercent,
            differenceQty: current.type === "inventory" ? roundAdmin(next.qty - next.currentStock) : next.qty,
            movementType:
              current.type === "inventory"
                ? next.qty > next.currentStock
                  ? "receipt"
                  : next.qty < next.currentStock
                    ? "writeoff"
                    : "none"
                : current.type === "writeoff"
                  ? "writeoff"
                  : "receipt",
            total: roundAdmin((current.type === "inventory" ? next.qty - next.currentStock : next.qty) * next.purchasePrice)
          };
        })
      };
    });
  };

  const addProductToDocument = (product: AdminProduct) => {
    setDocument((current) => {
      if (!current) return current;
      if (current.items.some((item) => item.productId === product.id)) {
        return current;
      }
      const itemStoreId = current.type === "transfer" ? currentStoreId : current.storeId;
      return { ...current, items: [...current.items, makeStockDocumentItem(account, product, current.type, itemStoreId)] };
    });
  };

  const applyStockProductBarcodeLookup = (barcode: string) => {
    const normalized = normalizeBarcode(barcode);
    const found = lookupProductByBarcode(normalized);
    const canReplaceName = (value?: string) => !value?.trim() || value.trim().toLowerCase() === "новый товар";
    if (!found) {
      setProductDraft((current) => ({
        ...current,
        barcode: normalized,
        name: canReplaceName(current.name) ? "Новый товар" : current.name
      }));
      return;
    }
    const categoryId =
      account.categories.find((category) => category.id === found.categoryHint)?.id ??
      account.categories.find((category) => category.name.toLowerCase().includes(found.categoryHint ?? ""))?.id ??
      productDraft.categoryId ??
      lastProductCategoryId;
    setProductDraft((current) => ({
      ...current,
      barcode: normalized,
      name: canReplaceName(current.name) ? found.name : current.name,
      unit: current.unit || found.unit || "шт",
      categoryId,
      purchasePrice: current.purchasePrice ?? found.purchasePrice ?? 0,
      salePrice: current.salePrice ?? found.salePrice ?? 0
    }));
  };

  const generateStockProductBarcode = () => {
    const existingBarcodes = account.products
      .filter((product) => product.id !== productDraft.id)
      .flatMap((product) => [product.barcode, ...(product.extraBarcodes ?? [])]);
    const barcode = generateInternalEan13(account.id, existingBarcodes);
    setProductDraft((current) => ({
      ...current,
      barcode,
      name: current.name?.trim() ? current.name : "Новый товар"
    }));
  };

  const saveProductFromDocument = () => {
    const barcode = normalizeBarcode(productDraft.barcode ?? "");
    if (!barcode) {
      window.alert("Укажите штрихкод или нажмите «Сгенерировать ШК» для внутреннего штрихкода товара.");
      return;
    }
    let savedCategoryId = productDraft.categoryId || lastProductCategoryId;
    const productToAdd = makeProduct(account, {
      ...productDraft,
      categoryId: savedCategoryId,
      barcode,
      name: productDraft.name?.trim() || "Новый товар",
      storePurchasePrice: Number(productDraft.purchasePrice ?? 0),
      storeSalePrice: Number(productDraft.salePrice ?? 0)
    }, currentStoreId);
    savedCategoryId = productToAdd.categoryId;
    patchAccount((current) => {
      const exists = current.products.some((item) => item.id === productToAdd.id);
      return {
        ...current,
        products: exists
          ? current.products.map((item) => (item.id === productToAdd.id ? productToAdd : item))
          : [productToAdd, ...current.products]
      };
    }, "Товар создан и добавлен в документ");
    setDocument((current) => {
      if (!current || current.items.some((item) => item.productId === productToAdd.id)) {
        return current;
      }
      const itemStoreId = current.type === "transfer" ? currentStoreId : current.storeId;
      return { ...current, items: [...current.items, makeStockDocumentItem(account, productToAdd, current.type, itemStoreId)] };
    });
    setSearch(productToAdd.name);
    setLastProductCategoryId(savedCategoryId);
    setProductDraft({ categoryId: savedCategoryId });
    setProductModalOpen(false);
  };

  const saveCurrent = (message = `${sectionTitle} saved`) => {
    if (!document) return;
    const safeDocument = enforceCurrentStoreAsTransferSource(document);
    patchAccount((current) => saveStockDocument(current, safeDocument), message);
    setDocument({ ...safeDocument, updatedAt: new Date().toISOString() });
  };

  const postCurrent = () => {
    if (!document) return;
    const safeDocument = enforceCurrentStoreAsTransferSource(document);
    if (safeDocument.type === "transfer" && (!safeDocument.targetStoreId || safeDocument.targetStoreId === (safeDocument.sourceStoreId || safeDocument.storeId))) {
      window.alert("Выберите другую торговую точку, куда нужно переместить товар.");
      return;
    }
    if (safeDocument.type === "transfer") {
      const sourceStore = account.stores.find((store) => store.id === (safeDocument.sourceStoreId || safeDocument.storeId));
      const targetStore = account.stores.find((store) => store.id === safeDocument.targetStoreId);
      if (sourceStore?.nomenclatureGroupId !== targetStore?.nomenclatureGroupId) {
        window.alert("Перемещение доступно только между точками с одной номенклатурной группой. Для другой группы сначала создайте товар в этой точке.");
        return;
      }
    }
    patchAccount((current) => postStockDocument(current, safeDocument, adminSession ?? undefined), `${sectionTitle} posted`);
    setMode("list");
    setDocument(null);
  };

  const activeProducts = account.products.filter((product) => !product.isDeleted && productAvailableInStore(account, product, currentStoreId));
  const filteredProducts = activeProducts.filter((product) => {
    const value = search.toLowerCase();
    return product.name.toLowerCase().includes(value) ||
      product.barcode.includes(value) ||
      (product.extraBarcodes ?? []).some((barcode) => barcode.includes(value)) ||
      product.sku.toLowerCase().includes(value);
  });

  if (section === "balances") {
    return (
      <section className="admin-card">
        <div className="card-head">
          <h1>Остатки</h1>
          <span>{activeProducts.length} товаров</span>
        </div>
        <div className="admin-table balances-table">
          <div className="admin-row head"><span>Товар</span><span>Штрихкод</span><span>Категория</span><span>Остаток</span><span>Цена</span></div>
          {activeProducts.map((product) => (
            <div className="admin-row" key={product.id}>
              <strong>{product.name}</strong>
              <span>{product.barcode}</span>
              <span>{account.categories.find((category) => category.id === product.categoryId)?.name ?? "-"}</span>
              <span>{formatQty(stockOf(account, product, currentStoreId))} {product.unit}</span>
              <span>{money(salePriceForStore(product, currentStoreId, account))}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (mode === "document" && document) {
    const totalPurchase = document.items.reduce((sum, item) => sum + item.total, 0);
    const totalSale = document.items.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
    const inventoryResults = document.items.reduce(
      (acc, item) => {
        const diff = roundAdmin(item.qty - item.currentStock);
        if (diff > 0) acc.surplus += diff;
        if (diff < 0) acc.shortage += Math.abs(diff);
        if (diff === 0) acc.same += 1;
        return acc;
      },
      { surplus: 0, shortage: 0, same: 0 }
    );
    return (
      <div className="stock-document-page">
        <section className="document-toolbar">
          <div>
            <h1>{sectionTitle} №{document.number}</h1>
            <span className={`doc-status ${document.status}`}>{document.status === "posted" ? "Проведен" : "Черновик"}</span>
          </div>
          <div className="admin-inline-actions">
            <button className="primary-admin" type="button" disabled={document.status === "posted"} onClick={postCurrent}>
              Провести
            </button>
            <button className="secondary-admin" type="button" onClick={() => saveCurrent()}>
              Сохранить
            </button>
            <button className="ghost-admin" type="button" onClick={() => { setMode("list"); setDocument(null); }}>
              Закрыть
            </button>
          </div>
        </section>

        <section className="document-meta">
          {document.type === "transfer" ? (
            <>
              <label className="admin-field readonly-field">
                Откуда
                <input value={currentStoreName} readOnly />
              </label>
              <label className="admin-field">
                Куда
                <AdminStyledSelect
                  value={document.targetStoreId ?? ""}
                  options={[
                    { value: "", label: "Выберите точку" },
                    ...account.stores.filter((store) => store.id !== currentStoreId).map((store) => ({ value: store.id, label: store.name }))
                  ]}
                  onChange={(targetStoreId) => setDocument({ ...document, targetStoreId })}
                />
              </label>
            </>
          ) : (
            <label className="admin-field">
              Торговая точка
              <AdminStyledSelect
                value={document.storeId}
                options={account.stores.map((store) => ({ value: store.id, label: store.name }))}
                onChange={(storeId) => setDocument({ ...document, storeId, sourceStoreId: storeId })}
              />
            </label>
          )}
          <label className="admin-field">
            Дата документа
            <input type="datetime-local" value={toDateInput(document.createdAt)} onChange={(event) => setDocument({ ...document, createdAt: new Date(event.target.value).toISOString() })} />
          </label>
          <label className="admin-field wide-field">
            Комментарий
            <input value={document.comment} onChange={(event) => setDocument({ ...document, comment: event.target.value })} placeholder="Комментарий к документу" />
          </label>
          <strong>Создал: {document.createdByUserName || document.userName} · {formatDateTime(document.createdAt)}</strong>
          {document.postedAt && <strong>Провел: {document.postedByUserName || document.userName} · {formatDateTime(document.postedAt)}</strong>}
        </section>

        <section className="admin-card document-table-card">
          <div className="document-actions">
            <strong>Товары ({document.items.length})</strong>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Добавление товара: название или штрихкод" />
            <button
              className="secondary-admin scanner-action"
              type="button"
              onClick={() =>
                setScannerTarget({
                  title: "barcode",
                  onScan: (barcode) => {
                    setSearch(barcode);
                    const product = account.products.find((item) =>
                      productAvailableInStore(account, item, currentStoreId) &&
                      (item.barcode === barcode || item.sku === barcode || (item.extraBarcodes ?? []).includes(barcode))
                    );
                    if (product) addProductToDocument(product);
                  }
                })
              }
            >
              <ScanBarcode size={17} />
            </button>
            <button className="secondary-admin" type="button" onClick={() => filteredProducts[0] && addProductToDocument(filteredProducts[0])}>
              Добавить
            </button>
            <button className="secondary-admin" type="button" onClick={() => setShowNomenclature(true)}>
              Добавить из номенклатуры
            </button>
            <button
              className="primary-admin"
              type="button"
              disabled={document.status === "posted"}
              onClick={() => {
                setProductDraft({ categoryId: lastProductCategoryId });
                setProductModalOpen(true);
              }}
            >
              <Plus size={17} />
              Новый товар
            </button>
          </div>
          {search && filteredProducts.length > 0 && (
            <div className="quick-suggestions">
              {filteredProducts.slice(0, 5).map((product) => (
                <button type="button" key={product.id} onClick={() => addProductToDocument(product)}>
                  {product.name} · {product.barcode}
                </button>
              ))}
            </div>
          )}
          <div className={`receipt-doc-table ${canViewPurchasePrice ? "" : "no-purchase"}`}>
            <div className="receipt-doc-head">
              <span>№</span><span>Название товара</span><span>Штрихкод</span><span>Кол-во</span><span>Текущий остаток</span><span>Ед.</span>{canViewPurchasePrice && <span>Цена</span>}{canViewPurchasePrice && <span>Закупочная</span>}{canViewPurchasePrice && <span>Наценка %</span>}<span>Продажная</span>{canViewPurchasePrice && <span>Итого</span>}<span>Комментарий</span><span />
            </div>
            {document.items.length === 0 ? (
              <div className="empty-admin doc-empty">Тут пока пусто. Добавьте товары с помощью панели выше.</div>
            ) : (
              document.items.map((item, index) => (
                <div className="receipt-doc-row" key={item.id}>
                  <span data-label="№">{index + 1}</span>
                  <strong data-label="Товар">{item.name}</strong>
                  <span data-label="ШК">{item.barcode}</span>
                  <input data-label={document.type === "inventory" ? "Факт" : document.type === "writeoff" ? "К списанию" : "Кол-во"} type="number" value={item.qty} onChange={(event) => updateItem(item.id, { qty: Number(event.target.value) })} />
                  <span data-label="Остаток">{item.currentStock}</span>
                  <span data-label="Ед.">{item.unit}</span>
                  {canViewPurchasePrice && <input data-label="Цена" type="number" value={item.price} onChange={(event) => updateItem(item.id, { purchasePrice: Number(event.target.value), price: Number(event.target.value) })} />}
                  {canViewPurchasePrice && <input data-label="Закуп" type="number" value={item.purchasePrice} onChange={(event) => updateItem(item.id, { purchasePrice: Number(event.target.value), price: Number(event.target.value) })} />}
                  {canViewPurchasePrice && <span data-label="Наценка %">{item.markupPercent}</span>}
                  <input data-label="Продажа" type="number" value={item.salePrice} onChange={(event) => updateItem(item.id, { salePrice: Number(event.target.value) })} />
                  {canViewPurchasePrice && <strong data-label={document.type === "inventory" ? "Разница" : "Итого"}>{money(item.total)}</strong>}
                  <input data-label="Коммент." value={item.comment} onChange={(event) => updateItem(item.id, { comment: event.target.value })} />
                  <button className="icon-only" type="button" onClick={() => setDocument({ ...document, items: document.items.filter((row) => row.id !== item.id) })}>
                    <X size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="document-totals">
            {canViewPurchasePrice && <span>Итого закуп: {money(totalPurchase)}</span>}
            <span>Итого продажа: {money(totalSale)}</span>
          </div>
          {document.type === "inventory" && (
            <div className="inventory-results">
              <div><span>Излишек</span><strong className="positive-text">+{inventoryResults.surplus}</strong></div>
              <div><span>Недостача</span><strong className="danger-text">-{inventoryResults.shortage}</strong></div>
              <div><span>Без изменений</span><strong>{inventoryResults.same}</strong></div>
            </div>
          )}
        </section>

        {showNomenclature && (
          <NomenclatureModal
            account={account}
            storeId={currentStoreId}
            selectedIds={document.items.map((item) => item.productId)}
            onClose={() => setShowNomenclature(false)}
            onAdd={(products) => {
              products.forEach(addProductToDocument);
              setShowNomenclature(false);
            }}
          />
        )}
        {productModalOpen && (
          <div className="admin-modal-backdrop">
            <section className="admin-card product-modal">
              <div className="card-head">
                <h2>Создать товар для документа</h2>
                <button className="icon-only" type="button" onClick={() => setProductModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <FormInput label="Название" value={productDraft.name ?? ""} onChange={(name) => setProductDraft({ ...productDraft, name })} />
              <label className="admin-field">
                Категория
                <AdminStyledSelect
                  value={productDraft.categoryId ?? orderedCategories[0]?.id}
                  options={orderedCategories.map((category) => ({ value: category.id, label: category.name }))}
                  onChange={(categoryId) => setProductDraft({ ...productDraft, categoryId })}
                />
              </label>
              <FormInput
                label="Штрихкод"
                value={productDraft.barcode ?? ""}
                placeholder="Отсканируйте, введите или сгенерируйте"
                onChange={(barcode) => {
                  setProductDraft({ ...productDraft, barcode });
                  if (barcode.replace(/\D/g, "").length >= 8) {
                    applyStockProductBarcodeLookup(barcode);
                  }
                }}
              />
              <button
                className="secondary-admin scan-inline-button"
                type="button"
                onClick={() =>
                  setScannerTarget({
                    title: "Штрихкод",
                    onScan: (barcode) => {
                      setProductDraft((current) => ({ ...current, barcode }));
                      applyStockProductBarcodeLookup(barcode);
                    }
                  })
                }
              >
                <ScanBarcode size={17} />
                Сканер
              </button>
              <button className="secondary-admin scan-inline-button" type="button" onClick={generateStockProductBarcode}>
                Сгенерировать ШК
              </button>
              {productDraft.barcode && lookupProductByBarcode(productDraft.barcode) && (
                <span>Название найдено по штрихкоду, его можно изменить вручную.</span>
              )}
              {canViewPurchasePrice && <FormInput label="Цена закуп" type="number" value={String(productDraft.purchasePrice ?? "")} onChange={(purchasePrice) => setProductDraft({ ...productDraft, purchasePrice: Number(purchasePrice) })} />}
              <FormInput label="Цена продажи" type="number" value={String(productDraft.salePrice ?? "")} onChange={(salePrice) => setProductDraft({ ...productDraft, salePrice: Number(salePrice) })} />
              <label className="admin-field">
                Ед. изм.
                <AdminStyledSelect
                  value={productDraft.unit ?? "шт"}
                  options={productUnits.map((unit) => ({ value: unit, label: unit }))}
                  onChange={(unit) => setProductDraft({ ...productDraft, unit })}
                />
              </label>
              <ImageInput
                label="Фото товара"
                value={productDraft.imageData}
                onChange={(imageData) => setProductDraft({ ...productDraft, imageData })}
              />
              <div className="modal-actions">
                <button className="primary-admin" type="button" onClick={saveProductFromDocument}>
                  <Save size={17} />
                  Сохранить и добавить
                </button>
                <button className="ghost-admin" type="button" onClick={() => setProductModalOpen(false)}>
                  Отмена
                </button>
              </div>
            </section>
          </div>
        )}
        {scannerTarget && (
          <BarcodeScannerModal
            title={scannerTarget.title}
            onClose={() => setScannerTarget(null)}
            onDetected={(barcode) => {
              scannerTarget.onScan(barcode);
              setScannerTarget(null);
            }}
          />
        )}
      </div>
    );
  }

  const documents = account.stockDocuments.filter((doc) => {
    const docType = doc.type ?? "receipt";
    const belongsToStore = docType === "transfer"
      ? (doc.sourceStoreId || doc.storeId) === currentStoreId
      : doc.storeId === currentStoreId;
    if (!belongsToStore) return false;
    if (section === "acceptance") return docType === "receipt" && doc.status === "draft";
    if (section === "receipt") return docType === "receipt" && doc.status === "posted";
    return docType === documentType;
  });

  return (
    <div className="stock-list-page">
      <section className="admin-card wide">
        <div className="card-head">
          <h1>{sectionTitle}</h1>
          <div className="admin-inline-actions">
            <button className="primary-admin" type="button" onClick={() => openDocument()}>
              <PackagePlus size={17} />
              {sectionTitle}
            </button>
            <button className="secondary-admin" type="button">
              Фильтр
            </button>
          </div>
        </div>
        <div className="admin-table stock-documents-table">
          <div className="admin-row head">
            <span>Номер</span><span>Дата</span><span>Точка</span><span>Статус документа</span><span>Пользователь</span><span>Комментарий</span><span>Общая сумма</span><span />
          </div>
          {documents.length === 0 ? (
            <div className="empty-admin">Документов оприходования пока нет.</div>
          ) : (
            documents.map((doc) => (
              <div className="admin-row" key={doc.id}>
                <button className="link-button" type="button" onClick={() => openDocument(doc)}>{doc.number}</button>
                <span>{formatDateTime(doc.createdAt)}</span>
                <span>{doc.type === "transfer" ? `${storeName(account, doc.sourceStoreId || doc.storeId)} → ${storeName(account, doc.targetStoreId || "")}` : storeName(account, doc.storeId)}</span>
                <span className={`doc-status ${doc.status}`}>{doc.status === "posted" ? "Проведен" : "Черновик"}</span>
                <span>{doc.createdByUserName || doc.userName}</span>
                <span>{doc.comment || "-"}</span>
                <strong>{money(doc.items.reduce((sum, item) => sum + item.total, 0))}</strong>
                <button className="icon-only" type="button" onClick={() => openDocument(doc)}>↗</button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function NomenclatureModal({
  account,
  storeId,
  selectedIds,
  onAdd,
  onClose
}: {
  account: AdminAccount;
  storeId: string;
  selectedIds: string[];
  onAdd: (products: AdminProduct[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const products = account.products.filter((product) => {
    const value = query.toLowerCase();
    return (
      !product.isDeleted &&
      productAvailableInStore(account, product, storeId) &&
      !selectedIds.includes(product.id) &&
      (categoryId === "all" || product.categoryId === categoryId) &&
      (product.name.toLowerCase().includes(value) ||
        product.barcode.includes(value) ||
        (product.extraBarcodes ?? []).some((barcode) => barcode.includes(value)) ||
        product.sku.toLowerCase().includes(value))
    );
  });

  return (
    <div className="modal-backdrop admin-modal-backdrop">
      <section className="nomenclature-modal">
        <div className="card-head">
          <h2>Добавление товаров из номенклатуры</h2>
          <button className="icon-only" type="button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-filters">
          <label className="admin-field">
            Поиск по названию и штрихкоду
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по товарам" />
          </label>
          <label className="admin-field">
            Категория
            <AdminStyledSelect
              value={categoryId}
              options={[
                { value: "all", label: "Все" },
                ...sortCategories(account.categories).map((category) => ({ value: category.id, label: category.name }))
              ]}
              onChange={setCategoryId}
            />
          </label>
        </div>
        <div className="nomenclature-list">
          {products.map((product) => (
            <label className="nomenclature-row" key={product.id}>
              <input
                type="checkbox"
                checked={selected.includes(product.id)}
                onChange={(event) =>
                  setSelected((items) => event.target.checked ? [...items, product.id] : items.filter((id) => id !== product.id))
                }
              />
              <strong>{product.name}</strong>
              <span>{product.barcode}</span>
              <span>{money(purchasePriceForStore(product, storeId, account))}</span>
              <span>{money(salePriceForStore(product, storeId, account))}</span>
              <span>{product.unit}</span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary-admin" type="button" onClick={() => onAdd(account.products.filter((product) => selected.includes(product.id)))}>
            Добавить выбранные
          </button>
          <button className="ghost-admin" type="button" onClick={onClose}>Отмена</button>
        </div>
      </section>
    </div>
  );
}

function SalesPage({ account, storeId }: { account: AdminAccount; storeId: string }) {
  const sales = account.sales.filter((sale) => sale.storeId === storeId);
  return (
    <section className="admin-card">
      <h1>История продаж</h1>
      <div className="admin-table sales-table">
        <div className="admin-row head">
          <span>Чек</span>
          <span>Дата</span>
          <span>Кассир</span>
          <span>Оплата</span>
          <span>Сумма</span>
          <span>Прибыль</span>
        </div>
        {sales.length === 0 ? (
          <div className="empty-admin">Продажи появятся после синхронизации кассы.</div>
        ) : (
          sales.map((sale) => (
            <div className="admin-row" key={sale.id}>
              <strong>{sale.number}</strong>
              <span>{formatDateTime(sale.createdAt)}</span>
              <span>{sale.cashier}</span>
              <span>{paymentLabel(sale.paymentMethod)}</span>
              <span>{money(sale.total)}</span>
              <span>{money(sale.total - sale.costTotal)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function HomeDashboard({
  account,
  storeId,
  setView
}: {
  account: AdminAccount;
  storeId: string;
  setView: (view: AdminView) => void;
}) {
  const store = account.stores.find((item) => item.id === storeId);
  const sales = account.sales
    .filter((sale) => sale.storeId === storeId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const saleReceipts = sales.filter((sale) => (sale.type ?? "sale") !== "return");
  const returns = sales.filter((sale) => (sale.type ?? "sale") === "return");
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  const inRange = (sale: AdminSale, from: number, to: number) => {
    const createdAt = new Date(sale.createdAt).getTime();
    return Number.isFinite(createdAt) && createdAt >= from && createdAt <= to;
  };
  const todaySales = saleReceipts.filter((sale) => inRange(sale, dayStart, dayEnd));
  const todayReturns = returns.filter((sale) => inRange(sale, dayStart, dayEnd));
  const monthSales = saleReceipts.filter((sale) => inRange(sale, monthStart, monthEnd));
  const monthReturns = returns.filter((sale) => inRange(sale, monthStart, monthEnd));
  const todayRevenue = roundAdmin(
    todaySales.reduce((sum, sale) => sum + sale.total, 0) -
      todayReturns.reduce((sum, sale) => sum + sale.total, 0)
  );
  const monthRevenue = roundAdmin(
    monthSales.reduce((sum, sale) => sum + sale.total, 0) -
      monthReturns.reduce((sum, sale) => sum + sale.total, 0)
  );
  const monthAverageReceipt = monthSales.length ? roundAdmin(monthRevenue / monthSales.length) : 0;
  const paymentTotals = {
    cash: sumSalesByMethod(todaySales, "cash"),
    card: sumSalesByMethod(todaySales, "card"),
    qr: sumSalesByMethod(todaySales, "qr")
  };
  const paymentTotal = Math.max(1, paymentTotals.cash + paymentTotals.card + paymentTotals.qr);
  const lowStockProducts = account.products
    .filter((product) => productAvailableInStore(account, product, storeId) && !product.isDeleted)
    .map((product) => productForStore(account, product, storeId))
    .filter((product) => (product.stockByStore[storeId] ?? 0) <= 5)
    .slice(0, 4);
  const storeRegisters = account.registers.filter((register) => register.storeId === storeId);

  return (
    <div className="mobile-dashboard">
      <section className="mobile-hero-card">
        <div>
          <span>Продажи сегодня</span>
          <strong>{money(todayRevenue)}</strong>
          <em>{todaySales.length} чеков · {todayReturns.length ? `возвраты ${money(todayReturns.reduce((sum, sale) => sum + sale.total, 0))}` : store?.name ?? account.name}</em>
        </div>
        <div>
          <span>За месяц</span>
          <strong>{money(monthRevenue)}</strong>
          <em>Средний чек: {money(monthAverageReceipt)}</em>
        </div>
      </section>

      <section className="mobile-panel payment-panel">
        <div>
          <h2>Оплата</h2>
          <PaymentLine label="Наличные" value={paymentTotals.cash} share={paymentTotals.cash / paymentTotal * 100} />
          <PaymentLine label="Картой" value={paymentTotals.card} share={paymentTotals.card / paymentTotal * 100} />
          <PaymentLine label="QR оплата" value={paymentTotals.qr} share={paymentTotals.qr / paymentTotal * 100} />
        </div>
        <div
          className="mobile-donut"
          style={{
            background: `conic-gradient(#31c986 0 ${paymentTotals.cash / paymentTotal * 100}%, #147adf 0 ${(paymentTotals.cash + paymentTotals.card) / paymentTotal * 100}%, #8b5cf6 0 100%)`
          }}
        >
          <span>{money(todayRevenue).replace(" сом", "")}<small>сом</small></span>
        </div>
      </section>

      <section className={`mobile-alert ${lowStockProducts.length ? "" : "muted"}`}>
        <div>
          <strong>Товары с низким остатком</strong>
          <span>{lowStockProducts.length ? lowStockProducts.map((product) => `${product.name} (${formatQty(product.stockByStore[storeId] ?? 0)} ${product.unit})`).join(", ") : "Критичных остатков нет"}</span>
        </div>
        <b>{lowStockProducts.length}</b>
      </section>

      <section className="mobile-panel">
        <div className="mobile-section-head">
          <h2>Кассы</h2>
          <button type="button" onClick={() => setView("stores")}>Все кассы</button>
        </div>
        <div className="mobile-register-grid">
          {storeRegisters.slice(0, 4).map((register) => (
            <div key={register.id}>
              <strong>{register.name}</strong>
              <span className={register.status === "online" ? "online" : ""}>{register.status === "online" ? "Онлайн" : register.status === "not_activated" ? "Не активирована" : "Офлайн"}</span>
            </div>
          ))}
          {storeRegisters.length === 0 && <p>Кассы для этой точки не созданы.</p>}
        </div>
      </section>

      <section className="mobile-panel">
        <div className="mobile-section-head">
          <h2>Последние продажи</h2>
          <button type="button" onClick={() => setView("sales")}>Все чеки</button>
        </div>
        <div className="mobile-sales-list">
          {sales.slice(0, 5).map((sale) => (
            <div key={sale.id}>
              <span>Чек №{sale.number}</span>
              <em>{formatDateTime(sale.createdAt)}</em>
              <strong>{money(sale.total)}</strong>
            </div>
          ))}
          {sales.length === 0 && <p>Продажи появятся после синхронизации кассы.</p>}
        </div>
      </section>
    </div>
  );
}

function PaymentLine({ label, value, share }: { label: string; value: number; share: number }) {
  return (
    <div className="payment-line">
      <span>{label}</span>
      <strong>{money(value)}</strong>
      <em>{Math.round(share)}%</em>
    </div>
  );
}

function sumSalesByMethod(sales: AdminSale[], method: AdminSale["paymentMethod"]) {
  return roundAdmin(sales.filter((sale) => sale.paymentMethod === method).reduce((sum, sale) => sum + sale.total, 0));
}

function EmployeesPage({
  account,
  patchAccount,
  storeId
}: {
  account: AdminAccount;
  patchAccount: (updater: (account: AdminAccount) => AdminAccount, message?: string) => void;
  storeId: string;
}) {
  const [editing, setEditing] = useState<Partial<AdminEmployee> | null>(null);

  const saveEmployee = () => {
    if (!editing) return;
    const firstName = editing.firstName || editing.name?.split(" ")[0] || "";
    const lastName = editing.lastName || editing.name?.split(" ").slice(1).join(" ") || "";
    const employee: AdminEmployee = {
      id: editing.id || `emp-${Date.now()}`,
      name: `${firstName} ${lastName}`.trim() || editing.name || "Новый сотрудник",
      firstName,
      lastName,
      role: editing.role || "cashier",
      phone: editing.phone || "",
      email: editing.email || "",
      storeId: editing.storeId || editing.allowedStoreIds?.[0] || storeId || account.stores[0]?.id || "",
      allowedStoreIds: editing.allowedStoreIds?.length ? editing.allowedStoreIds : [editing.storeId || storeId || account.stores[0]?.id || ""],
      canLoginCash: Boolean(editing.canLoginCash),
      canLoginAdmin: Boolean(editing.canLoginAdmin),
      adminLogin: editing.adminLogin || slugFromName(`${firstName} ${lastName}`.trim() || editing.name || "employee"),
      adminPassword: editing.adminPassword || "",
      permissions: normalizePermissions(editing.permissions, editing.role || "cashier"),
      pin: editing.pin || "0000",
      status: editing.status || "active",
      lastShiftAt: editing.lastShiftAt || new Date().toISOString()
    };
    patchAccount((current) => ({
      ...current,
      employees: current.employees.some((item) => item.id === employee.id)
        ? current.employees.map((item) => (item.id === employee.id ? employee : item))
        : [employee, ...current.employees]
    }), "Сотрудник сохранен");
    setEditing(null);
  };

  return (
    <div className="page-grid employees-page">
      <section className="admin-card wide">
        <div className="card-head">
          <h1>Сотрудники</h1>
          <button className="primary-admin" type="button" onClick={() => setEditing({ role: "cashier", storeId, allowedStoreIds: [storeId], canLoginCash: true, canLoginAdmin: false, pin: "0000", permissions: defaultPermissionsForRole("cashier") })}>
            <Plus size={17} />
            Пользователь
          </button>
        </div>
        <div className="admin-table employees-table">
          <div className="admin-row head">
            <span>ФИО</span><span>Должность</span><span>Телефон</span><span>Почта</span><span>Торговые точки</span><span>Статус</span><span />
          </div>
          {account.employees.map((employee) => (
            <div className="admin-row" key={employee.id}>
              <strong>{employee.name}</strong>
              <span>{roleLabel(employee.role)}</span>
              <span>{employee.phone}</span>
              <span>{employee.email}</span>
              <span>{employee.allowedStoreIds.map((id) => account.stores.find((store) => store.id === id)?.name ?? id).join(", ")}</span>
              <span className="green-badge">{employee.status === "active" ? "Активен" : "Не в сети"}</span>
              <button type="button" onClick={() => setEditing(employee)}>Изм.</button>
            </div>
          ))}
        </div>
      </section>

      {editing && (
        <section className="admin-card employee-form-card">
          <h2>{editing.id ? "Редактирование пользователя" : "Создание пользователя"}</h2>
          <FormInput label="Имя" value={editing.firstName ?? ""} onChange={(firstName) => setEditing({ ...editing, firstName })} />
          <FormInput label="Фамилия" value={editing.lastName ?? ""} onChange={(lastName) => setEditing({ ...editing, lastName })} />
          <label className="admin-field">
            Телефон
            <PhoneInput value={editing.phone ?? ""} onChange={(phone) => setEditing({ ...editing, phone: normalizeKyrgyzPhone(phone) || phone })} />
          </label>
          <FormInput label="Почта" value={editing.email ?? ""} onChange={(email) => setEditing({ ...editing, email })} />
          <div className="employee-store-access">
            <label className="check-row">
              <input
                type="checkbox"
                checked={(editing.allowedStoreIds?.length ?? 0) === account.stores.length}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    allowedStoreIds: event.target.checked ? account.stores.map((store) => store.id) : [storeId || account.stores[0]?.id || ""],
                    storeId: event.target.checked ? account.stores[0]?.id : storeId
                  })
                }
              />
              Доступ ко всем торговым точкам
            </label>
            <div className="store-checkbox-grid">
              {account.stores.map((store) => {
                const checked = (editing.allowedStoreIds ?? [editing.storeId || storeId]).includes(store.id);
                return (
                  <label className="check-row" key={store.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const current = editing.allowedStoreIds ?? [editing.storeId || storeId];
                        const next = event.target.checked
                          ? Array.from(new Set([...current, store.id]))
                          : current.filter((id) => id !== store.id);
                        setEditing({ ...editing, allowedStoreIds: next, storeId: next[0] || storeId });
                      }}
                    />
                    {store.name}
                  </label>
                );
              })}
            </div>
          </div>
          <label className="admin-field">
            Роль пользователя
            <AdminStyledSelect
              value={editing.role ?? "cashier"}
              options={[
                { value: "owner", label: "Владелец" },
                { value: "admin", label: "Администратор" },
                { value: "cashier", label: "Кассир" },
                { value: "manager", label: "Менеджер" }
              ]}
              onChange={(value) => {
              const role = value as AdminEmployee["role"];
              setEditing({ ...editing, role, permissions: defaultPermissionsForRole(role) });
            }}
            />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={Boolean(editing.canLoginCash)} onChange={(event) => setEditing({ ...editing, canLoginCash: event.target.checked })} />
            Разрешить вход на кассу
          </label>
          <FormInput label="PIN/пароль от кассы" value={editing.pin ?? ""} onChange={(pin) => setEditing({ ...editing, pin })} />
          <label className="check-row">
            <input type="checkbox" checked={Boolean(editing.canLoginAdmin)} onChange={(event) => setEditing({ ...editing, canLoginAdmin: event.target.checked })} />
            Разрешить вход в админку
          </label>
          {editing.canLoginAdmin && (
            <>
              <FormInput label="Логин для админки" value={editing.adminLogin ?? ""} onChange={(adminLogin) => setEditing({ ...editing, adminLogin })} />
              <FormInput label="Пароль для админки" value={editing.adminPassword ?? ""} onChange={(adminPassword) => setEditing({ ...editing, adminPassword })} />
              <div className="permissions-panel">
                {permissionGroups.map((group) => (
                  <div className="permission-group" key={group.title}>
                    <h3>{group.title}</h3>
                    {group.permissions.map((permission) => (
                      <label className="check-row" key={permission}>
                        <input
                          type="checkbox"
                          checked={(editing.permissions ?? defaultPermissionsForRole(editing.role ?? "cashier")).includes(permission)}
                          onChange={(event) => {
                            const current = editing.permissions ?? defaultPermissionsForRole(editing.role ?? "cashier");
                            setEditing({
                              ...editing,
                              permissions: event.target.checked
                                ? Array.from(new Set([...current, permission]))
                                : current.filter((item) => item !== permission)
                            });
                          }}
                        />
                        {permissionLabels[permission]}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="admin-inline-actions">
            <button className="primary-admin" type="button" onClick={saveEmployee}>Создать/сохранить</button>
            <button className="ghost-admin" type="button" onClick={() => setEditing(null)}>Отмена</button>
          </div>
        </section>
      )}
    </div>
  );
}

function StoresPage({
  account,
  patchAccount,
  storeId
}: {
  account: AdminAccount;
  patchAccount: (updater: (account: AdminAccount) => AdminAccount, message?: string) => void;
  storeId: string;
}) {
  const [editing, setEditing] = useState<AdminRegister | null>(null);
  const [tab, setTab] = useState<"general" | "receipt" | "accounts">("general");
  const registerLimitReached = account.registers.length >= account.subscription.maxRegisters;
  const currentStoreId = account.stores.some((store) => store.id === storeId) ? storeId : account.stores[0]?.id ?? "";
  const storeRegisters = account.registers.filter((register) => register.storeId === currentStoreId);

  const saveRegister = () => {
    if (!editing) return;
    patchAccount((current) => ({
      ...current,
      registers: current.registers.map((register) => (register.id === editing.id ? editing : register))
    }), "Касса сохранена");
    setEditing(null);
  };

  return (
    <div className="page-grid">
      <section className="admin-card wide">
        <div className="card-head">
          <h1>Управление кассами</h1>
          <button className="primary-admin" type="button" disabled={registerLimitReached} onClick={() => {
            if (registerLimitReached) {
              return;
            }
            const register = makeAdminRegister(account, currentStoreId, { name: `Касса ${account.registers.length + 1}` });
            patchAccount((current) => ({ ...current, registers: [register, ...current.registers] }), "Касса создана");
          }}>
            <Plus size={17} />
            Создать кассу
          </button>
        </div>
        <div className={`limit-note ${registerLimitReached ? "danger" : ""}`}>
          Кассы: {account.registers.length} / {account.subscription.maxRegisters}. Тариф: {account.subscription.plan} до {formatDateOnly(account.subscription.expiresAt)}.
        </div>
        <div className="admin-table cashboxes-table">
          <div className="admin-row head">
            <span>ID</span><span>Название</span><span>Статус активности</span><span>Версия кассы</span><span>Платформа</span><span>Последняя синхр.</span><span>Магазин</span><span />
          </div>
          {storeRegisters.map((register) => (
            <div className="admin-row" key={register.id}>
              <span>{register.id}</span>
              <strong>{register.name}</strong>
              <span>{registerStatus(register.status)}</span>
              <span>{register.appVersion}</span>
              <span>{register.platform || register.deviceName || register.device}</span>
              <span>{formatDateTime(register.lastSyncAt)}</span>
              <span>{account.stores.find((store) => store.id === register.storeId)?.name}</span>
              <button type="button" onClick={() => { setEditing(structuredClone(register)); setTab("general"); }}>Изм.</button>
            </div>
          ))}
        </div>
      </section>
      <section className="admin-card">
        <h2>Магазины</h2>
        {account.stores.map((store) => (
          <div className="store-card" key={store.id}>
            <strong>{store.name}</strong>
            <span>{store.address}</span>
            <em>{store.license}</em>
          </div>
        ))}
      </section>
      {editing && (
        <div className="modal-backdrop admin-modal-backdrop">
          <section className="cashbox-modal">
            <div className="card-head">
              <h2>Редактирование кассы: {editing.name}</h2>
              <button className="icon-only" type="button" onClick={() => setEditing(null)}><X size={18} /></button>
            </div>
            <div className="tabs-row">
              <button className={tab === "general" ? "active" : ""} type="button" onClick={() => setTab("general")}>Общие настройки</button>
              <button className={tab === "receipt" ? "active" : ""} type="button" onClick={() => setTab("receipt")}>Настройка чека</button>
              <button className={tab === "accounts" ? "active" : ""} type="button" onClick={() => setTab("accounts")}>Счета</button>
            </div>
            {tab === "general" && (
              <div className="modal-form-grid">
                <FormInput label="Название" value={editing.name} onChange={(name) => setEditing({ ...editing, name })} />
                <label className="admin-field">
                  Статус кассы
                  <AdminStyledSelect
                    value={editing.status}
                    options={[
                      { value: "online", label: "Активна" },
                      { value: "offline", label: "Не активна" },
                      { value: "not_activated", label: "Не активирована" }
                    ]}
                    onChange={(status) => setEditing({ ...editing, status: status as AdminRegister["status"] })}
                  />
                </label>
                <FormInput label="Версия кассы" value={editing.appVersion} onChange={(appVersion) => setEditing({ ...editing, appVersion })} />
                <FormInput label="Платформа" value={editing.platform ?? ""} onChange={(platform) => setEditing({ ...editing, platform })} />
                <FormInput label="Устройство" value={editing.deviceName ?? ""} onChange={(deviceName) => setEditing({ ...editing, deviceName })} />
                <FormInput label="Время последней синхронизации" value={formatDateTime(editing.lastSyncAt)} onChange={() => undefined} />
                <label className="admin-field key-field">
                  Одноразовый ключ
                  <div className="key-line">
                    <input value={editing.activationKey.key} readOnly />
                    <button type="button" onClick={() => navigator.clipboard?.writeText(editing.activationKey.key)}><Copy size={15} /></button>
                  </div>
                </label>
                <button className="secondary-admin" type="button" onClick={() => {
                  patchAccount((current) => issueRegisterKey(current, editing.id), "Ключ кассы сгенерирован");
                  setEditing(null);
                }}>
                  Сгенерировать одноразовый ключ
                </button>
              </div>
            )}
            {tab === "receipt" && (
              <div className="modal-form-grid">
                <FormInput label="Шаблон" value={editing.receiptSettings?.template ?? "Стандартный"} onChange={(template) => setEditing({ ...editing, receiptSettings: { ...(editing.receiptSettings ?? { showQr: false, header: account.name, footer: "Спасибо за покупку" }), showQr: false, template } })} />
                <FormInput label="Текст сверху" value={editing.receiptSettings?.header ?? account.stores.find((store) => store.id === editing.storeId)?.name ?? account.name} onChange={(header) => setEditing({ ...editing, receiptSettings: { ...(editing.receiptSettings ?? { template: "Стандартный", showQr: false, footer: "Спасибо за покупку" }), showQr: false, header } })} />
                <FormInput label="Текст внизу чека" value={editing.receiptSettings?.footer ?? "Спасибо за покупку"} onChange={(footer) => setEditing({ ...editing, receiptSettings: { ...(editing.receiptSettings ?? { template: "Стандартный", showQr: false, header: account.name }), showQr: false, footer } })} />
              </div>
            )}
            {tab === "accounts" && (
              <div className="account-bind-list">
                <InfoLine label="Магазин:" value={account.stores.find((store) => store.id === editing.storeId)?.name ?? editing.storeId} />
                <InfoLine label="Привязанные счета:" value="1" />
                <InfoLine label="Остаток на счету:" value="0 сом" />
              </div>
            )}
            <div className="modal-actions">
              <button className="primary-admin" type="button" onClick={saveRegister}>Сохранить</button>
              <button className="ghost-admin" type="button" onClick={() => setEditing(null)}>Отменить</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ReportsPage({ account, storeId }: { account: AdminAccount; storeId: string }) {
  const [reportTab, setReportTab] = useState<"shifts" | "abc" | "sales">("shifts");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [period, setPeriod] = useState({
    from: toDateInput(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString()),
    to: toDateInput(new Date().toISOString())
  });
  const shifts = account.shiftReports.filter((shift) => shift.storeId === storeId);
  const selected = shifts.find((shift) => shift.id === selectedId) ?? null;
  const sales = selected ? account.sales.filter((sale) => sale.shiftId === selected.id && sale.storeId === storeId) : [];
  const periodSales = account.sales.filter((sale) => {
    const createdAt = new Date(sale.createdAt).getTime();
    return sale.storeId === storeId && createdAt >= new Date(`${period.from}T00:00:00`).getTime() && createdAt <= new Date(`${period.to}T23:59:59`).getTime();
  });
  const productRows = buildProductSalesRows(periodSales);
  const abcRows = buildAbcRows(productRows);

  if (selected && reportTab === "shifts") {
    return (
      <section className="admin-card shift-detail-card">
        <div className="card-head">
          <div>
            <h1>Обзор по отчету</h1>
            <p>Кассир: {selected.cashier} · Касса: {selected.registerName}</p>
          </div>
          <button className="ghost-admin" type="button" onClick={() => setSelectedId(null)}>Назад</button>
        </div>
        <div className="tabs-row">
          {[
            ["overview", "Обзор"],
            ["sales", "Продажи"],
            ["returns", "Возвраты"],
            ["purchases", "Закупки"],
            ["money", "Денежные операции"],
            ["debts", "Долги"],
            ["canceled", "Отмененные товары"]
          ].map(([id, label]) => (
            <button className={tab === id ? "active" : ""} type="button" key={id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        {tab === "overview" && (
          <div className="shift-overview">
            <section className="money-card">
              <h2>Движение денег</h2>
              <InfoLine label="Остаток на начало смены" value={money(selected.openingCash)} />
              <InfoLine label="Приход" value={money(selected.cash)} />
              <InfoLine label="Продажи наличными" value={money(selected.cash)} />
              <InfoLine label="Продажи картой" value={money(selected.card)} />
              <InfoLine label="Продажи QR" value={money(selected.qr)} />
              <InfoLine label="Продажи в долг" value={money(selected.debtIssued)} />
              <InfoLine label="Погашение долгов" value={money(selected.debtPaidCash + selected.debtPaidCard + selected.debtPaidQr)} />
              <InfoLine label="Расход" value={money(selected.expenses)} />
              <InfoLine label="Остаток на конец смены" value={money(selected.closingCash)} />
              <InfoLine label="Разница" value={money(selected.difference)} />
            </section>
            <section className="money-card">
              <h2>Выручка за смену</h2>
              <InfoLine label="Выручка" value={money(selected.revenue)} />
              <InfoLine label="Продажи" value={money(selected.revenue + selected.returnsTotal)} />
              <InfoLine label="Возвраты" value={money(selected.returnsTotal)} />
              <InfoLine label="Себестоимость" value={money(selected.revenue - selected.profit)} />
              <InfoLine label="Валовая прибыль за смену" value={money(selected.profit)} />
              <div className="mini-chart">
                <span style={{ height: `${Math.max(8, Math.min(100, selected.revenue / 200))}%` }} />
              </div>
            </section>
          </div>
        )}
        {tab === "sales" && (
          <div className="admin-table sales-table">
            <div className="admin-row head"><span>Чек</span><span>Дата</span><span>Оплата</span><span>Сумма</span><span>Себестоимость</span><span>Прибыль</span></div>
            {sales.filter((sale) => (sale.type ?? "sale") !== "return").map((sale) => (
              <div className="admin-row" key={sale.id}>
                <strong>{sale.number}</strong>
                <span>{formatDateTime(sale.createdAt)}</span>
                <span>{paymentLabel(sale.paymentMethod)}</span>
                <span>{money(sale.total)}</span>
                <span>{money(sale.costTotal)}</span>
                <span>{money(sale.total - sale.costTotal)}</span>
              </div>
            ))}
            {sales.length === 0 && <div className="empty-admin">Продаж по этой смене нет.</div>}
          </div>
        )}
        {tab === "returns" && (
          <div className="admin-table sales-table">
            <div className="admin-row head"><span>Чек</span><span>Дата</span><span>Способ</span><span>Сумма</span><span>Исходный чек</span><span>Причина</span></div>
            {sales.filter((sale) => (sale.type ?? "sale") === "return").map((sale) => (
              <div className="admin-row" key={sale.id}>
                <strong>{sale.number}</strong>
                <span>{formatDateTime(sale.createdAt)}</span>
                <span>{paymentLabel(sale.returnPaymentMethod ?? sale.paymentMethod)}</span>
                <span className="danger-text">-{money(sale.total)}</span>
                <span>{sale.originalSaleId || "-"}</span>
                <span>{sale.returnReason || "Возврат"}</span>
              </div>
            ))}
            {sales.filter((sale) => (sale.type ?? "sale") === "return").length === 0 && <div className="empty-admin">Возвратов по этой смене нет.</div>}
          </div>
        )}
        {tab !== "overview" && tab !== "sales" && tab !== "returns" && <div className="empty-admin">По этой вкладке реальных данных пока нет.</div>}
      </section>
    );
  }

  return (
    <section className="admin-card reports-page-card">
      <div className="card-head">
        <div>
          <h1>Отчеты</h1>
          <p>Смены, ABC-анализ и продажи за период строятся только по реальным данным кассы.</p>
        </div>
      </div>
      <div className="tabs-row">
        <button className={reportTab === "shifts" ? "active" : ""} type="button" onClick={() => setReportTab("shifts")}>Смены</button>
        <button className={reportTab === "abc" ? "active" : ""} type="button" onClick={() => setReportTab("abc")}>ABC-анализ</button>
        <button className={reportTab === "sales" ? "active" : ""} type="button" onClick={() => setReportTab("sales")}>Продажи</button>
      </div>

      {reportTab === "shifts" && (
        <div className="admin-table shifts-table">
          <div className="admin-row head">
            <span>№</span><span>Касса</span><span>Кассир</span><span>Время открытия</span><span>Время закрытия</span><span>Наличные</span><span>Карта</span><span>QR</span><span>Долг</span><span>Погашено</span><span>Возвраты</span><span>Итого</span><span>Разница</span><span>Прибыль</span>
          </div>
          {shifts.length === 0 ? (
            <div className="empty-admin">По данным фильтра ничего не найдено. Откройте или закройте смену на кассе, чтобы отчет появился здесь.</div>
          ) : (
            shifts.map((shift, index) => (
              <div className="admin-row" key={shift.id}>
                <button className="link-button" type="button" onClick={() => setSelectedId(shift.id)}>{index + 1}</button>
                <span>{shift.registerName}</span>
                <span>{shift.cashier}</span>
                <span>{formatDateTime(shift.openedAt)}</span>
                <span>{shift.closedAt ? formatDateTime(shift.closedAt) : "Не закрыта"}</span>
                <span className="positive-text">{money(shift.cash)}</span>
                <span>{money(shift.card)}</span>
                <span>{money(shift.qr)}</span>
                <span className="danger-text">{money(shift.debtIssued)}</span>
                <span>{money(shift.debtPaidCash + shift.debtPaidCard + shift.debtPaidQr)}</span>
                <span className="danger-text">{money(shift.returnsTotal)}</span>
                <span>{money(shift.totalReceived)}</span>
                <span>{money(shift.difference)}</span>
                <span>{money(shift.profit)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {reportTab !== "shifts" && (
        <>
          <div className="report-filter-row">
            <label>С
              <input type="date" value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} />
            </label>
            <label>По
              <input type="date" value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} />
            </label>
          </div>
          {reportTab === "abc" && (
            <div className="admin-table analytics-table">
              <div className="admin-row head"><span>Класс</span><span>Товар</span><span>Кол-во</span><span>Выручка</span><span>Доля</span><span>Прибыль</span></div>
              {abcRows.map((row) => (
                <div className="admin-row" key={row.productId}>
                  <strong className={`abc-class abc-${row.className.toLowerCase()}`}>{row.className}</strong>
                  <span>{row.name}</span>
                  <span>{formatQty(row.qty)}</span>
                  <span>{money(row.revenue)}</span>
                  <span>{row.share.toFixed(1)}%</span>
                  <span>{money(row.profit)}</span>
                </div>
              ))}
              {abcRows.length === 0 && <div className="empty-admin">За выбранный период продаж нет.</div>}
            </div>
          )}
          {reportTab === "sales" && (
            <div className="admin-table analytics-table">
              <div className="admin-row head"><span>№</span><span>Товар</span><span>Кол-во</span><span>Выручка</span><span>Себестоимость</span><span>Прибыль</span></div>
              {productRows.map((row, index) => (
                <div className="admin-row" key={row.productId}>
                  <strong>{index + 1}</strong>
                  <span>{row.name}</span>
                  <span>{formatQty(row.qty)}</span>
                  <span>{money(row.revenue)}</span>
                  <span>{money(row.cost)}</span>
                  <span>{money(row.profit)}</span>
                </div>
              ))}
              {productRows.length === 0 && <div className="empty-admin">За выбранный период продаж нет.</div>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

type ProductSalesRow = {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
};

type AbcRow = ProductSalesRow & {
  share: number;
  className: "A" | "B" | "C";
};

function buildProductSalesRows(sales: AdminSale[]): ProductSalesRow[] {
  const rows = new Map<string, ProductSalesRow>();
  for (const sale of sales) {
    const sign = (sale.type ?? "sale") === "return" ? -1 : 1;
    for (const item of sale.items ?? []) {
      const current = rows.get(item.productId) ?? {
        productId: item.productId,
        name: item.name,
        qty: 0,
        revenue: 0,
        cost: 0,
        profit: 0
      };
      const revenue = sign * (item.total ?? 0);
      const cost = sign * (item.costTotal ?? (item.purchasePrice ?? 0) * item.qty);
      current.qty = roundAdmin(current.qty + sign * item.qty);
      current.revenue = roundAdmin(current.revenue + revenue);
      current.cost = roundAdmin(current.cost + cost);
      current.profit = roundAdmin(current.profit + revenue - cost);
      rows.set(item.productId, current);
    }
  }
  return [...rows.values()]
    .filter((row) => Math.abs(row.qty) > 0.0001 || Math.abs(row.revenue) > 0.009)
    .sort((left, right) => right.revenue - left.revenue);
}

function buildAbcRows(rows: ProductSalesRow[]): AbcRow[] {
  const totalRevenue = rows.reduce((sum, row) => sum + Math.max(0, row.revenue), 0);
  let cumulative = 0;
  return rows.map((row) => {
    const share = totalRevenue > 0 ? Math.max(0, row.revenue) / totalRevenue * 100 : 0;
    cumulative += share;
    return {
      ...row,
      share,
      className: cumulative <= 80 ? "A" : cumulative <= 95 ? "B" : "C"
    };
  });
}

function SettingsPage({
  account,
  patchAccount
}: {
  account: AdminAccount;
  patchAccount: (updater: (account: AdminAccount) => AdminAccount, message?: string) => void;
}) {
  const [settings, setSettings] = useState(account.settings);
  useEffect(() => setSettings(account.settings), [account.id]);
  return (
    <section className="admin-card settings-card">
      <h1>Настройки</h1>
      <FormInput label="Компания" value={settings.companyName} onChange={(companyName) => setSettings({ ...settings, companyName })} />
      <FormInput label="ИНН" value={settings.inn} onChange={(inn) => setSettings({ ...settings, inn })} />
      <FormInput label="Адрес" value={settings.address} onChange={(address) => setSettings({ ...settings, address })} />
      <FormInput label="Валюта" value={settings.currency} onChange={(currency) => setSettings({ ...settings, currency })} />
      <FormInput label="НДС %" type="number" value={String(settings.taxRate)} onChange={(taxRate) => setSettings({ ...settings, taxRate: Number(taxRate) })} />
      <button
        className="primary-admin"
        type="button"
        onClick={() => patchAccount((current) => ({ ...current, settings }), "Настройки сохранены")}
      >
        <Save size={17} />
        Сохранить изменения
      </button>
    </section>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="admin-card placeholder-admin">
      <h1>{title}</h1>
      <p>Раздел подготовлен в меню и будет расширен после локального теста учета.</p>
    </section>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <section className="admin-card metric-card">
      <span>{title}</span>
      <strong>{value}</strong>
    </section>
  );
}

const barcodeFormats = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF
];

const barcodeHints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, barcodeFormats],
  [DecodeHintType.TRY_HARDER, true]
]);

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    image.src = url;
  });
}

function makeBarcodeCanvas(image: HTMLImageElement, rotation = 0, crop = false, threshold = false) {
  const radians = (rotation * Math.PI) / 180;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropWidth = crop ? Math.round(sourceWidth * 0.9) : sourceWidth;
  const cropHeight = crop ? Math.round(sourceHeight * 0.62) : sourceHeight;
  const cropX = crop ? Math.round((sourceWidth - cropWidth) / 2) : 0;
  const cropY = crop ? Math.round((sourceHeight - cropHeight) / 2) : 0;
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(cropWidth, cropHeight));
  const targetWidth = Math.max(1, Math.round(cropWidth * scale));
  const targetHeight = Math.max(1, Math.round(cropHeight * scale));
  const rotated = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = rotated ? targetHeight : targetWidth;
  canvas.height = rotated ? targetWidth : targetHeight;
  const context = canvas.getContext("2d", { willReadFrequently: threshold });
  if (!context) return canvas;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.drawImage(image, cropX, cropY, cropWidth, cropHeight, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
  if (threshold) {
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < data.data.length; index += 4) {
      const gray = data.data[index] * 0.299 + data.data[index + 1] * 0.587 + data.data[index + 2] * 0.114;
      const value = gray < 150 ? 0 : 255;
      data.data[index] = value;
      data.data[index + 1] = value;
      data.data[index + 2] = value;
    }
    context.putImageData(data, 0, 0);
  }
  return canvas;
}

async function decodeBarcodeImage(file: File) {
  const image = await loadImage(file);
  const oneDReader = new BrowserMultiFormatOneDReader(barcodeHints);
  const multiReader = new BrowserMultiFormatReader(barcodeHints);
  const variants: HTMLCanvasElement[] = [];
  for (const rotation of [0, 90, 270, 180]) {
    variants.push(makeBarcodeCanvas(image, rotation, false, false));
    variants.push(makeBarcodeCanvas(image, rotation, false, true));
    variants.push(makeBarcodeCanvas(image, rotation, true, false));
    variants.push(makeBarcodeCanvas(image, rotation, true, true));
  }
  for (const canvas of variants) {
    for (const reader of [oneDReader, multiReader]) {
      try {
        const raw = reader.decodeFromCanvas(canvas).getText().trim();
        if (raw) return raw;
      } catch {
        // Try the next processed image variant.
      }
    }
  }
  return "";
}

function BarcodeScannerModal({
  title,
  onDetected,
  onClose
}: {
  title: string;
  onDetected: (barcode: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [cameraFallback, setCameraFallback] = useState(false);

  const scanImageFile = async (file: File) => {
    try {
      setError("");
      const raw = await decodeBarcodeImage(file);
      if (raw) {
        onDetected(raw);
        return;
      }
      setError("На фото не видно штрихкод. Попробуйте ближе и ровнее.");
    } catch {
      try {
        const Detector = (window as any).BarcodeDetector;
        if (!Detector) {
          setError("Не удалось распознать штрихкод. Попробуйте сфотографировать ближе или введите код вручную.");
          return;
        }
        const bitmap = await createImageBitmap(file);
        const detector = new Detector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"] });
        const codes = await detector.detect(bitmap);
        const raw = String(codes?.[0]?.rawValue ?? "").trim();
        if (raw) {
          onDetected(raw);
          return;
        }
        setError("На фото не видно штрихкод. Попробуйте ближе и ровнее.");
      } catch {
        setError("Штрихкод не распознан. Попробуйте снять ближе: код должен занимать почти всю ширину фото, без бликов и сильного наклона.");
      }
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  useEffect(() => {
    let stopped = false;
    let controls: IScannerControls | null = null;

    const start = async () => {
      try {
        if (!window.isSecureContext) {
          setCameraFallback(true);
          setError("Живая камера на телефоне доступна только через HTTPS. Сейчас используйте фото штрихкода или ручной ввод.");
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraFallback(true);
          setError("Камера недоступна в этом браузере. Нажмите «Сфотографировать штрихкод» или введите код вручную.");
          return;
        }
        if (!videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, scanError, activeControls) => {
          if (stopped) return;
          if (result) {
            const raw = result.getText().trim();
            if (raw) {
              stopped = true;
              activeControls.stop();
              onDetected(raw);
            }
          }
          if (scanError) {
            // Keep scanning while the camera is focusing and frames are unreadable.
          }
        });
      } catch {
        setCameraFallback(true);
        setError("Не удалось открыть камеру. Разрешите доступ к камере или нажмите «Сфотографировать штрихкод».");
      }
    };

    start();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [onDetected]);

  const submitManualCode = () => {
    const value = manualCode.trim();
    if (!value) {
      setError("Введите штрихкод вручную или отсканируйте камерой.");
      return;
    }
    onDetected(value);
  };

  return (
    <div className="admin-modal-backdrop">
      <section className="scanner-modal">
        <div className="card-head">
          <h2>{title}</h2>
          <button className="icon-only" type="button" onClick={onClose}><X size={18} /></button>
        </div>
        {cameraFallback ? (
          <div className="scanner-fallback">
            <ScanBarcode size={42} />
            <strong>Сканирование через фото</strong>
            <span>На локальном адресе телефона браузер блокирует живую камеру. Сделайте фото штрихкода, и админка вставит код в выбранное поле.</span>
          </div>
        ) : (
          <video ref={videoRef} className="scanner-video" muted playsInline />
        )}
        {error && <div className="import-error">{error}</div>}
        <button className={cameraFallback ? "primary-admin" : "secondary-admin"} type="button" onClick={() => fileRef.current?.click()}>
          <ScanBarcode size={17} />
          Сфотографировать штрихкод
        </button>
        <div className="scanner-manual-row">
          <input
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitManualCode();
            }}
            inputMode="numeric"
            placeholder="Ввести штрихкод вручную"
          />
          <button className="primary-admin compact" type="button" onClick={submitManualCode}>
            Готово
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => event.target.files?.[0] && scanImageFile(event.target.files[0])}
        />
      </section>
    </div>
  );
}

function FormInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="admin-field">
      {label}
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ImageInput({
  label,
  value,
  onChange
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const readImage = async (file: File) => {
    setError("");
    setProcessing(true);
    try {
      onChange(await compressImageFile(file));
    } catch {
      setError("Не удалось обработать фото. Попробуйте другое изображение.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="image-input">
      {value && (
        <div className="image-preview">
          <img src={value} alt="" />
          <div>
            <strong>Фото загружено</strong>
            <span>Изображение сжато для кассы.</span>
          </div>
        </div>
      )}
      <div className="image-actions">
        <label className="admin-file">
          <Upload size={17} />
          {processing ? "Сжимаем фото..." : value ? "Заменить фото" : label}
          <input
            type="file"
            accept="image/*"
            disabled={processing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              void readImage(file);
            }}
          />
        </label>
        {value && (
          <button className="ghost-admin" type="button" disabled={processing} onClick={() => onChange(undefined)}>
            Удалить
          </button>
        )}
      </div>
      {error && <div className="import-error">{error}</div>}
    </div>
  );
}

function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("image failed"));
      image.onload = () => {
        const maxSide = 600;
        const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
        const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
        const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("canvas failed"));
          return;
        }
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function stockOf(account: AdminAccount, product: AdminProduct, storeId = account.stores[0]?.id ?? "") {
  return product.stockByStore[storeId] ?? 0;
}

function normalizeExtraBarcodes(barcodes: string[]) {
  return Array.from(new Set(barcodes.map(normalizeBarcode).filter(Boolean)));
}

function findDuplicateProductBarcode(
  products: AdminProduct[],
  barcode: string,
  extraBarcodes: string[],
  currentProductId?: string
) {
  const rawCodes = [barcode, ...extraBarcodes].filter(Boolean);
  const ownCodes = normalizeExtraBarcodes(rawCodes);
  if (ownCodes.length !== rawCodes.length) {
    return { name: "этот же товар" };
  }
  const own = new Set(ownCodes);
  return products.find((product) => {
    if (product.id === currentProductId || product.isDeleted) {
      return false;
    }
    return normalizeExtraBarcodes([product.barcode, ...(product.extraBarcodes ?? [])]).some((code) => own.has(code));
  });
}

function totalStockOf(product: AdminProduct) {
  return Object.values(product.stockByStore ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function storeName(account: AdminAccount, storeId: string) {
  return account.stores.find((store) => store.id === storeId)?.name ?? "Точка";
}

function storeHasData(account: AdminAccount, storeId: string) {
  return (
    account.registers.some((register) => register.storeId === storeId) ||
    account.sales.some((sale) => sale.storeId === storeId) ||
    account.shiftReports.some((shift) => shift.storeId === storeId) ||
    account.stockDocuments.some((document) => document.storeId === storeId || document.sourceStoreId === storeId || document.targetStoreId === storeId) ||
    account.products.some((product) => Math.abs(product.stockByStore?.[storeId] ?? 0) > 0.0009)
  );
}

function formatQty(value: number) {
  return new Intl.NumberFormat("ru-KG", { maximumFractionDigits: 3 }).format(value || 0);
}

function openLabelPrintWindow(account: AdminAccount, products: AdminProduct[], storeId = account.stores[0]?.id ?? "") {
  const store = account.stores.find((item) => item.id === storeId);
  const labels = products
    .map((product) => {
      const barcodeSvg = code128Svg(product.barcode || product.sku || product.id);
      return `
        <section class="label">
          <div class="store">${escapeHtml(store?.name || account.name)}</div>
          <div class="product">${escapeHtml(product.name)}</div>
          <div class="barcode">${barcodeSvg}</div>
          <div class="code">${escapeHtml(product.barcode)}</div>
          <div class="price">ЦЕНА: ${escapeHtml(money(salePriceForStore(product, storeId, account)).toUpperCase())}</div>
        </section>`;
    })
    .join("");
  const html = `<!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Печать этикеток</title>
      <style>
        @page { size: 58mm 40mm; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #fff; font-family: Arial, sans-serif; color: #000; }
        .label {
          width: 58mm;
          height: 40mm;
          page-break-after: always;
          display: grid;
          grid-template-rows: 5mm 7.5mm 12mm 3.5mm 7mm;
          align-items: center;
          justify-items: center;
          padding: 2mm 3mm 1.5mm;
          overflow: hidden;
        }
        .store { max-width: 100%; font-size: 10pt; font-weight: 900; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .product { max-width: 100%; font-size: 12pt; font-weight: 900; line-height: 1; text-align: center; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .barcode { width: 46mm; height: 11.5mm; }
        .barcode svg { width: 100%; height: 100%; display: block; }
        .code { font-size: 8pt; letter-spacing: 0.8px; line-height: 1; }
        .price { width: 100%; font-size: 13pt; font-weight: 950; line-height: 1; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
    </head>
    <body>${labels}<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script></body>
    </html>`;
  const printWindow = window.open("", "_blank", "width=420,height=640");
  if (!printWindow) {
    window.alert("Не удалось открыть окно печати. Разрешите всплывающие окна для админки.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char] || char);
}

const code128Patterns = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
];

function code128Svg(value: string) {
  const text = String(value || "000000").replace(/[^\x20-\x7e]/g, "").slice(0, 48) || "000000";
  const codes = [104, ...Array.from(text).map((char) => char.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, index) => sum + code * (index === 0 ? 1 : index), 0) % 103;
  const allCodes = [...codes, checksum, 106];
  let x = 0;
  const bars: string[] = [];
  for (const code of allCodes) {
    const pattern = code128Patterns[code] || code128Patterns[0];
    Array.from(pattern).forEach((widthChar, index) => {
      const width = Number(widthChar);
      if (index % 2 === 0) {
        bars.push(`<rect x="${x}" y="0" width="${width}" height="50" />`);
      }
      x += width;
    });
  }
  return `<svg viewBox="0 0 ${x} 50" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars.join("")}</svg>`;
}

function excelCellToImportText(cell: string | number | boolean | null) {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return numberToPlainText(cell);
  return String(cell).trim();
}

function numberToPlainText(value: number) {
  if (!Number.isFinite(value)) return "";
  const text = String(value);
  return /e/i.test(text) ? expandScientificNotation(text) : text;
}

function expandScientificNotation(value: string) {
  const compact = String(value || "").trim().replace(/\s+/g, "").replace(",", ".");
  const match = compact.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return value;
  const [, sign, integerPart, fractionPart = "", exponentText] = match;
  const exponent = Number(exponentText);
  const digits = `${integerPart}${fractionPart}`;
  const decimalIndex = integerPart.length + exponent;
  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(Math.abs(decimalIndex))}${digits}`.replace(/\.?0+$/, "");
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`.replace(/\.?0+$/, "");
}

function normalizeImportedBarcode(value: string) {
  return expandScientificNotation(value).replace(/[^\d]/g, "");
}

function importProductsFromRows(
  account: AdminAccount,
  rows: string[][],
  mapping: Record<number, ImportField>,
  skipFirstRow: boolean,
  storeId = account.stores[0]?.id ?? "store-main"
) {
  const groupId = account.stores.find((store) => store.id === storeId)?.nomenclatureGroupId || account.nomenclatureGroups[0]?.id;
  let categories = [...account.categories];
  let products = [...account.products];
  let uncategorized = categories.find((category) => isUncategorizedCategory(category));
  if (!uncategorized) {
    uncategorized = {
      id: UNCATEGORIZED_CATEGORY_ID,
      name: UNCATEGORIZED_CATEGORY_NAME,
      icon: "ShoppingBasket",
      color: "#9aa8b8",
      sortOrder: categories.length + 1,
      nomenclatureGroupId: groupId
    };
    categories = [...categories, uncategorized];
  }
  let imported = 0;
  let skipped = 0;

  const fieldValue = (row: string[], field: ImportField) => {
    const column = Object.entries(mapping).find(([, mapped]) => mapped === field)?.[0];
    return column === undefined ? "" : String(row[Number(column)] ?? "").trim();
  };

  for (const [index, row] of rows.entries()) {
    if (skipFirstRow && index === 0) {
      continue;
    }
    const name = fieldValue(row, "name");
    const barcode = normalizeImportedBarcode(fieldValue(row, "barcode"));
    const extraBarcodes = normalizeExtraBarcodes(
      fieldValue(row, "extraBarcodes")
        .split(/[,\n;]/)
        .map(normalizeImportedBarcode)
    );
    const salePrice = parseImportNumber(fieldValue(row, "salePrice"));
    if (!name || !barcode || salePrice <= 0) {
      skipped += 1;
      continue;
    }

    const categoryName = fieldValue(row, "category");
    let categoryId = uncategorized.id;
    if (categoryName) {
      let category = categories.find((item) => item.nomenclatureGroupId === groupId && item.name.trim().toLowerCase() === categoryName.trim().toLowerCase());
      if (!category) {
        category = {
          id: `cat-import-${Date.now()}-${categories.length}`,
          name: categoryName,
          icon: "ShoppingBasket",
          color: importCategoryColor(categories.length),
          sortOrder: categories.length + 1,
          nomenclatureGroupId: groupId
        };
        categories = [...categories, category];
      }
      categoryId = category.id;
    }
    if (!categories.length) {
      categories = [{
        id: "cat-import-default",
        name: "Импорт",
        icon: "ShoppingBasket",
        color: "#147adf",
        sortOrder: 1,
        nomenclatureGroupId: groupId
      }];
      categoryId = categories[0].id;
    }

    const stockRaw = fieldValue(row, "stock");
    const purchaseRaw = fieldValue(row, "purchasePrice");
    const rawUnit = fieldValue(row, "unit") || "шт";
    const unit = productUnits.includes(rawUnit as typeof productUnits[number]) ? rawUnit : "шт";
    const sku = fieldValue(row, "sku") || `IMP-${String(products.length + imported + 1).padStart(4, "0")}`;
    const allImportBarcodes = new Set([barcode, ...extraBarcodes]);
    const existing = products.find((product) =>
      productAvailableInStore(account, product, storeId) &&
      [product.barcode, ...(product.extraBarcodes ?? [])].some((code) => allImportBarcodes.has(code))
    );
    const nextProduct = makeProduct({ ...account, categories, products }, {
      ...(existing ?? {}),
      id: existing?.id ?? `prod-import-${Date.now()}-${index}`,
      categoryId,
      name,
      unit,
      barcode,
      extraBarcodes: normalizeExtraBarcodes([...(existing?.extraBarcodes ?? []), ...extraBarcodes]),
      sku: existing?.sku && !fieldValue(row, "sku") ? existing.sku : sku,
      storePurchasePrice: purchaseRaw ? parseImportNumber(purchaseRaw) : existing ? purchasePriceForStore(existing, storeId, account) : 0,
      storeSalePrice: salePrice,
      stockByStore: {
        ...(existing?.stockByStore ?? {}),
        [storeId]: stockRaw ? parseImportNumber(stockRaw) : existing?.stockByStore?.[storeId] ?? 0
      },
      imageData: existing?.imageData,
      isDeleted: false
    }, storeId);

    products = existing
      ? products.map((product) => (product.id === existing.id ? nextProduct : product))
      : [nextProduct, ...products];
    imported += 1;
  }

  return {
    account: {
      ...account,
      categories,
      products
    },
    imported,
    skipped
  };
}

function guessImportMapping(rows: string[][]): Record<number, ImportField> {
  const firstRow = rows[0] ?? [];
  const mapping: Record<number, ImportField> = {};
  firstRow.forEach((value, index) => {
    const text = value.toLowerCase();
    if (text.includes("наим") || text.includes("товар") || text.includes("name")) mapping[index] = "name";
    else if (text.includes("доп") && (text.includes("штрих") || text.includes("шк") || text.includes("barcode"))) mapping[index] = "extraBarcodes";
    else if (text.includes("штрих") || text === "шк" || text.includes("barcode")) mapping[index] = "barcode";
    else if (text.includes("груп") || text.includes("катег") || text.includes("category")) mapping[index] = "category";
    else if (text.includes("остат")) mapping[index] = "stock";
    else if (text.includes("закуп")) mapping[index] = "purchasePrice";
    else if (text.includes("прод") || text.includes("розн")) mapping[index] = "salePrice";
    else if (text.includes("ед")) mapping[index] = "unit";
    else if (text.includes("sku") || text.includes("артик")) mapping[index] = "sku";
    else mapping[index] = "ignore";
  });
  if (!Object.values(mapping).includes("salePrice")) {
    firstRow.forEach((value, index) => {
      if ((mapping[index] ?? "ignore") === "ignore" && value.toLowerCase().includes("цена")) {
        mapping[index] = "salePrice";
      }
    });
  }
  return mapping;
}

function looksLikeHeader(row: string[]) {
  const text = row.join(" ").toLowerCase();
  return ["наим", "штрих", "цена", "остат", "товар", "barcode", "name"].some((marker) => text.includes(marker));
}

function parseImportNumber(value: string) {
  const normalized = value.replace(/\s+/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  return Number(normalized || 0);
}

function importCategoryColor(index: number) {
  const colors = ["#ff9f1c", "#3b82f6", "#2fbf71", "#ef4444", "#7c5ccf", "#0f766e", "#f97316"];
  return colors[index % colors.length];
}

function isUncategorizedCategory(category: Pick<AdminCategory, "id" | "name">) {
  return category.id === UNCATEGORIZED_CATEGORY_ID || category.name.trim().toLowerCase() === UNCATEGORIZED_CATEGORY_NAME.toLowerCase();
}

function sortCategories<T extends { name: string; sortOrder?: number }>(categories: T[]) {
  return [...categories].sort((left, right) => {
    const leftOrder = Number.isFinite(left.sortOrder) ? Number(left.sortOrder) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.sortOrder) ? Number(right.sortOrder) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.name.localeCompare(right.name, "ru");
  });
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-KG", { maximumFractionDigits: 2 }).format(value || 0)} сом`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function roleLabel(role: string) {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Администратор";
  if (role === "manager") return "Менеджер";
  return "Кассир";
}

function activationLabel(status: string) {
  return status === "active" ? "Активен" : status === "used" ? "Использован" : "Отозван";
}

function operationLabel(type: StockOperationType) {
  return type === "receipt" ? "Оприходование" : type === "writeoff" ? "Списание" : "Инвентаризация";
}

function registerStatus(status: AdminRegister["status"]) {
  if (status === "online") return "Активна";
  if (status === "offline") return "Не активна";
  return "Не активирована";
}

function accountStatusLabel(status: AdminAccount["status"]) {
  return status === "active" ? "Разрешен" : "Закрыт";
}

function adminAccessBlockedReason(account: AdminAccount) {
  if (account.status === "blocked") {
    return "Доступ к аккаунту закрыт в контрольной панели.";
  }
  if (account.subscription.status === "expired" || account.subscription.status === "suspended") {
    return "Подписка не активна. Обратитесь к владельцу К-про.";
  }
  if (new Date(account.subscription.expiresAt).getTime() < Date.now()) {
    return "Срок подписки истек. Обратитесь к владельцу К-про.";
  }
  return "";
}

function subscriptionStatusLabel(status: AdminAccount["subscription"]["status"]) {
  if (status === "active") return "активна";
  if (status === "trial") return "тест";
  if (status === "expired") return "истекла";
  return "остановлена";
}

function slugFromName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "") || "employee";
}

function paymentLabel(method: string) {
  if (method === "cash") return "Наличные";
  if (method === "card") return "Карта";
  if (method === "debt") return "В долг";
  return "QR";
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-info-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function roundAdmin(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toDateInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toDateOnlyInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function fromDateOnlyInput(value: string) {
  return new Date(`${value}T23:59:59`).toISOString();
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}



