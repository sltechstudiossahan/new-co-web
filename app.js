// ==========================================================================
// VERIDO — app.js  (chat.html logic)
// ==========================================================================
import {
  auth, db, storage,
  onAuthStateChanged, signOut,
  doc, setDoc, getDoc, updateDoc, serverTimestamp,
  collection, addDoc, query, where, orderBy, onSnapshot, limit,
  getDocs, ref, uploadBytes, getDownloadURL
} from "./firebase-init.js";

const $ = sel => document.querySelector(sel);
let ME = null;          // current user's Firestore doc data
let MY_UID = null;
const savedContactCache = new Map();   // otherUid -> boolean
const userCache = new Map();           // uid -> user doc data
let currentChatId = null;
let currentOtherUid = null;
let unsubMessages = null;
let unsubChats = null;

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function chatIdFor(a, b) { return [a, b].sort().join("_"); }

// ==========================================================================
// AUTH GUARD
// ==========================================================================
onAuthStateChanged(auth, async (user) => {
  if (!user || !user.emailVerified) {
    window.location.href = "index.html";
    return;
  }
  MY_UID = user.uid;
  const snap = await getDoc(doc(db, "users", MY_UID));
  if (!snap.exists()) { window.location.href = "index.html"; return; }
  ME = snap.data();
  userCache.set(MY_UID, ME);

  $("#me-avatar").src = ME.profilePhotoURL || ME.registrationSelfieURL;
  $("#me-name").innerHTML = escapeHtml(ME.name) + `<span class="dot">.</span>`;

  listenToChats();
});

$("#logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// let the user set/replace their profile photo — this is what saved contacts
// see instead of the registration selfie, same idea as WhatsApp's profile pic
$("#me-avatar").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    toast("Uploading profile photo…");
    const r = ref(storage, `profilePhotos/${MY_UID}.jpg`);
    await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
    const url = await getDownloadURL(r);
    await updateDoc(doc(db, "users", MY_UID), { profilePhotoURL: url });
    ME.profilePhotoURL = url;
    $("#me-avatar").src = url;
    toast("Profile photo updated");
  };
  input.click();
});

// ==========================================================================
// helpers: user + saved-contact lookups
// ==========================================================================
async function fetchUser(uid) {
  if (userCache.has(uid)) return userCache.get(uid);
  const snap = await getDoc(doc(db, "users", uid));
  const data = snap.exists() ? snap.data() : null;
  if (data) userCache.set(uid, data);
  return data;
}

async function isSaved(otherUid) {
  if (savedContactCache.has(otherUid)) return savedContactCache.get(otherUid);
  const snap = await getDoc(doc(db, "contacts", MY_UID, "savedContacts", otherUid));
  const val = snap.exists();
  savedContactCache.set(otherUid, val);
  return val;
}

// what avatar URL to show for a given user, given saved state
function displayAvatarFor(userDoc, saved) {
  if (saved && userDoc.profilePhotoURL) return userDoc.profilePhotoURL;
  return userDoc.registrationSelfieURL; // unsaved, or saved but never set a profile photo
}

// ==========================================================================
// SIDEBAR — chat list
// ==========================================================================
function listenToChats() {
  const q = query(collection(db, "chats"), where("participants", "array-contains", MY_UID));
  unsubChats = onSnapshot(q, async (snap) => {
    const rows = [];
    for (const d of snap.docs) {
      const chat = d.data();
      const otherUid = chat.participants.find(p => p !== MY_UID);
      if (!otherUid) continue;
      const other = await fetchUser(otherUid);
      if (!other) continue;
      const saved = await isSaved(otherUid);
      rows.push({ chatId: d.id, other, otherUid, saved, chat });
    }
    rows.sort((a, b) => (b.chat.lastMessageTime?.seconds || 0) - (a.chat.lastMessageTime?.seconds || 0));
    renderContactList(rows);
  });
}

