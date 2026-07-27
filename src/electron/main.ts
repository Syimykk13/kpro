import { app, BrowserWindow, dialog, ipcMain, screen } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { KassaDatabase } from "./database";
import { createQrPayment, getQrPaymentStatus } from "./accountBridge";
import type {
  CloseShiftInput,
  CreateReceiptInput,
  CartItem,
  CashBinding,
  CustomerInput,
  DeviceUpdateInput,
  CustomerDisplayState,
  CreateQrPaymentInput,
  OpenShiftInput,
  PayDebtInput,
  Receipt,
  ReturnReceiptInput,
  SuspendReceiptInput
} from "../shared/types";

type LocalReceiptSettings = {
  template: string;
  header: string;
  footer: string;
};

let mainWindow: BrowserWindow | null = null;
let customerDisplayWindow: BrowserWindow | null = null;
let lastCustomerDisplayState: CustomerDisplayState | null = null;
let store: KassaDatabase;

const DEFAULT_SERVER_URL = "http://132.243.114.107:5173";
const appMode = process.env.KASSA_PRO_MODE?.trim().toLowerCase();
if (!process.env.KASSA_PRO_SERVER_URL?.trim() && appMode !== "local") {
  process.env.KASSA_PRO_SERVER_URL = DEFAULT_SERVER_URL;
}

const configuredDataDir =
  process.env.KASSA_PRO_DATA_DIR?.trim() ||
  path.join(app.getPath("appData"), appMode === "local" ? "kassa-pro-desktop-local" : "kassa-pro-desktop-server");
app.setPath("userData", configuredDataDir);

const logPath = path.join(app.getPath("userData"), "kassa-pro-launcher.log");
const log = (message: string) => {
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Startup diagnostics must never prevent the register from opening.
  }
};

const focusMainWindow = () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
};

const createWindow = () => {
  log("createWindow:start");
  const appIcon = path.join(process.cwd(), "dist", "k-pro-logo.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "К-про",
    icon: fs.existsSync(appIcon) ? appIcon : undefined,
    backgroundColor: "#eef3f8",
    autoHideMenuBar: true,
    fullscreen: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    log(`createWindow:loadURL ${process.env.VITE_DEV_SERVER_URL}`);
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const filePath = path.join(__dirname, "../../dist/cash/index.html");
    if (!fs.existsSync(filePath) || !fs.existsSync(path.join(__dirname, "preload.js"))) {
      log(`install:missing-files index=${fs.existsSync(filePath)} preload=${fs.existsSync(path.join(__dirname, "preload.js"))}`);
      dialog.showErrorBox(
        "К-про",
        "Приложение установлено некорректно. Переустановите K-pro Setup.exe."
      );
      app.quit();
      return;
    }
    log(`createWindow:loadFile ${filePath}`);
    mainWindow.loadFile(filePath);
  }

  mainWindow.once("ready-to-show", () => {
    log("window:ready-to-show");
    mainWindow?.setFullScreen(true);
    focusMainWindow();
  });
  mainWindow.on("closed", () => {
    log("window:closed");
    mainWindow = null;
    closeCustomerDisplayWindow();
  });
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (value: number) =>
  new Intl.NumberFormat("ru-KG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);

const paymentLabel = (method: string) => {
  if (method === "cash") return "Наличные";
  if (method === "card") return "Карта";
  if (method === "qr") return "QR";
  if (method === "debt") return "В долг";
  return method;
};

const moneyPlain = (value: number) => `${money(value).replace(/\s/g, " ")} сом`;

const qtyPlain = (value: number) =>
  Number(value || 0)
    .toFixed(3)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");

const cp866Byte = (char: string) => {
  const code = char.charCodeAt(0);
  if (code <= 0x7f) {
    return code;
  }
  if (code >= 0x0410 && code <= 0x043f) {
    return 0x80 + (code - 0x0410);
  }
  if (code >= 0x0440 && code <= 0x044f) {
    return 0xe0 + (code - 0x0440);
  }
  const extra: Record<string, number> = {
    "Ё": 0xf0,
    "ё": 0xf1,
    "№": 0xfc,
    "«": 0x22,
    "»": 0x22,
    "“": 0x22,
    "”": 0x22,
    "’": 0x27,
    "₽": 0x70
  };
  return extra[char] ?? 0x3f;
};

const encodeCp866 = (text: string) => Buffer.from(Array.from(text).map(cp866Byte));

const cleanReceiptText = (value: string) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();

const receiptColumns = 42;

const fitLine = (value: string, width = receiptColumns) => {
  const text = cleanReceiptText(value);
  return text.length > width ? text.slice(0, Math.max(0, width - 3)) + "..." : text;
};

const centerLine = (value: string, width = receiptColumns) => {
  const text = fitLine(value, width);
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  return `${" ".repeat(left)}${text}`;
};

const splitLine = (left: string, right: string, width = receiptColumns) => {
  const safeRight = cleanReceiptText(right);
  const leftWidth = Math.max(1, width - safeRight.length - 1);
  return `${fitLine(left, leftWidth).padEnd(leftWidth, " ")} ${safeRight}`;
};

const wrapLine = (value: string, width = receiptColumns) => {
  const words = cleanReceiptText(value).split(" ").filter(Boolean);
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      rows.push(fitLine(current, width));
      current = word;
    }
  }
  if (current) {
    rows.push(fitLine(current, width));
  }
  return rows.length ? rows : [""];
};

