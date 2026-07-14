// ==========================================================================
// VERIDO — Firebase initialization (v10 modular SDK, loaded straight from CDN)
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  onAuthStateChanged,
  updatePassword,
  browserLocalPersistence,
  setPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc, setDoc, getDoc, updateDoc, serverTimestamp,
  collection, addDoc, query, where, orderBy, onSnapshot, limit,
  arrayUnion, arrayRemove, getDocs, or
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCaMdPoVqGflbBhWhsuV4L2duqiASIbP64",
  authDomain: "src-competion-web.firebaseapp.com",
  projectId: "src-competion-web",
  storageBucket: "src-competion-web.firebasestorage.app",
  messagingSenderId: "568183938397",
  appId: "1:568183938397:web:02d16665d7bd393d505cb4",
  measurementId: "G-C0YQX47SR5"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  onAuthStateChanged,
  updatePassword,
  doc, setDoc, getDoc, updateDoc, serverTimestamp,
  collection, addDoc, query, where, orderBy, onSnapshot, limit,
  arrayUnion, arrayRemove, getDocs, or,
  ref, uploadBytes, getDownloadURL
};
