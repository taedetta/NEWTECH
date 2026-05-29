'use strict';

/* FlightSlate feature bundle — messaging, utilization, push, locations, leads */

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

var _aircraftDocsAircraftId = null;
var _aircraftDocsLabels = {};

function readFileBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      var result = reader.result;
      if (typeof result !== 'string') return reject(new Error('Failed to read file'));
      var comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = function() { reject(reader.error || new Error('Failed to read file')); };
    reader.readAsDataURL(file);
  });
}

function canUploadAircraftDocs() {
  return currentUser && ['owner', 'admin'].includes(currentUser.role);
}

function openAircraftDocsModal(aircraftId) {
  aircraftId = parseInt(aircraftId, 10);
  if (!Number.isFinite(aircraftId)) return;
  var ac = (typeof allAircraft !== 'undefined' && allAircraft || []).find(function(x) { return x.id === aircraftId; });
  _aircraftDocsAircraftId = aircraftId;
  document.getElementById('aircraft-docs-aircraft-id').value = aircraftId;
  document.getElementById('aircraft-docs-title').textContent = (ac && ac.tail_number ? ac.tail_number : 'Aircraft') + ' — Documents';
  document.getElementById('aircraft-docs-subtitle').textContent = (ac && ac.make_model) || '';
  document.getElementById('aircraft-docs-error').classList.remove('visible');
  document.getElementById('aircraft-docs-error').textContent = '';
  document.getElementById('aircraft-docs-upload-wrap').classList.toggle('hidden', !canUploadAircraftDocs());
  document.getElementById('aircraft-docs-upload-form').reset();
  document.getElementById('aircraft-docs-modal').classList.remove('hidden');
  loadAircraftDocsList();
}

function closeAircraftDocsModal() {
  document.getElementById('aircraft-docs-modal').classList.add('hidden');
  _aircraftDocsAircraftId = null;
}

