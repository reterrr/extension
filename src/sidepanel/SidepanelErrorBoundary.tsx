import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: string | null;
}

export class SidepanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Burbot sidepanel crashed", error, info);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main
        role="alert"
        style={{
          maxWidth: 520,
          margin: "24px auto",
          padding: 20,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <section
          style={{
            padding: 18,
            border: "1px solid #d8e1da",
            borderRadius: 10,
            background: "#fff",
          }}
        >
          <strong style={{ display: "block", marginBottom: 6 }}>
            Burbot nie mógł wyświetlić panelu
          </strong>
          <p style={{ margin: "0 0 12px", fontSize: 12, lineHeight: 1.45 }}>
            Dane nie zostały usunięte. Odśwież panel i spróbuj ponownie.
          </p>
          <code
            style={{
              display: "block",
              marginBottom: 12,
              overflowWrap: "anywhere",
              fontSize: 10,
            }}
          >
            {this.state.error}
          </code>
          <button type="button" onClick={this.reload}>
            Odśwież Burbot
          </button>
        </section>
      </main>
    );
  }
}
