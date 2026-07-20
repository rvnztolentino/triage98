import { useCallback, useEffect, useState } from 'react';
import { fetchHealth, type HealthReport } from '../lib/api';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; report: HealthReport }
  | { kind: 'error'; message: string };

function StatusDot({ up }: { up: boolean }) {
  return (
    <span
      className={`status-dot ${up ? 'status-dot--up' : 'status-dot--down'}`}
      role="img"
      aria-label={up ? 'up' : 'down'}
    />
  );
}

export function HomePage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    fetchHealth()
      .then((report) => setState({ kind: 'ready', report }))
      .catch((err: unknown) =>
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Could not reach the API.',
        }),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="home">
      <fieldset>
        <legend>Welcome</legend>
        <p>
          <strong>Triage98</strong> is a fully local operations triage system. People
          submit messy internal requests in plain language; a local AI model suggests a
          category, priority, and department; an admin reviews and approves or overrides
          it; approved requests become tracked tickets.
        </p>
        <p className="home__muted">
          The AI suggests. A human decides. Nothing here phones home.
        </p>
      </fieldset>

      <fieldset>
        <legend>System status</legend>

        {state.kind === 'loading' && <p role="status">Checking services…</p>}

        {state.kind === 'error' && (
          <p role="alert">
            <StatusDot up={false} /> API unreachable — {state.message}
          </p>
        )}

        {state.kind === 'ready' && (
          <table className="status-table">
            <tbody>
              <tr>
                <td>Overall</td>
                <td>
                  <StatusDot up={state.report.status === 'ok'} />
                  {state.report.status === 'ok' ? 'Operational' : 'Degraded'}
                </td>
              </tr>
              <tr>
                <td>Database</td>
                <td>
                  <StatusDot up={state.report.checks.database === 'up'} />
                  {state.report.checks.database}
                </td>
              </tr>
              <tr>
                <td>Redis</td>
                <td>
                  <StatusDot up={state.report.checks.redis === 'up'} />
                  {state.report.checks.redis}
                </td>
              </tr>
              <tr>
                <td>Uptime</td>
                <td>{state.report.uptimeSeconds}s</td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="home__actions">
          <button type="button" onClick={load} disabled={state.kind === 'loading'}>
            Refresh
          </button>
        </div>
      </fieldset>
    </div>
  );
}
