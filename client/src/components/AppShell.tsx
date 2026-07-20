import { Outlet } from 'react-router-dom';

/**
 * Desktop-style window chrome that wraps every route. The retro look is the
 * project's identity (see vision.md), not a shortcut — real focus states and
 * keyboard access are preserved on top of it.
 */
export function AppShell() {
  return (
    <div className="desktop">
      <div className="window app-window">
        <div className="title-bar">
          <div className="title-bar-text">Triage98 — Operations Triage</div>
          <div className="title-bar-controls">
            <button aria-label="Minimize" type="button" />
            <button aria-label="Maximize" type="button" />
            <button aria-label="Close" type="button" />
          </div>
        </div>

        <div className="window-body app-body">
          <Outlet />
        </div>

        <div className="status-bar">
          <p className="status-bar-field">Triage98</p>
          <p className="status-bar-field">Local-first triage</p>
          <p className="status-bar-field">v0.1.0</p>
        </div>
      </div>
    </div>
  );
}
