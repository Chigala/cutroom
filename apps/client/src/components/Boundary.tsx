/**
 * A panel that can fail on its own. A render error inside it (a value an edit got wrong, a bug) stays in
 * it: the panel says so with a way to reload it, and the rest of the window keeps working. It also tries
 * again by itself when `resetKey` changes (the project's doc: an undo, the next request, a fix).
 */
import { Component, type ReactNode } from "react";

interface Props {
  /** What the panel is, for the message and the log ("timeline"). */
  name: string;
  /** Changing it clears the error and draws the panel again. */
  resetKey?: unknown;
  children: ReactNode;
  className?: string;
}

interface State {
  error: Error | null;
  at: unknown;
}

export class Boundary extends Component<Props, State> {
  override state: State = { error: null, at: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // The project changed since it failed: worth drawing again.
    if (state.error && props.resetKey !== state.at) return { error: null, at: props.resetKey };
    if (!state.error && props.resetKey !== state.at) return { at: props.resetKey };
    return null;
  }

  override componentDidCatch(error: Error): void {
    console.error(`[${this.props.name}] stopped:`, error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className={
          this.props.className ??
          "flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-sunken p-6 text-center"
        }
      >
        <span className="text-[14px] font-medium text-fg">The {this.props.name} hit a snag</span>
        <span className="max-w-[280px] text-[13px] leading-relaxed text-muted">
          The rest of the app is fine. It comes back by itself when the edit changes, or now:
        </span>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="h-9 rounded-lg bg-control px-4 text-[13px] text-fg transition-colors hover:bg-selected"
        >
          Reload the {this.props.name}
        </button>
        <span className="max-w-[300px] font-mono text-[11px] break-words text-faint">{error.message}</span>
      </div>
    );
  }
}
