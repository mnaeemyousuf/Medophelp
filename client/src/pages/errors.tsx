import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileQuestion, ServerCrash, ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

function ErrorScreen({ icon, code, title, message, action }: { icon: ReactNode; code: string; title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-full bg-subtle p-4 text-muted">{icon}</div>
      <p className="num text-xs font-semibold uppercase tracking-widest text-muted">Error {code}</p>
      <h1 className="mt-1 text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-muted">{message}</p>
      <div className="mt-6">{action ?? <Link to="/dashboard"><Button variant="outline">Back to dashboard</Button></Link>}</div>
    </div>
  );
}

export const NotFoundPage = () => <ErrorScreen icon={<FileQuestion className="h-7 w-7" />} code="404" title="Page not found" message="The page you are looking for does not exist or has moved." />;

export const ForbiddenPage = () => (
  <ErrorScreen icon={<ShieldX className="h-7 w-7" />} code="403" title="Access denied" message="Your role does not include access to this area. If you need it, ask a hospital administrator to update your permissions." />
);

export const ServerErrorPage = ({ onRetry }: { onRetry?: () => void }) => (
  <ErrorScreen
    icon={<ServerCrash className="h-7 w-7" />}
    code="500"
    title="Something went wrong"
    message="An unexpected error occurred. The problem has been logged. Please try again."
    action={<Button variant="outline" onClick={onRetry ?? (() => window.location.reload())}>Try again</Button>}
  />
);

/** Catches render errors so one broken widget never blanks the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }
  render() {
    return this.state.error ? <ServerErrorPage onRetry={() => this.setState({ error: null })} /> : this.props.children;
  }
}
