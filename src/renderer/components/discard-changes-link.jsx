import { ReasonedButton } from './reasoned-button.jsx';

// One discard action, wherever it is offered. Keeping the disabled rendering
// here means the ticket note cannot lose the explanation while the review
// modal keeps it (or vice versa). Its words are `label`, or, inside a
// sentence, the ones the sentence marks for it.
export function DiscardChangesLink({ label, children, onClick, reason }) {
  return <ReasonedButton variant="link" isDestructive onClick={onClick} reason={reason}>{children ?? label}</ReasonedButton>;
}
