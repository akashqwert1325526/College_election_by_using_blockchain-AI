/**
 * admin.js
 * College Voting System — Admin Dashboard Module
 */

// ─── Admin State ──────────────────────────────────────────────────────────────
const Admin = (() => {
  const ADMIN_PIN_KEY = 'cvs_admin_pin';
  const ELECTIONS_KEY = 'cvs_elections';
  const DEFAULT_PIN   = 'admin123';

  let _authenticated = false;
  let _resultsChart   = null;
  let _turnoutChart   = null;
  let _refreshInterval = null;

  // ── Persistence ────────────────────────────────────────────────────────────
  function loadElections() {
    try { return JSON.parse(localStorage.getItem(ELECTIONS_KEY)) || []; }
    catch (_) { return []; }
  }
  function saveElections(elections) {
    localStorage.setItem(ELECTIONS_KEY, JSON.stringify(elections));
  }

  function updateElectionStatuses() {
    const elections = loadElections();
    let changed = false;
    const now = new Date().getTime();

    elections.forEach(e => {
      const started = e.startTime ? new Date(e.startTime).getTime() <= now : false;
      const ended = e.endTime ? new Date(e.endTime).getTime() <= now : false;

      if (e.status === 'upcoming' && started && !ended) {
        e.status = 'active';
        e.activatedAt = new Date().toISOString();
        changed = true;
      } else if (e.status !== 'ended' && ended) {
        e.status = 'ended';
        e.endedAt = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) saveElections(elections);
  }

  function getActiveElections() {
    updateElectionStatuses();
    return loadElections().filter(e => e.status === 'active');
  }
  function getActiveElection() {
    return getActiveElections()[0] || null;
  }
  function getElectionById(id) {
    return loadElections().find(e => e.id === id) || null;
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  function initPin() {
    if (!localStorage.getItem(ADMIN_PIN_KEY)) {
      localStorage.setItem(ADMIN_PIN_KEY, DEFAULT_PIN);
    }
  }
  function verifyPin(pin) {
    return pin === localStorage.getItem(ADMIN_PIN_KEY);
  }
  function isAuthenticated() { return _authenticated; }
  function logout() {
    _authenticated = false;
    stopRefresh();
    App.navigate('landing');
    App.toast('Logged out', 'Admin session ended.', 'info');
  }

  // ── Login form ─────────────────────────────────────────────────────────────
  function bindLoginForm() {
    const form = document.getElementById('admin-login-form');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const pin = document.getElementById('admin-pin-input').value;
      if (verifyPin(pin)) {
        _authenticated = true;
        App.navigate('admin-dashboard');
        renderDashboard();
        App.toast('Welcome, Admin', 'Dashboard loaded.', 'success');
      } else {
        App.toast('Access Denied', 'Incorrect PIN.', 'error');
        document.getElementById('admin-pin-input').value = '';
      }
    };
  }

  // ── Render Dashboard ───────────────────────────────────────────────────────
  function renderDashboard() {
    renderStats();
    renderElectionsList();
    renderFraudLog();
    renderBlockExplorer();
    renderRegisteredVoters();
    startRefresh();
  }

  function renderStats() {
    const elections = loadElections();
    const activeElections = getActiveElections();
    const enrolled  = window.FaceEngine.getEnrolledCount();
    const blocks    = window.VoteChain.length;
    const totalVotes = activeElections.length
      ? activeElections.reduce((s, e) => s + window.VoteChain.getTotalVotes(e.id), 0)
      : elections.reduce((s, e) => s + window.VoteChain.getTotalVotes(e.id), 0);
    const fraudCount = window.FaceEngine.fraudLog.length;

    _set('stat-enrolled',   enrolled);
    _set('stat-total-votes', totalVotes);
    _set('stat-blocks',     blocks);
    _set('stat-fraud',      fraudCount);
    _set('stat-elections',  elections.length);
    _set('stat-active-election', activeElections.length === 1
      ? activeElections[0].title
      : activeElections.length > 1
        ? `${activeElections.length} active elections`
        : 'None');

    // Chain validity
    window.VoteChain.isChainValid().then(result => {
      const el = document.getElementById('stat-chain-valid');
      if (el) {
        el.textContent = result.valid ? '✓ Valid' : '✗ Tampered!';
        el.className = result.valid ? 'text-success' : 'text-danger';
      }
    });
  }

  // ── Elections CRUD ─────────────────────────────────────────────────────────
  function renderElectionsList() {
    const container = document.getElementById('elections-list');
    if (!container) return;
    updateElectionStatuses();
    const elections = loadElections();

    if (!elections.length) {
      container.innerHTML = `<div class="text-center text-secondary" style="padding:var(--sp-2xl) 0">
        <div style="font-size:2.5rem;margin-bottom:var(--sp-md)">🗳️</div>
        <p>No elections created yet.</p>
        <button class="btn btn-primary mt-md" onclick="Admin.openElectionModal()">Create First Election</button>
      </div>`;
      return;
    }

    container.innerHTML = elections.map(e => {
      const votes = window.VoteChain.getTotalVotes(e.id);
      const statusBadge = {
        active:   '<span class="badge badge-success">● Active</span>',
        upcoming: '<span class="badge badge-warning">◷ Upcoming</span>',
        ended:    '<span class="badge badge-muted">○ Ended</span>',
      }[e.status] || '<span class="badge badge-muted">Unknown</span>';

      return `
      <div class="block-card" style="margin-bottom:var(--sp-sm)">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-sm">
              <span class="fw-700">${_esc(e.title)}</span>
              ${statusBadge}
            </div>
            <div class="text-xs text-muted mt-sm">
              ID: <span class="mono">${e.id}</span> &nbsp;|&nbsp;
              ${e.candidates.length} candidates &nbsp;|&nbsp;
              ${votes} vote${votes !== 1 ? 's' : ''}
            </div>
            ${e.startTime || e.endTime ? `<div class="text-xs text-muted mt-sm">
              ${e.startTime ? `Starts: ${new Date(e.startTime).toLocaleString()}` : ''}
              ${e.startTime && e.endTime ? ' &nbsp;|&nbsp; ' : ''}
              ${e.endTime ? `Ends: ${new Date(e.endTime).toLocaleString()}` : ''}
            </div>` : ''}
          </div>
          <div class="flex gap-sm">
            ${e.status !== 'active' ? `<button class="btn btn-success btn-sm" onclick="Admin.activateElection('${e.id}')">Activate</button>` : `<button class="btn btn-danger btn-sm" onclick="Admin.endElection('${e.id}')">End</button>`}
            <button class="btn btn-outline btn-sm" onclick="Admin.deleteElection('${e.id}')">🗑</button>
          </div>
        </div>
        ${e.candidates.length ? `<div class="flex gap-sm mt-md flex-wrap">
          ${e.candidates.map(c => `<span class="badge badge-accent">${_esc(c.name)}</span>`).join('')}
        </div>` : ''}
      </div>`;
    }).join('');
  }

  // ── Election Modal ─────────────────────────────────────────────────────────
  function openElectionModal(editId = null) {
    const elections = loadElections();
    const edit = editId ? elections.find(e => e.id === editId) : null;

    document.getElementById('election-modal-title').textContent = edit ? 'Edit Election' : 'Create Election';
    document.getElementById('election-title-input').value  = edit ? edit.title : '';

    let startInput = document.getElementById('election-start-input');
    let endInput = document.getElementById('election-end-input');

    if (!startInput) {
      const titleGroup = document.getElementById('election-title-input').closest('.form-group');
      if (titleGroup) {
        const timeGrid = document.createElement('div');
        timeGrid.className = 'grid-2 mt-md mb-md';
        timeGrid.innerHTML = `
          <div class="form-group mb-0">
            <label class="form-label" for="election-start-input">Start Time (Optional)</label>
            <input type="datetime-local" id="election-start-input" class="form-input" />
          </div>
          <div class="form-group mb-0">
            <label class="form-label" for="election-end-input">End Time (Optional)</label>
            <input type="datetime-local" id="election-end-input" class="form-input" />
          </div>
        `;
        titleGroup.insertAdjacentElement('afterend', timeGrid);
        startInput = document.getElementById('election-start-input');
        endInput = document.getElementById('election-end-input');
      }
    }

    if (startInput) startInput.value = edit && edit.startTime ? edit.startTime : '';
    if (endInput) endInput.value = edit && edit.endTime ? edit.endTime : '';

    // Clear & repopulate candidates
    const cList = document.getElementById('candidates-list-input');
    cList.innerHTML = '';
    const candidates = edit ? edit.candidates : [{ name: '', party: '' }, { name: '', party: '' }];
    candidates.forEach((c, i) => addCandidateRow(c.name, c.party));

    document.getElementById('election-modal').dataset.editId = editId || '';
    document.getElementById('election-modal-backdrop').classList.add('open');
  }

  function addCandidateRow(name = '', party = '') {
    const cList = document.getElementById('candidates-list-input');
    const row = document.createElement('div');
    row.className = 'flex gap-sm mt-sm';
    row.innerHTML = `
      <input type="text" class="form-input candidate-name" placeholder="Candidate name" value="${_esc(name)}" />
      <input type="text" class="form-input candidate-party" placeholder="Party / role" value="${_esc(party)}" style="flex:0 0 40%" />
      <button type="button" class="btn btn-ghost btn-icon" onclick="this.parentElement.remove()">✕</button>
    `;
    cList.appendChild(row);
  }

  function saveElectionModal() {
    const title = document.getElementById('election-title-input').value.trim();
    if (!title) { App.toast('Error', 'Election title is required.', 'error'); return; }

    const startInput = document.getElementById('election-start-input');
    const endInput = document.getElementById('election-end-input');
    const startTime = startInput && startInput.value ? startInput.value : null;
    const endTime = endInput && endInput.value ? endInput.value : null;

    if (startTime && endTime && new Date(startTime) >= new Date(endTime)) {
      App.toast('Error', 'End time must be after start time.', 'error'); return;
    }

    const rows = document.querySelectorAll('#candidates-list-input > div');
    const candidates = [];
    rows.forEach(row => {
      const name  = row.querySelector('.candidate-name')?.value.trim();
      const party = row.querySelector('.candidate-party')?.value.trim();
      if (name) candidates.push({ id: _genId(), name, party: party || 'Independent' });
    });
    if (candidates.length < 2) { App.toast('Error', 'Add at least 2 candidates.', 'error'); return; }

    const elections = loadElections();
    const editId    = document.getElementById('election-modal').dataset.editId;

    if (editId) {
      const idx = elections.findIndex(e => e.id === editId);
      if (idx !== -1) {
        elections[idx].title = title;
        elections[idx].candidates = candidates;
        elections[idx].startTime = startTime;
        elections[idx].endTime = endTime;
      }
    } else {
      elections.push({
        id: _genId(),
        title,
        candidates,
        startTime,
        endTime,
        status: 'upcoming',
        createdAt: new Date().toISOString(),
      });
    }

    saveElections(elections);
    updateElectionStatuses();
    closeElectionModal();
    renderElectionsList();
    App.toast('Saved', 'Election saved successfully.', 'success');
  }

  function closeElectionModal() {
    document.getElementById('election-modal-backdrop').classList.remove('open');
  }

  function activateElection(id) {
    const elections = loadElections();
    const el = elections.find(e => e.id === id);
    if (el) {
      el.status = 'active';
      el.activatedAt = new Date().toISOString();
      saveElections(elections);
      renderElectionsList();
      App.toast('Election Active', `"${el.title}" is now live!`, 'success');
      // Update voter view
      if (typeof renderVoterView === 'function') renderVoterView();
    }
  }

  function endElection(id) {
    const elections = loadElections();
    const el = elections.find(e => e.id === id);
    if (el) { el.status = 'ended'; el.endedAt = new Date().toISOString(); }
    saveElections(elections);
    renderElectionsList();
    App.toast('Election Ended', `"${el?.title}" has been closed.`, 'info');
  }

  function deleteElection(id) {
    if (!confirm('Delete this election? This cannot be undone.')) return;
    const elections = loadElections().filter(e => e.id !== id);
    saveElections(elections);
    renderElectionsList();
    App.toast('Deleted', 'Election removed.', 'warning');
  }

  // ── Results Charts ─────────────────────────────────────────────────────────
  function renderResultsCharts() {
    const active = getActiveElection();
    const container = document.getElementById('results-chart-section');
    if (!container) return;

    if (!active) {
      container.innerHTML = '<p class="text-secondary text-center">No active election.</p>';
      return;
    }

    const tally   = window.VoteChain.getResults(active.id);
    const labels  = active.candidates.map(c => c.name);
    const data    = active.candidates.map(c => tally[c.id] || 0);
    const total   = data.reduce((s, v) => s + v, 0);

    // Winner highlight
    const maxVotes = Math.max(...data);
    const winnerIdx = data.indexOf(maxVotes);
    const winnerEl  = document.getElementById('results-winner');
    if (winnerEl && total > 0) {
      winnerEl.innerHTML = `
        <div class="alert alert-success">
          🏆 <strong>${_esc(active.candidates[winnerIdx]?.name)}</strong> leads with ${maxVotes} vote${maxVotes!==1?'s':''}
          (${total ? Math.round((maxVotes/total)*100) : 0}%)
        </div>`;
    } else if (winnerEl) {
      winnerEl.innerHTML = '<div class="alert alert-info">ℹ️ No votes cast yet.</div>';
    }

    // Total votes
    _set('results-total-votes', total);
    _set('results-election-title', active.title);

    // Chart
    const ctx = document.getElementById('results-bar-chart');
    if (!ctx) return;

    if (_resultsChart) _resultsChart.destroy();

    const colors = [
      'rgba(139,92,246,0.9)',
      'rgba(0,217,255,0.85)',
      'rgba(16,185,129,0.85)',
      'rgba(245,158,11,0.85)',
      'rgba(244,63,94,0.85)',
      'rgba(59,130,246,0.85)',
    ];

    _resultsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Votes',
          data,
          backgroundColor: colors.slice(0, labels.length),
          borderColor: colors.map(c => c.replace('0.85', '1')).slice(0, labels.length),
          borderWidth: 2,
          borderRadius: 8,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: ctx => `${total ? Math.round((ctx.raw/total)*100) : 0}% of votes`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: '#94a3b8' },
            grid: { color: 'rgba(255,255,255,.05)' },
          },
          x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
        }
      }
    });

    // Candidate result rows
    const rowsContainer = document.getElementById('candidate-result-rows');
    if (rowsContainer) {
      rowsContainer.innerHTML = active.candidates.map((c, i) => {
        const v = tally[c.id] || 0;
        const pct = total ? Math.round((v/total)*100) : 0;
        return `<div class="candidate-card" style="cursor:default;pointer-events:none;text-align:left;padding:var(--sp-md) var(--sp-lg)">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-md">
              <div class="candidate-avatar" style="width:44px;height:44px;font-size:1rem">${c.name[0]}</div>
              <div>
                <div class="fw-700">${_esc(c.name)}</div>
                <div class="text-xs text-muted">${_esc(c.party)}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="fw-700 text-accent">${v} vote${v!==1?'s':''}</div>
              <div class="text-xs text-muted">${pct}%</div>
            </div>
          </div>
          <div class="progress-bar mt-sm">
            <div class="progress-fill" style="width:${pct}%;background:${colors[i % colors.length]}"></div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ── Fraud Log ──────────────────────────────────────────────────────────────
  function renderFraudLog() {
    const container = document.getElementById('fraud-log-table-body');
    if (!container) return;
    const log = window.FaceEngine.fraudLog;

    _set('fraud-count-badge', log.length);

    if (!log.length) {
      container.innerHTML = `<tr><td colspan="4" class="text-center text-secondary" style="padding:var(--sp-xl)">
        ✅ No fraud attempts recorded.
      </td></tr>`;
      return;
    }

    container.innerHTML = log.slice(0, 50).map(entry => `
      <tr>
        <td>${new Date(entry.timestamp).toLocaleString()}</td>
        <td><span class="mono text-xs">${_esc(entry.suspectedStudentId)}</span></td>
        <td><span class="badge badge-danger">${_esc(entry.type)}</span></td>
        <td>${entry.distance}</td>
      </tr>
    `).join('');
  }

  // ── Block Explorer ─────────────────────────────────────────────────────────
  function renderBlockExplorer() {
    const container = document.getElementById('block-explorer-list');
    if (!container) return;
    const chain = [...window.VoteChain.chain].reverse();

    container.innerHTML = chain.map(block => {
      const isGenesis = block.index === 0;
      const isVote    = block.data.type === 'VOTE';
      const hashShort = block.hash.slice(0, 12) + '…' + block.hash.slice(-6);
      const prevShort = block.previousHash.slice(0, 12) + '…' + block.previousHash.slice(-6);

      return `
      <div class="block-card" style="margin-bottom:var(--sp-sm)">
        <div class="block-header">
          <span class="block-index">Block #${block.index}</span>
          <div class="flex gap-sm items-center">
            ${isGenesis ? '<span class="badge badge-primary">Genesis</span>' : ''}
            ${isVote    ? '<span class="badge badge-accent">Vote</span>'    : ''}
            <span class="text-xs text-muted mono">Nonce: ${block.nonce}</span>
          </div>
        </div>
        <div class="text-xs text-muted mb-md">${new Date(block.timestamp).toLocaleString()}</div>
        <div class="block-hash"><span class="text-xs text-muted">Hash: </span><span class="hash-highlight">${hashShort}</span></div>
        <div class="block-hash mt-sm"><span class="text-xs text-muted">Prev: </span>${prevShort}</div>
        ${isVote ? `
        <div class="mt-md flex gap-sm flex-wrap">
          <span class="badge badge-muted">Candidate: ${_esc(block.data.candidateId)}</span>
          <span class="badge badge-muted">Election: ${block.data.electionId?.slice(0,8)}</span>
        </div>` : ''}
      </div>`;
    }).join('');

    _set('block-count-badge', window.VoteChain.length);
  }

  // ── Registered Voters ──────────────────────────────────────────────────────
  function renderRegisteredVoters() {
    const container = document.getElementById('voters-table-body');
    if (!container) return;
    const students = window.FaceEngine.getAllStudents();
    let duplicateGroups = [];
    let auditError = null;
    try {
      duplicateGroups = window.FaceEngine.getDuplicateFaceGroups();
    } catch (err) {
      auditError = err;
      console.error('Duplicate voter audit failed:', err);
    }
    const duplicateIds = new Set(duplicateGroups.flat());

    _set('voters-count-badge', students.length);
    _set('voter-summary-total', students.length);
    _set('voter-summary-duplicates', duplicateGroups.length);
    _set('voter-summary-status', auditError ? 'Audit Error' : duplicateGroups.length ? 'Review Needed' : 'Clear');
    _set('voter-summary-updated', `Updated ${new Date().toLocaleTimeString()}`);
    _set('voters-count-badge-header', duplicateGroups.length
      ? `${students.length} enrolled • ${duplicateGroups.length} duplicate face group${duplicateGroups.length !== 1 ? 's' : ''}`
      : `${students.length} enrolled`);

    if (!students.length) {
      container.innerHTML = `<tr><td colspan="4">
        <div class="voters-empty">
          <div class="voters-empty-icon">ID</div>
          <strong>No registered voters</strong>
          <span>Enrolled students will appear here after face registration.</span>
        </div>
      </td></tr>`;
      return;
    }

    const auditWarning = auditError ? `
      <tr>
        <td colspan="4">
          <div class="alert alert-warning">
            Could not verify duplicate faces right now. Registered voters are shown below.
          </div>
        </td>
      </tr>
    ` : '';

    const duplicateWarning = duplicateGroups.length ? `
      <tr>
        <td colspan="4">
          <div class="alert alert-danger">
            Duplicate face records found: ${duplicateGroups
              .map(group => group.map(id => `<span class="mono text-xs">${_esc(id)}</span>`).join(' / '))
              .join(', ')}. Remove duplicate voter records before voting.
          </div>
        </td>
      </tr>
    ` : '';

    container.innerHTML = auditWarning + duplicateWarning + students.map(s => `
      <tr>
        <td>
          <div class="voter-id-cell">
            <span class="voter-avatar">${_esc(s.studentId).slice(0, 2).toUpperCase()}</span>
            <div>
              <span class="mono text-xs voter-id">${_esc(s.studentId)}</span>
              <span class="text-xs text-muted">Face descriptor stored locally</span>
            </div>
          </div>
        </td>
        <td>
          ${duplicateIds.has(s.studentId)
            ? '<span class="badge badge-danger">Duplicate Face</span>'
            : '<span class="badge badge-success">Verified Unique</span>'}
        </td>
        <td>${new Date(s.enrolledAt).toLocaleString()}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="Admin.removeVoter('${_esc(s.studentId)}')">Remove</button>
        </td>
      </tr>
    `).join('');
  }

  function removeVoter(studentId) {
    if (!confirm(`Remove ${studentId}? Their face data will be deleted.`)) return;
    window.FaceEngine.removeStudent(studentId);
    renderRegisteredVoters();
    renderStats();
    App.toast('Removed', `Student ${studentId} removed.`, 'warning');
  }

  // ── Chain Validation ───────────────────────────────────────────────────────
  async function validateChain() {
    const result = await window.VoteChain.isChainValid();
    const el = document.getElementById('chain-validation-result');
    if (!el) return;
    if (result.valid) {
      el.innerHTML = '<div class="alert alert-success">✓ Blockchain integrity verified — all blocks are valid.</div>';
    } else {
      el.innerHTML = `<div class="alert alert-danger">⚠ Chain tampered at block #${result.failedAt}: ${result.reason}</div>`;
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  function exportResults() {
    const active = getActiveElection();
    if (!active) { App.toast('No active election', 'Nothing to export.', 'warning'); return; }
    const tally  = window.VoteChain.getResults(active.id);
    
    if (!window.jspdf) {
      App.toast('Error', 'PDF library not loaded.', 'error');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text('Election Results Report', 14, 22);

    doc.setFontSize(12);
    doc.text(`Title: ${active.title}`, 14, 32);
    doc.text(`Status: ${active.status}`, 14, 40);
    doc.text(`Exported at: ${new Date().toLocaleString()}`, 14, 48);

    const tableData = active.candidates.map(c => [
      c.name,
      c.party || 'Independent',
      tally[c.id] || 0
    ]);

    doc.autoTable({
      startY: 55,
      head: [['Candidate Name', 'Party', 'Votes']],
      body: tableData,
    });

    doc.save(`election-results-${active.id.slice(0,8)}.pdf`);
    App.toast('Exported', 'Results downloaded as PDF.', 'success');
  }

  // ── System Reset ───────────────────────────────────────────────────────────
  function resetSystem() {
    if (!confirm('⚠ This will ERASE all data: blockchain, face data, elections, fraud logs. Are you sure?')) return;
    if (!confirm('Last warning: ALL data will be permanently deleted. Confirm?')) return;
    window.VoteChain.reset();
    window.FaceEngine.reset();
    localStorage.removeItem(ELECTIONS_KEY);
    window.VoteChain.init().then(() => {
      renderDashboard();
      App.toast('System Reset', 'All data cleared. Fresh start.', 'info');
    });
  }

  // ── Auto Refresh ───────────────────────────────────────────────────────────
  function startRefresh() {
    stopRefresh();
    _refreshInterval = setInterval(() => {
      const activeView = document.querySelector('.view.active');
      if (!activeView) return;
      const id = activeView.id;
      if (id === 'view-admin-dashboard') { renderStats(); }
      if (id === 'view-admin-results')   { renderResultsCharts(); }
      if (id === 'view-admin-explorer')  { renderBlockExplorer(); }
    }, 4000);
  }
  function stopRefresh() {
    if (_refreshInterval) { clearInterval(_refreshInterval); _refreshInterval = null; }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init:                initPin,
    bindLoginForm,
    renderDashboard,
    renderStats,
    renderResultsCharts,
    renderFraudLog,
    renderBlockExplorer,
    renderRegisteredVoters,
    validateChain,
    exportResults,
    resetSystem,
    openElectionModal,
    addCandidateRow,
    saveElectionModal,
    closeElectionModal,
    activateElection,
    endElection,
    deleteElection,
    removeVoter,
    logout,
    isAuthenticated,
    getActiveElections,
    getActiveElection,
    getElectionById,
    loadElections,
    updateElectionStatuses,
  };
})();

window.Admin = Admin;