function renderContactList(rows) {
  const list = $("#contact-list");
  if (rows.length === 0) {
    list.innerHTML = `<div class="empty-state">No chats yet. Tap ＋ to find someone by their Gmail address and start a verified conversation.</div>`;
    return;
  }
  const filterText = ($("#contact-search").value || "").toLowerCase();
  list.innerHTML = "";
  rows
    .filter(r => r.other.name.toLowerCase().includes(filterText))
    .forEach(r => {
      const row = document.createElement("div");
      row.className = "contact-row" + (r.chatId === currentChatId ? " active" : "");
      const avatarUrl = displayAvatarFor(r.other, r.saved);
      const time = r.chat.lastMessageTime ? formatTime(r.chat.lastMessageTime) : "";
      row.innerHTML = `
        <div class="avatar-wrap ${r.saved ? "verified" : "unsaved"}">
          <img class="avatar" src="${avatarUrl}" />
          ${r.saved ? "" : `<div class="unsaved-flag">unsaved</div>`}
        </div>
        <div class="contact-meta">
          <div class="name">${escapeHtml(r.other.name)}</div>
          <div class="preview">${escapeHtml(previewFor(r.chat.lastMessage))}</div>
        </div>
        <div class="contact-time">${time}</div>
      `;
      row.addEventListener("click", () => openChat(r.chatId, r.otherUid));
      list.appendChild(row);
    });
}

function previewFor(lastMessage) {
  if (!lastMessage) return "Say hello 👋";
  if (lastMessage.type === "voice") return "🎤 Voice message";
  if (lastMessage.type === "poll") return "📊 Poll: " + (lastMessage.text || "");
  if (lastMessage.type === "location") return "📍 Live location";
  return lastMessage.text || "";
}

$("#contact-search").addEventListener("input", () => {
  const f = $("#contact-search").value.toLowerCase();
  document.querySelectorAll(".contact-row").forEach(row => {
    const name = row.querySelector(".name").textContent.toLowerCase();
    row.style.display = name.includes(f) ? "" : "none";
  });
});

// ==========================================================================
// NEW CHAT
// ==========================================================================
$("#new-chat-btn").addEventListener("click", () => {
  $("#new-chat-email").value = "";
  $("#new-chat-err").textContent = "";
  $("#new-chat-modal").classList.remove("hidden");
});
$("#new-chat-cancel").addEventListener("click", () => $("#new-chat-modal").classList.add("hidden"));

$("#new-chat-go").addEventListener("click", async () => {
  const email = $("#new-chat-email").value.trim().toLowerCase();
  const errEl = $("#new-chat-err");
  errEl.textContent = "";
  if (!email) { errEl.textContent = "Enter a Gmail address."; return; }
  if (email === ME.emailLower) { errEl.textContent = "That's your own account."; return; }

  const snap = await getDocs(query(collection(db, "users"), where("emailLower", "==", email)));
  if (snap.empty) { errEl.textContent = "No Verido account uses that Gmail address."; return; }

  const otherDoc = snap.docs[0];
  const otherUid = otherDoc.id;
  userCache.set(otherUid, otherDoc.data());

  const chatId = chatIdFor(MY_UID, otherUid);
  const chatRef = doc(db, "chats", chatId);
  const existing = await getDoc(chatRef);
  if (!existing.exists()) {
    await setDoc(chatRef, {
      participants: [MY_UID, otherUid],
      createdAt: serverTimestamp(),
      lastMessage: null,
      lastMessageTime: serverTimestamp(),
    });
  }
  $("#new-chat-modal").classList.add("hidden");
  openChat(chatId, otherUid);
});