const receiptRawText = (
  receipt: Receipt,
  items: CartItem[],
  binding: CashBinding | null,
  settings: LocalReceiptSettings
) => {
  const isReturn = receipt.status === "returned";
  const header = settings.header || binding?.storeName || binding?.accountName || "К-про";
  const lines: string[] = [
    centerLine(header),
    isReturn ? centerLine("ВОЗВРАТ") : "",
    centerLine(`Чек № ${receipt.number}`),
    isReturn && receipt.originalReceiptNumber ? centerLine(`Исх. чек № ${receipt.originalReceiptNumber}`) : "",
    splitLine("Кассир", receipt.cashier),
    centerLine(new Date(receipt.createdAt).toLocaleString("ru-RU")),
    "-".repeat(receiptColumns)
  ].filter(Boolean);

  for (const item of items) {
    lines.push(...wrapLine(item.name));
    lines.push(splitLine(`${moneyPlain(item.price)} x ${qtyPlain(item.qty)} ${item.unit}`, moneyPlain(item.total)));
    if (item.discountAmount) {
      lines.push(splitLine("Скидка", moneyPlain(item.discountAmount)));
    }
  }

  lines.push("-".repeat(receiptColumns));
  lines.push(splitLine("Сумма", moneyPlain(receipt.subtotal)));
  lines.push(splitLine("Скидка", moneyPlain(receipt.discount)));
  lines.push("=".repeat(receiptColumns));
  lines.push(splitLine(isReturn ? "К ВОЗВРАТУ" : "ИТОГО", moneyPlain(receipt.total)));
  lines.push("=".repeat(receiptColumns));
  lines.push(splitLine(isReturn ? "Возврат денег" : "Оплата", paymentLabel(receipt.paymentMethod)));
  if (receipt.paymentMethod === "cash") {
    lines.push(splitLine("Получено", moneyPlain(receipt.paidAmount ?? receipt.total)));
    lines.push(splitLine("Сдача", moneyPlain(receipt.changeAmount ?? 0)));
  }
  if (receipt.paymentMethod === "debt") {
    lines.push(splitLine("Клиент", receipt.customerName || "Без имени"));
    lines.push(splitLine("В долг", moneyPlain(receipt.debtAmount ?? receipt.total)));
  }
  if (isReturn && receipt.returnReason) {
    lines.push(splitLine("Причина", receipt.returnReason));
  }
  lines.push("-".repeat(receiptColumns));
  lines.push(centerLine(settings.footer || "Спасибо за покупку"));
  return `${lines.join("\r\n")}\r\n`;
};

const serialPortName = (port: string) => {
  const match = String(port || "").match(/\bCOM\d+\b/i);
  return match ? match[0].toUpperCase() : "";
};

const serialDevicePath = (portName: string) => `\\\\.\\${portName}`;

