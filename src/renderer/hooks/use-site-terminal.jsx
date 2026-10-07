import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { __, sprintf } from '@wordpress/i18n';
import { terminalFont, terminalTheme, tokenName, TERMINAL_READABILITY } from '../terminal-theme.cjs';
import { terminalGrid } from '../tray.cjs';
import { useThemeKey } from '../components/app-theme.jsx';

// What the terminal is painted with, read off the design system's tokens
// where the terminal stands (#557). The terminal takes its colours and its
// font as values, not as CSS, so each token is resolved here: a colour
// through an element that is given it and a canvas that writes it as the
// terminal reads one, a font's as it is written. Which token is which colour
// is terminal-theme.cjs's.
function readTerminalLook(host) {
  const styles = window.getComputedStyle(host);
  const probe = document.createElement('span');
  host.appendChild(probe);
  const canvas = document.createElement('canvas').getContext('2d');
  const value = (token) => styles.getPropertyValue(tokenName(token));
  const color = (token) => {
    probe.style.color = token;
    canvas.fillStyle = window.getComputedStyle(probe).color;
    return canvas.fillStyle;
  };
  const look = { theme: terminalTheme({ value, color }), ...terminalFont(value) };
  probe.remove();
  return look;
}
const TERMINAL_INSTALL_ALIASES = ['npm install', 'npm i', 'install'];

// What a busy terminal says to a command, or to a hint, it turns away.
function alreadyRunningLine() {
  // translators: %s: the keys that stop a command, Ctrl+C.
  return sprintf(__('A command is already running. Press %s to stop it.'), 'Ctrl+C') + '\n';
}

