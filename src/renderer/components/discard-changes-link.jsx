import { ReasonedButton } from './reasoned-button.jsx';

// One discard action, wherever it is offered. Keeping the disabled rendering
// here means the ticket note cannot lose the explanation while the review
// modal keeps it (or vice versa).
export function DiscardChangesLink({ label, onClick, reason }) {
  return <ReasonedButton variant="link" isDestructive onClick={onClick} reason={reason}>{label}</ReasonedButton>;
}
