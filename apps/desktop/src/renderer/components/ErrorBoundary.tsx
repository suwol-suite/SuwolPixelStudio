import { Component, type ReactNode } from "react";
import type { Logger } from "@suwol/shared";
import type { Translate } from "../i18n";

interface Props {
  readonly children: ReactNode;
  readonly logger: Logger;
  readonly t: Translate;
}
interface State {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.logger.error("Renderer component initialization failed.");
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <h1>{this.props.t("error.title")}</h1>
        <p>{this.props.t("error.description")}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {this.props.t("error.reload")}
        </button>
      </main>
    );
  }
}