// A command in the help, padded so that what it does starts in the same
// column on every line.
const helpCommand = (command) => command.padEnd(27);

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
// `terminalContainerRef` goes on the element the terminal is drawn in, and
// `shown` says whether that element is on screen, which it is while this
// site is the open one and the tray is showing its terminal (#558): the
// terminal is made when the site's view mounts, put on the page the first
// time it is shown, and fitted to its element whenever that changes size.
// `writeToTerminal` prints, and `prefillTerminalCommand` puts a command at the
// prompt without running it. Every function returned keeps its identity for
// the life of the component. The effect that creates the xterm instance
// depends on `normalizeForTerminal`, on the help it prints and on the prompt
// it shows, and through the help on `writeToTerminal`; were any of those to
// change, it would dispose the terminal and make another, scrollback and all.
// None of them depends on the three runners, which may change as often as
// they like.
export function useSiteTerminal({ allowedScripts, runInstall, runScript, killCurrent, shown }) {
  const themeKey = useThemeKey();
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
  // The element the terminal is drawn in, kept as state and not as a ref:
  // it is in the tray (#558), which the window draws and this site's view
  // fills, so it arrives a render after the view does. The effects that put
  // the terminal on the page and watch its size have to run when it comes.
  // The terminal itself does not wait for it: what a site prints as its view
  // mounts has to have somewhere to go.
  const [container, setContainer] = useState(null);
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
      writeToTerminal(alreadyRunningLine());
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
    writeToTerminal(`${__('Available commands:')}\n`);
    // translators: %s: the command help, padded with spaces so that this text lines up with the lines below it.
    writeToTerminal(`  ${sprintf(__('%s Show this help text'), helpCommand('help'))}\n`);
    // translators: 1: the command npm install, padded with spaces so that this text lines up with the lines around it. 2: the same command, npm install.
    writeToTerminal(`  ${sprintf(__('%1$s Run %2$s in the site directory'), helpCommand('npm install'), 'npm install')}\n`);
    // translators: 1: the command npm run <script>, padded with spaces so that this text lines up with the lines above it. 2: the names of the scripts it can run, separated by commas.
    writeToTerminal(`  ${sprintf(__('%1$s Run one of: %2$s'), helpCommand('npm run <script>'), allowedScriptsRef.current.join(', '))}\n`);
    // Two sentences, each on its own line: a translation cannot carry a line
    // break, and the terminal wraps a line that is wider than it is.
    writeToTerminal(`\n${sprintf(
      // translators: 1: the command npm install. 2: the command npm run build.
      __('The setup checklist runs %1$s and %2$s once.'),
      'npm install',
      'npm run build'
    )}\n`);
    writeToTerminal(`${__('Run them here whenever you change files or add a dependency afterwards.')}\n`);
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
      writeToTerminal(alreadyRunningLine());
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
      // translators: %s: the command being run, such as npm install.
      writeToTerminal(`${sprintf(__('Running %s…'), 'npm install')}\n`);
      runInstall({
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          // translators: 1: the command that ended, such as npm install. 2: the code it exited with, a number.
          writeToTerminal(`${sprintf(__('%1$s exited with code %2$s'), 'npm install', code)}\n`);
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
        // translators: %s: an example of the command, npm run build.
        writeToTerminal(`${sprintf(__('Missing script name. Example: %s'), 'npm run build')}\n`);
        showPrompt(false);
        return;
      }
      const allowed = allowedScriptsRef.current;
      if (!allowed.includes(script)) {
        // translators: 1: the script asked for. 2: the names of the scripts that can be run, separated by commas.
        writeToTerminal(`${sprintf(__('Unsupported script "%1$s". Allowed scripts: %2$s'), script, allowed.join(', '))}\n`);
        showPrompt(false);
        return;
      }
      markTerminalRunning(true);
      terminalKillRef.current = () => { killCurrent().catch(() => {}); };
      // translators: %s: the command being run, such as npm run build.
      writeToTerminal(`${sprintf(__('Running %s…'), `npm run ${script}`)}\n`);
      runScript(script, {
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          // translators: 1: the command that ended, such as npm run build. 2: the code it exited with, a number.
          writeToTerminal(`${sprintf(__('%1$s exited with code %2$s'), `npm run ${script}`, code)}\n`);
          markTerminalRunning(false);
          terminalKillRef.current = null;
          showPrompt(false);
        }
      });
      return;
    }

    // translators: %s: what was typed at the prompt.
    writeToTerminal(`${sprintf(__('Unsupported command: %s'), command)}\n`);
    // translators: %s: the command that lists the others, help.
    writeToTerminal(`${sprintf(__('Try "%s" for the list of supported commands.'), 'help')}\n`);
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
    const term = new Terminal({
      rows: 12,
      cursorBlink: true,
      scrollback: 4000,
      convertEol: false,
      ...TERMINAL_READABILITY
    });
    terminalRef.current = term;
    // Not opened here, and not given its colours and font here: see the
    // effect below. Everything written before it opens is kept in the
    // terminal's buffer and drawn when it does.
    term.write(normalizeForTerminal(`${__('WordPress npm helper terminal.')}\n`));
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

  // As many columns and rows as its element has room for (#558). The tray is
  // as wide as the page and as tall as it is dragged, so the terminal is no
  // longer the eighty columns by twelve rows it was on the page.
  //
  // A cell is measured off what the terminal has drawn: a row's height, and
  // the rows' width over the columns they hold. The scrollbar's width is
  // taken off the room first, where the platform draws one beside the rows.
  // Hidden, everything measures zero and the terminal is left as it is.
  const fitTerminal = useCallback(() => {
    const term = terminalRef.current;
    if (!term || !term.element || !container) return;
    const rows = container.querySelector('.xterm-rows');
    const viewport = container.querySelector('.xterm-viewport');
    if (!rows || !rows.firstElementChild || !viewport) return;
    const grid = terminalGrid({
      width: container.clientWidth - (viewport.offsetWidth - viewport.clientWidth),
      height: container.clientHeight,
      cellWidth: rows.getBoundingClientRect().width / term.cols,
      cellHeight: rows.firstElementChild.getBoundingClientRect().height
    });
    if (grid && (grid.cols !== term.cols || grid.rows !== term.rows)) term.resize(grid.cols, grid.rows);
  }, [container]);

  // The terminal is put on the page the first time it is shown, not when the
  // view mounts. xterm sets the spacing between characters from the width of
  // a glyph it measures in the document as it opens and as it draws a row,
  // and every site's view mounts behind `display: none` (the selected site is
  // only chosen by an effect after that, and the tray starts closed), where a
  // glyph measures zero: the spacing came out a whole cell wide, and any row
  // drawn before the terminal was shown stayed that way, every letter a cell
  // apart and each line cut in half.
  //
  // After every render, and not only when `shown` changes: the effect above
  // can make the terminal anew, and the new one has to be opened too. Once a
  // terminal has an element there is nothing left to do here, and xterm
  // would do nothing with a second call either.
  useEffect(() => {
    const term = terminalRef.current;
    if (!shown || !term || !container || term.element) return;
    // Its colours and font are read where it stands, just before it is drawn
    // there, and given to it as the values it takes.
    Object.assign(term.options, readTerminalLook(container));
    term.open(container);
    fitTerminal();
  });

  // Painted again when the window's theme changes (#560). The terminal was
  // given its colours as values when it opened, and a change to the tokens
  // does not reach a value; so they are read again, after the provider has
  // put the new tokens on the document, which it does in a layout effect,
  // before this one runs. A terminal not yet opened is given them when it is.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !term.element || !container) return;
    term.options.theme = readTerminalLook(container).theme;
  }, [themeKey, container]);

  // Fitted again whenever its element changes size: the tray dragged, the
  // window resized, and the element coming back on screen, which is a change
  // from no size to one.
  useEffect(() => {
    if (!container) return undefined;
    const observer = new ResizeObserver(() => fitTerminal());
    observer.observe(container);
    return () => observer.disconnect();
  }, [container, fitTerminal]);

  return {
    terminalContainerRef: setContainer,
    terminalStateRef,
    terminalKillRef,
    terminalRunning,
    markTerminalRunning,
    writeToTerminal,
    prefillTerminalCommand
  };
}