const listSerialPorts = () => {
  if (process.platform !== "win32") {
    return [];
  }
  const ports = new Set<string>();

  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-CimInstance Win32_SerialPort | ForEach-Object { $_.DeviceID }"],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 2500
      }
    );
    String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => serialPortName(line.trim()))
      .filter(Boolean)
      .forEach((port) => ports.add(port));
  } catch (error) {
    log(`display:list-ports-cim-failed ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const result = spawnSync("mode.com", [], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2500
    });
    String(result.stdout || "")
      .match(/COM\d+/gi)
      ?.map((port) => port.toUpperCase())
      .forEach((port) => ports.add(port));
  } catch (error) {
    log(`display:list-ports-mode-failed ${error instanceof Error ? error.message : String(error)}`);
  }

  return Array.from(ports).sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
};

const configureSerialPort = (portName: string, baudRate = 2400) => {
  if (process.platform !== "win32") {
    return;
  }
  try {
    spawnSync("mode.com", [`${portName}:`, `BAUD=${baudRate}`, "PARITY=N", "DATA=8", "STOP=1"], {
      windowsHide: true,
      timeout: 1200
    });
  } catch (error) {
    log(`display:serial-mode-failed ${portName} ${error instanceof Error ? error.message : String(error)}`);
  }
};

const formatMiniDisplayAmount = (value: number) => {
  const amount = Math.max(0, Number(value || 0));
  return amount.toFixed(2).slice(-8);
};

const miniDisplayProtocol = (port: string) => {
  if (/vfd|9600|text/i.test(port)) {
    return "text9600";
  }
  return "led8n";
};

const miniDisplayPayload = (state: CustomerDisplayState, protocol: "led8n" | "text9600") => {
  const text = formatMiniDisplayAmount(state.status === "idle" ? 0 : state.total);
  if (protocol === "text9600") {
    return {
      baudRate: 9600,
      text,
      payload: Buffer.from(`${" ".repeat(8)}\r${text.padStart(8, " ")}\r`, "ascii")
    };
  }

  return {
    baudRate: 2400,
    text,
    payload: Buffer.concat([
      Buffer.from([0x1b, 0x40, 0x0c]),
      Buffer.from([0x1b, 0x73, 0x32]),
      Buffer.from([0x1b, 0x51, 0x41]),
      Buffer.from(text, "ascii"),
      Buffer.from([0x0d])
    ])
  };
};

const writeMiniCustomerDisplay = (state: CustomerDisplayState, port: string) => {
  const portName = serialPortName(port);
  if (!portName) {
    return false;
  }
  const protocol = miniDisplayProtocol(port);
  const { baudRate, payload, text } = miniDisplayPayload(state, protocol);
  configureSerialPort(portName, baudRate);
  let handle: number | null = null;
  try {
    handle = fs.openSync(serialDevicePath(portName), "w");
    fs.writeSync(handle, payload, 0, payload.length);
    log(`display:serial-write ${portName} ${protocol} baud=${baudRate} ${text}`);
    return true;
  } catch (error) {
    log(`display:serial-failed ${portName} ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // Ignore close errors for serial devices.
      }
    }
  }
};

const writeReceiptHtmlFile = (receipt: Receipt, html: string) => {
  const dir = path.join(app.getPath("userData"), "receipt-print");
  fs.mkdirSync(dir, { recursive: true });
  const safeNumber = receipt.number.replace(/[^a-zA-Z0-9_-]/g, "-");
  const htmlPath = path.join(dir, `receipt-${safeNumber}-${Date.now()}.html`);
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
};

const rawPrinterScriptPath = () => {
  const dir = path.join(app.getPath("userData"), "receipt-print");
  fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, "print-raw-default.ps1");
  fs.writeFileSync(
    scriptPath,
    String.raw`param([Parameter(Mandatory=$true)][string]$DataPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA
  {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern Int32 StartDocPrinter(IntPtr hPrinter, Int32 level, [In] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] bytes, Int32 count, out Int32 written);

  public static void SendBytesToPrinter(string printerName, byte[] bytes)
  {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero)) throw new Exception("OpenPrinter failed");
    try
    {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "K-pro receipt";
      di.pDataType = "RAW";
      if (StartDocPrinter(hPrinter, 1, di) == 0) throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      try
      {
        if (!StartPagePrinter(hPrinter)) throw new Exception("StartPagePrinter failed: " + Marshal.GetLastWin32Error());
        try
        {
          int written;
          if (!WritePrinter(hPrinter, bytes, bytes.Length, out written)) throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
          if (written != bytes.Length) throw new Exception("Not all bytes were written");
        }
        finally
        {
          EndPagePrinter(hPrinter);
        }
      }
      finally
      {
        EndDocPrinter(hPrinter);
      }
    }
    finally
    {
      ClosePrinter(hPrinter);
    }
  }
}
'@
$printer = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
if ([string]::IsNullOrWhiteSpace($printer)) { throw 'Default printer not found' }
$bytes = [System.IO.File]::ReadAllBytes($DataPath)
[RawPrinterHelper]::SendBytesToPrinter($printer, $bytes)
`,
    "utf8"
  );
  return scriptPath;
};

