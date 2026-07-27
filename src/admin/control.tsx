import React from "react";
import ReactDOM from "react-dom/client";
import { ControlApp } from "./AdminApp";
import "./admin.css";

ReactDOM.createRoot(document.getElementById("control-root") as HTMLElement).render(
  <React.StrictMode>
    <ControlApp />
  </React.StrictMode>
);
