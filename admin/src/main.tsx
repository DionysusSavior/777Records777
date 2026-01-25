import React from "react";
import { createRoot } from "react-dom/client";
import App from "@medusajs/dashboard";
import "@medusajs/dashboard/css";
import preordersPlugin from "./preorders";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App plugins={[preordersPlugin]} />
  </React.StrictMode>
);
