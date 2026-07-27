const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const outputDir = path.join(process.cwd(), ".receipt-layout-smoke");
const htmlPath = path.join(outputDir, "receipt.html");
const screenshotPath = path.join(outputDir, "receipt.png");
const pdfPath = path.join(outputDir, "receipt.pdf");

const html = `<!doctype html>
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
      .line { border-top: 1px dashed #000; margin: 1mm 0; }
      .total { font-size: 15px; font-weight: 800; }
      .pair { display: flex; justify-content: space-between; gap: 8px; padding: .7mm 0; }
    </style>
  </head>
  <body>
    <main id="receipt-root">
      <h1>Фрукты и овощи</h1>
      <div class="center">Чек № 10279</div>
      <div class="center">Кассир: Елена Петрова</div>
      <div class="center">25.07.2026, 08:35:06</div>
      <div class="line"></div>
      <strong>Нан 30 сом</strong>
      <div class="pair"><span>30,00 x 1 шт</span><span>30,00</span></div>
      <div class="line"></div>
      <div class="pair"><span>Сумма</span><strong>30,00 сом</strong></div>
      <div class="pair"><span>Скидка</span><strong>0,00 сом</strong></div>
      <div class="pair total"><span>Итого</span><strong>30,00 сом</strong></div>
      <div class="line"></div>
      <div class="pair"><span>Оплата</span><strong>Наличные</strong></div>
      <div class="pair"><span>Получено</span><strong>305,00 сом</strong></div>
      <div class="pair"><span>Сдача</span><strong>275,00 сом</strong></div>
      <div class="line"></div>
      <div class="center">Спасибо за покупку</div>
    </main>
  </body>
</html>`;

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(htmlPath, html, "utf8");
  const win = new BrowserWindow({
    show: false,
    width: 360,
    height: 900,
    webPreferences: { offscreen: true }
  });
  await win.loadFile(htmlPath);
  const metrics = await win.webContents.executeJavaScript(`(() => {
    const root = document.getElementById("receipt-root");
    const rootRect = root.getBoundingClientRect();
    const bodyRect = document.body.getBoundingClientRect();
    const htmlRect = document.documentElement.getBoundingClientRect();
    return {
      root: { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height },
      body: { x: bodyRect.x, y: bodyRect.y, width: bodyRect.width, height: bodyRect.height },
      html: { x: htmlRect.x, y: htmlRect.y, width: htmlRect.width, height: htmlRect.height },
      scrollHeight: document.documentElement.scrollHeight
    };
  })()`);
  const image = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: Math.ceil(metrics.root.width),
    height: Math.ceil(metrics.root.height)
  });
  fs.writeFileSync(screenshotPath, image.toPNG());
  const measuredHeightMicrons = Math.ceil(metrics.root.height * 264.583) + 2000;
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    pageSize: {
      width: 80000,
      height: measuredHeightMicrons
    }
  });
  fs.writeFileSync(pdfPath, pdf);
  process.stdout.write(`${JSON.stringify({ metrics, measuredHeightMicrons, screenshotPath, pdfPath }, null, 2)}\n`);
  win.destroy();
  app.quit();
});
