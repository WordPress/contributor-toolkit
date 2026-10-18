import { createContext, useContext } from 'react';

// The one way any panel confirms a completed action (#253). `confirm(message)`
// queues a transient, screen-reader-announced notice; the provider in App renders
// the queue once for the window. The default is a no-op so a component rendered
// outside the provider (a test, say) does not throw on a stray confirm.
export const ConfirmationContext = createContext(() => {});

export function useConfirmation() {
  return useContext(ConfirmationContext);
}
