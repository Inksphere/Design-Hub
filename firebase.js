import { initializeApp, initializeApp as initSecondaryApp, deleteApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail, 
  updatePassword, 
  reauthenticateWithCredential, 
  EmailAuthProvider, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection,
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp, 
  getDocFromServer 
} from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

// Initialize primary Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);

// Initialize Firestore with explicit databaseId
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Helper for Admin user creation without signing out current admin session
export async function adminCreateUserAccount(email, password) {
  const secondaryAppName = `SecondaryAuthApp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const secondaryApp = initSecondaryApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = userCredential.user.uid;
    await signOut(secondaryAuth);
    return newUid;
  } catch (err) {
    await signOut(secondaryAuth).catch(() => {});
    throw err;
  } finally {
    await deleteApp(secondaryApp).catch(() => {});
  }
}

// Connection test as required by Firebase integration
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Firebase client is currently offline or connecting...");
    }
  }
}

// Re-export modular methods for clean imports in app.js
export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  collection,
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp 
};
