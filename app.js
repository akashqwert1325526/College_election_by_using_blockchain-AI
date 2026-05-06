/**
 * app.js
 * College Voting System — Core Application Logic
 * Router · State Machine · Orchestration · Toast · Camera
 */

// ─── App State ────────────────────────────────────────────────────────────────
const App = (() => {

  let _currentView     = 'landing';
  let _stream          = null;  // active MediaStream
  let _cameraEl        = null;  // active <video>
  let _enrollStudentId = '';
  let _verifiedStudent = null;  // student verified in current voting session

  // ── Router ─────────────────────────────────────────────────────────────────
  function navigate(viewId, opts = {}) {
    const current = document.getElementById(`view-${_currentView}`);
    const next    = document.getElementById(`view-${viewId}`);
    if (!next) return console.warn(`View not found: view-${viewId}`);

    // Stop any running cameras when leaving
    stopCamera();

    if (current) current.classList.remove('active');
    next.classList.add('active');
    _currentView = viewId;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === viewId);
    });

    // Close mobile sidebar
    closeSidebar();

    // Lifecycle hooks
    on_enter(viewId, opts);
    window.scrollTo(0, 0);
  }

  function on_enter(viewId, opts) {
    switch (viewId) {
      case 'admin-login':
        Admin.bindLoginForm();
        break;

      case 'admin-dashboard':
        if (!Admin.isAuthenticated()) { navigate('admin-login'); return; }
        Admin.renderDashboard();
        break;

      case 'admin-results':
        if (!Admin.isAuthenticated()) { navigate('admin-login'); return; }
        Admin.renderResultsCharts();
        break;

      case 'admin-explorer':
        if (!Admin.isAuthenticated()) { navigate('admin-login'); return; }
        Admin.renderBlockExplorer();
        break;

      case 'admin-fraud':
        if (!Admin.isAuthenticated()) { navigate('admin-login'); return; }
        Admin.renderFraudLog();
        break;

      case 'admin-voters':
        if (!Admin.isAuthenticated()) { navigate('admin-login'); return; }
        Admin.renderRegisteredVoters();
        break;

      case 'register':
        renderRegisterView();
        break;

      case 'vote':
        renderVoteView();
        break;

      case 'results':
        renderPublicResults();
        break;
    }
  }

  // ── Camera Utilities ────────────────────────────────────────────────────────
  async function startCamera(videoEl, opts = {}) {
    stopCamera();
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          ...opts,
        }
      });
      videoEl.srcObject = _stream;
      await videoEl.play();
      _cameraEl = videoEl;
      return true;
    } catch (err) {
      toast('Camera Error', err.message, 'error');
      return false;
    }
  }

  function stopCamera() {
    if (_stream) {
      _stream.getTracks().forEach(t => t.stop());
      _stream = null;
    }
    if (_cameraEl) {
      _cameraEl.srcObject = null;
      _cameraEl = null;
    }
  }

  // ── Registration View ───────────────────────────────────────────────────────
  function renderRegisterView() {
    const content = document.getElementById('register-content');
    if (!content) return;

    // Reset state
    content.innerHTML = `
      <div class="grid-2" style="gap:var(--sp-xl);align-items:start;">
        <div>
          <div class="camera-container" id="reg-cam-container">
            <video id="reg-video" autoplay muted playsinline></video>
            <div class="scan-line"></div>
            <div class="camera-corners">
              <span class="corner-tl"></span>
              <span class="corner-tr"></span>
            </div>
            <div class="camera-overlay"><div class="face-guide" id="reg-face-guide"></div></div>
            <div class="camera-status">
              <div class="status-dot"></div>
              <span id="reg-cam-status">Starting camera…</span>
            </div>
          </div>
        </div>
        <div>
          <h3 class="mb-lg">Student Enrollment</h3>

          <div class="form-group">
            <label class="form-label" for="reg-student-id">Student ID</label>
            <input type="text" id="reg-student-id" class="form-input" placeholder="e.g. CS2021001" />
          </div>
          <div class="form-group">
            <label class="form-label" for="reg-student-name">Full Name (optional)</label>
            <input type="text" id="reg-student-name" class="form-input" placeholder="e.g. Rahul Sharma" />
          </div>

          <div class="card sm mt-md" style="margin-bottom:var(--sp-md)">
            <p class="text-sm fw-600 mb-md">Face Capture Progress</p>
            <div class="enroll-dots" id="enroll-dots">
              ${Array(5).fill(0).map((_,i) => `<div class="enroll-dot" id="dot-${i}"></div>`).join('')}
              <span class="text-muted text-xs" style="margin-left:auto;align-self:center" id="enroll-count">0 / 5</span>
            </div>
            <div class="progress-bar mt-md">
              <div class="progress-fill" id="enroll-progress" style="width:0%"></div>
            </div>
          </div>

          <div id="enroll-status-msg" class="mt-md hidden"></div>

          <button id="reg-start-btn" class="btn btn-primary btn-full mt-md" onclick="App.startEnrollment()">
            🎭 Start Face Enrollment
          </button>
          <button id="reg-cancel-btn" class="btn btn-ghost btn-full mt-sm hidden" onclick="App.cancelEnrollment()">
            Cancel
          </button>
        </div>
      </div>
    `;

    // Start camera
    const videoEl = document.getElementById('reg-video');
    startCamera(videoEl).then(ok => {
      if (ok) {
        document.getElementById('reg-cam-status').textContent = 'Position your face in the oval ↑';
        document.getElementById('reg-cam-container').classList.add('scanning');
      }
    });
  }

  let _enrollActive = false;
  let _selectedActiveElectionId = null;

  async function startEnrollment() {
    const studentId = document.getElementById('reg-student-id')?.value.trim();
    if (!studentId) { toast('Required', 'Enter your Student ID first.', 'warning'); return; }

    if (window.FaceEngine.isEnrolled(studentId)) {
      toast('Already Registered', `${studentId} is already enrolled.`, 'warning');
      return;
    }

    _enrollStudentId = studentId;
    _enrollActive = true;

    const btn = document.getElementById('reg-start-btn');
    const cancel = document.getElementById('reg-cancel-btn');
    if (btn) btn.disabled = true;
    if (cancel) cancel.classList.remove('hidden');

    document.getElementById('reg-student-id').disabled = true;
    document.getElementById('reg-cam-status').textContent = 'Capturing face… stay still';

    setGuideState('scanning');

    // Load models
    try {
      await window.FaceEngine.loadModels(msg => {
        const el = document.getElementById('reg-cam-status');
        if (el) el.textContent = msg;
      });
    } catch (err) {
      toast('Model Error', err.message, 'error');
      cancelEnrollment();
      return;
    }

    const videoEl = document.getElementById('reg-video');
    try {
      await window.FaceEngine.enrollFace(studentId, videoEl, (captured, total) => {
        if (!_enrollActive) return;
        for (let i = 0; i < total; i++) {
          const dot = document.getElementById(`dot-${i}`);
          if (!dot) continue;
          if (i < captured) dot.className = 'enroll-dot captured';
          else if (i === captured) dot.className = 'enroll-dot active';
          else dot.className = 'enroll-dot';
        }
        const count = document.getElementById('enroll-count');
        if (count) count.textContent = `${captured} / ${total}`;
        const progress = document.getElementById('enroll-progress');
        if (progress) progress.style.width = `${(captured / total) * 100}%`;
        const stat = document.getElementById('reg-cam-status');
        if (stat) stat.textContent = `Capturing frame ${captured} of ${total}…`;
      });

      // Success!
      setGuideState('success');
      document.getElementById('reg-cam-status').textContent = '✓ Face enrolled successfully!';
      toast('Enrolled!', `${studentId} registered. You can now vote.`, 'success');
      updateHeroStats();

      const statusMsg = document.getElementById('enroll-status-msg');
      if (statusMsg) {
        statusMsg.className = 'alert alert-success mt-md';
        statusMsg.innerHTML = `✓ <strong>${studentId}</strong> registered successfully. Proceed to vote.`;
        statusMsg.classList.remove('hidden');
      }

      if (btn) { btn.textContent = '✓ Enrolled — Go Vote'; btn.disabled = false; btn.onclick = () => navigate('vote'); }
      if (cancel) cancel.classList.add('hidden');

    } catch (err) {
      _enrollActive = false;
      setGuideState('fail');
      const msg = err.message === 'ENROLLMENT_TIMEOUT' ? 'Could not detect face — check lighting.' :
                  err.message === 'ALREADY_ENROLLED'   ? 'Already enrolled.'                        :
                  err.message === 'LIVENESS_FAILED'    ? 'Face verification failed. Please face the camera clearly and try again.' :
                  err.message === 'FACE_ALREADY_ENROLLED'
                    ? `This face is already registered as ${err.studentId || 'another student'}.` :
                  err.message;
      toast('Enrollment Failed', msg, 'error');
      const statusMsg = document.getElementById('enroll-status-msg');
      if (statusMsg) {
        statusMsg.className = 'alert alert-danger mt-md';
        statusMsg.textContent = `✗ ${msg}`;
        statusMsg.classList.remove('hidden');
      }
      if (btn) { btn.disabled = false; btn.textContent = '🎭 Try Again'; }
      if (cancel) cancel.classList.add('hidden');
    }

    _enrollActive = false;
  }

  function cancelEnrollment() {
    _enrollActive = false;
    const btn = document.getElementById('reg-start-btn');
    if (btn) { btn.disabled = false; btn.textContent = '🎭 Start Face Enrollment'; }
    const cancel = document.getElementById('reg-cancel-btn');
    if (cancel) cancel.classList.add('hidden');
    const sid = document.getElementById('reg-student-id');
    if (sid) sid.disabled = false;
    setGuideState('');
    document.getElementById('reg-cam-status').textContent = 'Position your face in the oval ↑';
  }

  function setGuideState(state) {
    const guide = document.getElementById('reg-face-guide');
    if (!guide) return;
    guide.className = 'face-guide' + (state ? ` ${state}` : '');
  }

  // ── Voting View ─────────────────────────────────────────────────────────────
  function renderVoteView() {
    const content = document.getElementById('vote-content');
    if (!content) return;
    const activeElections = Admin.getActiveElections();

    if (!activeElections.length) {
      content.innerHTML = `<div class="card text-center" style="padding:var(--sp-3xl)">
        <div style="font-size:3rem;margin-bottom:var(--sp-md)">🗳️</div>
        <h3>No Active Election</h3>
        <p class="text-secondary mt-md">An admin must start an election before voting can begin.</p>
      </div>`;
      return;
    }

    if (!_selectedActiveElectionId || !activeElections.some(e => e.id === _selectedActiveElectionId)) {
      _selectedActiveElectionId = activeElections[0].id;
    }

    const active = Admin.getElectionById(_selectedActiveElectionId) || activeElections[0];
    const electionSelector = activeElections.length > 1 ? `
      <div class="card sm mb-md">
        <label class="form-label" for="active-election-select">Active Election</label>
        <select id="active-election-select" class="form-input">
          ${activeElections.map(e => `
            <option value="${e.id}" ${e.id === active.id ? 'selected' : ''}>
              ${_esc(e.title)}
            </option>
          `).join('')}
        </select>
      </div>
    ` : '';

    content.innerHTML = `
      <div id="vote-phase-verify">
        <h3 class="mb-lg">Step 1 — Face Verification</h3>
        <div class="grid-2" style="gap:var(--sp-xl);align-items:start">
          <div>
            <div class="camera-container" id="vote-cam-container">
              <video id="vote-video" autoplay muted playsinline></video>
              <div class="scan-line"></div>
              <div class="camera-corners">
                <span class="corner-tl"></span>
                <span class="corner-tr"></span>
              </div>
              <div class="camera-overlay"><div class="face-guide" id="vote-face-guide"></div></div>
              <div class="camera-status">
                <div class="status-dot"></div>
                <span id="vote-cam-status">Starting camera…</span>
              </div>
            </div>
          </div>
          <div>
            <div class="card sm">
              <h4 class="mb-md">🗳️ ${_esc(active.title)}</h4>
              <p class="text-secondary text-sm">${active.candidates.length} candidates</p>
            </div>
            ${electionSelector}
            <div class="card sm mt-md">
              <p class="fw-600 mb-sm">How it works</p>
              <ol style="padding-left:1.2em;color:var(--txt-secondary);font-size:.85rem;line-height:2">
                <li>Position your face in the oval</li>
                <li>System checks liveness (open eyes)</li>
                <li>Matches your face against enrolled data</li>
                <li>If matched → proceed to vote</li>
              </ol>
            </div>
            <div id="verify-status-msg" class="mt-md hidden"></div>
            <button id="verify-btn" class="btn btn-accent btn-full mt-lg" onclick="App.runVerification()">
              👁 Scan Face & Verify
            </button>
          </div>
        </div>
      </div>

      <div id="vote-phase-cast" class="hidden">
        <h3 class="mb-md">Step 2 — Cast Your Vote</h3>
        <div class="flex items-center gap-sm mb-xl">
          <span id="voter-identity-badge" class="badge badge-success">✓ Verified</span>
          <span class="text-secondary text-sm">Voting as: <strong id="vote-student-id-display"></strong></span>
        </div>
        <p class="text-secondary mb-xl">Select your candidate and confirm. <strong>Your vote is final and cannot be changed.</strong></p>
        <div class="candidates-grid" id="vote-candidates-grid"></div>
        <div class="mt-xl flex gap-md justify-between items-center">
          <div id="vote-selected-info" class="text-secondary text-sm">No candidate selected</div>
          <button id="cast-vote-btn" class="btn btn-primary btn-lg" onclick="App.castVote()" disabled>
            🔗 Cast Vote on Blockchain
          </button>
        </div>
      </div>

      <div id="vote-phase-success" class="hidden">
        <div class="verify-result" style="min-height:60vh">
          <div class="verify-icon">🎉</div>
          <h2 class="gradient-text">Vote Cast!</h2>
          <p class="text-secondary">Your vote has been permanently recorded on the blockchain.</p>
          <div class="card sm mt-lg" style="max-width:400px;width:100%">
            <div class="text-xs text-muted mb-sm">Block Hash</div>
            <div class="block-hash" id="vote-block-hash"></div>
            <div class="text-xs text-muted mt-md mb-sm">Nonce (Proof of Work)</div>
            <div class="mono text-sm" id="vote-block-nonce"></div>
          </div>
          <div class="flex gap-md mt-xl">
            <button class="btn btn-outline" onclick="App.navigate('results')">View Results</button>
            <button class="btn btn-ghost" onclick="App.navigate('landing')">Home</button>
          </div>
        </div>
      </div>
    `;

    const select = document.getElementById('active-election-select');
    if (select) {
      select.onchange = (event) => App.selectActiveElection(event.target.value);
    }

    // Start camera for verification
    const videoEl = document.getElementById('vote-video');
    startCamera(videoEl).then(ok => {
      if (ok) {
        document.getElementById('vote-cam-status').textContent = 'Position your face in the oval ↑';
        document.getElementById('vote-cam-container').classList.add('scanning');
      }
    });

    // Populate candidate cards
    renderCandidateCards(active);
  }

  let _selectedCandidateId = null;

  function renderCandidateCards(election) {
    _selectedCandidateId = null;
    const grid = document.getElementById('vote-candidates-grid');
    if (!grid) return;

    grid.innerHTML = election.candidates.map(c => `
      <div class="candidate-card" id="ccard-${c.id}" onclick="App.selectCandidate('${c.id}', '${_esc(c.name)}')">
        <div class="candidate-avatar">${c.name[0]}</div>
        <div class="candidate-name">${_esc(c.name)}</div>
        <div class="candidate-party">${_esc(c.party)}</div>
      </div>
    `).join('');
  }

  function selectCandidate(candidateId, name) {
    _selectedCandidateId = candidateId;
    document.querySelectorAll('.candidate-card').forEach(el => {
      el.classList.toggle('selected', el.id === `ccard-${candidateId}`);
    });
    const info = document.getElementById('vote-selected-info');
    if (info) info.innerHTML = `Selected: <strong>${_esc(name)}</strong>`;
    const btn = document.getElementById('cast-vote-btn');
    if (btn) btn.disabled = false;
  }

  function selectActiveElection(id) {
    _selectedActiveElectionId = id;
    renderVoteView();
  }

  // ── Face Verification Flow ──────────────────────────────────────────────────
  let _verifying = false;
  async function runVerification() {
    if (_verifying) return;
    _verifying = true;

    const btn = document.getElementById('verify-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Scanning…'; }

    const guide = document.getElementById('vote-face-guide');
    if (guide) guide.className = 'face-guide scanning';

    const statusMsg = document.getElementById('verify-status-msg');

    try {
      // Load models first
      await window.FaceEngine.loadModels(msg => {
        document.getElementById('vote-cam-status').textContent = msg;
      });

      document.getElementById('vote-cam-status').textContent = 'Checking liveness…';
      const videoEl = document.getElementById('vote-video');
      const result  = await window.FaceEngine.verifyFace(videoEl);

      if (result.matched) {
        // Check if already voted
        const active = Admin.getElectionById(_selectedActiveElectionId) || Admin.getActiveElection();
        if (!active) {
          throw new Error('No active election selected.');
        }
        const voterHash = await sha256(result.studentId + active.id);

        if (window.VoteChain.hasVoted(voterHash, active.id)) {
          if (guide) guide.className = 'face-guide fail';
          showVerifyStatus('error', `⚠ <strong>${result.studentId}</strong> has already voted in this election.`);
          toast('Already Voted', 'One student, one vote.', 'warning');
        } else {
          // SUCCESS
          if (guide) guide.className = 'face-guide success';
          _verifiedStudent = { studentId: result.studentId, confidence: result.confidence, voterHash };
          document.getElementById('vote-cam-status').textContent = `✓ Verified (${result.confidence}% match)`;
          toast('Identity Verified', `Welcome, ${result.studentId}`, 'success');

          await _sleep(800);
          stopCamera();

          // Switch to cast phase
          document.getElementById('vote-phase-verify').classList.add('hidden');
          const castPhase = document.getElementById('vote-phase-cast');
          castPhase.classList.remove('hidden');
          document.getElementById('vote-student-id-display').textContent = result.studentId;
        }
      } else {
        if (guide) guide.className = 'face-guide fail';
        const reasons = {
          LIVENESS_FAILED:    'Liveness check failed — please blink naturally and try again.',
          NO_FACE_DETECTED:   'No face detected — ensure good lighting and face the camera.',
          FACE_NOT_RECOGNIZED:'Face not recognized — are you registered?',
          DUPLICATE_FACE_RECORD:'This face is registered under multiple Student IDs. Ask admin to remove duplicate voter records.',
        };
        const msg = reasons[result.reason] || 'Verification failed.';
        showVerifyStatus('error', `✗ ${msg}`);
        document.getElementById('vote-cam-status').textContent = 'Verification failed';
        toast('Verification Failed', msg, 'error');

        setTimeout(() => {
          if (guide) guide.className = 'face-guide';
          if (btn) { btn.disabled = false; btn.textContent = '👁 Scan Face & Verify'; }
        }, 2000);
      }

    } catch (err) {
      showVerifyStatus('error', `Error: ${err.message}`);
      toast('Error', err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '👁 Try Again'; }
    }

    _verifying = false;
  }

  function showVerifyStatus(type, html) {
    const el = document.getElementById('verify-status-msg');
    if (!el) return;
    el.className = `alert alert-${type === 'error' ? 'danger' : 'success'} mt-md`;
    el.innerHTML = html;
    el.classList.remove('hidden');
  }

  // ── Cast Vote ──────────────────────────────────────────────────────────────
  let _casting = false;
  async function castVote() {
    if (_casting || !_verifiedStudent || !_selectedCandidateId) return;
    _casting = true;

    const btn = document.getElementById('cast-vote-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⛏ Mining block…'; }

    // Show mining overlay
    showMiningModal(true);

    try {
      const active = Admin.getElectionById(_selectedActiveElectionId) || Admin.getActiveElection();
      if (!active) {
        throw new Error('No active election selected.');
      }
      const block  = await window.VoteChain.castVote(
        _verifiedStudent.voterHash,
        _selectedCandidateId,
        active.id,
        _verifiedStudent.studentId
      );

      showMiningModal(false);

      // Success phase
      document.getElementById('vote-phase-cast').classList.add('hidden');
      const successPhase = document.getElementById('vote-phase-success');
      successPhase.classList.remove('hidden');
      document.getElementById('vote-block-hash').textContent = block.hash;
      document.getElementById('vote-block-nonce').textContent = block.nonce;

      toast('Vote Recorded!', 'Your vote is permanently on the blockchain.', 'success');
      launchConfetti();

    } catch (err) {
      showMiningModal(false);
      if (err.message === 'ALREADY_VOTED') {
        toast('Already Voted', 'You have already cast your vote.', 'warning');
      } else {
        toast('Error', err.message, 'error');
      }
      if (btn) { btn.disabled = false; btn.textContent = '🔗 Try Again'; }
    }

    _casting = false;
  }

  function showMiningModal(show) {
    let overlay = document.getElementById('mining-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mining-overlay';
      overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(4,7,15,.88);
        backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
        z-index:500;display:flex;align-items:center;justify-content:center;
      `;
      overlay.innerHTML = `
        <div class="mining-card">
          <div class="mining-spinner"></div>
          <h3 class="gradient-text" style="margin-top:28px">Mining Block…</h3>
          <p class="text-secondary" style="margin-top:8px;font-size:.875rem">Computing Proof-of-Work (SHA-256)</p>
          <div class="mono text-xs" style="color:var(--t3);margin-top:16px;word-break:break-all" id="mining-hash-preview">Searching for valid hash…</div>
        </div>
      `;
      document.body.appendChild(overlay);

      const preview = overlay.querySelector('#mining-hash-preview');
      const interval = setInterval(() => {
        const fake = Array.from({length:64}, () => '0123456789abcdef'[Math.floor(Math.random()*16)]).join('');
        if (preview) preview.textContent = fake;
      }, 80);
      overlay._interval = interval;
    }
    overlay.style.display = show ? 'flex' : 'none';
    if (!show && overlay._interval) { clearInterval(overlay._interval); }
  }

  // ── Public Results ──────────────────────────────────────────────────────────
  function renderPublicResults() {
    const content = document.getElementById('results-content');
    if (!content) return;

    const elections = Admin.loadElections();
    const active    = elections.find(e => e.status === 'active') || elections[elections.length - 1];

    if (!active) {
      content.innerHTML = `<div class="card text-center" style="padding:var(--sp-3xl)">
        <div style="font-size:3rem;margin-bottom:var(--sp-md)">📊</div>
        <h3>No Elections Yet</h3>
      </div>`;
      return;
    }

    const tally  = window.VoteChain.getResults(active.id);
    const total  = window.VoteChain.getTotalVotes(active.id);
    const maxV   = Math.max(...active.candidates.map(c => tally[c.id] || 0));
    const winner = active.candidates.find(c => tally[c.id] === maxV && maxV > 0);

    const colors = ['rgba(139,92,246,0.9)','rgba(0,217,255,0.85)','rgba(16,185,129,0.85)','rgba(245,158,11,0.85)','rgba(244,63,94,0.85)','rgba(59,130,246,0.85)'];

    content.innerHTML = `
      <div class="flex items-center justify-between mb-xl">
        <div>
          <h3>${_esc(active.title)}</h3>
          <div class="flex gap-sm mt-sm">
            <span class="badge badge-${active.status === 'active' ? 'success' : 'muted'}">${active.status}</span>
            <span class="badge badge-accent">${total} vote${total !== 1 ? 's' : ''} cast</span>
          </div>
        </div>
        <button class="btn btn-outline" onclick="App.renderPublicResults()">↻ Refresh</button>
      </div>

      ${winner ? `<div class="alert alert-success mb-xl">
        🏆 <strong>${_esc(winner.name)}</strong> is leading with ${maxV} vote${maxV!==1?'s':''}
        (${total ? Math.round((maxV/total)*100) : 0}%)
      </div>` : total === 0 ? `<div class="alert alert-info mb-xl">ℹ️ No votes have been cast yet.</div>` : ''}

      <div class="candidates-grid">
        ${active.candidates.map((c, i) => {
          const v   = tally[c.id] || 0;
          const pct = total ? Math.round((v / total) * 100) : 0;
          const isWinner = c.id === winner?.id;
          return `
          <div class="candidate-card" style="cursor:default;pointer-events:none;${isWinner ? 'border-color:var(--clr-success)' : ''}">
            ${isWinner ? '<div style="position:absolute;top:var(--sp-md);right:var(--sp-md);font-size:1.5rem">🏆</div>' : ''}
            <div class="candidate-avatar" style="background:${colors[i % colors.length]}">${c.name[0]}</div>
            <div class="candidate-name">${_esc(c.name)}</div>
            <div class="candidate-party text-muted">${_esc(c.party)}</div>
            <div class="candidate-votes">${v}</div>
            <div class="candidate-vote-label">votes (${pct}%)</div>
            <div class="vote-bar progress-bar mt-sm">
              <div class="progress-fill" style="width:${pct}%;background:${colors[i % colors.length]}"></div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="card mt-xl">
        <div class="flex items-center justify-between mb-lg">
          <h4>📊 Live Chart</h4>
          <span class="badge badge-muted mono text-xs">Auto-updates</span>
        </div>
        <div class="chart-compact">
          <canvas id="public-results-chart"></canvas>
        </div>
      </div>
    `;

    // Chart
    const ctx = document.getElementById('public-results-chart');
    if (ctx && window.Chart) {
      new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: active.candidates.map(c => c.name),
          datasets: [{
            data: active.candidates.map(c => tally[c.id] || 0),
            backgroundColor: colors.slice(0, active.candidates.length),
            borderColor: 'rgba(255,255,255,.05)',
            borderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 20 } },
            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} votes` } }
          },
          cutout: '60%',
        }
      });
    }
  }

  // ── Confetti ───────────────────────────────────────────────────────────────
  function launchConfetti() {
    if (!window.confetti) {
      // Lightweight inline confetti
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const pieces = Array.from({ length: 120 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * -canvas.height,
        size: Math.random() * 8 + 4,
        vel: { x: (Math.random() - .5) * 4, y: Math.random() * 4 + 2 },
        color: ['#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444'][Math.floor(Math.random() * 5)],
        rot: Math.random() * 360, rotV: (Math.random() - .5) * 8,
      }));

      let frame = 0;
      function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
          p.x  += p.vel.x; p.y  += p.vel.y;
          p.rot += p.rotV;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot * Math.PI / 180);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
          ctx.restore();
        });
        frame++;
        if (frame < 200) requestAnimationFrame(draw);
        else canvas.remove();
      }
      draw();
    }
  }

  // ── Toast System ───────────────────────────────────────────────────────────
  function toast(title, msg = '', type = 'info') {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-content">
        <div class="toast-title">${_esc(title)}</div>
        ${msg ? `<div class="toast-msg">${_esc(msg)}</div>` : ''}
      </div>
    `;
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 350);
    }, 4000);
  }

  // ── Sidebar Mobile ─────────────────────────────────────────────────────────
  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('open');
  }

  // ── Initialize App ─────────────────────────────────────────────────────────
  async function init() {
    // Init blockchain & admin
    await window.VoteChain.init();
    Admin.init();

    // Landing page blockchain animation
    animateLandingChain();
    updateHeroStats();

    // Nav items
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => {
        const view = el.dataset.view;
        if (view) navigate(view);
      });
    });

    // Hamburger
    document.getElementById('hamburger-btn')?.addEventListener('click', openSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

    // Chain status
    updateChainStatus();
    setInterval(updateChainStatus, 5000);

    // Block mined events
    window.addEventListener('block:mined', () => {
      updateChainStatus();
      updateHeroStats();
    });
    window.addEventListener('fraud:detected', () => {
      const badge = document.getElementById('fraud-nav-badge');
      if (badge) badge.textContent = window.FaceEngine.fraudLog.length;
      updateHeroStats();
    });

    // Show landing
    navigate('landing');
  }

  function animateLandingChain() {
    const blocks = document.querySelectorAll('.chain-block-inner');
    blocks.forEach((b, i) => {
      const hashes = ['0000a4f…', '00003bc…', '0000e71…', '0000c22…', '0000d9f…'];
      b.innerHTML = `#${i}<br><span>${hashes[i] || '0000…'}</span>`;
    });
  }

  function updateHeroStats() {
    const elections = Admin.loadElections ? Admin.loadElections() : [];
    const totalVotes = elections.reduce((sum, election) => {
      return sum + window.VoteChain.getTotalVotes(election.id);
    }, 0);

    _setText('hero-stat-voters', window.FaceEngine.getEnrolledCount());
    _setText('hero-stat-votes', totalVotes);
    _setText('hero-stat-blocks', window.VoteChain.length);
    _setText('hero-stat-fraud', window.FaceEngine.fraudLog.length);

    const latest = window.VoteChain.chain?.[window.VoteChain.chain.length - 1];
    if (latest?.hash) _setText('hero-chain-hash', `${latest.hash.slice(0, 14)}...`);
  }

  async function updateChainStatus() {
    const statusText = document.getElementById('chain-status-text');
    if (statusText) {
      const result = await window.VoteChain.isChainValid();
      statusText.textContent = result.valid ? `Chain valid · ${window.VoteChain.length} blocks` : '⚠ Chain invalid!';
      const dot = document.getElementById('chain-dot');
      if (dot) dot.style.background = result.valid ? 'var(--clr-success)' : 'var(--clr-danger)';
    }
    updateHeroStats();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init,
    navigate,
    startCamera,
    stopCamera,
    toast,
    openSidebar,
    closeSidebar,
    startEnrollment,
    cancelEnrollment,
    runVerification,
    selectCandidate,
    selectActiveElection,
    castVote,
    renderPublicResults,
  };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