const writeRawReceiptFile = (receipt: Receipt, payload: Buffer) => {
  const dir = path.join(app.getPath("userData"), "receipt-print");
  fs.mkdirSync(dir, { recursive: true });
  const safeNumber = receipt.number.replace(/[^a-zA-Z0-9_-]/g, "-");
  const rawPath = path.join(dir, `receipt-${safeNumber}-${Date.now()}.bin`);
  fs.writeFileSync(rawPath, payload);
  return rawPath;
};

const rawReceiptPayload = (
  receipt: Receipt,
  items: CartItem[],
  binding: CashBinding | null,
  settings: LocalReceiptSettings
) =>
  Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1c, 0x2e]),
    Buffer.from([0x1b, 0x74, 0x11]),
    encodeCp866(receiptRawText(receipt, items, binding, settings)),
    Buffer.from([0x0a, 0x1d, 0x56, 0x42, 0x00])
  ]);

const printReceiptRaw = async (receipt: Receipt, items: CartItem[]) => {
  if (process.platform !== "win32") {
    return false;
  }
  let rawPath = "";
  try {
    rawPath = writeRawReceiptFile(receipt, rawReceiptPayload(receipt, items, store.getBinding(), store.getReceiptSettings()));
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", rawPrinterScriptPath(), "-DataPath", rawPath],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000
      }
    );
    if (result.status === 0) {
      log(`receipt:raw-printed ${receipt.number}`);
      return true;
    }
    log(`receipt:raw-failed code=${result.status} stderr=${String(result.stderr || "").trim()}`);
    return false;
  } catch (error) {
    log(`receipt:raw-failed ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    if (rawPath) {
      fs.rm(rawPath, { force: true }, () => undefined);
    }
  }
};

const receiptPageHeight = (receipt: Receipt, itemCount: number) => {
  const paymentExtra = receipt.paymentMethod === "cash" || receipt.paymentMethod === "debt" ? 18000 : 9000;
  const returnExtra = receipt.status === "returned" ? 12000 : 0;
  return Math.min(420000, Math.max(120000, 95000 + itemCount * 14000 + paymentExtra + returnExtra));
};

const waitForReceiptAssets = async (printWindow: BrowserWindow) => {
  await printWindow.webContents.executeJavaScript(`
    Promise.all(Array.from(document.images).map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve(true);
      return new Promise((resolve) => {
        const done = () => resolve(true);
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        setTimeout(done, 1000);
      });
    })).then(() => document.fonts ? document.fonts.ready : true)
  `);
};

const measureReceiptPageHeight = async (printWindow: BrowserWindow) => {
  const pxHeight = await printWindow.webContents.executeJavaScript(`
    (() => {
      const receipt = document.getElementById("receipt-root");
      return receipt ? Math.ceil(receipt.getBoundingClientRect().height) : 0;
    })()
  `);
  const measured = Math.ceil(Number(pxHeight || 0) * 264.583);
  return Math.min(500000, Math.max(35000, measured + 2000));
};

const receiptHtml = (
  receipt: Receipt,
  items: CartItem[],
  binding: CashBinding | null,
  settings: LocalReceiptSettings
) => {
  const isReturn = receipt.status === "returned";
  const headerText = settings.header || binding?.storeName || binding?.accountName || "К-про";
  const rows = items
    .map(
      (item) => `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${money(item.price)} x ${money(item.qty).replace(",00", "")} ${escapeHtml(item.unit)}</span>
            ${item.discountAmount ? `<em>Скидка: ${money(item.discountAmount)} сом</em>` : ""}
          </td>
          <td>${money(item.total)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
  <html lang="ru">
    <head>
      <meta charset="utf-8" />
      <style>
        @page { margin: 0; }
        * { box-sizing: border-box; }
        html, body {
          width: 72mm;
          height: auto !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible;
          page-break-after: avoid;
          break-after: avoid;
        }
        body {
          color: #000;
          background: #fff;
          font-family: "Segoe UI", Arial, sans-serif;
          font-size: 10.5px;
          line-height: 1.16;
        }
        #receipt-root {
          position: static;
          display: flow-root;
          width: 72mm;
          height: auto;
          margin: 0;
          padding: 0;
        }
        h1 { margin: 0 0 .5mm; font-size: 14px; text-align: center; }
        .center { text-align: center; }
        .muted { color: #333; }
        .line { border-top: 1px dashed #000; margin: 1mm 0; }
        table { width: 100%; border-collapse: collapse; }
        tr { break-inside: avoid; page-break-inside: avoid; }
        td { padding: .8mm 0; vertical-align: top; }
        td:first-child { padding-right: 2mm; }
        td:last-child { width: 18mm; text-align: right; white-space: nowrap; }
        strong, span, em { display: block; }
        em { font-style: normal; color: #333; }
        .total { font-size: 15px; font-weight: 800; }
        .pair { display: flex; justify-content: space-between; gap: 8px; padding: .7mm 0; }
      </style>
    </head>
    <body>
      <main id="receipt-root">
        <h1>${escapeHtml(headerText)}</h1>
        ${isReturn ? `<div class="center total">Возврат</div>` : ""}
        <div class="center">Чек № ${escapeHtml(receipt.number)}</div>
        ${isReturn && receipt.originalReceiptNumber ? `<div class="center muted">Исходный чек № ${escapeHtml(receipt.originalReceiptNumber)}</div>` : ""}
        <div class="center">Кассир: ${escapeHtml(receipt.cashier)}</div>
        <div class="center">${new Date(receipt.createdAt).toLocaleString("ru-RU")}</div>
        <div class="line"></div>
        <table>${rows}</table>
        <div class="line"></div>
        <div class="pair"><span>Сумма</span><strong>${money(receipt.subtotal)} сом</strong></div>
        <div class="pair"><span>Скидка</span><strong>${money(receipt.discount)} сом</strong></div>
        <div class="pair total"><span>${isReturn ? "К возврату" : "Итого"}</span><strong>${money(receipt.total)} сом</strong></div>
        <div class="line"></div>
        <div class="pair"><span>${isReturn ? "Возврат денег" : "Оплата"}</span><strong>${paymentLabel(receipt.paymentMethod)}</strong></div>
        ${receipt.paymentMethod === "cash" ? `<div class="pair"><span>Получено</span><strong>${money(receipt.paidAmount ?? receipt.total)} сом</strong></div><div class="pair"><span>Сдача</span><strong>${money(receipt.changeAmount ?? 0)} сом</strong></div>` : ""}
        ${receipt.paymentMethod === "debt" ? `<div class="pair"><span>Клиент</span><strong>${escapeHtml(receipt.customerName || "Без имени")}</strong></div><div class="pair"><span>В долг</span><strong>${money(receipt.debtAmount ?? receipt.total)} сом</strong></div>` : ""}
        ${isReturn && receipt.returnReason ? `<div class="pair"><span>Причина</span><strong>${escapeHtml(receipt.returnReason)}</strong></div>` : ""}
        <div class="line"></div>
        <div class="center">${escapeHtml(settings.footer || "Спасибо за покупку")}</div>
      </main>
    </body>
  </html>`;
};

const isDeviceReady = (id: string) => {
  const device = store.getDevices().find((item) => item.id === id);
  return Boolean(device?.enabled && device.status !== "offline");
};

const printReceiptSilently = async (receipt: Receipt | null, items: CartItem[]) => {
  if (!receipt) {
    return;
  }
  if (!isDeviceReady("printer")) {
    log(`receipt:print-skipped ${receipt.number} printer-disabled`);
    return;
  }
  if (await printReceiptRaw(receipt, items)) {
    return;
  }
  log(`receipt:html-fallback ${receipt.number}`);
  const pageHeight = receiptPageHeight(receipt, items.length);
  let htmlPath = "";
  const printWindow = new BrowserWindow({
    show: false,
    width: 360,
    height: Math.max(900, Math.min(2200, Math.round(pageHeight / 180))),
    webPreferences: {
      offscreen: true
    }
  });

  try {
    const html = receiptHtml(receipt, items, store.getBinding(), store.getReceiptSettings());
    htmlPath = writeReceiptHtmlFile(receipt, html);
    await printWindow.loadFile(htmlPath);
    await waitForReceiptAssets(printWindow);
    const measuredPageHeight = await measureReceiptPageHeight(printWindow);
    await new Promise<void>((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: true,
          landscape: false,
          scaleFactor: 100,
          printBackground: true,
          margins: { marginType: "none" },
          pageSize: {
            width: 80000,
            height: measuredPageHeight
          }
        },
        (success, failureReason) => {
          if (success) {
            resolve();
          } else {
            reject(new Error(failureReason || "Не удалось напечатать чек."));
          }
        }
      );
    });
    log(`receipt:printed ${receipt.number} height=${measuredPageHeight}`);
  } catch (error) {
    log(`receipt:print-failed ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    printWindow.close();
    if (htmlPath) {
      fs.rm(htmlPath, { force: true }, () => undefined);
    }
  }
};

const customerDisplayHtml = () => `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; overflow: hidden; color: #0d1f37; background: linear-gradient(135deg, #eef6ff 0%, #ffffff 52%, #e7f0ff 100%); font-family: "Segoe UI", Arial, sans-serif; }
      .screen { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 14px; height: 100vh; padding: 28px; }
      .top { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
      .brand { display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 900; }
      .logo { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 16px; color: #fff; background: linear-gradient(135deg, #0f7ee8, #06489b); font-weight: 950; }
      .receipt { color: #61728a; font-size: 22px; font-weight: 800; }
      .items { display: grid; grid-template-rows: repeat(5, minmax(0, 1fr)); align-content: start; gap: 9px; min-height: 0; overflow: hidden; }
      .item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; min-height: 0; padding: 12px 18px; border: 1px solid #d8e5f3; border-radius: 14px; background: rgba(255,255,255,.88); box-shadow: 0 8px 22px rgba(28, 68, 120, .07); }
      .item strong { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font-size: 24px; line-height: 1.08; }
      .item span { color: #657891; font-size: 18px; font-weight: 750; }
      .item b { color: #0d1f37; font-size: 26px; white-space: nowrap; }
      .empty { display: grid; height: 100%; place-items: center; color: #6c8199; font-size: 36px; font-weight: 900; text-align: center; }
      .bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: stretch; }
      .summary, .message { padding: 18px 22px; border-radius: 18px; color: #fff; background: linear-gradient(135deg, #0f7ee8, #045ac3); box-shadow: 0 14px 28px rgba(4, 90, 195, .22); }
      .summary div { display: flex; justify-content: space-between; gap: 18px; font-size: 20px; font-weight: 750; }
      .summary .total { margin-top: 8px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.35); font-size: 34px; font-weight: 950; }
      .message { display: grid; align-content: center; background: linear-gradient(135deg, #18a957, #0b7f42); font-size: 26px; font-weight: 900; text-align: center; }
      .message.idle { color: #0d1f37; background: rgba(255,255,255,.9); }
      .message.paid { position: relative; overflow: hidden; min-height: 190px; background: linear-gradient(135deg, #10b981, #0f7ee8); animation: paid-pop .42s ease-out both; }
      .message.paid::before { content: ""; position: absolute; inset: -45%; background: radial-gradient(circle, rgba(255,255,255,.34), transparent 54%); animation: paid-shine 2.4s ease-in-out infinite; }
      .paid-wrap { position: relative; display: grid; gap: 10px; justify-items: center; }
      .paid-check { display: grid; width: 78px; height: 78px; place-items: center; border-radius: 50%; color: #0f8f55; background: #fff; font-size: 52px; line-height: 1; box-shadow: 0 18px 36px rgba(0,0,0,.16); animation: paid-check .5s ease-out .1s both; }
      .paid-title { font-size: 36px; font-weight: 950; }
      .paid-total { font-size: 30px; opacity: .94; }
      small { font-size: 22px; opacity: .85; }
      @keyframes paid-pop { from { transform: scale(.96); opacity: .35; } to { transform: scale(1); opacity: 1; } }
      @keyframes paid-check { from { transform: scale(.5) rotate(-18deg); opacity: 0; } to { transform: scale(1) rotate(0); opacity: 1; } }
      @keyframes paid-shine { 0%, 100% { transform: translate(-16%, -16%); opacity: .55; } 50% { transform: translate(16%, 16%); opacity: 1; } }
    </style>
  </head>
  <body>
    <div id="root" class="screen"></div>
    <script>
      const htmlEscape = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const money = (value) => new Intl.NumberFormat('ru-KG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0) + ' сом';
      const qty = (value) => Number(value || 0).toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
      window.renderCustomerDisplay = (state) => {
        const items = state.items || [];
        const visibleLimit = items.length > 5 ? 4 : 5;
        const rows = items.slice(0, visibleLimit).map((item) =>
          '<div class="item"><div><strong>' + htmlEscape(item.name) + '</strong><span>' + qty(item.qty) + ' ' + htmlEscape(item.unit) + ' x ' + money(item.price) + '</span></div><b>' + money(item.total) + '</b></div>'
        ).join('');
        const hidden = items.length > 5 ? '<div class="item"><strong>Еще товаров: ' + (items.length - visibleLimit) + '</strong><b></b></div>' : '';
        const message = htmlEscape(state.message || (items.length ? 'Проверьте товары и сумму' : 'Добро пожаловать'));
        const customer = state.customerName ? '<br><small>' + htmlEscape(state.customerName) + '</small>' : '';
        const statusClass = state.status === 'paid' ? ' paid' : (items.length || state.status === 'return' ? '' : ' idle');
        const messageHtml = state.status === 'paid'
          ? '<div class="paid-wrap"><div class="paid-check">✓</div><div class="paid-title">Спасибо за покупку</div><div class="paid-total">' + money(state.total) + '</div><small>' + message + '</small>' + customer + '</div>'
          : message + customer;
        document.getElementById('root').innerHTML =
          '<div class="top"><div class="brand"><div class="logo">K</div><span>' + htmlEscape(state.storeName || 'К-про') + '</span></div><div class="receipt">Чек № ' + htmlEscape(state.receiptNumber || '') + '</div></div>' +
          '<div class="items">' + (items.length ? rows + hidden : '<div class="empty">Добавьте товар на кассе</div>') + '</div>' +
          '<div class="bottom"><div class="summary"><div><span>Сумма</span><b>' + money(state.subtotal) + '</b></div><div><span>Скидка</span><b>' + money(state.discount) + '</b></div><div class="total"><span>Итого</span><b>' + money(state.total) + '</b></div></div>' +
          '<div class="message' + statusClass + '">' + messageHtml + '</div></div>';
      };
      window.renderCustomerDisplay({ items: [], subtotal: 0, discount: 0, total: 0, status: 'idle' });
    </script>
  </body>
</html>`;

const closeCustomerDisplayWindow = () => {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    customerDisplayWindow.close();
  }
  customerDisplayWindow = null;
};

