'use strict';

/* FlightSlate feature bundle — messaging, documents, utilization, push, locations, leads */

let _activeMessageThreadId = null;
let _readinessPrintData = null;

function featuresCanStaff() {
  return currentUser && ['owner', 'admin', 'instructor'].includes(currentUser.role);
}

function printCheckrideReadiness() {
  if (!_readinessPrintData) return;
  const w = window.open('', '_blank');
  if (!w) { showToast('Allow popups to print report', 'error'); return; }
  const studentName = _readinessPrintData.studentName || 'Student';
  const programs = _readinessPrintData.programs || [];
  let html = '<html><head><title>Checkride Readiness</title><style>body{font-family:Arial,sans-serif;padding:2rem}h1{font-size:1.3rem}.prog{margin:1rem 0;border-bottom:1px solid #ddd;padding-bottom:0.75rem}</style></head><body>';
  html += '<h1>Checkride Readiness Report</h1><p><strong>Student:</strong> ' + escHtml(studentName) + '</p>';
  for (const p of programs) {
    html += '<div class="prog"><h2>' + escHtml(p.program_name) + ' — ' + p.readiness_pct + '%</h2><ul>';
    for (const c of (p.categories || [])) {
      html += '<li>' + escHtml(c.label) + ': ' + c.got + ' / ' + c.need + ' (' + c.pct + '%)</li>';
    }
    html += '</ul></div>';
  }
  html += '</body></html>';
  w.document.write(html);
  w.document.close();
  setTimeout(function() { w.print(); }, 300);
}

async function loadMessagesPage() {
  const listEl = document.getElementById('messages-thread-list');
  const chatEl = document.getElementById('messages-chat');
  if (!listEl) return;
  listEl.innerHTML = '<div style="padding:1rem;color:var(--gray-500)">Loading…</div>';
  try {
    const data = await api('/api/messages/threads');
    if (!data.threads || !data.threads.length) {
      listEl.innerHTML = '<div style="padding:1rem;color:var(--gray-500)">No conversations yet.</div>';
      if (chatEl) chatEl.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--gray-500)">Start a conversation below.</div>';
      populateMessageNewForm();
      return;
    }
    listEl.innerHTML = data.threads.map(function(t) {
      var unread = t.unread_count > 0 ? ' <span style="background:var(--sky);color:#0f172a;font-size:0.65rem;padding:0.1rem 0.35rem;border-radius:999px">' + t.unread_count + '</span>' : '';
      return '<div class="msg-thread-item" onclick="openMessageThread(' + t.id + ')"><div style="font-weight:600">' + escHtml(t.student_name) + ' / ' + escHtml(t.instructor_name) + unread + '</div><div style="font-size:0.75rem;color:var(--gray-500)">' + escHtml((t.last_message || '').slice(0, 50)) + '</div></div>';
    }).join('');
    populateMessageNewForm();
  } catch (err) {
    listEl.innerHTML = '<div style="padding:1rem;color:var(--red)">' + escHtml(err.error || 'Failed') + '</div>';
  }
}

