# Verido — Build Plan for a Real, Deployable Version

The prototype (`verido-messenger.html`) is a **clickable UI demo** — it runs entirely in your browser with no server, so "sending a message" or "saving a face" only exists in that browser tab and disappears on refresh. This document is the plan for turning it into a real, always-on messenger. Nothing here is fictional dressing — it's the actual stack and sequence I'd build in.

## 1. Core idea, restated
Every account requires a Gmail address (verified by a one-time code) **and** a live camera scan captured during registration. That scan becomes the account's identity photo. When someone messages a user they haven't saved as a contact, they see that live scan instead of a chosen profile picture — so an impersonator can't hide behind a stolen photo until the recipient decides to trust them.

## 2. System components

| Layer | Purpose | Suggested tech |
|---|---|---|
| **Client apps** | Web + mobile UI, camera/mic capture | React or React Native, WebRTC |
| **Auth service** | Gmail OTP, password hashing, session tokens | Node/NestJS or Django, Google's SMTP or SendGrid for OTP mail, bcrypt/argon2 for passwords, JWT/OAuth2 sessions |
| **Identity service** | Liveness check + face capture storage | See §3 below — this is the sensitive part |
| **Messaging service** | Real-time chat delivery | WebSocket layer (Socket.IO or a managed service like Ably/Pusher) + a message queue (Redis/Kafka) for offline delivery |
| **Media service** | Voice notes, images, location, polls | Object storage (S3/Cloudflare R2) for audio/images; Postgres for poll/location structured data |
| **Calling** | Voice/video calls | WebRTC with a signaling server + TURN/STUN (coturn, or managed: Twilio, Agora, LiveKit) |
| **Speech services** | Voice typing in English + Sinhala | Browser `SpeechRecognition` API where supported, **or** a cloud STT with real Sinhala support — Google Cloud Speech-to-Text supports `si-LK`, which is the most reliable option today |
| **Database** | Users, messages, contacts, polls | PostgreSQL (relational core) + Redis (presence/online status, session cache) |

## 3. The face-verification pipeline (the sensitive part)

This is the feature that makes Verido different, and it's also the part that carries real legal and engineering weight. Three separate problems live inside "scan a live face":

1. **Liveness detection** — proving the camera is seeing a real, present person, not a photo held up to the lens or a video replay. This needs an actual liveness SDK, not just "did the camera turn on." Options: cloud APIs like AWS Rekognition Face Liveness, Azure Face Liveness, or FaceTec; open-source options are far less robust against spoofing.
2. **Face detection** (is there a face in frame, centered, well-lit) — this part is easy and can run client-side with a library like `face-api.js` or MediaPipe Face Detector.
3. **Storage of the identity photo** — the captured frame is stored as the account's fallback identity image. You do **not** need to do face-*recognition* matching (comparing two faces to see if they're the same person) for the core anti-scam feature to work — simply *showing* the live-captured photo to new contacts is often enough to deter impersonation, since a scammer would have to show their real face on camera. Face-recognition matching (e.g., flagging duplicate accounts by the same person) is a valid v2 feature but is a much bigger undertaking (embedding models, vector similarity search, false-positive handling) and should be scoped separately.

**Why this matters legally:** a face scan is biometric data under laws like GDPR (EU), Sri Lanka's Personal Data Protection Act, and similar regimes elsewhere. Before storing any face image tied to an identity, you'll generally need: explicit informed consent (a clear screen explaining what's captured and why, not buried in terms of service), a stated retention/deletion policy, encryption at rest, and a lawful basis for processing. Consult a lawyer in your jurisdiction before launching this for real — this part of the idea is good, but it's also the part most likely to get you in trouble if the compliance is skipped.

## 4. Registration flow (matches the prototype)

1. User enters a `@gmail.com` address + recovery password.
2. Backend generates a 6-digit OTP, emails it, expires in ~10 minutes.
3. User verifies OTP → short-lived "pending registration" token issued.
4. Client opens camera, runs local face-detection to confirm a face is framed, then captures a frame and runs it through the liveness check.
5. On success, the frame is uploaded (over TLS) and stored against the new account as `identity_photo`.
6. User sets a display name → account created, session issued.

## 5. Contact-trust display logic

- Every message thread checks: **is this sender in my saved contacts?**
- If **not saved** → show `identity_photo` (the registration scan) with a visible "not saved" label, as in the prototype.
- If **saved** → show the contact's chosen `profile_photo` (which can differ from their identity photo, same as WhatsApp).
- This logic lives entirely in the client's rendering layer, keyed off a `contacts` table — no extra backend complexity beyond a standard contacts model.

## 6. Feature-by-feature notes

- **Real-time messaging:** WebSocket connection per active session; undelivered messages queue in Redis/Kafka and flush on reconnect. Typing indicators and read receipts are small event messages over the same socket.
- **Voice messages:** client records with `MediaRecorder`, uploads the blob to object storage, message row stores a URL + duration.
- **Voice typing (EN + Sinhala):** the browser's built-in `SpeechRecognition` (used in the prototype) works well for English in Chrome but has inconsistent Sinhala support across browsers/OSes. For reliable Sinhala, route audio to Google Cloud Speech-to-Text with language code `si-LK` server-side instead.
- **Polls:** a `polls` table (question, options, votes-per-option, one-vote-per-user constraint) referenced by a message row.
- **Live location:** client requests `navigator.geolocation`, sends lat/lng (a single point, or a periodically-updated "live" share with a stop time, same as WhatsApp's live location).
- **Calls:** WebRTC peer connection, signaling over your existing WebSocket layer, TURN server for users behind restrictive NATs.

## 7. Suggested build order

1. Auth (Gmail OTP + password) — no messaging yet, just accounts.
2. Face capture + liveness + storage, wired into registration.
3. 1:1 text messaging over WebSockets, with the saved/unsaved photo-swap logic.
4. Voice messages + voice typing.
5. Polls + location sharing.
6. Calling (voice, then video).
7. Group chats, if wanted (not in the prototype — a reasonable v2).

## 8. What the attached prototype already shows you

Open `verido-messenger.html` in a browser (Chrome recommended) to see, functioning for real in-browser:
- The registration flow end-to-end, including opening your actual camera and capturing a real frame (falls back to a demo image if the preview sandbox blocks camera access).
- The saved-vs-unsaved contact photo distinction.
- Real voice message recording and playback (uses your mic).
- Real voice-to-text typing (English reliable in Chrome; Sinhala depends on your browser/OS support).
- Real device location sharing (uses your GPS/location permission).
- Working poll creation and voting UI, and a call-screen mockup.

Everything above is real, working browser code — what's simulated is only the parts that require a server: no messages are actually delivered to another person, no face image is stored anywhere beyond your current tab, and OTP is a fixed demo code instead of a real email.
