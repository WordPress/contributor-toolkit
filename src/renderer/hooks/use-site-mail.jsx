import { useCallback, useRef, useState } from 'react';

// Newest first, by when a mail was sent and not by when it arrived.
const sortEmails = (list) => [...list].sort((a, b) => new Date(b.sentAt || b.date || 0) - new Date(a.sentAt || a.date || 0));

// The mail a site's WordPress sent, which the app catches instead of letting
// it out (#554): the list, where the mail server is listening, and the one
// mail open in the dialog.
//
// The dev server decides when the list is live, because the mail server runs
// with it. So this hook does not start anything by itself. The caller calls
// `listen` before it starts the dev server, so that no early mail is missed,
// `load` once the server is up, for what the store already holds, and
// `stopListening` when the server stops. Until the first `load` the list is
// empty, whatever the store holds.
//
// Every function returned keeps its identity for as long as `sitePath` does.
// The callbacks that start and stop the dev server list them as dependencies,
// and one that changed on every render would hand those callbacks a new
// identity each time too.
export function useSiteMail({ sitePath }) {
  const [emails, setEmails] = useState([]);
  const [smtpPort, setSmtpPort] = useState(0);
  // The mail open in the dialog, or null while none is: the dialog is up
  // exactly while there is one to show.
  const [activeEmail, setActiveEmail] = useState(null);
  const newEmailUnsubRef = useRef(null);
  const smtpStartedUnsubRef = useRef(null);

  const open = useCallback((email) => { setActiveEmail(email); }, []);
  const close = useCallback(() => { setActiveEmail(null); }, []);
  const clear = useCallback(async () => { await window.api.clearEmails(sitePath); setEmails([]); }, [sitePath]);

  // Each listener is added once however often this is called: a second one
  // would add every mail to the list a second time.
  const listen = useCallback(() => {
    if (!smtpStartedUnsubRef.current) smtpStartedUnsubRef.current = window.api.onSmtpStarted(sitePath, (port) => setSmtpPort(port || 0));
    if (!newEmailUnsubRef.current) newEmailUnsubRef.current = window.api.onNewEmail(sitePath, (msg) => setEmails((prev) => sortEmails([msg, ...prev])));
  }, [sitePath]);

  const stopListening = useCallback(() => {
    try { if (newEmailUnsubRef.current) { newEmailUnsubRef.current(); newEmailUnsubRef.current = null; } } catch {}
    try { if (smtpStartedUnsubRef.current) { smtpStartedUnsubRef.current(); smtpStartedUnsubRef.current = null; } } catch {}
    setSmtpPort(0);
  }, []);

  const load = useCallback(async () => {
    try { const { port, emails: fetchedEmails } = await window.api.getEmails(sitePath); if (port) setSmtpPort(port); setEmails(fetchedEmails || []); } catch {}
  }, [sitePath]);

  return { emails, smtpPort, activeEmail, open, close, clear, listen, stopListening, load };
}