async function openMessageThread(threadId) {
  _activeMessageThreadId = threadId;
  var chatEl = document.getElementById('messages-chat');
  if (!chatEl) return;
  try {
    var data = await api('/api/messages/threads/' + threadId);
    var t = data.thread;
    var isAdmin = ['owner', 'admin'].includes(currentUser.role);
    var canReply = !isAdmin || currentUser.role === 'instructor' || currentUser.role === 'student';
    chatEl.innerHTML = '<div class="msg-chat-hdr"><strong>' + escHtml(t.student_name) + '</strong> &harr; <strong>' + escHtml(t.instructor_name) + '</strong>' + (isAdmin ? ' <span style="color:var(--amber);font-size:0.72rem">(admin view)</span>' : '') + '</div><div class="msg-chat-msgs" id="msg-chat-msgs">' +
      (data.messages || []).map(function(m) {
        return '<div class="msg-bubble ' + (m.sender_id === currentUser.id ? 'mine' : '') + '"><div class="msg-bubble-meta">' + escHtml(m.sender_name) + '</div><div>' + escHtml(m.body) + '</div></div>';
      }).join('') + '</div>' +
      (canReply ? '<form class="msg-compose" onsubmit="sendMessageReply(event,' + threadId + ')"><textarea id="msg-reply-input" rows="2" required placeholder="Type a message…"></textarea><button type="submit" class="btn btn-primary btn-sm">Send</button></form>' : '<p style="font-size:0.82rem;color:var(--gray-500)">Admins can read all threads. Instructors and students send replies from their own accounts.</p>');
    var msgs = document.getElementById('msg-chat-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } catch (err) {
    chatEl.innerHTML = '<div style="color:var(--red);padding:1rem">' + escHtml(err.error || 'Failed') + '</div>';
  }
}

async function sendMessageReply(e, threadId) {
  e.preventDefault();
  var body = document.getElementById('msg-reply-input').value.trim();
  if (!body) return;
  await api('/api/messages/threads/' + threadId, { method: 'POST', body: JSON.stringify({ body: body }) });
  document.getElementById('msg-reply-input').value = '';
  openMessageThread(threadId);
}

async function startNewMessageThread(e) {
  e.preventDefault();
  await api('/api/messages/threads', {
    method: 'POST',
    body: JSON.stringify({
      student_id: parseInt(document.getElementById('msg-new-student').value, 10),
      instructor_id: parseInt(document.getElementById('msg-new-instructor').value, 10),
      body: document.getElementById('msg-new-body').value.trim(),
    }),
  });
  document.getElementById('msg-new-body').value = '';
  showToast('Message sent', 'success');
  loadMessagesPage();
}

function populateMessageNewForm() {
  var stSel = document.getElementById('msg-new-student');
  var iSel = document.getElementById('msg-new-instructor');
  if (!stSel || !allUsers) return;
  stSel.innerHTML = allUsers.filter(function(u) { return u.role === 'student'; }).map(function(u) { return '<option value="' + u.id + '">' + escHtml(u.name) + '</option>'; }).join('');
  iSel.innerHTML = allUsers.filter(function(u) { return u.role === 'instructor' || u.is_instructor; }).map(function(u) { return '<option value="' + u.id + '">' + escHtml(u.name) + '</option>'; }).join('');
  if (currentUser.role === 'student') stSel.value = currentUser.id;
  if (currentUser.role === 'instructor') iSel.value = currentUser.id;
}

async function loadDocumentsPage() {
  var el = document.getElementById('documents-content');
  if (!el) return;
  var studentId = currentUser.role === 'student' ? currentUser.id : parseInt(document.getElementById('docs-student-select').value, 10);
  if (!studentId) { el.innerHTML = '<p style="color:var(--gray-500)">Select a student.</p>'; return; }
  var data = await api('/api/documents/student/' + studentId);
  var labels = { medical: 'Medical', student_pilot_cert: 'Student Pilot Cert', id: 'ID', tsa: 'TSA', insurance: 'Insurance', renter_agreement: 'Renter Agmt', other: 'Other' };
  el.innerHTML = '<div class="table-card scroll-x-wrap"><table class="data-table"><thead><tr><th>Type</th><th>File</th><th>Expires</th><th>Notes</th></tr></thead><tbody>' +
    (data.documents || []).map(function(d) {
      return '<tr><td>' + escHtml(labels[d.doc_type] || d.doc_type) + '</td><td>' + (d.file_url ? '<a href="' + escHtml(d.file_url) + '" target="_blank">View</a>' : '—') + '</td><td>' + (d.expiry_date || '—') + '</td><td>' + escHtml(d.notes || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

async function submitStudentDocument(e) {
  e.preventDefault();
  var studentId = currentUser.role === 'student' ? currentUser.id : parseInt(document.getElementById('docs-student-select').value, 10);
  var payload = { doc_type: document.getElementById('doc-type-select').value, expiry_date: document.getElementById('doc-expiry-input').value || null, notes: document.getElementById('doc-notes-input').value || null };
  var fileInput = document.getElementById('doc-file-input');
  if (fileInput.files[0]) {
    var buf = await fileInput.files[0].arrayBuffer();
    payload.file_name = fileInput.files[0].name;
    payload.file_data = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  }
  await api('/api/documents/student/' + studentId, { method: 'POST', body: JSON.stringify(payload) });
  showToast('Document saved', 'success');
  loadDocumentsPage();
}

async function loadCfiUtilizationPage() {
  var el = document.getElementById('cfi-util-content');
  if (!el) return;
  var data = await api('/api/instructor-utilization');
  el.innerHTML = '<div class="table-card scroll-x-wrap"><table class="data-table"><thead><tr><th>Instructor</th><th>Students</th><th>Booked</th><th>Available</th><th>Util %</th><th>Dual hrs</th><th>Est revenue</th></tr></thead><tbody>' +
    (data.instructors || []).map(function(i) {
      return '<tr><td>' + escHtml(i.name) + '</td><td>' + i.assigned_students + '</td><td>' + i.booked_hours + '</td><td>' + i.available_hours + '</td><td>' + i.utilization_pct + '%</td><td>' + i.dual_hobbs_logged + '</td><td>$' + i.est_instruction_revenue.toFixed(2) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(base64);
  var arr = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function enablePushNotifications() {
  if (!('Notification' in window)) { showToast('Not supported', 'error'); return; }
  if (await Notification.requestPermission() !== 'granted') { showToast('Permission denied', 'error'); return; }
  var keyData = await api('/api/push/vapid-public-key');
  var reg = await navigator.serviceWorker.ready;
  var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) });
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
  updatePushStatusUI(true);
  showToast('Push notifications enabled', 'success');
}

async function disablePushNotifications() {
  var reg = await navigator.serviceWorker.ready;
  var sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
  updatePushStatusUI(false);
}

function updatePushStatusUI(on) {
  var t = document.getElementById('push-status-text');
  if (t) t.textContent = on ? 'Push notifications ON for this device.' : 'Enable push for booking alerts on your phone (works in installed app).';
  var en = document.getElementById('push-enable-btn');
  var off = document.getElementById('push-disable-btn');
  if (en) en.classList.toggle('hidden', on);
  if (off) off.classList.toggle('hidden', !on);
}

async function checkPushStatus() {
  try {
    var reg = await navigator.serviceWorker.ready;
    updatePushStatusUI(!!(await reg.pushManager.getSubscription()));
  } catch (_) {}
}

async function sendLeadFollowUp(leadId) {
  var data = await api('/api/leads/' + leadId + '/follow-up', { method: 'POST' });
  showToast('Follow-up sent', 'success');
  if (typeof renderLeadDetail === 'function') renderLeadDetail(data.lead, data.activity || []);
}

async function convertLead(leadId) {
  var data = await api('/api/leads/' + leadId + '/convert', { method: 'POST' });
  showToast(data.needs_account ? 'Converted — create account in People' : 'Lead linked to user', 'success');
  if (typeof renderLeadDetail === 'function') renderLeadDetail(data.lead, data.activity || []);
  loadLeads();
}

async function loadLocationsAdmin() {
  var el = document.getElementById('locations-admin-list');
  if (!el) return;
  var data = await api('/api/locations');
  el.innerHTML = (data.locations || []).map(function(l) {
    return '<div style="padding:0.5rem 0;border-bottom:1px solid var(--border)"><strong>' + escHtml(l.code) + '</strong> ' + escHtml(l.name) + (l.is_default ? ' (default)' : '') + '</div>';
  }).join('');
}

async function addLocation(e) {
  e.preventDefault();
  await api('/api/locations', { method: 'POST', body: JSON.stringify({ code: document.getElementById('loc-code').value, name: document.getElementById('loc-name').value, weather_station: document.getElementById('loc-wx').value, is_default: document.getElementById('loc-default').checked }) });
  loadLocationsAdmin();
  showToast('Location added', 'success');
}