// ==========================================================================
// OPEN A CHAT
// ==========================================================================
async function openChat(chatId, otherUid) {
  currentChatId = chatId;
  currentOtherUid = otherUid;

  $("#no-chat-selected").classList.add("hidden");
  $("#active-chat").classList.remove("hidden");
  $("#sidebar").classList.add("chat-open");
  $("#chat-pane").classList.add("chat-open");

  const other = await fetchUser(otherUid);
  const saved = await isSaved(otherUid);

  $("#chat-head-name").textContent = other.name;
  $("#chat-head-sub").textContent = saved ? "Saved contact" : "Not saved yet";
  $("#chat-head-avatar").src = displayAvatarFor(other, saved);
  $("#chat-head-avatar-wrap").className = "avatar-wrap " + (saved ? "verified" : "unsaved");

  const strip = $("#unsaved-strip");
  if (saved) {
    strip.classList.add("hidden");
  } else {
    strip.classList.remove("hidden");
    $("#unsaved-strip-img").src = other.registrationSelfieURL;
  }

  if (unsubMessages) unsubMessages();
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"), limit(300));
  unsubMessages = onSnapshot(q, (snap) => {
    renderMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

$("#back-btn").addEventListener("click", () => {
  $("#sidebar").classList.remove("chat-open");
  $("#chat-pane").classList.remove("chat-open");
});

$("#save-contact-btn").addEventListener("click", async () => {
  await setDoc(doc(db, "contacts", MY_UID, "savedContacts", currentOtherUid), { savedAt: serverTimestamp() });
  savedContactCache.set(currentOtherUid, true);
  toast("Contact saved");
  openChat(currentChatId, currentOtherUid);
});

// ==========================================================================
// MESSAGES — render
// ==========================================================================
function renderMessages(msgs) {
  const box = $("#messages");
  const wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  box.innerHTML = "";
  let lastDay = null;

  msgs.forEach(m => {
    const day = m.timestamp ? new Date(m.timestamp.seconds * 1000).toDateString() : null;
    if (day && day !== lastDay) {
      const sep = document.createElement("div");
      sep.className = "day-sep";
      sep.textContent = day === new Date().toDateString() ? "Today" : day;
      box.appendChild(sep);
      lastDay = day;
    }
    box.appendChild(renderBubble(m));
  });

  if (wasAtBottom) box.scrollTop = box.scrollHeight;
}

function renderBubble(m) {
  const mine = m.senderId === MY_UID;
  const row = document.createElement("div");
  row.className = "bubble-row " + (mine ? "mine" : "theirs");
  const time = m.timestamp ? formatTime(m.timestamp) : "";

  let inner = "";
  if (m.type === "voice") {
    inner = `<div class="bubble voice-bubble">🎤 <audio controls src="${m.audioURL}"></audio><span class="time">${time}</span></div>`;
  } else if (m.type === "poll") {
    inner = `<div class="bubble poll-bubble" data-msg-id="${m.id}">
      <div class="poll-q">📊 ${escapeHtml(m.text)}</div>
      ${m.options.map((opt, i) => {
        const votedByMe = (opt.votes || []).includes(MY_UID);
        const pct = totalVotes(m.options) ? Math.round(((opt.votes || []).length / totalVotes(m.options)) * 100) : 0;
        return `<div class="poll-opt ${votedByMe ? "voted" : ""}" data-opt-index="${i}">
          <span>${escapeHtml(opt.text)}</span><span>${(opt.votes || []).length} · ${pct}%</span>
        </div>`;
      }).join("")}
      <span class="time">${time}</span>
    </div>`;
  } else if (m.type === "location") {
    const mapUrl = `https://www.google.com/maps?q=${m.lat},${m.lng}`;
    inner = `<div class="bubble location-bubble">
      <a href="${mapUrl}" target="_blank" rel="noopener">
        <div class="loc-title">📍 Live location</div>
        <div class="loc-sub">Open in Google Maps</div>
      </a>
      <span class="time" style="padding:0 14px 8px; display:block;">${time}</span>
    </div>`;
  } else {
    inner = `<div class="bubble">${escapeHtml(m.text)}<span class="time">${time}</span></div>`;
  }
  row.innerHTML = inner;

  if (m.type === "poll") {
    row.querySelectorAll(".poll-opt").forEach(el => {
      el.addEventListener("click", () => voteOnPoll(m, parseInt(el.dataset.optIndex)));
    });
  }
  return row;
}

function totalVotes(options) { return options.reduce((s, o) => s + (o.votes ? o.votes.length : 0), 0); }

async function voteOnPoll(m, optIndex) {
  const msgRef = doc(db, "chats", currentChatId, "messages", m.id);
  const fresh = await getDoc(msgRef);
  if (!fresh.exists()) return;
  const data = fresh.data();
  const options = data.options.map((o, i) => {
    const votes = new Set(o.votes || []);
    if (i === optIndex) {
      votes.has(MY_UID) ? votes.delete(MY_UID) : votes.add(MY_UID);
    } else {
      votes.delete(MY_UID); // single-choice poll
    }
    return { ...o, votes: Array.from(votes) };
  });
  await updateDoc(msgRef, { options });
}

// ==========================================================================
// SEND — text
// ==========================================================================
async function sendMessage(payload) {
  if (!currentChatId) return;
  await addDoc(collection(db, "chats", currentChatId, "messages"), {
    senderId: MY_UID,
    timestamp: serverTimestamp(),
    ...payload
  });
  const preview = payload.type === "text" ? payload.text
    : payload.type === "voice" ? "" : payload.text || "";
  await updateDoc(doc(db, "chats", currentChatId), {
    lastMessage: { type: payload.type, text: preview },
    lastMessageTime: serverTimestamp()
  });
}

const textInput = $("#text-input");
textInput.addEventListener("input", () => {
  textInput.style.height = "auto";
  textInput.style.height = Math.min(textInput.scrollHeight, 120) + "px";
});
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSendText(); }
});
$("#send-btn").addEventListener("click", doSendText);

