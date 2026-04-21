/**
 * face-engine.js
 * College Voting System — Face Recognition Engine
 * Powered by face-api.js (TensorFlow.js)
 * Runs 100% in-browser — no biometric data leaves the device
 */

const FACE_CFG = {
  MODEL_URL: 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights',
  MATCH_THRESHOLD: 0.45,        // Euclidean distance (lower = stricter)
  ENROLLMENT_FRAMES: 5,          // How many frames to average for enrollment
  ENROLLMENT_TIMEOUT_MS: 20000,  // Abort enrollment after 20s
  LIVENESS_FRAMES: 4,            // Frames to check for liveness
  LIVENESS_EAR_MIN: 0.15,        // Eye open threshold
  DETECTION_CONFIDENCE: 0.5,
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
    return faceapi
      .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({
        minConfidence: FACE_CFG.DETECTION_CONFIDENCE
      }))
      .withFaceLandmarks()
      .withFaceDescriptor();
  }

  // ── Enrollment ─────────────────────────────────────────────────────────────
  async enrollFace(studentId, videoEl, onProgress) {
    if (!this._loaded) throw new Error('Models not loaded');
    if (this.enrolledFaces[studentId]) throw new Error('ALREADY_ENROLLED');

    const descriptors = [];
    const deadline = Date.now() + FACE_CFG.ENROLLMENT_TIMEOUT_MS;
    let attempts = 0;

    while (descriptors.length < FACE_CFG.ENROLLMENT_FRAMES) {
      if (Date.now() > deadline) throw new Error('ENROLLMENT_TIMEOUT');
      attempts++;

      try {
        const det = await this._detect(videoEl);
        if (det) {
          descriptors.push(Array.from(det.descriptor));
          if (onProgress) onProgress(descriptors.length, FACE_CFG.ENROLLMENT_FRAMES);
        }
      } catch (_) { /* skip bad frame */ }

      await _sleep(350);
    }

    // Average all captured descriptors for robustness
    const avgDescriptor = descriptors[0].map((_, i) =>
      descriptors.reduce((sum, d) => sum + d[i], 0) / descriptors.length
    );

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
        const det = await faceapi
          .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
          .withFaceLandmarks();

        if (det) {
          const ear = this._eyeAspectRatio(det.landmarks);
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
    const det = await this._detect(videoEl);
    if (!det) {
      return { matched: false, reason: 'NO_FACE_DETECTED', confidence: 0 };
    }

    // Step 3: Match against all enrolled faces
    const queryDescriptor = det.descriptor;
    let best = { studentId: null, distance: Infinity };

    for (const [sid, data] of Object.entries(this.enrolledFaces)) {
      const dist = faceapi.euclideanDistance(queryDescriptor, new Float32Array(data.descriptor));
      if (dist < best.distance) best = { studentId: sid, distance: dist };
    }

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

  // ── Student queries ────────────────────────────────────────────────────────
  isEnrolled(studentId) { return !!this.enrolledFaces[studentId]; }
  getEnrolledCount()    { return Object.keys(this.enrolledFaces).length; }
  getAllStudents()       { return Object.values(this.enrolledFaces); }

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
