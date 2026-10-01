import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';

// The font of the terminal, and of the log panes beside it, which are drawn to
// look like it.
export const TERMINAL_FONT = { fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace', fontSize: 13 };
const TERMINAL_INSTALL_ALIASES = ['npm install', 'npm i', 'install'];

// The site's terminal (#554): the xterm instance, the line being typed and its
// history, the handful of commands it knows, and the one lock that says a
// command is running.
//
// It is not a shell. It runs npm install and the project's allowed npm scripts,
// one at a time, through the three functions it is given: `runInstall` and
// `runScript` start a run and report its output and its end, and `killCurrent`
// stops the run that was started last. `allowedScripts` is the project's list.
//
// The lock is not the terminal's alone. Every chain that runs an install or a
// build (the setup, a trunk update, applying a patch, switching tickets) takes
// it for as long as it runs, writes its progress here, and says what Ctrl+C
// should stop. So three things are handed out as they are, for those chains to
// use the way they always have: `terminalStateRef`, whose `running` they read
// before starting; `markTerminalRunning`, which moves that flag and the state
// copy the screen reads, `terminalRunning`, together; and `terminalKillRef`,
// where whoever holds the lock leaves the function Ctrl+C calls.
//
// `terminalContainerRef` goes on the element the terminal is drawn in.
// `writeToTerminal` prints, and `prefillTerminalCommand` puts a command at the
// prompt without running it. Every function returned keeps its identity for
// the life of the component: the xterm instance is created by an effect that
// depends on some of them, and one that changed would dispose the terminal
// and make another, scrollback and all.
export function useSiteTerminal({ allowedScripts, runInstall, runScript, killCurrent }) {
  // Read through a ref by the terminal's command handlers rather than closed
  // over: the xterm instance is created by an effect that depends on
  // `printHelp`, so a new array identity here would otherwise dispose and
  // recreate the terminal, scrollback and all, the first time a status
  // reports a type. Same indirection as terminalInputHandlerRef, and updated
  // the same way: from an effect, once the render that changed it is on screen.
  const allowedScriptsRef = useRef(allowedScripts);
  useLayoutEffect(() => {
    allowedScriptsRef.current = allowedScripts;
  }, [allowedScripts]);
  const terminalContainerRef = useRef(null);
  const terminalRef = useRef(null);
  const terminalStickRef = useRef(true);
  const terminalInputHandlerRef = useRef(() => {});
  const terminalKillRef = useRef(null);
  const terminalStateRef = useRef({ input: '', history: [], historyIndex: 0, running: false });

  // The terminal's own busy flag lives in a ref, so nothing re-renders when it
  // moves — fine for the guards that read it inline, useless for anything the
  // UI has to reflect. The hints under the Terminal (#182) do have to reflect
  // it, so every write goes through here and keeps a state copy in step. The
  // direction that hurts is the ref saying "busy" while the state says "free":
  // the hint links stay enabled and their click is silently refused.
  const [terminalRunning, setTerminalRunning] = useState(false);
  const markTerminalRunning = useCallback((value) => {
    const next = Boolean(value);
    terminalStateRef.current.running = next;
    setTerminalRunning(next);
  }, []);

  const normalizeForTerminal = useCallback((text) => String(text ?? '').replace(/\r?\n/g, '\r\n'), []);

  const writeToTerminal = useCallback((text) => {
    const term = terminalRef.current;
    if (!term) return;
    term.write(normalizeForTerminal(text));
    if (terminalStickRef.current) term.scrollToBottom();
  }, [normalizeForTerminal]);

  const showPrompt = useCallback((prependNewLine = true) => {
    const term = terminalRef.current;
    if (!term) return;
    const state = terminalStateRef.current;
    if (prependNewLine) term.write('\r\n');
    term.write('$ ');
    state.input = '';
    state.historyIndex = state.history.length;
    if (terminalStickRef.current) term.scrollToBottom();
  }, []);

  const replaceTerminalInput = useCallback((next) => {
    const term = terminalRef.current;
    if (!term) return;
    const state = terminalStateRef.current;
    const current = state.input;
    if (current && current.length) {
      for (let i = 0; i < current.length; i += 1) {
        term.write('\b \b');
      }
    }
    state.input = next;
    if (next) term.write(next);
    if (terminalStickRef.current) term.scrollToBottom();
  }, []);

  // Drops a command at the prompt without running it, for the hints under the
  // Terminal (#182). Build and install are one-time steps in the setup
  // checklist, so a contributor who edits files or adds a dependency later has
  // no button left to press — the terminal is the path that still works, and
  // nothing pointed at it. Prefilling rather than running is the point: the
  // command lands where they can see it, and they press Enter themselves.
  const prefillTerminalCommand = useCallback((command) => {
    // The links are already rendered as plain text while the terminal is busy,
    // so this is the belt to that braces — but it says so rather than returning
    // silently, matching every other busy guard in this file. A guard that
    // swallows the click is how a link becomes a control that does nothing.
    if (terminalStateRef.current.running) {
      writeToTerminal('A command is already running. Press Ctrl+C to stop it.\n');
      return;
    }
    replaceTerminalInput(command);
    const term = terminalRef.current;
    if (term) term.focus();
  }, [replaceTerminalInput, writeToTerminal]);

  const addCommandToHistory = useCallback((value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const state = terminalStateRef.current;
    if (state.history[state.history.length - 1] === trimmed) {
      state.historyIndex = state.history.length;
      return;
    }
    const nextHistory = [...state.history, trimmed];
    if (nextHistory.length > 50) nextHistory.shift();
    state.history = nextHistory;
    state.historyIndex = nextHistory.length;
  }, []);

  const printHelp = useCallback(() => {
    writeToTerminal('Available commands:\n');
    writeToTerminal('  help                        Show this help text\n');
    writeToTerminal('  npm install                 Run npm install in the site directory\n');
    writeToTerminal('  npm run <script>            Run one of: ' + allowedScriptsRef.current.join(', ') + '\n');
    writeToTerminal('\nThe setup checklist runs npm install and npm run build once. Run them here\nwhenever you change files or add a dependency afterwards.\n');
  }, [writeToTerminal]);

  const executeTerminalCommand = useCallback((rawCommand) => {
    const command = rawCommand.trim();
    const state = terminalStateRef.current;
    if (!command) {
      showPrompt(false);
      return;
    }

    addCommandToHistory(command);

    if (state.running) {
      writeToTerminal('A command is already running. Press Ctrl+C to stop it.\n');
      return;
    }

    if (command === 'help') {
      printHelp();
      showPrompt(false);
      return;
    }

    const lower = command.toLowerCase();
    if (TERMINAL_INSTALL_ALIASES.includes(lower)) {
      markTerminalRunning(true);
      terminalKillRef.current = () => { killCurrent().catch(() => {}); };
      writeToTerminal('Running npm install…\n');
      runInstall({
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          writeToTerminal(`npm install exited with code ${code}\n`);
          markTerminalRunning(false);
          terminalKillRef.current = null;
          showPrompt(false);
        }
      });
      return;
    }

    if (lower.startsWith('npm run ')) {
      const script = command.slice(8).trim();
      if (!script) {
        writeToTerminal('Missing script name. Example: npm run build\n');
        showPrompt(false);
        return;
      }
      const allowed = allowedScriptsRef.current;
      if (!allowed.includes(script)) {
        writeToTerminal(`Unsupported script "${script}". Allowed scripts: ${allowed.join(', ')}\n`);
        showPrompt(false);
        return;
      }
      markTerminalRunning(true);
      terminalKillRef.current = () => { killCurrent().catch(() => {}); };
      writeToTerminal(`Running npm run ${script}…\n`);
      runScript(script, {
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          writeToTerminal(`npm run ${script} exited with code ${code}\n`);
          markTerminalRunning(false);
          terminalKillRef.current = null;
          showPrompt(false);
        }
      });
      return;
    }

    writeToTerminal(`Unsupported command: ${command}\nTry "help" for the list of supported commands.\n`);
    showPrompt(false);
  }, [addCommandToHistory, killCurrent, markTerminalRunning, printHelp, runInstall, runScript, showPrompt, writeToTerminal]);

  const handleTerminalData = useCallback((data) => {
    const term = terminalRef.current;
    if (!term) return;
    const state = terminalStateRef.current;

    if (data === '\u0003') { // Ctrl+C
      term.write('^C\r\n');
      state.input = '';
      state.historyIndex = state.history.length;
      if (state.running) {
        if (terminalKillRef.current) terminalKillRef.current();
      } else {
        showPrompt(false);
      }
      return;
    }

    if (state.running) {
      // Ignore all other input while command is running
      return;
    }

    if (data === '\r') { // Enter
      const current = state.input;
      state.input = '';
      term.write('\r\n');
      state.historyIndex = state.history.length;
      executeTerminalCommand(current);
      return;
    }

    if (data === '\u007f') { // Backspace
      if (state.input.length > 0) {
        state.input = state.input.slice(0, -1);
        term.write('\b \b');
      }
      return;
    }

    if (data === '\u001b[A' || data === '\u001b[B') { // history navigation
      if (!state.history.length) return;
      if (data === '\u001b[A') {
        state.historyIndex = Math.max(0, state.historyIndex - 1);
      } else {
        state.historyIndex = Math.min(state.history.length, state.historyIndex + 1);
      }
      const nextValue = state.historyIndex >= state.history.length ? '' : state.history[state.historyIndex];
      replaceTerminalInput(nextValue);
      return;
    }

    if (data.startsWith('\u001b')) {
      // Ignore other escape sequences
      return;
    }

    state.input += data;
    term.write(data);
    if (terminalStickRef.current) term.scrollToBottom();
  }, [executeTerminalCommand, replaceTerminalInput, showPrompt]);

  useEffect(() => {
    terminalInputHandlerRef.current = handleTerminalData;
  }, [handleTerminalData]);

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return undefined;
    const term = new Terminal({
      rows: 12,
      cursorBlink: true,
      scrollback: 4000,
      convertEol: false,
      theme: { background: '#111', foreground: '#f5f5f5' },
      ...TERMINAL_FONT
    });
    terminalRef.current = term;
    term.open(container);
    term.write(normalizeForTerminal('WordPress npm helper terminal.\n'));
    printHelp();
    showPrompt(false);
    const dataDisposable = term.onData((d) => terminalInputHandlerRef.current(d));
    const scrollDisposable = term.onScroll(() => {
      const buffer = term.buffer.active;
      const atBottom = buffer.baseY + buffer.cursorY >= buffer.length - term.rows;
      terminalStickRef.current = atBottom;
    });
    return () => {
      dataDisposable.dispose();
      scrollDisposable.dispose();
      term.dispose();
      terminalRef.current = null;
      terminalStickRef.current = true;
    };
  }, [normalizeForTerminal, printHelp, showPrompt]);

  return {
    terminalContainerRef,
    terminalStateRef,
    terminalKillRef,
    terminalRunning,
    markTerminalRunning,
    writeToTerminal,
    prefillTerminalCommand
  };
}