function doSendText() {
  const text = textInput.value.trim();
  if (!text) return;
  sendMessage({ type: "text", text });
  textInput.value = "";
  textInput.style.height = "auto";
}

// ==========================================================================
// VOICE TYPING (speech-to-text) — English + Sinhala
// ==========================================================================
let recognition = null;
let recognizing = false;
let sttLang = "en-US";

$("#lang-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-lang]");
  if (!btn) return;
  document.querySelectorAll("#lang-toggle button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  sttLang = btn.dataset.lang;
  if (recognizing) toggleMicTyping(); // restart with new language
});

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

$("#mic-type-btn").addEventListener("click", toggleMicTyping);

function toggleMicTyping() {
  const SR = getSpeechRecognition();
  if (!SR) {
    toast("Voice typing isn't supported in this browser — try Chrome.");
    return;
  }
  if (recognizing) {
    recognition && recognition.stop();
    recognizing = false;
    $("#mic-type-btn").classList.remove("active");
    $("#stt-live").textContent = "";
    return;
  }
  recognition = new SR();
  recognition.lang = sttLang;
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = "", final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t; else interim += t;
    }
    if (final) {
      textInput.value = (textInput.value ? textInput.value + " " : "") + final.trim();
    }
    $("#stt-live").textContent = interim;
  };
  recognition.onerror = () => { $("#stt-live").textContent = ""; };
  recognition.onend = () => {
    if (recognizing) recognition.start(); // keep listening until user stops it
  };

  recognition.start();
  recognizing = true;
  $("#mic-type-btn").classList.add("active");
}

// ==========================================================================
// VOICE NOTES (record + send as audio message)
// ==========================================================================
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

$("#voice-note-btn").addEventListener("click", async () => {
  if (isRecording) {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      isRecording = false;
      $("#voice-note-btn").classList.remove("recording");
      const blob = new Blob(recordedChunks, { type: "audio/webm" });
      if (blob.size < 500) return; // too short / accidental tap
      toast("Sending voice message…");
      const fileId = crypto.randomUUID();
      const r = ref(storage, `voiceMessages/${currentChatId}/${fileId}.webm`);
      await uploadBytes(r, blob, { contentType: "audio/webm" });
      const url = await getDownloadURL(r);
      await sendMessage({ type: "voice", audioURL: url });
    };
    mediaRecorder.start();
    isRecording = true;
    $("#voice-note-btn").classList.add("recording");
  } catch (err) {
    toast("Microphone access is blocked.");
  }
});

// ==========================================================================
// LIVE LOCATION
// ==========================================================================
$("#location-btn").addEventListener("click", () => {
  if (!navigator.geolocation) { toast("Location isn't available in this browser."); return; }
  toast("Getting your location…");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    await sendMessage({
      type: "location",
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      text: "Live location"
    });
  }, () => toast("Couldn't get your location — check location permissions."));
});

// ==========================================================================
// POLLS
// ==========================================================================
$("#poll-btn").addEventListener("click", () => {
  $("#poll-question").value = "";
  $("#poll-options-wrap").innerHTML = `
    <div class="poll-opt-input"><input type="text" placeholder="Option 1" /></div>
    <div class="poll-opt-input"><input type="text" placeholder="Option 2" /></div>`;
  $("#poll-modal").classList.remove("hidden");
});
$("#poll-cancel").addEventListener("click", () => $("#poll-modal").classList.add("hidden"));
$("#add-poll-opt").addEventListener("click", () => {
  const wrap = $("#poll-options-wrap");
  const n = wrap.children.length + 1;
  const div = document.createElement("div");
  div.className = "poll-opt-input";
  div.innerHTML = `<input type="text" placeholder="Option ${n}" />`;
  wrap.appendChild(div);
});
$("#poll-send").addEventListener("click", async () => {
  const question = $("#poll-question").value.trim();
  const options = Array.from(document.querySelectorAll("#poll-options-wrap input"))
    .map(i => i.value.trim()).filter(Boolean);
  if (!question || options.length < 2) { toast("Add a question and at least 2 options."); return; }
  await sendMessage({ type: "poll", text: question, options: options.map(t => ({ text: t, votes: [] })) });
  $("#poll-modal").classList.add("hidden");
});

// ==========================================================================
// formatting helpers
// ==========================================================================
function formatTime(ts) {
  const d = new Date(ts.seconds * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
