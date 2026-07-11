import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLogger, detectSystemLanguage } from "@suwol/shared";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { createTranslator } from "./i18n";
import "./styles.css";

const logger = createLogger("renderer", import.meta.env.DEV);
const rootElement = document.getElementById("root");

if (rootElement === null) {
  logger.error("Renderer root element was missing.");
  document.body.textContent = createTranslator(
    detectSystemLanguage(navigator.languages),
  )("error.title");
} else {
  const t = createTranslator(detectSystemLanguage(navigator.languages));
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary logger={logger} t={t}>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
