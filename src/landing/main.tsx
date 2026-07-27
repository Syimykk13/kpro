import React from "react";
import ReactDOM from "react-dom/client";
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  CreditCard,
  MonitorSmartphone,
  ShieldCheck,
  ShoppingCart,
  Store,
  Users
} from "lucide-react";
import "./styles.css";

const features = [
  { icon: ShoppingCart, title: "Касса для продаж", text: "Продажи наличными, картой, QR, скидки, клиенты, долги и возвраты." },
  { icon: Boxes, title: "Склад и остатки", text: "Оприходование, списание, инвентаризация, перемещения и остатки по торговым точкам." },
  { icon: BarChart3, title: "Отчеты", text: "Смены, продажи, прибыль, ABC-анализ и контроль касс в одном кабинете." },
  { icon: Users, title: "Сотрудники", text: "Права доступа, кассиры, PIN для кассы и отдельный вход в админку." }
];

const steps = [
  "Создаем аккаунт магазина",
  "Добавляем торговые точки и кассы",
  "Вводим товары или импортируем Excel",
  "Активируем кассу на моноблоке"
];

function LandingApp() {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <a className="landing-brand" href="/">
          <img src="/k-pro-logo.png" alt="" />
          <span>К-про</span>
        </a>
        <nav>
          <a href="#features">Возможности</a>
          <a href="#workflow">Как работает</a>
          <a href="#contacts">Контакты</a>
          <a className="login-link" href="/admin/">Войти</a>
        </nav>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <span className="eyebrow">Касса и учет для розницы</span>
          <h1>К-про помогает магазину продавать, считать остатки и видеть прибыль</h1>
          <p>
            Desktop-касса для моноблоков и веб-админка для телефона или компьютера. Подходит для продуктовых,
            вещевых и смешанных магазинов.
          </p>
          <div className="hero-actions">
            <a className="primary-link" href="/admin/">Открыть админку</a>
            <a className="secondary-link" href="#contacts">Связаться</a>
          </div>
        </div>

        <div className="hero-dashboard" aria-label="Пример панели К-про">
          <div className="dashboard-top">
            <span>Сегодня</span>
            <strong>15 230,00 сом</strong>
          </div>
          <div className="dashboard-grid">
            <div>
              <CreditCard size={20} />
              <span>QR / карта</span>
              <strong>7 110 сом</strong>
            </div>
            <div>
              <Store size={20} />
              <span>Кассы</span>
              <strong>4 онлайн</strong>
            </div>
            <div>
              <Boxes size={20} />
              <span>Низкий остаток</span>
              <strong>5 товаров</strong>
            </div>
            <div>
              <MonitorSmartphone size={20} />
              <span>Доступ</span>
              <strong>ПК и телефон</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="feature-section" id="features">
        <div className="section-head">
          <span>Возможности</span>
          <h2>Основные рабочие инструменты магазина</h2>
        </div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, text }) => (
            <article key={title}>
              <Icon size={24} />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-head">
          <span>Запуск</span>
          <h2>Как подключается магазин</h2>
        </div>
        <div className="workflow-list">
          {steps.map((step, index) => (
            <div key={step}>
              <b>{index + 1}</b>
              <span>{step}</span>
              <CheckCircle2 size={20} />
            </div>
          ))}
        </div>
      </section>

      <section className="contacts-section" id="contacts">
        <div>
          <span className="eyebrow">Контакты</span>
          <h2>Подключение и настройка К-про</h2>
          <p>Для подключения магазина напишите нам. Мы создадим аккаунт, торговые точки и поможем активировать кассу.</p>
        </div>
        <div className="contact-card">
          <ShieldCheck size={28} />
          <strong>kpro.kg</strong>
          <a href="mailto:info@kpro.kg">info@kpro.kg</a>
          <span>Кыргызстан, Бишкек</span>
        </div>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("landing-root") as HTMLElement).render(
  <React.StrictMode>
    <LandingApp />
  </React.StrictMode>
);
