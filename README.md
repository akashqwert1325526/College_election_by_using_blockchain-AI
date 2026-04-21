# SecureVote — Blockchain + Face Recognition Voting System

A tamper-proof, fraud-resistant college election system combining real-time **face recognition** and a **SHA-256 blockchain**.

## 🔐 Features
- **Face Enrollment** — Webcam captures 5 frames, averaged into a 128-float descriptor (stored locally, never uploaded)
- **Liveness Detection** — Eye Aspect Ratio (EAR) check prevents photo spoofing
- **SHA-256 Blockchain** — Votes mined with Proof-of-Work (difficulty 2) using the Web Crypto API
- **One Vote Per Face** — `SHA-256(studentId + electionId)` enforced at blockchain level
- **Fraud Log** — Every failed verification attempt logged with timestamp
- **Admin Dashboard** — Election management, live results charts, block explorer, chain validation
- **Zero Backend** — Runs 100% in the browser (localStorage for persistence)

## 🛠️ Tech Stack
| Component | Technology |
|---|---|
| Face Recognition | face-api.js (SSD MobileNet + FaceNet) |
| Liveness | Eye Aspect Ratio via 68-point landmarks |
| Blockchain | Custom SHA-256 + Proof-of-Work |
| Hashing | Web Crypto API |
| Frontend | HTML5, Vanilla CSS, JavaScript |
| Charts | Chart.js v4 |

## 🚀 How to Run
1. Clone the repository
2. Serve locally (required for webcam access):
   ```
   npx serve . --listen 5500
   ```
3. Open **http://localhost:5500**

## 📋 Usage
1. **Admin Login** → PIN: `admin123` → Create & activate an election
2. **Register Face** → Enter Student ID → webcam enrolls your face
3. **Vote** → Face scan verifies identity → select candidate → vote mined on blockchain
4. **Results** → Live results with Chart.js
5. **Block Explorer** → Browse every mined block in the chain

## 📁 File Structure
```
├── index.html        # SPA shell — all views
├── style.css         # Dark glassmorphism design system
├── blockchain.js     # SHA-256 Block/Chain + Proof-of-Work
├── face-engine.js    # Face enrollment, liveness, verification
├── admin.js          # Admin dashboard, charts, fraud log
└── app.js            # Router, camera, voting flow
```

## ⚠️ Note
On first use, face-api.js downloads ~6MB of AI model weights from CDN (cached after first load).

---
*Built with face-api.js, Chart.js, and the Web Crypto API*