async function loadAircraftDocsList() {
  var loading = document.getElementById('aircraft-docs-loading');
  var empty = document.getElementById('aircraft-docs-empty');
  var list = document.getElementById('aircraft-docs-list');
  if (!loading || !_aircraftDocsAircraftId) return;
  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  list.classList.add('hidden');
  list.innerHTML = '';
  try {
    var data = await api('/api/aircraft/' + _aircraftDocsAircraftId + '/documents');
    _aircraftDocsLabels = data.labels || {};
    var docs = data.documents || [];
    loading.classList.add('hidden');
    if (!docs.length) {
      empty.classList.remove('hidden');
      return;
    }
    var canDelete = canUploadAircraftDocs();
    list.innerHTML = docs.map(function(d) {
      var label = _aircraftDocsLabels[d.doc_type] || d.doc_type;
      var title = d.title || d.file_name || 'Document';
      var dateStr = d.created_at ? new Date(d.created_at).toLocaleDateString() : '—';
      var expStr = d.expiry_date ? new Date(d.expiry_date + 'T12:00:00').toLocaleDateString() : '—';
      var view = d.file_url ? '<a href="' + escHtml(d.file_url) + '" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">View</a>' : '—';
      var del = canDelete ? ' <button type="button" class="btn btn-danger btn-sm" onclick="deleteAircraftDocument(' + d.id + ')">Delete</button>' : '';
      return '<div class="pwa-device-card" style="margin-bottom:0.65rem;padding:0.85rem 1rem;display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:0.75rem">' +
        '<div style="min-width:0;flex:1">' +
          '<div style="font-weight:600;color:var(--white);font-size:0.92rem">' + escHtml(title) + '</div>' +
          '<div style="font-size:0.78rem;color:var(--sky);margin-top:0.15rem">' + escHtml(label) + '</div>' +
          '<div style="font-size:0.75rem;color:var(--gray-500);margin-top:0.35rem">' +
            'Uploaded ' + escHtml(dateStr) + (d.uploaded_by_name ? ' · ' + escHtml(d.uploaded_by_name) : '') +
            (d.expiry_date ? ' · Expires ' + escHtml(expStr) : '') +
          '</div>' +
          (d.notes ? '<div style="font-size:0.78rem;color:var(--gray-400);margin-top:0.35rem">' + escHtml(d.notes) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:0.35rem;flex-shrink:0">' + view + del + '</div>' +
      '</div>';
    }).join('');
    list.classList.remove('hidden');
  } catch (err) {
    loading.classList.add('hidden');
    var errEl = document.getElementById('aircraft-docs-error');
    errEl.textContent = err.error || err.message || 'Failed to load documents';
    errEl.classList.add('visible');
  }
}

async function submitAircraftDocument(e) {
  e.preventDefault();
  var errEl = document.getElementById('aircraft-docs-error');
  var btn = document.getElementById('aircraft-doc-upload-btn');
  var fileInput = document.getElementById('aircraft-doc-file');
  errEl.classList.remove('visible');
  errEl.textContent = '';
  if (!_aircraftDocsAircraftId) {
    errEl.textContent = 'No aircraft selected — close and reopen the Docs modal.';
    errEl.classList.add('visible');
    return;
  }
  if (!canUploadAircraftDocs()) {
    errEl.textContent = 'Only owners and admins can upload aircraft documents.';
    errEl.classList.add('visible');
    return;
  }
  if (!fileInput.files || !fileInput.files[0]) {
    errEl.textContent = 'Please choose a file';
    errEl.classList.add('visible');
    return;
  }
  var file = fileInput.files[0];
  if (file.size > 12 * 1024 * 1024) {
    errEl.textContent = 'File too large (max 12 MB)';
    errEl.classList.add('visible');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    var payload = {
      doc_type: document.getElementById('aircraft-doc-type').value,
      title: document.getElementById('aircraft-doc-title').value.trim() || null,
      expiry_date: document.getElementById('aircraft-doc-expiry').value || null,
      notes: document.getElementById('aircraft-doc-notes').value.trim() || null,
      file_name: file.name,
      file_data: await readFileBase64(file),
    };
    await api('/api/aircraft/' + _aircraftDocsAircraftId + '/documents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    document.getElementById('aircraft-docs-upload-form').reset();
    showToast('Document uploaded', 'success');
    await loadAircraftDocsList();
  } catch (err) {
    errEl.textContent = err.error || err.message || 'Upload failed';
    errEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload to this aircraft';
  }
}

async function deleteAircraftDocument(docId) {
  if (!_aircraftDocsAircraftId || !canUploadAircraftDocs()) return;
  if (!confirm('Delete this document?')) return;
  try {
    await api('/api/aircraft/' + _aircraftDocsAircraftId + '/documents/' + docId, { method: 'DELETE' });
    showToast('Document removed', 'success');
    await loadAircraftDocsList();
  } catch (err) {
    showToast(err.error || err.message || 'Delete failed', 'error');
  }
}

window.openAircraftDocsModal = openAircraftDocsModal;
window.closeAircraftDocsModal = closeAircraftDocsModal;
window.submitAircraftDocument = submitAircraftDocument;
window.deleteAircraftDocument = deleteAircraftDocument;

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

async function ensurePushServiceWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers not supported in this browser');
  var reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }
  return navigator.serviceWorker.ready;
}

async function enablePushNotifications() {
  try {
    if (!window.isSecureContext) {
      showToast('Push requires a secure (HTTPS) connection', 'error');
      return;
    }
    if (!('PushManager' in window) || !('Notification' in window)) {
      showToast('Push notifications are not supported in this browser', 'error');
      return;
    }

    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isIOS && !standalone) {
      showToast('Add the app to your home screen first, then enable push from the installed app', 'error');
      return;
    }

    // Request permission immediately while the click gesture is still active
    var perm = Notification.permission;
    if (perm === 'default') {
      perm = await Notification.requestPermission();
    }
    if (perm !== 'granted') {
      showToast(
        perm === 'denied'
          ? 'Notifications blocked — enable them in your browser settings for this site'
          : 'Notification permission was not granted',
        'error'
      );
      return;
    }

    var reg = await ensurePushServiceWorker();

    var existing = await reg.pushManager.getSubscription();
    if (existing) {
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: existing.toJSON() }) });
      updatePushStatusUI(true);
      showToast('Push notifications enabled', 'success');
      return;
    }

    var keyData = await api('/api/push/vapid-public-key');
    if (!keyData.publicKey) {
      showToast('Push notifications are not configured on the server', 'error');
      return;
    }

    var sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
    });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
    updatePushStatusUI(true);
    showToast('Push notifications enabled', 'success');
  } catch (err) {
    console.error('[push] enable failed:', err);
    showToast(err.error || err.message || 'Failed to enable push notifications', 'error');
  }
}

async function disablePushNotifications() {
  try {
    var reg = await ensurePushServiceWorker();
    var sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    updatePushStatusUI(false);
  } catch (err) {
    console.error('[push] disable failed:', err);
    showToast(err.error || err.message || 'Failed to disable push', 'error');
  }
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
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    var reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return;
    reg = await navigator.serviceWorker.ready;
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
