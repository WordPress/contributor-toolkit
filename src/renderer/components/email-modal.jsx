import { Modal, TabPanel } from '@wordpress/components';

function formatEmailDate(email) {
  if (email.sentAt) return new Date(email.sentAt).toLocaleString();
  if (email.date) return new Date(email.date).toLocaleString();
  return '';
}

// One mail the site sent, opened from the list under "Mail": who it is from
// and to, and the message in two forms, as a reader would see it and as it was
// sent. It holds no state of its own. Whoever renders it owns which mail is
// open, and renders it only while one is, so every mail opens on the rendered
// form whatever tab the last one was left on.
export function EmailModal({ email, onClose }) {
  return (
    <Modal
      title={email.subject || 'Email'}
      onRequestClose={onClose}
      shouldCloseOnClickOutside
      isFullScreen
    >
      <div style={{ padding: 8 }}>
        <div style={{ marginBottom: 8, fontSize:12, color:'#444' }}>
          <div><strong>From:</strong> {email.from || ''}</div>
          <div><strong>To:</strong> {email.to || ''}</div>
          {email.cc ? (<div><strong>CC:</strong> {email.cc}</div>) : null}
          <div><strong>Date:</strong> {formatEmailDate(email)}</div>
        </div>
        <TabPanel className="email-tabs" activeClass="is-active" tabs={[{name:'rendered',title:'Rendered'},{name:'raw',title:'Raw'}]}>
          {(tab)=> tab.name==='rendered' ? (
            <div style={{ border:'1px solid #ddd', borderRadius:6, padding:12, minHeight:'60vh', background:'#fff' }}>
              {email.html ? (
                <div dangerouslySetInnerHTML={{ __html: String(email.html) }} />
              ) : (
                <pre style={{ whiteSpace:'pre-wrap', margin:0 }}>{email.text || ''}</pre>
              )}
            </div>
          ) : (
            <pre style={{ whiteSpace:'pre-wrap', margin:0, background:'#111', color:'#eee', padding:12, borderRadius:6, minHeight:'60vh', overflow:'auto' }}>{email.raw || email.text || ''}</pre>
          )}
        </TabPanel>
      </div>
    </Modal>
  );
}
