/**
 * face-engine.js
 * College Voting System — Face Recognition Engine
 * Powered by face-api.js (TensorFlow.js)
 * Runs 100% in-browser — no biometric data leaves the device
 */

const FACE_CFG = {
  MODEL_URL: 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights',
  MATCH_THRESHOLD: 0.5,           // Euclidean distance (lower = stricter)
  DUPLICATE_FACE_THRESHOLD: 0.5,  // Reject another Student ID for the same face
  ENROLLMENT_FRAMES: 5,          // How many frames to average for enrollment
  ENROLLMENT_TIMEOUT_MS: 20000,  // Abort enrollment after 20s
  LIVENESS_FRAMES: 4,            // Frames to check for liveness
  LIVENESS_EAR_MIN: 0.15,        // Eye open threshold
  DETECTION_CONFIDENCE: 0.4,     // Slightly lower to detect reliably in dim lighting
};

// ─── Face Engine ──────────────────────────────────────────────────────────────
class FaceEngine {
  constructor() {
    this._loaded = false;
    this._loading = false;
    this._loadPromise = null;
    this.enrolledFaces = this._loadStore('cvs_enrolled_faces', {});
    this.fraudLog      = this._loadStore('cvs_fraud_log', []);
  }

  // ── Model Loading ──────────────────────────────────────────────────────────
  async loadModels(onStatus) {
    if (this._loaded) return;
    if (this._loading) return this._loadPromise;

    this._loading = true;
    this._loadPromise = this._doLoad(onStatus);
    return this._loadPromise;
  }

