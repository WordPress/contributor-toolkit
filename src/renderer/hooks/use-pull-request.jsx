import { useState } from 'react';
import { carryTestMode } from '../github-account.cjs';
import { prConfirmationMessage } from '../confirmations.cjs';

// Opening a pull request from a site (#167): the GitHub account the app is
// acting for, the sign-in that gets one, what the contributor typed, and the
// attempt itself with how it went.
//
// Held by the site rather than by the card that shows it
// (PullRequestDestination), because most of it has to outlive the card. A
// sign-in is finished in a browser and an attempt takes as long as a fork
// takes, and the dialog can be closed during either: the code has to be there
// when it opens again, and an attempt that is still running has to go on
// moving the card it was started from. The account outlives the dialog for a
// plainer reason: knowing it already is what keeps the card from asking
// "Checking…" on every open.
//
// `sitePath` is the site the pull request is opened from. `confirm` announces
// the outcome to a contributor who looked away.
export function usePullRequest({ sitePath, confirm }) {
  // `account` is null until the panel has asked; `{ login: null }` is a real
  // answer meaning signed out, and the two must not render the same way —
  // offering "Sign in" before the app knows whether it already is signed in
  // makes the panel flicker on every open.
  const [account, setAccount] = useState(null);
  const [deviceCode, setDeviceCode] = useState(null);
  const [signInError, setSignInError] = useState('');
  const [declined, setDeclined] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [stage, setStage] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const loadAccount = async () => {
    try {
      const res = await window.api.getGithubAccount();
      setAccount(res && res.ok ? res : { login: null, configured: false });
    } catch {
      setAccount({ login: null, configured: false });
    }
  };

  // For the moment the review dialog opens. Last time's outcome belongs to
  // last time's patch. The account is not reset — that survives the modal —
  // but it is re-read, since it can have been signed out from another site's
  // panel.
  const startReview = () => {
    setResult(null);
    setError(null);
    setStage('');
    setNotes('');
    setSignInError('');
    setDeclined(false);
    loadAccount();
  };

  // Sign-in is two-legged on purpose: this resolves as soon as there is a code
  // to show, because the contributor's next move is in a browser, and the
  // outcome of the wait arrives later on the callback.
  const startSignIn = async () => {
    setSignInError('');
    setCodeCopied(false);
    let started;
    try {
      started = await window.api.signInToGithub((done) => {
        setDeviceCode(null);
        if (done && done.ok) {
          setAccount((prev) => carryTestMode(prev, { login: done.login, configured: true }));
          setSignInError('');
          return;
        }
        // Declining is a choice, not a fault, so it reads as one.
        setSignInError(done && done.reason === 'denied'
          ? 'The authorization was declined on GitHub. Nothing was changed.'
          : (done && done.error) || 'Sign-in did not complete.');
      });
    } catch (e) {
      setSignInError(e && e.message ? e.message : String(e));
      return;
    }
    if (!started || !started.ok) {
      setSignInError((started && started.error) || 'Could not start sign-in.');
      return;
    }
    setDeviceCode({ userCode: started.userCode, verificationUri: started.verificationUri });
    // Opening the page here rather than making it a second button: the code on
    // screen is only useful on that page, and a contributor who has just been
    // told what will happen should not have to go looking for where.
    window.api.openExternal(started.verificationUri);
  };

  const cancelSignIn = async () => {
    setDeviceCode(null);
    setSignInError('');
    try { await window.api.cancelGithubSignIn(); } catch {}
  };

  const signOut = async () => {
    try { await window.api.signOutOfGithub(); } catch {}
    setAccount((prev) => carryTestMode(prev, { login: null, configured: prev?.configured !== false }));
    setResult(null);
    setError(null);
  };

  const decline = () => {
    setDeclined(true);
    setSignInError('');
  };

  const askAgain = () => setDeclined(false);

  const copyDeviceCode = async () => {
    if (!deviceCode?.userCode) return;
    try {
      await navigator.clipboard.writeText(deviceCode.userCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {}
  };

  const open = async () => {
    setError(null);
    setResult(null);
    setStage('forking');
    // Subscribed only for the duration of the attempt: the event carries a site
    // path because one main process serves every open site, and a stale
    // listener would move another site's spinner.
    const unsubscribe = window.api.subscribePullRequestProgress((payload) => {
      if (payload && payload.sitePath === sitePath) setStage(payload.stage);
    });
    try {
      const res = await window.api.openPullRequest(sitePath, { title, notes });
      if (res && res.ok) {
        setResult(res);
        // The result panel carries the link; this announces the outcome for a
        // contributor who looked away during the slow fork step (#253).
        confirm(prConfirmationMessage(res));
      } else {
        setError(res || { reason: 'error', error: 'The pull request could not be opened.' });
        // A revoked authorization is forgotten in the main process, so the card
        // has to stop claiming an account it no longer has.
        if (res && res.reason === 'unauthorized') setAccount((prev) => carryTestMode(prev, { login: null, configured: true }));
      }
    } catch (e) {
      setError({ reason: 'error', error: e && e.message ? e.message : String(e) });
    } finally {
      setStage('');
      unsubscribe();
    }
  };

  const copyLink = async () => {
    if (!result?.url) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {}
  };

  return {
    account,
    deviceCode,
    signInError,
    declined,
    codeCopied,
    title,
    notes,
    stage,
    result,
    error,
    linkCopied,
    setTitle,
    setNotes,
    startReview,
    startSignIn,
    cancelSignIn,
    signOut,
    decline,
    askAgain,
    copyDeviceCode,
    open,
    copyLink
  };
}
