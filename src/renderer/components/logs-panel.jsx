import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Stack, Tabs } from '@wordpress/ui';
import { LogText } from './log-text.jsx';

// The logs, in the tray (#558): a tab for each thing that prints, and under
// the tabs the selected one's pane. The dev server's output, the build
// watch's, and WordPress's own debug.log with the file it is read from and
// what can be done with it.
//
// It holds no state. `logs` is the site's useSiteLogs: the text of each pane,
// which tab is selected, where each pane's element is handed over and what
// scrolling it means, and the three things done to debug.log. `tabs` names the tabs, since what the
// watch's tab says is the watch's state and the debug tab carries its count
// of unseen lines. `copyLabel` is what the Copy button says of its last
// press. `hidden` is the tray showing something else.
//
// Only the selected tab's pane is drawn, which is what the hook's scrolling
// counts on: a pane switched back to is a new element. The one just left is
// in the document for a frame more, and takes no room there (shell.css).
export function LogsPanel({ hidden, tabs, logs, copyLabel }) {
  // Taken out by name before anything else is read from `logs`: the lint
  // rule that keeps refs out of a render takes an object for a ref as soon
  // as one of its members is given to `ref`, and would then object to every
  // other member being read.
  const { runtimePane, watchPane, debugPane } = logs;
  return (
    <Tabs.Root value={logs.activeTab} onValueChange={logs.selectTab} render={<div className="tray-panel" hidden={hidden} />}>
      <Tabs.List variant="minimal" className="tray-tabs">
        {tabs.map((tab) => <Tabs.Tab key={tab.name} value={tab.name}>{tab.title}</Tabs.Tab>)}
      </Tabs.List>
      <Tabs.Panel value="runtime" tabIndex={-1} className="tray-log-panel">
        <div ref={runtimePane} onScroll={logs.makeOnScroll('runtime')} className="log-pane"><LogText text={logs.runtimeLogs} /></div>
      </Tabs.Panel>
      <Tabs.Panel value="watch" tabIndex={-1} className="tray-log-panel">
        <div ref={watchPane} onScroll={logs.makeOnScroll('watch')} className="log-pane">
          {logs.watchLogs ? <LogText text={logs.watchLogs} /> : (
            <span className="log-pane-note">{createInterpolateElement(
              // translators: <source /> is the folder edits are made in, src/. <build /> is the folder they are compiled into, build/.
              __('The build watch compiles <code><source /></code> edits into <code><build /></code>. It runs independently of the dev server — its output, and whether it is watching, paused, or stopped, appears here.'),
              { code: <code />, source: <>src/</>, build: <>build/</> }
            )}</span>
          )}
        </div>
      </Tabs.Panel>
      <Tabs.Panel value="debug" tabIndex={-1} className="tray-log-panel">
        <div ref={debugPane} onScroll={logs.makeOnScroll('debug')} className="log-pane">
          {logs.debugLogs ? <LogText text={logs.debugLogs} /> : (
            // An empty pane reads as broken, which is what this one was
            // for as long as WP_DEBUG_LOG was never set. Say what fills
            // it instead. In the app's own font, not the terminal's:
            // this is interface copy rather than log output, and it is
            // what keeps the `<code>` bits in it distinguishable.
            <span className="log-pane-note">{createInterpolateElement(
              // translators: <function /> is the PHP function that writes to the log, error_log().
              __('No PHP notices or errors yet. Anything WordPress or your code writes — <code><function /></code>, notices, deprecations, fatals — appears here while the dev server runs.'),
              { code: <code />, function: <>error_log()</> }
            )}</span>
          )}
        </div>
        <Stack direction="row" align="center" justify="space-between" gap="sm" wrap="wrap" className="tray-notes">
          {/* The file is under build/, while the file being edited when
              it filled up is under src/ — so it cannot be guessed, and
              it is what someone needs to tail it in a terminal or attach
              it to a ticket. Selectable rather than truncated with an
              ellipsis: a path you cannot copy is decoration. */}
          <code className="log-path">{logs.debugLogPath || __('The log file appears once the dev server has run.')}</code>
          <Stack direction="row" gap="sm">
            <Button variant="outline" tone="neutral" size="compact" onClick={logs.revealDebugLog} disabled={!logs.debugLogPath}>{__('Show in folder')}</Button>
            <Button variant="outline" tone="neutral" size="compact" onClick={logs.copyDebugLog} disabled={!logs.debugLogs}>{copyLabel}</Button>
            <Button variant="outline" tone="neutral" size="compact" onClick={logs.clearDebugLog} disabled={!logs.debugLogs}>{__('Clear')}</Button>
          </Stack>
        </Stack>
      </Tabs.Panel>
    </Tabs.Root>
  );
}