  async _doLoad(onStatus) {
    const report = msg => { if (onStatus) onStatus(msg); };
    try {
      report('Loading face detection model…');
      await faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_CFG.MODEL_URL);
      report('Loading landmark model…');
      await faceapi.nets.faceLandmark68Net.loadFromUri(FACE_CFG.MODEL_URL);
      report('Loading recognition model…');
      await faceapi.nets.faceRecognitionNet.loadFromUri(FACE_CFG.MODEL_URL);
      this._loaded = true;
      report('Models ready ✓');
    } catch (err) {
      this._loading = false;
      throw new Error(`MODEL_LOAD_FAILED: ${err.message}`);
    }
    this._loading = false;
  }

  // ── Detect a single face with full info ───────────────────────────────────
  async _detect(videoEl) {
    const dets = await faceapi
      .detectAllFaces(videoEl, new faceapi.SsdMobilenetv1Options({
        minConfidence: FACE_CFG.DETECTION_CONFIDENCE
      }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (!dets || dets.length === 0) return null;
    if (dets.length === 1) return dets[0];

    // Handle multiple faces by filtering out background noise
    dets.sort((a, b) => {
      const areaA = a.detection.box.width * a.detection.box.height;
      const areaB = b.detection.box.width * b.detection.box.height;
      return areaB - areaA;
    });

    const primaryArea = dets[0].detection.box.width * dets[0].detection.box.height;
    const secondaryArea = dets[1].detection.box.width * dets[1].detection.box.height;

    // If the second face is prominently visible (>25% of the primary face), abort
    if (secondaryArea > primaryArea * 0.25) {
      throw new Error('MULTIPLE_FACES_DETECTED');
    }

    // Safely return the main face, ignoring tiny background noise
    return dets[0];
  }

  // ── Enrollment ─────────────────────────────────────────────────────────────
  async enrollFace(studentId, videoEl, onProgress) {
    if (!this._loaded) throw new Error('Models not loaded');
    if (this.enrolledFaces[studentId]) throw new Error('ALREADY_ENROLLED');

    const isLive = await this.checkLiveness(videoEl);
    if (!isLive) {
      this._logFraud(null, null, 'ENROLLMENT_LIVENESS_FAIL');
      throw new Error('LIVENESS_FAILED');
    }

    const descriptors = [];
    const deadline = Date.now() + FACE_CFG.ENROLLMENT_TIMEOUT_MS;
    let attempts = 0;

    while (descriptors.length < FACE_CFG.ENROLLMENT_FRAMES) {
      if (Date.now() > deadline) throw new Error('ENROLLMENT_TIMEOUT');
      attempts++;

      try {
        const det = await this._detect(videoEl);
        if (det) {
          const frameDescriptor = Array.from(det.descriptor);
          const duplicate = this.findBestMatch(frameDescriptor, FACE_CFG.DUPLICATE_FACE_THRESHOLD);
          if (duplicate) throw this._duplicateEnrollmentError(duplicate);

          descriptors.push(frameDescriptor);
          if (onProgress) onProgress(descriptors.length, FACE_CFG.ENROLLMENT_FRAMES);
        }
      } catch (err) {
        if (err.message === 'FACE_ALREADY_ENROLLED') throw err;
        if (err.message === 'MULTIPLE_FACES_DETECTED') throw err;
        /* skip bad frame */
      }

      await _sleep(350);
    }

    // Average all captured descriptors for robustness
    const avgDescriptor = descriptors[0].map((_, i) =>
      descriptors.reduce((sum, d) => sum + d[i], 0) / descriptors.length
    );

    const duplicate = this.findBestMatch(avgDescriptor, FACE_CFG.DUPLICATE_FACE_THRESHOLD);
    if (duplicate) {
      throw this._duplicateEnrollmentError(duplicate);
    }

    this.enrolledFaces[studentId] = {
      studentId,
      descriptor: avgDescriptor,
      enrolledAt: new Date().toISOString(),
      frames: descriptors.length,
    };
    this._saveStore('cvs_enrolled_faces', this.enrolledFaces);
    return true;
  }

  // ── Liveness Check ─────────────────────────────────────────────────────────
  async checkLiveness(videoEl) {
    let validFrames = 0;
    for (let i = 0; i < FACE_CFG.LIVENESS_FRAMES; i++) {
      try {
        const dets = await faceapi
          .detectAllFaces(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: FACE_CFG.DETECTION_CONFIDENCE }))
          .withFaceLandmarks();

        if (dets && dets.length > 0) {
          // Identify the main face for liveness
          dets.sort((a, b) => {
            const areaA = a.detection.box.width * a.detection.box.height;
            const areaB = b.detection.box.width * b.detection.box.height;
            return areaB - areaA;
          });
          
          const ear = this._eyeAspectRatio(dets[0].landmarks);
          // Eyes should be open (not a printed photo with closed or drawn eyes)
          if (ear >= FACE_CFG.LIVENESS_EAR_MIN) validFrames++;
        }
      } catch (_) {}
      await _sleep(200);
    }
    return validFrames >= Math.ceil(FACE_CFG.LIVENESS_FRAMES / 2);
  }

  // ── Verification ──────────────────────────────────────────────────────────
  async verifyFace(videoEl) {
    if (!this._loaded) throw new Error('Models not loaded');

    // Step 1: Liveness
    const isLive = await this.checkLiveness(videoEl);
    if (!isLive) {
      this._logFraud(null, null, 'LIVENESS_FAIL');
      return { matched: false, reason: 'LIVENESS_FAILED', confidence: 0 };
    }

    // Step 2: Detect
    let det;
    try {
      det = await this._detect(videoEl);
    } catch (err) {
      if (err.message === 'MULTIPLE_FACES_DETECTED') {
        this._logFraud(null, null, 'MULTIPLE_FACES_DETECTED');
        return { matched: false, reason: 'MULTIPLE_FACES_DETECTED', confidence: 0 };
      }
      throw err;
    }

    if (!det) {
      return { matched: false, reason: 'NO_FACE_DETECTED', confidence: 0 };
    }

    // Step 3: Match against all enrolled faces
    const queryDescriptor = det.descriptor;
    const matches = this.findMatches(queryDescriptor, FACE_CFG.MATCH_THRESHOLD);
    if (matches.length > 1) {
      this._logFraud(matches.map(m => m.studentId).join(','), matches[0].distance, 'DUPLICATE_FACE_RECORD');
      return {
        matched: false,
        reason: 'DUPLICATE_FACE_RECORD',
        confidence: Math.round(Math.max(0, (1 - matches[0].distance) * 100)),
        distance: matches[0].distance,
        studentIds: matches.map(m => m.studentId),
      };
    }

    const best = this.findBestMatch(queryDescriptor) || { studentId: null, distance: Infinity };

    const matched = best.distance < FACE_CFG.MATCH_THRESHOLD;
    const confidence = Math.round(Math.max(0, (1 - best.distance) * 100));

    if (!matched) {
      this._logFraud(best.studentId, best.distance, 'FACE_MISMATCH');
      return { matched: false, reason: 'FACE_NOT_RECOGNIZED', confidence, distance: best.distance };
    }

    return {
      matched: true,
      studentId: best.studentId,
      confidence,
      distance: best.distance,
    };
  }

  // ── Eye Aspect Ratio (liveness / blink detection) ─────────────────────────
  _eyeAspectRatio(landmarks) {
    try {
      const euclidean = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const earForEye = (eye) => {
        const a = euclidean(eye[1], eye[5]);
        const b = euclidean(eye[2], eye[4]);
        const c = euclidean(eye[0], eye[3]);
        return (a + b) / (2.0 * c);
      };
      return (earForEye(landmarks.getLeftEye()) + earForEye(landmarks.getRightEye())) / 2;
    } catch (_) {
      return 0.3; // safe default
    }
  }

  // ── Fraud Logging ──────────────────────────────────────────────────────────
  _logFraud(suspectedId, distance, type) {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      suspectedStudentId: suspectedId || 'UNKNOWN',
      distance: distance != null ? Number(distance).toFixed(4) : 'N/A',
      type,
    };
    this.fraudLog.unshift(entry);          // newest first
    if (this.fraudLog.length > 100) this.fraudLog.pop(); // cap log size
    this._saveStore('cvs_fraud_log', this.fraudLog);
    window.dispatchEvent(new CustomEvent('fraud:detected', { detail: entry }));
  }

  _duplicateEnrollmentError(match) {
    this._logFraud(match.studentId, match.distance, 'DUPLICATE_ENROLLMENT');
    const err = new Error('FACE_ALREADY_ENROLLED');
    err.studentId = match.studentId;
    err.distance = match.distance;
    return err;
  }

  // ── Student queries ────────────────────────────────────────────────────────
  isEnrolled(studentId) { return !!this.enrolledFaces[studentId]; }
  getEnrolledCount()    { return Object.keys(this.enrolledFaces).length; }
  getAllStudents()       { return Object.values(this.enrolledFaces); }

  getDuplicateFaceGroups(threshold = FACE_CFG.DUPLICATE_FACE_THRESHOLD) {
    const students = this.getAllStudents().filter(s => Array.isArray(s.descriptor));
    const parent = new Map(students.map(s => [s.studentId, s.studentId]));

    const find = (id) => {
      const root = parent.get(id);
      if (root === id) return id;
      const next = find(root);
      parent.set(id, next);
      return next;
    };
    const unite = (a, b) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootB, rootA);
    };

    for (let i = 0; i < students.length; i++) {
      for (let j = i + 1; j < students.length; j++) {
        const dist = this._distance(students[i].descriptor, students[j].descriptor);
        if (dist < threshold) unite(students[i].studentId, students[j].studentId);
      }
    }

    const groups = new Map();
    students.forEach(s => {
      const root = find(s.studentId);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(s.studentId);
    });

    return Array.from(groups.values()).filter(group => group.length > 1);
  }

  findBestMatch(queryDescriptor, threshold = Infinity) {
    const matches = this.findMatches(queryDescriptor, threshold);
    return matches[0] || null;
  }

  findMatches(queryDescriptor, threshold = Infinity) {
    const query = queryDescriptor instanceof Float32Array
      ? queryDescriptor
      : new Float32Array(queryDescriptor);
    const matches = [];

    for (const [sid, data] of Object.entries(this.enrolledFaces)) {
      if (!Array.isArray(data.descriptor)) continue;
      const dist = this._distance(query, data.descriptor);
      if (dist < threshold) matches.push({ studentId: sid, distance: dist });
    }

    return matches.sort((a, b) => a.distance - b.distance);
  }

  _distance(a, b) {
    const left = a instanceof Float32Array ? a : new Float32Array(a);
    const right = b instanceof Float32Array ? b : new Float32Array(b);
    if (left.length !== right.length) return Infinity;

    let sum = 0;
    for (let i = 0; i < left.length; i++) {
      const diff = left[i] - right[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  removeStudent(studentId) {
    delete this.enrolledFaces[studentId];
    this._saveStore('cvs_enrolled_faces', this.enrolledFaces);
  }

  // ── Persistence helpers ────────────────────────────────────────────────────
  _loadStore(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) || def; }
    catch (_) { return def; }
  }
  _saveStore(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  reset() {
    this.enrolledFaces = {};
    this.fraudLog = [];
    localStorage.removeItem('cvs_enrolled_faces');
    localStorage.removeItem('cvs_fraud_log');
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

window.FaceEngine = new FaceEngine();
window._sleep = _sleep;
