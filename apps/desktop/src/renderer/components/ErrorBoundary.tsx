import { Component, type ReactNode } from "react";
import type { Logger } from "@suwol/shared";
import { SETTINGS_STORAGE_KEY } from "@suwol/shared";
import type { Translate } from "../i18n";

interface Props {
  readonly children: ReactNode;
  readonly logger: Logger;
  readonly t: Translate;
}
interface State {
  readonly failed: boolean;
}

export function resetWorkspacePreferences(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(SETTINGS_STORAGE_KEY);
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.logger.error("Renderer component initialization failed.");
    void window.suwolDesktop?.app.reportRendererFailure();
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <h1>{this.props.t("error.title")}</h1>
        <p>{this.props.t("error.description")}</p>
        <div className="fatal-error-actions">
          <button
            type="button"
            onClick={() => {
              resetWorkspacePreferences(window.localStorage);
              window.location.reload();
            }}
          >
            {this.props.t("error.resetWorkspace")}
          </button>
          <button
            type="button"
            onClick={() => {
              void window.suwolDesktop?.app.relaunchWithoutPlugins();
            }}
          >
            {this.props.t("error.restartWithoutPlugins")}
          </button>
          <button
            type="button"
            onClick={() => {
              void window.suwolDesktop?.app.openLogsFolder();
            }}
          >
            {this.props.t("error.openLogs")}
          </button>
        </div>
      </main>
    );
  }
}
