import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; title?: string }
interface State { error: Error | null }

/** Keeps a failing page from blanking the whole application. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ui]', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="page-failure" role="alert">
        <span className="eyebrow">ERROR / 出错了</span>
        <h1>{this.props.title ?? '这个页面没有正常加载'}</h1>
        <p>{this.state.error.message || '发生未知错误。'}</p>
        <div className="page-failure-actions">
          <button type="button" className="button-primary" onClick={() => this.setState({ error: null })}>重试</button>
          <button type="button" className="button-secondary" onClick={() => location.reload()}>刷新页面</button>
        </div>
      </section>
    );
  }
}
