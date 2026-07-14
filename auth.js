// ==========================================================================
// VERIDO — auth.js  (index.html logic)
// ==========================================================================
import {
  auth, db, storage,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, doc, setDoc, getDoc,
  serverTimestamp, ref, uploadBytes, getDownloadURL,
  collection, query, where, getDocs
} from "./firebase-init.js";
import { loadFaceModels, startCamera, stopCamera, watchForFace, captureFrame } from "./face.js";

// ---------- small helpers ----------
const $ = sel => document.querySelector(sel);
const bannerSlot = $("#banner-slot");

function showBanner(kind, text) {
  bannerSlot.innerHTML = `<div class="msg-banner ${kind}">${text}</div>`;
}
function clearBanner() { bannerSlot.innerHTML = ""; }

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------- tabs ----------
const loginForm = $("#login-form");
const registerForm = $("#register-form");
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    clearBanner();
    if (btn.dataset.tab === "login") {
      loginForm.classList.remove("hidden");
      registerForm.classList.add("hidden");
      stopCamera(camStream); camStream = null;
    } else {
      loginForm.classList.add("hidden");
      registerForm.classList.remove("hidden");
    }
  });
});

// ==========================================================================
// LOGIN
// ==========================================================================
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearBanner();
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const submitBtn = loginForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (!cred.user.emailVerified) {
      showBanner("info", "Almost there — verify your Gmail address first. Check your inbox (and spam folder) for the link we sent, or use \"Resend verification email\" below.");
      submitBtn.disabled = false;
      return;
    }
    window.location.href = "chat.html";
  } catch (err) {
    showBanner("err", friendlyAuthError(err));
    submitBtn.disabled = false;
  }
});

$("#resend-verify-link").addEventListener("click", async (e) => {
  e.preventDefault();
  clearBanner();
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  if (!email || !password) {
    showBanner("err", "Enter your Gmail and password above first, then tap resend.");
    return;
  }
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(cred.user);
    showBanner("ok", "Verification email sent again. It can take a few minutes to arrive.");
  } catch (err) {
    showBanner("err", friendlyAuthError(err));
  }
});

function friendlyAuthError(err) {
  const code = err.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "That Gmail address or password doesn't match an account here.";
  }
  if (code.includes("too-many-requests")) return "Too many attempts — wait a moment and try again.";
  if (code.includes("email-already-in-use")) return "An account already exists with that Gmail address.";
  return "Something went wrong: " + (err.message || code);
}

// ==========================================================================
// REGISTER — step 1: details
// ==========================================================================
let regData = { name: "", email: "", password: "", recovery: "" };
let capturedBlob = null;

function goToStep(n) {
  document.querySelectorAll(".reg-step").forEach(el => {
    el.classList.toggle("hidden", el.dataset.step !== String(n));
  });
  document.querySelectorAll(".step-dot").forEach(el => {
    el.classList.toggle("active", el.dataset.step === String(n));
  });
}

$("#to-step-2").addEventListener("click", async () => {
  clearBanner();
  const name = $("#reg-name").value.trim();
  const email = $("#reg-email").value.trim();
  const password = $("#reg-password").value;
  const recovery = $("#reg-recovery").value;

  $("#reg-email-err").textContent = "";
  $("#reg-pw-err").textContent = "";

  if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
    $("#reg-email-err").textContent = "Please use a Gmail address (name@gmail.com).";
    return;
  }
  if (password.length < 8) {
    $("#reg-pw-err").textContent = "Password needs at least 8 characters.";
    return;
  }
  if (recovery.length < 8 || recovery === password) {
    $("#reg-pw-err").textContent = "Recovery password must be different and at least 8 characters.";
    return;
  }

  regData = { name, email, password, recovery };
  goToStep(2);
  await initCamera();
});

$("#back-to-1").addEventListener("click", () => {
  stopCamera(camStream); camStream = null;
  if (stopWatching) stopWatching();
  goToStep(1);
});

// ---------- step 2: live camera + face presence detection ----------
let camStream = null;
let stopWatching = null;
let faceReady = false;