const updateCustomerDisplayWindow = async (state: CustomerDisplayState) => {
  lastCustomerDisplayState = state;
  if (!store || !isDeviceReady("display")) {
    closeCustomerDisplayWindow();
    return false;
  }
  const displayDevice = store.getDevices().find((item) => item.id === "display");
  const serialPort = serialPortName(displayDevice?.port || "");
  if (serialPort) {
    closeCustomerDisplayWindow();
    return writeMiniCustomerDisplay(state, serialPort);
  }
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const target = displays.find((display) => display.id !== primaryId);
  if (!target) {
    closeCustomerDisplayWindow();
    return false;
  }
  if (!customerDisplayWindow || customerDisplayWindow.isDestroyed()) {
    customerDisplayWindow = new BrowserWindow({
      x: target.bounds.x,
      y: target.bounds.y,
      width: target.bounds.width,
      height: target.bounds.height,
      frame: false,
      fullscreen: true,
      autoHideMenuBar: true,
      backgroundColor: "#eef6ff",
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    customerDisplayWindow.on("closed", () => {
      customerDisplayWindow = null;
    });
    await customerDisplayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(customerDisplayHtml())}`);
  }
  const payload = JSON.stringify(state).replace(/</g, "\\u003c");
  await customerDisplayWindow.webContents.executeJavaScript(`window.renderCustomerDisplay(${payload})`);
  return true;
};
const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    log("app:second-instance");
    focusMainWindow();
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "К-про",
        message: "Касса уже запущена",
        detail: "Чтобы не было путаницы в чеках, второе окно кассы не открывается.",
        buttons: ["Понятно"],
        noLink: true
      });
    }
  });
}

const registerIpc = () => {
  ipcMain.handle("account:getBinding", () => store.getBinding());
  ipcMain.handle("account:activate", (_event, key: string) => store.activateWithKey(key));
  ipcMain.handle("account:refresh", () => store.refreshSnapshot());
  ipcMain.handle("account:logout", (_event, force?: boolean) => store.logoutAccount(Boolean(force)));
  ipcMain.handle("shift:getCurrent", () => store.getCurrentShift());
  ipcMain.handle("shift:open", (_event, input: OpenShiftInput) => store.openShift(input));
  ipcMain.handle("shift:close", (_event, input: CloseShiftInput) => store.closeShift(input));
  ipcMain.handle("products:categories", () => store.getCategories());
  ipcMain.handle("products:list", (_event, search?: string) => store.listProducts(search));
  ipcMain.handle("products:createFromCash", (_event, input) => store.createProductFromCash(input));
  ipcMain.handle("products:updatePrice", (_event, input) => store.updateProductPrice(input));
  ipcMain.handle("employees:listCashiers", () => store.getEmployees());
  ipcMain.handle("customers:list", (_event, search?: string) => store.listCustomers(search));
  ipcMain.handle("customers:save", (_event, input: CustomerInput) => store.saveCustomer(input));
  ipcMain.handle("debts:list", () => store.listDebtors());
  ipcMain.handle("debts:transactions", (_event, customerId?: string) => store.listDebtTransactions(customerId));
  ipcMain.handle("debts:pay", (_event, input: PayDebtInput) => store.payDebt(input));
  ipcMain.handle("receipts:getNextNumber", () => store.getNextReceiptNumber());
  ipcMain.handle("receipts:list", () => store.listReceipts());
  ipcMain.handle("receipts:items", (_event, receiptId: number) => store.getReceiptItems(receiptId));
  ipcMain.handle("receipts:print", async (_event, receiptId: number) => {
    const receipt = store.listReceipts().find((item) => item.id === receiptId) ?? null;
    if (!receipt) {
      throw new Error("Чек не найден.");
    }
    await printReceiptSilently(receipt, store.getReceiptItems(receiptId));
    return true;
  });
  ipcMain.handle("cart:createReceipt", async (_event, input: CreateReceiptInput) => {
    const receipt = store.createReceipt(input);
    await printReceiptSilently(receipt, input.items);
    return receipt;
  });
  ipcMain.handle("cart:createReturn", async (_event, input: ReturnReceiptInput) => {
    const receipt = store.createReturn(input);
    await printReceiptSilently(receipt, input.items);
    return receipt;
  });
  ipcMain.handle("cart:suspendReceipt", (_event, input: SuspendReceiptInput) => {
    return store.suspendReceipt(input);
  });
  ipcMain.handle("cart:restoreSuspended", (_event, id: number) => {
    return store.restoreSuspendedReceipt(id);
  });
  ipcMain.handle("receipts:listSuspended", (_event, search?: string) => {
    return store.listSuspendedReceipts(search);
  });
  ipcMain.handle("receipts:deleteSuspended", (_event, id: number) => {
    return store.deleteSuspendedReceipt(id);
  });
  ipcMain.handle("settings:getDevices", () => store.getDevices());
  ipcMain.handle("settings:updateDevice", (_event, input: DeviceUpdateInput) => {
    const updated = store.updateDevice(input);
    if (input.id === "display") {
      if (lastCustomerDisplayState) {
        void updateCustomerDisplayWindow(lastCustomerDisplayState).catch((error) =>
          log(`display:update-failed ${error instanceof Error ? error.message : String(error)}`)
        );
      } else if (!updated?.enabled || updated.status === "offline") {
        closeCustomerDisplayWindow();
      }
    }
    return updated;
  });
  ipcMain.handle("display:update", async (_event, state: CustomerDisplayState) => {
    return updateCustomerDisplayWindow(state);
  });
  ipcMain.handle("display:listPorts", () => listSerialPorts());
  ipcMain.handle("display:testMini", (_event, input: { port: string; amount?: number }) =>
    writeMiniCustomerDisplay(
      {
        storeName: "К-про",
        receiptNumber: "TEST",
        items: [],
        subtotal: Number(input?.amount ?? 123.45),
        discount: 0,
        total: Number(input?.amount ?? 123.45),
        status: "editing",
        message: "Тест табло"
      },
      input?.port || ""
    )
  );
  ipcMain.handle("sync:getStatus", () => store.getSyncStatus());
  ipcMain.handle("sync:flush", () => store.flushSyncQueue());
  ipcMain.handle("qr:createPayment", async (_event, input: CreateQrPaymentInput) => {
    const binding = store.getBinding();
    if (!binding) {
      throw new Error("Касса не привязана к аккаунту.");
    }
    return createQrPayment(binding, input);
  });
  ipcMain.handle("qr:getStatus", (_event, txnId: string) => getQrPaymentStatus(txnId));
  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
    return true;
  });
  ipcMain.handle("window:close", async () => {
    if (!mainWindow) {
      return false;
    }
    const result = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Закрыть систему", "Отмена"],
      defaultId: 1,
      cancelId: 1,
      title: "К-про",
      message: "Вы точно хотите закрыть систему?",
      detail: "Открытая смена не будет закрыта автоматически."
    });
    if (result.response === 0) {
      mainWindow.close();
      return true;
    }
    return false;
  });
};

if (singleInstanceLock) {
  app.whenReady().then(async () => {
  log("app:ready");
  store = await KassaDatabase.open(app.getPath("userData"));
  log("database:open");
  registerIpc();
  log("ipc:registered");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  });
}

app.on("window-all-closed", () => {
  log("app:window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  log("app:before-quit");
});
