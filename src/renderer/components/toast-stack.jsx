import { useCallback, useEffect, useRef } from 'react';
import { __ } from '@wordpress/i18n';
import { Notice } from '@wordpress/ui';
import { toastView } from '../confirmations.cjs';

// One confirmation. It says itself as it appears, politely or at once as the
// queue decided, and one that clears itself does so when its time is up. Any
// of them can be dismissed before that.
function Toast({ notice, onRemove, onDismiss }) {
  const { intent, lifetime } = toastView(notice);
  useEffect(() => {
    if (!lifetime) return undefined;
    const timer = setTimeout(() => onRemove(notice.id), lifetime);
    return () => clearTimeout(timer);
  }, [lifetime, notice.id, onRemove]);
  return (
    <Notice.Root intent={intent} politeness={notice.politeness} spokenMessage={notice.content}>
      <Notice.Title>{notice.content}</Notice.Title>
      <Notice.CloseIcon onClick={() => onDismiss(notice.id)} />
    </Notice.Root>
  );
}

/**
 * The window's confirmations (#253, #557), stacked in its corner: that an
 * action worked, or that one the contributor is no longer looking at did
 * not. The newest is the nearest to the corner.
 *
 * It draws the queue it is given. Which messages are in it, how each speaks
 * and whether it stays are decided in confirmations.cjs.
 *
 * @param {Object}   props
 * @param {Array}    props.notices  The queue's notices, oldest first.
 * @param {Function} props.onRemove Takes a notice out of the queue, by its id.
 */
export function ToastStack({ notices, onRemove }) {
  const stack = useRef(null);
  // The button that dismisses a notice goes with it, and the focus would go
  // to the top of the document. It is put on the stack, which is where the
  // next notice's button is. A notice that runs out of time takes no focus
  // from anywhere but itself, and moves none.
  const dismiss = useCallback((id) => {
    if (stack.current) stack.current.focus();
    onRemove(id);
  }, [onRemove]);
  return (
    <section ref={stack} tabIndex={-1} className="toast-stack" aria-label={__('Notifications')}>
      {notices.map((notice) => <Toast key={notice.id} notice={notice} onRemove={onRemove} onDismiss={dismiss} />)}
    </section>
  );
}
