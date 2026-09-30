import { Modal, TabPanel } from '@wordpress/components';

function formatEmailDate(email) {
  if (email.sentAt) return new Date(email.sentAt).toLocaleString();
  if (email.date) return new Date(email.date).toLocaleString();
  return '';
}

// What goes in front of every mail's HTML part. The mail's own markup follows
// it and wins wherever it says otherwise.
//
// The style is the look a mail had when it was drawn in the dialog's own
// document: the app's font and size, and no margin of its own.
//
// The <base> is for links. A link with no target would load its address in
// the frame itself, the frame may not load it, and the mail would be replaced
// by an empty page. Aimed at a new window, which the frame may not open
// either, the link does nothing and the mail stays where it is.
const MAIL_DEFAULTS = '<base target="_blank"><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px}</style>';

// One mail the site sent, opened from the list under "Mail": who it is from
// and to, and the message in two forms, as a reader would see it and as it was
// sent. It holds no state of its own. Whoever renders it owns which mail is
// open, and renders it only while one is, so every mail opens on the rendered
// form whatever tab the last one was left on.
//
// A mail's markup is written by whatever sent it, never by the app, so its
// HTML part is not put in the app's document. It is drawn in a frame that is
// allowed nothing (the empty `sandbox`): no scripts, no forms, no new windows,
// and no navigating the window it sits in. Its links, its forms, its <base>
// and its styles end at the frame's edge. The frame is a `srcdoc` one, so it
// inherits this window's content security policy as well, and nothing in it
// loads from the network.
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
                <iframe
                  title="Mail"
                  sandbox=""
                  srcDoc={MAIL_DEFAULTS + String(email.html)}
                  style={{ display:'block', width:'100%', height:'60vh', border:0 }}
                />
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