async function initCamera() {
  const video = $("#cam-video");
  const wrap = $("#cam-wrap");
  const status = $("#cam-status");
  $("#capture-btn").disabled = true;
  faceReady = false;

  try {
    await loadFaceModels();
    camStream = await startCamera(video);
  } catch (err) {
    status.textContent = "Camera access is blocked — allow camera permission and reload this page.";
    return;
  }

  status.textContent = "Looking for your face…";
  wrap.classList.add("face-searching");

  let consecutiveHits = 0;
  stopWatching = watchForFace(video, (found) => {
    if (found) {
      consecutiveHits++;
      if (consecutiveHits >= 5) {
        faceReady = true;
        wrap.classList.remove("face-searching");
        wrap.classList.add("face-ok");
        status.textContent = "Face detected — ready to capture";
        status.classList.add("ok");
        $("#capture-btn").disabled = false;
      }
    } else {
      consecutiveHits = 0;
      faceReady = false;
      wrap.classList.remove("face-ok");
      wrap.classList.add("face-searching");
      status.textContent = "Looking for your face…";
      status.classList.remove("ok");
      $("#capture-btn").disabled = true;
    }
  });
}

$("#capture-btn").addEventListener("click", async () => {
  if (!faceReady) return;
  const video = $("#cam-video");
  capturedBlob = await captureFrame(video);
  const url = URL.createObjectURL(capturedBlob);
  $("#cam-preview").src = url;
  $("#cam-preview").classList.remove("hidden");
  video.classList.add("hidden");
  if (stopWatching) stopWatching();
  $("#capture-btn").classList.add("hidden");
  $("#retake-row").classList.remove("hidden");
});

$("#retake-btn").addEventListener("click", async () => {
  capturedBlob = null;
  $("#cam-preview").classList.add("hidden");
  $("#cam-video").classList.remove("hidden");
  $("#capture-btn").classList.remove("hidden");
  $("#retake-row").classList.add("hidden");
  await initCamera();
});

$("#confirm-face-btn").addEventListener("click", () => {
  if (!capturedBlob) return;
  stopCamera(camStream); camStream = null;
  $("#final-preview").src = $("#cam-preview").src;
  goToStep(3);
});

// ---------- step 3: create account ----------
$("#submit-register").addEventListener("click", async () => {
  clearBanner();
  const btn = $("#submit-register");
  btn.disabled = true;
  btn.textContent = "Creating account…";

  try {
    // check email not already used
    const existing = await getDocs(query(collection(db, "users"), where("email", "==", regData.email)));
    if (!existing.empty) {
      showBanner("err", "An account already exists with that Gmail address.");
      btn.disabled = false; btn.textContent = "Create my verified account";
      return;
    }

    const cred = await createUserWithEmailAndPassword(auth, regData.email, regData.password);
    const uid = cred.user.uid;

    // upload the live selfie
    const selfieRef = ref(storage, `registrationSelfies/${uid}.jpg`);
    await uploadBytes(selfieRef, capturedBlob, { contentType: "image/jpeg" });
    const selfieURL = await getDownloadURL(selfieRef);

    const recoveryHash = await sha256(regData.recovery);

    await setDoc(doc(db, "users", uid), {
      uid,
      name: regData.name,
      email: regData.email,
      emailLower: regData.email.toLowerCase(),
      registrationSelfieURL: selfieURL,
      profilePhotoURL: null, // set later by the user; unsaved contacts still see the selfie
      recoveryHash,
      status: "Hey there — I'm verified on Verido.",
      createdAt: serverTimestamp(),
    });

    await sendEmailVerification(cred.user);

    showBanner("ok", "Account created. We sent a verification link to " + regData.email + " — verify it, then log in.");
    document.querySelectorAll(".tab-btn")[0].click();
    loginForm.reset();
    $("#login-email").value = regData.email;
  } catch (err) {
    showBanner("err", friendlyAuthError(err));
    btn.disabled = false;
    btn.textContent = "Create my verified account";
  }
});
