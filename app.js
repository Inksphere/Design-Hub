import {
  auth,
  db,
  adminCreateUserAccount,
  testConnection,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  doc,
  collection,
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
  onSnapshot
} from './firebase.js';

// ============================================================
// CONSTANTS & GOOGLE DRIVE CONFIGURATION
// ============================================================

// Default Google Apps Script Exec URL (can also be updated in Admin Settings)
export const DEFAULT_GOOGLE_DRIVE_API_URL = 'PASTE_APPS_SCRIPT_EXEC_URL_HERE';
export const GOOGLE_DRIVE_ROOT_FOLDER_ID = 'bc1p7wsvzgq4lp23jmn568n5lamzx5qy9uwuj2t533cda38p56xa35eq9r8rn7';
export const GOOGLE_DRIVE_ROOT_FOLDER_URL = 'https://drive.google.com/drive/folders/bc1p7wsvzgq4lp23jmn568n5lamzx5qy9uwuj2t533cda38p56xa35eq9r8rn7';

// ============================================================
// TOASTS & LOGGING UTILITIES
// ============================================================

export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
  toast.innerHTML = `
    <span style="font-weight:700;">${type === 'error' ? '✕' : type === 'success' ? '✓' : 'ℹ'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4500);
}

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  showToast(error.message || 'Database operation failed', 'error');
  return errInfo;
}

export function formatDate(val) {
  if (!val) return '—';
  try {
    let d;
    if (val.toDate && typeof val.toDate === 'function') {
      d = val.toDate();
    } else if (val instanceof Date) {
      d = val;
    } else if (typeof val === 'string' || typeof val === 'number') {
      d = new Date(val);
    }
    if (d && !isNaN(d.getTime())) {
      return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    }
  } catch (e) {
    console.warn('Error formatting date:', e);
  }
  return String(val);
}

export function getStatusBadgeHtml(status) {
  const s = String(status || 'Submitted').toLowerCase().replace(/\s+/g, '-');
  return `<span class="badge badge-${s}"><span class="badge-dot"></span>${status}</span>`;
}

export function getPriorityBadgeHtml(priority) {
  const p = String(priority || 'Normal').toLowerCase();
  return `<span class="badge badge-${p}">${priority}</span>`;
}

export function getLanguageBadgeHtml(language) {
  if (!language || String(language).toLowerCase() === 'arabic' || String(language).toLowerCase() === 'urdu') {
    return '';
  }
  const lang = String(language).toLowerCase();
  return `<span class="badge badge-lang">${language}</span>`;
}

export async function logActivity(action, description, requestId = '') {
  try {
    const user = auth.currentUser;
    let actorName = user ? (user.displayName || user.email) : 'System';
    let actorRole = window.currentUserProfile?.role || 'user';
    await addDoc(collection(db, 'activityLogs'), {
      action,
      actorId: user ? user.uid : 'system',
      actorName,
      actorRole,
      requestId: requestId || '',
      timestamp: new Date().toISOString(),
      description
    });
  } catch (err) {
    console.warn('Could not log activity:', err);
  }
}

// Global active modal controller
export function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}
export function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}
window.closeModal = closeModal;
window.openModal = openModal;

// ============================================================
// USERNAME SYSTEM & NORMALIZATION
// ============================================================

/**
 * Normalizes username:
 * - Trims leading/trailing whitespace
 * - Converts to lowercase
 * - Validates: only letters, numbers, and underscores (3-30 chars)
 */
export function normalizeUsername(username) {
  if (!username || typeof username !== 'string') return '';
  return username.trim().toLowerCase();
}

export function isValidUsernameFormat(username) {
  if (!username || typeof username !== 'string') return false;
  const regex = /^[a-zA-Z0-9_]{3,30}$/;
  return regex.test(username.trim());
}

export function validateUsernameFormat(username) {
  if (!username || typeof username !== 'string' || !username.trim()) {
    return { valid: false, error: 'Username is required.' };
  }
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 30) {
    return { valid: false, error: 'Username must be between 3 and 30 characters.' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores.' };
  }
  return { valid: true };
}

export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function isValidEmailFormat(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function validateEmailFormat(email) {
  if (!email || typeof email !== 'string' || !email.trim()) {
    return { valid: false, error: 'Email address is required.' };
  }
  if (!isValidEmailFormat(email)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  return { valid: true };
}

export function getEmailDocId(email) {
  const norm = normalizeEmail(email);
  if (!norm) return '';
  // Collision-free safe document ID encoding
  return encodeURIComponent(norm).replace(/\./g, '%2E');
}

/**
 * Checks if a username is available across the system.
 * Returns true if available, false if genuinely taken.
 */
export async function isUsernameAvailable(rawUsername, excludeUid = null) {
  const normalized = normalizeUsername(rawUsername);
  if (!normalized) return false;

  // 1. Primary check: public usernames collection
  try {
    const unameDoc = await getDoc(doc(db, 'usernames', normalized));
    if (unameDoc.exists()) {
      const data = unameDoc.data();
      if (!excludeUid || data.uid !== excludeUid) {
        if (data.status !== 'rejected') {
          return false;
        }
      }
    }
  } catch (err) {
    console.warn('Error checking usernames mapping:', err);
  }

  // 2. Check users collection if authenticated
  if (auth.currentUser) {
    try {
      const qNorm = query(collection(db, 'users'), where('usernameNormalized', '==', normalized), limit(1));
      const snapNorm = await getDocs(qNorm);
      if (!snapNorm.empty) {
        if (!excludeUid || snapNorm.docs[0].id !== excludeUid) {
          return false;
        }
      }

      const qRaw = query(collection(db, 'users'), where('username', '==', rawUsername.trim()), limit(1));
      const snapRaw = await getDocs(qRaw);
      if (!snapRaw.empty) {
        if (!excludeUid || snapRaw.docs[0].id !== excludeUid) {
          return false;
        }
      }
    } catch (err) {
      // Ignore permission errors gracefully
    }

    // 3. Check pending userRequests and designerRequests if admin
    try {
      const qPendingUser = query(collection(db, 'userRequests'), where('usernameNormalized', '==', normalized), limit(10));
      const snapPendingUser = await getDocs(qPendingUser);
      for (const d of snapPendingUser.docs) {
        const dData = d.data();
        if (dData.status === 'pending' && (!excludeUid || (dData.uid && dData.uid !== excludeUid))) {
          return false;
        }
      }

      const qPendingDes = query(collection(db, 'designerRequests'), where('usernameNormalized', '==', normalized), limit(10));
      const snapPendingDes = await getDocs(qPendingDes);
      for (const d of snapPendingDes.docs) {
        const dData = d.data();
        if (dData.status === 'pending' && (!excludeUid || (dData.uid && dData.uid !== excludeUid))) {
          return false;
        }
      }
    } catch (err) {
      // Ignore gracefully
    }
  }

  return true;
}

/**
 * Checks if an email is available across the system.
 * Returns true if available, false if genuinely taken.
 */
export async function isEmailAvailable(rawEmail, excludeUid = null) {
  const normalized = normalizeEmail(rawEmail);
  if (!normalized) return false;

  const emailDocId = getEmailDocId(normalized);

  // 1. Primary check: emails mapping collection
  try {
    const emailDoc = await getDoc(doc(db, 'emails', emailDocId));
    if (emailDoc.exists()) {
      const data = emailDoc.data();
      if (!excludeUid || data.uid !== excludeUid) {
        if (data.status !== 'rejected') {
          // Verify actual email match
          if (!data.email || normalizeEmail(data.email) === normalized) {
            return false;
          }
        }
      }
    }

    // Check legacy document id format as fallback
    const legacyDocId = normalized.replace(/[^a-z0-9_]/g, '_');
    if (legacyDocId !== emailDocId) {
      const legacyDoc = await getDoc(doc(db, 'emails', legacyDocId));
      if (legacyDoc.exists()) {
        const data = legacyDoc.data();
        if (!excludeUid || data.uid !== excludeUid) {
          if (data.status !== 'rejected') {
            if (!data.email || normalizeEmail(data.email) === normalized) {
              return false;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Error checking emails mapping:', err);
  }

  // 2. Check users collection if authenticated
  if (auth.currentUser) {
    try {
      const userQuery = query(collection(db, 'users'), where('email', '==', normalized), limit(1));
      const userSnap = await getDocs(userQuery);
      if (!userSnap.empty) {
        if (!excludeUid || userSnap.docs[0].id !== excludeUid) {
          return false;
        }
      }
    } catch (err) {
      // Ignore permission errors gracefully
    }

    // 3. Check pending userRequests and designerRequests if admin
    try {
      const qPendingUser = query(collection(db, 'userRequests'), where('email1', '==', normalized), limit(10));
      const snapPendingUser = await getDocs(qPendingUser);
      for (const d of snapPendingUser.docs) {
        const dData = d.data();
        if (dData.status === 'pending' && (!excludeUid || (dData.uid && dData.uid !== excludeUid))) {
          return false;
        }
      }

      const qPendingDes = query(collection(db, 'designerRequests'), where('email', '==', normalized), limit(10));
      const snapPendingDes = await getDocs(qPendingDes);
      for (const d of snapPendingDes.docs) {
        const dData = d.data();
        if (dData.status === 'pending' && (!excludeUid || (dData.uid && dData.uid !== excludeUid))) {
          return false;
        }
      }
    } catch (err) {
      // Ignore gracefully
    }
  }

  return true;
}

/**
 * Resolves an email address from an identifier (email or username).
 * If identifier contains '@', returns it directly.
 * If identifier is a username, retrieves the associated email from Firestore.
 */
export async function resolveEmailFromIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') return null;
  const trimmed = identifier.trim();

  // If already an email
  if (trimmed.includes('@')) {
    return trimmed;
  }

  // Lookup username
  const normalized = normalizeUsername(trimmed);
  try {
    // Check usernames mapping doc
    const unameDoc = await getDoc(doc(db, 'usernames', normalized));
    if (unameDoc.exists() && unameDoc.data().email) {
      return unameDoc.data().email;
    }

    // Fallback: search users collection
    if (auth.currentUser) {
      const uq = query(collection(db, 'users'), where('usernameNormalized', '==', normalized), limit(1));
      const uSnap = await getDocs(uq);
      if (!uSnap.empty && uSnap.docs[0].data().email) {
        return uSnap.docs[0].data().email;
      }
    }
  } catch (err) {
    console.warn('Error resolving email from username:', err);
  }

  return null;
}

// ============================================================
// AUTHENTICATION (EMAIL OR USERNAME)
// ============================================================

export let currentUser = null;
export let currentUserProfile = null;

export async function fetchUserProfile(uid, email) {
  try {
    const userDocRef = doc(db, 'users', uid);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() };
    }

    // Bootstrap initial Admin if needed (e.g. hashimtypixel@gmail.com or first admin)
    if (email === 'hashimtypixel@gmail.com') {
      const adminData = {
        name: 'Super Admin',
        username: 'admin',
        usernameNormalized: 'admin',
        email: email,
        role: 'admin',
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await setDoc(userDocRef, adminData);
      await setDoc(doc(db, 'usernames', 'admin'), {
        username: 'admin',
        usernameNormalized: 'admin',
        email: email,
        uid: uid,
        status: 'active'
      });
      return { id: uid, ...adminData };
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, 'get', `users/${uid}`);
    return null;
  }
}

export function initAuthListener(expectedRole = null) {
  testConnection();

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    const path = window.location.pathname;
    const isLoginPage = path.endsWith('index.html') || path === '/' || path === '';

    if (!user) {
      if (!isLoginPage) {
        window.location.href = 'index.html';
      }
      return;
    }

    // Fetch user profile from Firestore
    const profile = await fetchUserProfile(user.uid, user.email);
    currentUserProfile = profile;
    window.currentUserProfile = profile;

    if (!profile) {
      showToast('Account profile not active or pending approval. Contact Administrator.', 'error');
      await signOut(auth);
      window.location.href = 'index.html';
      return;
    }

    if (profile.active === false) {
      showToast('Your account is deactivated or awaiting administrator approval.', 'error');
      await signOut(auth);
      window.location.href = 'index.html';
      return;
    }

    // If on login page, redirect to appropriate role dashboard
    if (isLoginPage) {
      const targetPage = `${profile.role}.html`;
      window.location.href = targetPage;
      return;
    }

    // Enforce role guard
    if (expectedRole && profile.role !== expectedRole && profile.role !== 'admin') {
      showToast(`Access restricted: Requires ${expectedRole} privileges`, 'error');
      window.location.href = `${profile.role}.html`;
      return;
    }

    // Populate user profile info in navbar and sidebar
    updateProfileBadges(profile);

    // Call page-specific loader
    if (window.onAppReady) {
      window.onAppReady(profile);
    }
  });
}

function updateProfileBadges(profile) {
  const nameEls = document.querySelectorAll('.user-display-name, #user-display-name');
  const roleEls = document.querySelectorAll('.user-display-role, #user-display-role');
  const avatarEls = document.querySelectorAll('.user-display-avatar, #user-display-avatar');
  const unameEls = document.querySelectorAll('.user-display-username, #user-display-username');

  const displayName = profile.name || profile.username || profile.email;
  nameEls.forEach(el => el.textContent = displayName);
  unameEls.forEach(el => el.textContent = profile.username ? `@${profile.username}` : '');
  
  const roleText = (profile.role || 'user').toUpperCase() + (profile.subCommitteeName ? ` • ${profile.subCommitteeName}` : '');
  roleEls.forEach(el => el.textContent = roleText);

  const initials = (profile.name || profile.username || profile.email || 'U').substring(0, 2).toUpperCase();
  avatarEls.forEach(el => el.textContent = initials);
}

// User Login function supporting Email OR Username
export async function handleLogin(identifier, password, submitBtn) {
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Logging In...';
  }
  try {
    const emailToUse = await resolveEmailFromIdentifier(identifier);
    if (!emailToUse) {
      showToast('No registered account found with this username or email.', 'error');
      return;
    }

    const cred = await signInWithEmailAndPassword(auth, emailToUse, password);
    showToast('Signed in successfully!', 'success');
    
    const profile = await fetchUserProfile(cred.user.uid, cred.user.email);
    if (profile) {
      window.location.href = `${profile.role}.html`;
    } else {
      window.location.href = 'user.html';
    }
  } catch (error) {
    let msg = 'Authentication failed. Please verify your credentials.';
    if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      msg = 'Incorrect password.';
    } else if (error.code === 'auth/user-not-found') {
      msg = 'No user account found with this email.';
    } else if (error.code === 'auth/user-disabled') {
      msg = 'This account has been deactivated.';
    } else if (error.code === 'auth/invalid-email') {
      msg = 'Please enter a valid email address or username.';
    } else if (error.code === 'auth/network-request-failed') {
      msg = 'Network connection error. Check your internet connectivity.';
    }
    showToast(msg, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Sign In';
    }
  }
}

// Forgot Password supporting Email OR Username
export async function handleForgotPassword(identifier) {
  if (!identifier) {
    showToast('Please enter your email or username', 'error');
    return;
  }
  try {
    const emailToUse = await resolveEmailFromIdentifier(identifier);
    if (!emailToUse) {
      showToast('If an account exists, a password reset email has been sent.', 'info');
      closeModal('forgot-password-modal');
      return;
    }

    await sendPasswordResetEmail(auth, emailToUse);
    showToast(`Password reset link sent to registered email!`, 'success');
    closeModal('forgot-password-modal');
  } catch (error) {
    showToast(error.message || 'Failed to send password reset email', 'error');
  }
}

/**
 * Request New User registration from Login Page.
 * SECURE: The applicant's account is created directly in Firebase Auth.
 * NO PASSWORDS are stored in Firestore!
 */
export async function handleRequestNewUser(formData, submitBtn) {
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting Application...';
  }
  try {
    const { username, email1, email2, password, confirmPassword, committeeName, chairman, convenor } = formData;

    // 1. Validations format first
    const uVal = validateUsernameFormat(username);
    if (!uVal.valid) {
      throw new Error(uVal.error);
    }
    const eVal = validateEmailFormat(email1);
    if (!eVal.valid) {
      throw new Error(eVal.error);
    }
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match.');
    }
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    const normUsername = normalizeUsername(username);

    // 2. Check Username availability
    const isUnameAvail = await isUsernameAvailable(normUsername);
    if (!isUnameAvail) {
      throw new Error('Username already exists');
    }

    // 3. Check Email availability
    const isMailAvail = await isEmailAvailable(email1.trim());
    if (!isMailAvail) {
      throw new Error('Email already exists');
    }

    // Securely create Firebase Auth user without signing out any active admin session
    let newUid;
    try {
      newUid = await adminCreateUserAccount(email1.trim(), password);
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-in-use') {
        throw new Error('Email already exists');
      }
      throw authErr;
    }

    // Reserve username in usernames collection (WITHOUT password)
    await setDoc(doc(db, 'usernames', normUsername), {
      username: username.trim(),
      usernameNormalized: normUsername,
      email: email1.trim(),
      uid: newUid,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    // Reserve email in emails collection
    await setDoc(doc(db, 'emails', getEmailDocId(email1)), {
      email: email1.trim(),
      uid: newUid,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    // Create user request record (WITHOUT password)
    await addDoc(collection(db, 'userRequests'), {
      uid: newUid,
      username: username.trim(),
      usernameNormalized: normUsername,
      committeeName: (committeeName || 'General').trim(),
      chairman: (chairman || '').trim(),
      convenor: (convenor || '').trim(),
      email1: email1.trim(),
      email2: (email2 || '').trim(),
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    await logActivity('User Registration Submitted', `Applicant requested access: @${username} for committee ${committeeName}`);
    showToast('User request submitted successfully', 'success');
    closeModal('request-user-modal');
  } catch (error) {
    showToast(error.message || 'Failed to submit registration request', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit Application';
    }
  }
}

// Request Designer Access (with required username)
export async function handleRequestDesigner(formData, submitBtn) {
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting Request...';
  }
  try {
    const { name, username, email, contactNumber, password, confirmPassword } = formData;
    if (!name || !name.trim()) {
      throw new Error('Please enter your full name.');
    }
    const uVal = validateUsernameFormat(username);
    if (!uVal.valid) {
      throw new Error(uVal.error);
    }
    const eVal = validateEmailFormat(email);
    if (!eVal.valid) {
      throw new Error(eVal.error);
    }
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match.');
    }
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    const normUsername = normalizeUsername(username);

    // 1. Check Username availability
    const isUnameAvail = await isUsernameAvailable(normUsername);
    if (!isUnameAvail) {
      throw new Error('Username already exists');
    }

    // 2. Check Email availability
    const isMailAvail = await isEmailAvailable(email.trim());
    if (!isMailAvail) {
      throw new Error('Email already exists');
    }

    let newUid;
    try {
      newUid = await adminCreateUserAccount(email.trim(), password);
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-in-use') {
        throw new Error('Email already exists');
      }
      throw authErr;
    }

    // Reserve username
    await setDoc(doc(db, 'usernames', normUsername), {
      username: username.trim(),
      usernameNormalized: normUsername,
      email: email.trim(),
      uid: newUid,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    // Reserve email
    await setDoc(doc(db, 'emails', getEmailDocId(email)), {
      email: email.trim(),
      uid: newUid,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    await addDoc(collection(db, 'designerRequests'), {
      uid: newUid,
      name: name.trim(),
      username: username.trim(),
      usernameNormalized: normUsername,
      email: email.trim(),
      contactNumber: (contactNumber || '').trim(),
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    await logActivity('Designer Access Requested', `Designer applicant: ${name} (@${username})`);
    showToast('User request submitted successfully', 'success');
    closeModal('request-designer-modal');
  } catch (error) {
    showToast(error.message || 'Failed to submit designer application', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit Application';
    }
  }
}

// Password Change
export async function handleChangePassword(currentPassword, newPassword, confirmNewPassword) {
  if (newPassword !== confirmNewPassword) {
    showToast('New passwords do not match', 'error');
    return false;
  }
  if (newPassword.length < 6) {
    showToast('New password must be at least 6 characters', 'error');
    return false;
  }
  const user = auth.currentUser;
  if (!user || !user.email) {
    showToast('No active user session found', 'error');
    return false;
  }

  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
    await logActivity('Password Changed', `User updated password`);
    showToast('Password changed successfully!', 'success');
    closeModal('change-password-modal');
    return true;
  } catch (error) {
    let msg = 'Failed to update password.';
    if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      msg = 'Current password is incorrect.';
    }
    showToast(msg, 'error');
    return false;
  }
}

// Sign Out
export async function handleSignOut() {
  await signOut(auth);
  window.location.href = 'index.html';
}
window.handleSignOut = handleSignOut;

// ============================================================
// AUTOMATIC SUB-COMMITTEE & DESIGNER ASSIGNMENT ENGINE
// ============================================================

/**
 * Reusable function to ensure a Sub-Committee exists.
 * Duplicate protection: normalizes name (case-insensitive, trims).
 * 'Arabic', 'arabic', 'ARABIC', ' arabic' are treated as the same Sub-Committee.
 */
export async function ensureSubCommitteeExists(rawName, defaultDesignerId = '', defaultDesignerName = '') {
  if (!rawName || typeof rawName !== 'string') {
    throw new Error('Valid Sub-Committee name is required');
  }

  const cleanName = rawName.trim();
  const normalized = cleanName.toLowerCase();

  try {
    // Search existing sub-committees
    const snap = await getDocs(collection(db, 'subCommittees'));
    for (const d of snap.docs) {
      const data = d.data();
      const existingNorm = (data.normalizedName || data.name || '').trim().toLowerCase();
      if (existingNorm === normalized) {
        return { id: d.id, ...data };
      }
    }

    // Does not exist: create automatically
    const newDocData = {
      name: cleanName,
      normalizedName: normalized,
      description: `Sub-Committee for ${cleanName}`,
      defaultDesignerId: defaultDesignerId || '',
      defaultDesignerName: defaultDesignerName || '',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const newDocRef = await addDoc(collection(db, 'subCommittees'), newDocData);
    await logActivity('Sub-Committee Created', `Automatically created sub-committee: ${cleanName}`);
    return { id: newDocRef.id, ...newDocData };
  } catch (err) {
    console.error('Error in ensureSubCommitteeExists:', err);
    throw err;
  }
}

export async function getSubCommittees() {
  try {
    const snap = await getDocs(collection(db, 'subCommittees'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.active !== false);
  } catch (err) {
    handleFirestoreError(err, 'get', 'subCommittees');
    return [];
  }
}

export async function getClassUnions() {
  try {
    const snap = await getDocs(collection(db, 'classUnions'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.active !== false);
  } catch (err) {
    handleFirestoreError(err, 'get', 'classUnions');
    return [];
  }
}

export async function getDesignersList() {
  try {
    // 1. Fetch active users with role == 'designer'
    const userSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'designer')));
    const designers = userSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.active !== false);

    // 2. Also merge from designers collection if present
    try {
      const snap = await getDocs(collection(db, 'designers'));
      snap.docs.forEach(d => {
        if (!designers.some(existing => existing.id === d.id)) {
          const data = d.data();
          if (data.active !== false) {
            designers.push({ id: d.id, ...data });
          }
        }
      });
    } catch (_) {}

    return designers;
  } catch (err) {
    console.warn('Error fetching designers list:', err);
    return [];
  }
}

// ============================================================
// GOOGLE DRIVE API & AUTOMATIC FILE NAMING ENGINE
// ============================================================

let cachedDriveConfig = null;

export async function getGoogleDriveConfig() {
  if (cachedDriveConfig) return cachedDriveConfig;
  try {
    const snap = await getDoc(doc(db, 'settings', 'drive'));
    if (snap.exists()) {
      cachedDriveConfig = snap.data();
      return cachedDriveConfig;
    }
  } catch (err) {
    console.warn('Could not read drive settings from Firestore:', err);
  }
  return {
    webAppUrl: DEFAULT_GOOGLE_DRIVE_API_URL,
    rootFolderId: GOOGLE_DRIVE_ROOT_FOLDER_ID,
    rootFolderUrl: GOOGLE_DRIVE_ROOT_FOLDER_URL
  };
}

export async function saveGoogleDriveConfig(config) {
  const data = {
    webAppUrl: (config.webAppUrl || '').trim(),
    rootFolderId: (config.rootFolderId || GOOGLE_DRIVE_ROOT_FOLDER_ID).trim(),
    rootFolderUrl: (config.rootFolderUrl || GOOGLE_DRIVE_ROOT_FOLDER_URL).trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: currentUserProfile?.name || 'Admin'
  };
  await setDoc(doc(db, 'settings', 'drive'), data);
  cachedDriveConfig = data;
  await logActivity('Google Drive Settings Saved', 'Updated Google Apps Script API & Drive Folder');
  showToast('Google Drive configuration updated successfully!', 'success');
}

/**
 * Wing code helper: maps committee/wing name to standardized prefix:
 * Italian Wing -> it
 * Arabic Wing  -> arb
 * Youth Wing   -> youth
 * Media Wing   -> media
 */
export function getWingCode(wingName) {
  if (!wingName) return 'gen';
  const name = String(wingName).trim().toLowerCase();

  if (name.includes('italian') || name === 'it') return 'it';
  if (name.includes('arabic') || name === 'arb') return 'arb';
  if (name.includes('youth')) return 'youth';
  if (name.includes('media')) return 'media';
  if (name.includes('urdu') || name === 'urd') return 'urd';
  if (name.includes('english') || name === 'eng') return 'eng';
  if (name.includes('art')) return 'arts';
  if (name.includes('science')) return 'sci';
  if (name.includes('sports')) return 'sports';
  if (name.includes('finance')) return 'fin';

  const cleaned = name
    .replace(/\b(wing|subcommittee|committee|council|dept|department)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
  const firstWord = cleaned.split(/\s+/)[0] || 'gen';
  if (firstWord.length <= 5) return firstWord;
  return firstWord.slice(0, 4);
}

/**
 * Automatically computes next poster number and ID for a Wing:
 * Format: [wing_code]_pos_[number]
 * Examples: it_pos_01, arb_pos_01, youth_pos_01, media_pos_01
 */
export async function generateNextPosterId(wingCode) {
  const code = (wingCode || 'gen').toLowerCase();
  let maxNum = 0;
  const regex = new RegExp(`^${code}_pos_(\\d+)$`, 'i');

  try {
    const snap = await getDocs(collection(db, 'requests'));
    snap.forEach(d => {
      const data = d.data();
      const id = data.posterId || data.requestId || d.id;
      const m = String(id).match(regex);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
      if (data.wingCode === code && typeof data.posterNumber === 'number' && data.posterNumber > maxNum) {
        maxNum = data.posterNumber;
      }
    });
  } catch (err) {
    console.warn('Error reading requests for poster counter:', err);
  }

  try {
    const counterRef = doc(db, 'wingCounters', code);
    const cSnap = await getDoc(counterRef);
    if (cSnap.exists()) {
      const cData = cSnap.data();
      if (typeof cData.lastPosterNumber === 'number' && cData.lastPosterNumber > maxNum) {
        maxNum = cData.lastPosterNumber;
      }
    }
  } catch (err) {
    console.warn('Error reading wingCounter doc for poster:', err);
  }

  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(2, '0');
  const posterId = `${code}_pos_${padded}`;

  try {
    await setDoc(doc(db, 'wingCounters', code), {
      wingCode: code,
      lastPosterNumber: nextNum,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Error saving wingCounter for poster:', err);
  }

  return { posterId, posterNumber: nextNum, wingCode: code };
}

/**
 * Automatically computes next proof number and ID for a Wing:
 * Format: [wing_code]_pro_[number]
 * Proof numbering is completely separate from poster numbering.
 * Examples: it_pro_01, arb_pro_01, youth_pro_01, media_pro_01
 */
export async function generateNextProofId(wingCode) {
  const code = (wingCode || 'gen').toLowerCase();
  let maxNum = 0;
  const regex = new RegExp(`^${code}_pro_(\\d+)$`, 'i');

  try {
    const proofsSnap = await getDocs(collection(db, 'proofs'));
    proofsSnap.forEach(d => {
      const data = d.data();
      const id = data.proofId || d.id;
      const m = String(id).match(regex);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
      if (data.wingCode === code && typeof data.proofNumber === 'number' && data.proofNumber > maxNum) {
        maxNum = data.proofNumber;
      }
    });
  } catch (err) {
    console.warn('Error scanning root proofs for counter:', err);
  }

  try {
    const reqsSnap = await getDocs(collection(db, 'requests'));
    for (const rDoc of reqsSnap.docs) {
      const rData = rDoc.data();
      const rCode = rData.wingCode || getWingCode(rData.subCommitteeName);
      if (rCode === code) {
        const pvSnap = await getDocs(collection(db, 'requests', rDoc.id, 'proofVersions'));
        pvSnap.forEach(pvd => {
          const pvData = pvd.data();
          const pId = pvData.proofId || pvData.fileName || pvd.id;
          const m = String(pId).match(regex);
          if (m) {
            const n = parseInt(m[1], 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
          }
        });
      }
    }
  } catch (err) {
    console.warn('Error scanning subcollections for proof counter:', err);
  }

  try {
    const counterRef = doc(db, 'wingCounters', code);
    const cSnap = await getDoc(counterRef);
    if (cSnap.exists()) {
      const cData = cSnap.data();
      if (typeof cData.lastProofNumber === 'number' && cData.lastProofNumber > maxNum) {
        maxNum = cData.lastProofNumber;
      }
    }
  } catch (err) {
    console.warn('Error reading wingCounters for proof:', err);
  }

  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(2, '0');
  const proofId = `${code}_pro_${padded}`;

  return { proofId, proofNumber: nextNum, wingCode: code };
}

/**
 * Standardized automatic file name generation:
 * [wing_code]_pos_[number].ext
 * [wing_code]_pro_[number].ext
 * Ref_01.ext
 */
export function generateAutomaticFileName(type, wingOrId = 'gen', versionIndex = 1, originalFileName = '') {
  const ext = originalFileName.includes('.') ? originalFileName.slice(originalFileName.lastIndexOf('.')) : '.png';
  const paddedIndex = String(versionIndex).padStart(2, '0');

  if (type === 'poster') {
    if (wingOrId.includes('_pos_')) return `${wingOrId}${ext}`;
    const code = getWingCode(wingOrId);
    return `${code}_pos_${paddedIndex}${ext}`;
  } else if (type === 'proof') {
    if (wingOrId.includes('_pro_')) return `${wingOrId}${ext}`;
    const code = getWingCode(wingOrId);
    return `${code}_pro_${paddedIndex}${ext}`;
  } else if (type === 'reference') {
    return `Ref_${paddedIndex}${ext}`;
  }
  return `file_${paddedIndex}${ext}`;
}

/**
 * Creates a safe, compact preview data URL (< 80KB) for uploaded files
 * ensuring Firestore documents never exceed the strict 1MB document limit.
 */
export async function createSafePreviewDataUrl(file) {
  if (!file) return '';
  if (file.type && file.type.startsWith('image/')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const maxDim = 800;
            let w = img.width;
            let h = img.height;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, w);
            canvas.height = Math.max(1, h);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const compressed = canvas.toDataURL('image/jpeg', 0.8);
            resolve(compressed);
          } catch (cErr) {
            console.warn('Canvas compression fallback:', cErr);
            const raw = e.target.result;
            resolve(typeof raw === 'string' && raw.length < 500000 ? raw : '');
          }
        };
        img.onerror = () => {
          const raw = e.target.result;
          resolve(typeof raw === 'string' && raw.length < 500000 ? raw : '');
        };
        img.src = e.target.result;
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }

  // Non-image files like PDF: create clean SVG preview
  const safeName = (file.name || 'Document').replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240"><rect width="100%" height="100%" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2" rx="8"/><rect x="160" y="40" width="80" height="100" fill="#e2e8f0" rx="4"/><polygon points="210,40 240,70 210,70" fill="#94a3b8"/><text x="200" y="105" font-family="sans-serif" font-size="14" font-weight="bold" fill="#475569" text-anchor="middle">PDF</text><text x="200" y="170" font-family="monospace" font-size="12" fill="#334155" text-anchor="middle">${safeName}</text><text x="200" y="195" font-family="sans-serif" font-size="11" fill="#64748b" text-anchor="middle">${(file.size / 1024).toFixed(1)} KB</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Uploads a file to Google Drive using the secure Google Apps Script Web App Bridge.
 * Automatically organizes into:
 * Posters:   Posters / {Committee Name} / {FileName}
 * Proof:     Proof / {Committee Name} / {FileName}
 * Reference: Reference / {FileName}
 */
export async function uploadFileToGoogleDrive({
  file,
  folderType, // 'Posters' | 'Proof' | 'Reference'
  committeeName = 'General',
  targetFileName = '',
  requestId = ''
}) {
  if (!file) throw new Error('No file provided for upload.');

  const MAX_SIZE = 25 * 1024 * 1024; // 25MB max
  if (file.size > MAX_SIZE) {
    throw new Error('File exceeds the 25MB size limit. Please upload a smaller file.');
  }

  // Convert file to base64
  const base64Data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result;
      const base64 = typeof res === 'string' ? res.split(',')[1] : '';
      resolve(base64);
    };
    reader.onerror = (err) => reject(new Error('Failed reading file: ' + err));
    reader.readAsDataURL(file);
  });

  const driveConfig = await getGoogleDriveConfig();
  const webAppUrl = driveConfig.webAppUrl;

  const resolvedFileName = targetFileName || file.name;

  if (webAppUrl && webAppUrl.startsWith('http') && !webAppUrl.includes('PASTE_APPS_SCRIPT_EXEC_URL_HERE')) {
    try {
      const payload = {
        action: 'uploadFile',
        base64: base64Data,
        fileName: resolvedFileName,
        mimeType: file.type || 'application/octet-stream',
        rootFolderId: driveConfig.rootFolderId || GOOGLE_DRIVE_ROOT_FOLDER_ID,
        folderType: folderType || 'Posters',
        committeeName: committeeName || 'General',
        requestId: requestId || ''
      };

      const response = await fetch(webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (result.status === 'success' && result.fileId) {
        return {
          fileId: result.fileId,
          fileName: result.fileName || resolvedFileName,
          driveUrl: result.fileUrl || `https://lh3.googleusercontent.com/d/${result.fileId}`,
          webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.fileId}/view`,
          downloadUrl: result.downloadUrl || `https://drive.google.com/uc?export=download&id=${result.fileId}`,
          folderId: result.folderId || '',
          folderPath: result.folderPath || `${folderType}/${committeeName}`,
          fileSize: file.size,
          storageType: 'google_drive'
        };
      } else {
        throw new Error(result.message || 'Google Drive bridge reported an error.');
      }
    } catch (err) {
      console.warn('Apps Script upload failed, falling back to secure preview data URL:', err);
      showToast('Google Apps Script bridge error. File stored with local preview fallback.', 'error');
    }
  }

  // Graceful local data preview fallback if Apps Script endpoint is not yet pasted
  const localDataUrl = await createSafePreviewDataUrl(file);

  const mockFileId = 'gdrive_local_' + Date.now().toString(36);
  return {
    fileId: mockFileId,
    fileName: resolvedFileName,
    driveUrl: localDataUrl,
    webViewLink: localDataUrl,
    downloadUrl: localDataUrl,
    folderId: 'root_local',
    folderPath: `${folderType}/${committeeName}`,
    fileSize: file.size,
    storageType: 'google_drive_preview',
    isLocalFallback: true
  };
}

// ============================================================
// REQUEST CREATION & WORKFLOW
// ============================================================

export async function createPosterRequest(data, referenceFile, submitBtn) {
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Creating Request...';
  }
  try {
    const user = auth.currentUser;
    const profile = currentUserProfile;

    // 1. Determine User's Sub-Committee / Wing (automatically locked to user)
    const subCommitteeId = profile.subCommitteeId || data.subCommitteeId || '';
    const subCommitteeName = profile.subCommitteeName || data.subCommitteeName || 'General';

    // 2. Automatic Poster ID generation: [wing_code]_pos_[number] (Requirement 3)
    const wingCode = getWingCode(subCommitteeName);
    const { posterId, posterNumber } = await generateNextPosterId(wingCode);
    const requestId = posterId;

    // 3. Workflow Requirement: All Main Poster requests go to Admin first, remain unassigned until Admin selects a Designer
    let assignedDesignerId = '';
    let assignedDesignerName = 'Unassigned';
    let assignmentType = 'unassigned';

    // 4. Upload Reference File to Google Drive if provided
    let referenceInfo = null;
    if (referenceFile) {
      try {
        const ext = referenceFile.name.includes('.') ? referenceFile.name.slice(referenceFile.name.lastIndexOf('.')) : '.pdf';
        const autoRefName = `${posterId}_ref_01${ext}`;
        referenceInfo = await uploadFileToGoogleDrive({
          file: referenceFile,
          folderType: 'Reference',
          committeeName: subCommitteeName,
          targetFileName: autoRefName,
          requestId: posterId
        });
      } catch (refErr) {
        console.warn('Reference upload skipped or failed:', refErr);
      }
    }

    const payload = {
      requestId,
      posterId,
      posterNumber,
      wingCode,
      userId: user.uid,
      userName: profile.name || profile.username || user.email,
      userUsername: profile.username || '',
      subCommitteeId,
      subCommitteeName,
      posterType: data.posterType || 'Main Poster',
      mainHeading: data.mainHeading.trim(),
      subHeading: (data.subHeading || '').trim(),
      date: data.date || '',
      time: data.time || '',
      venue: data.venue.trim(),
      collaboration: {
        subCommittees: data.collabSubCommittees || [],
        classUnions: data.collabClassUnions || []
      },
      description: (data.description || '').trim(),
      specialInstructions: (data.specialInstructions || '').trim(),
      priority: data.priority || 'Normal',
      deadline: data.deadline || '',
      designerId: assignedDesignerId,
      designerName: assignedDesignerName,
      assignmentType,
      assignedByAdmin: false,
      status: 'Submitted',
      posterStatus: 'Not Uploaded',
      poster: {
        currentVersion: '',
        fileName: '',
        driveUrl: '',
        fileId: '',
        webViewLink: '',
        downloadUrl: '',
        uploadedBy: '',
        uploadedAt: ''
      },
      proof: {
        currentVersion: '',
        fileName: '',
        driveUrl: '',
        fileId: '',
        webViewLink: '',
        downloadUrl: '',
        uploadedBy: '',
        uploadedAt: ''
      },
      reference: referenceInfo ? {
        fileName: referenceInfo.fileName,
        driveUrl: referenceInfo.driveUrl,
        fileId: referenceInfo.fileId,
        webViewLink: referenceInfo.webViewLink,
        downloadUrl: referenceInfo.downloadUrl
      } : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: profile.name || profile.username || user.email
    };

    await setDoc(doc(db, 'requests', requestId), payload);

    // Notify administrators about incoming Main Poster request awaiting designer assignment
    try {
      const adminUsersSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
      for (const aDoc of adminUsersSnap.docs) {
        await addDoc(collection(db, 'notifications'), {
          userId: aDoc.id,
          title: 'New Poster Request Submitted',
          message: `New poster request "${data.mainHeading}" (${posterId}) submitted from ${subCommitteeName}. Awaiting designer assignment.`,
          requestId,
          type: 'new_request',
          read: false,
          createdAt: new Date().toISOString()
        });
      }
    } catch (_) {}

    await logActivity('Poster Created', `Poster ${posterId} ("${data.mainHeading}") submitted for ${subCommitteeName}`, requestId);
    showToast(`Poster request ${posterId} submitted successfully!`, 'success');
    return requestId;
  } catch (error) {
    handleFirestoreError(error, 'write', 'requests');
    throw error;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit Poster Request';
    }
  }
}

// User / Admin Revision Request
export async function handleRequestRevision(requestId, reason, submitBtn) {
  if (submitBtn) submitBtn.disabled = true;
  try {
    const reqRef = doc(db, 'requests', requestId);
    const snap = await getDoc(reqRef);
    if (!snap.exists()) throw new Error('Request not found');
    const reqData = snap.data();

    await updateDoc(reqRef, {
      status: 'Revision Required',
      posterStatus: 'Revision Required',
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserProfile?.name || currentUserProfile?.username || 'User'
    });

    if (reqData.designerId) {
      await addDoc(collection(db, 'notifications'), {
        userId: reqData.designerId,
        title: 'Revision Requested',
        message: `Revision requested on "${reqData.mainHeading}": ${reason}`,
        requestId,
        type: 'revision',
        read: false,
        createdAt: new Date().toISOString()
      });
    }

    await logActivity('Revision Requested', `Revision on ${requestId}: ${reason}`, requestId);
    showToast('Revision request sent to designer!', 'success');
    closeModal('revision-modal');
  } catch (error) {
    handleFirestoreError(error, 'update', `requests/${requestId}`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ============================================================
// POSTERS & PROOFS WITH AUTOMATIC NAMING & DRIVE STORAGE
// ============================================================

/**
 * Designer Uploads a Poster Version (e.g. arb_pos_01.png).
 */
export async function uploadPosterVersion(requestId, file, notes = '', isFinal = false, submitBtn) {
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Uploading to Drive...';
  }
  try {
    const reqRef = doc(db, 'requests', requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) throw new Error('Request not found');
    const reqData = reqSnap.data();

    // Determine version number (v1, v2, v3...)
    const versionsSnap = await getDocs(collection(db, 'requests', requestId, 'posterVersions'));
    const versionNumber = versionsSnap.size + 1;
    const versionTag = `v${versionNumber}`;

    // Automatic naming based on Poster ID: [wing_code]_pos_[number].ext
    const posterId = reqData.posterId || reqData.requestId || requestId;
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.png';
    const autoFileName = versionNumber === 1 ? `${posterId}${ext}` : `${posterId}_v${versionNumber}${ext}`;

    // Upload to Google Drive under Posters/{Committee Name}/
    const driveResult = await uploadFileToGoogleDrive({
      file,
      folderType: 'Posters',
      committeeName: reqData.subCommitteeName || 'General',
      targetFileName: autoFileName,
      requestId
    });

    const versionData = {
      version: versionTag,
      fileId: driveResult.fileId,
      fileName: driveResult.fileName,
      driveUrl: driveResult.driveUrl,
      webViewLink: driveResult.webViewLink,
      downloadUrl: driveResult.downloadUrl,
      folderPath: driveResult.folderPath,
      committeeName: reqData.subCommitteeName || 'General',
      uploadedBy: auth.currentUser?.uid || currentUserProfile?.id || 'designer',
      uploadedByName: currentUserProfile?.name || currentUserProfile?.username || auth.currentUser?.email || 'Designer',
      uploadedAt: new Date().toISOString(),
      status: isFinal ? 'Final' : 'Uploaded',
      notes: notes || '',
      storageType: driveResult.storageType
    };

    // Save version in subcollection
    await addDoc(collection(db, 'requests', requestId, 'posterVersions'), versionData);

    // Update parent doc
    const newStatus = isFinal ? 'Final' : 'Poster Uploaded';
    const newPosterStatus = isFinal ? 'Final' : 'Uploaded';

    const updatePayload = {
      status: newStatus,
      posterStatus: newPosterStatus,
      poster: {
        currentVersion: versionTag,
        fileName: driveResult.fileName,
        driveUrl: driveResult.driveUrl,
        fileId: driveResult.fileId,
        webViewLink: driveResult.webViewLink,
        downloadUrl: driveResult.downloadUrl,
        folderPath: driveResult.folderPath,
        uploadedBy: currentUserProfile?.name || currentUserProfile?.username || auth.currentUser?.email || 'Designer',
        uploadedAt: new Date().toISOString(),
        storageType: driveResult.storageType
      },
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserProfile?.name || currentUserProfile?.username || 'Designer'
    };

    // If request was unassigned, claim it for current designer
    if (!reqData.designerId || reqData.designerId === 'Unassigned') {
      updatePayload.designerId = auth.currentUser?.uid || currentUserProfile?.id;
      updatePayload.designerName = currentUserProfile?.name || currentUserProfile?.username || 'Designer';
      if (currentUserProfile?.username) {
        updatePayload.designerUsername = currentUserProfile.username;
      }
      updatePayload.assignmentType = reqData.assignmentType || 'claimed';
    }

    await updateDoc(reqRef, updatePayload);

    // Notify user
    if (reqData.userId) {
      await addDoc(collection(db, 'notifications'), {
        userId: reqData.userId,
        title: isFinal ? 'Final Poster Uploaded' : 'New Poster Version Available',
        message: `Version ${autoFileName} (${versionTag}) uploaded for "${reqData.mainHeading}".`,
        requestId,
        type: 'poster',
        read: false,
        createdAt: new Date().toISOString()
      });
    }

    await logActivity('Poster Uploaded', `Uploaded ${autoFileName} (${versionTag}) for ${requestId}`, requestId);
    showToast(isFinal ? 'Final poster saved to Google Drive!' : `Poster version ${autoFileName} uploaded!`, 'success');
    closeModal('upload-poster-modal');
  } catch (error) {
    console.error('Error in uploadPosterVersion:', error);
    handleFirestoreError(error, 'write', `requests/${requestId}/posterVersions`);
    throw error;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Upload to Google Drive';
    }
  }
}

/**
 * Committee Adds a Proof to a submitted poster.
 * Inherits Wing from the original poster, generates [wing_code]_pro_[number].
 * Links proof directly to the original submitted poster.
 * (Workflow: Create Poster -> Submit Poster -> Committee Reviews/Opens Poster -> Committee Adds Proof)
 */
export async function addCommitteeProof({
  posterId,
  file,
  notes = '',
  submitBtn
}) {
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Adding Proof...';
  }
  try {
    if (!file) throw new Error('Please select a proof file to upload.');
    if (!posterId) throw new Error('Target poster ID is required.');

    const reqRef = doc(db, 'requests', posterId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) throw new Error(`Submitted poster "${posterId}" not found.`);
    const posterData = reqSnap.data();

    // 1. Automatically inherit the Wing from the original poster (Requirement 5)
    const wingName = posterData.subCommitteeName || 'General';
    const wingCode = posterData.wingCode || getWingCode(wingName);

    // 2. Automatically generate Proof ID: [wing_code]_pro_[number] (Requirement 4 & 5)
    const { proofId, proofNumber } = await generateNextProofId(wingCode);

    // 3. Filename format: [wing_code]_pro_[number].ext
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.png';
    const targetFileName = `${proofId}${ext}`;

    // 4. Upload to Google Drive under Proof/{Committee Name}/ (Requirement 1: no language in path)
    const driveResult = await uploadFileToGoogleDrive({
      file,
      folderType: 'Proof',
      committeeName: wingName,
      targetFileName,
      requestId: posterId
    });

    // 5. Update wingCounters with the newly assigned proof number
    try {
      await setDoc(doc(db, 'wingCounters', wingCode), {
        wingCode,
        lastProofNumber: proofNumber,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.warn('Error updating wingCounter lastProofNumber:', err);
    }

    const user = auth.currentUser;
    const profile = currentUserProfile;

    const proofData = {
      proofId,
      proofNumber,
      posterId,
      requestId: posterId,
      wingCode,
      wingName,
      committeeName: wingName,
      subCommitteeId: posterData.subCommitteeId || '',
      fileName: driveResult.fileName || targetFileName,
      originalFileName: file.name,
      driveUrl: driveResult.driveUrl,
      webViewLink: driveResult.webViewLink,
      downloadUrl: driveResult.downloadUrl,
      folderPath: driveResult.folderPath,
      uploadedBy: user ? user.uid : 'committee',
      uploadedByName: profile?.name || profile?.username || user?.email || 'Committee Member',
      uploadedByRole: profile?.role || 'committee',
      uploadedAt: new Date().toISOString(),
      notes: notes || '',
      status: 'Proof Added',
      storageType: driveResult.storageType
    };

    // 6. Save in requests/{posterId}/proofVersions/{proofId} (Requirement 6)
    await setDoc(doc(db, 'requests', posterId, 'proofVersions', proofId), proofData);

    // 7. Save in root proofs collection for cross-collection indexing & queries
    await setDoc(doc(db, 'proofs', proofId), proofData);

    // 8. Update original poster document linking the proof
    await updateDoc(reqRef, {
      proof: {
        proofId,
        fileName: proofData.fileName,
        driveUrl: proofData.driveUrl,
        webViewLink: proofData.webViewLink,
        downloadUrl: proofData.downloadUrl,
        uploadedBy: proofData.uploadedByName,
        uploadedAt: proofData.uploadedAt
      },
      latestProofId: proofId,
      hasProof: true,
      updatedAt: new Date().toISOString(),
      updatedBy: proofData.uploadedByName
    });

    await logActivity('Proof Added', `Proof ${proofId} linked to poster ${posterId}`, posterId);
    showToast(`Proof ${proofId} successfully added to poster ${posterId}!`, 'success');
    closeModal('add-proof-modal');
    return proofData;
  } catch (error) {
    handleFirestoreError(error, 'write', `requests/${posterId}/proofVersions`);
    throw error;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Upload &amp; Link Proof';
    }
  }
}

// Backwards-compatibility wrapper
export async function uploadProofVersion(requestId, file, notes = '', submitBtn) {
  return addCommitteeProof({ posterId: requestId, file, notes, submitBtn });
}

// Mark Request as Final / Completed / Designing
export async function updateRequestStatus(requestId, status, posterStatus = null) {
  try {
    const updatePayload = {
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserProfile?.name || 'Admin'
    };
    if (posterStatus) {
      updatePayload.posterStatus = posterStatus;
    }
    await updateDoc(doc(db, 'requests', requestId), updatePayload);
    await logActivity('Status Updated', `Status of ${requestId} set to ${status}`, requestId);
    showToast(`Request status updated to ${status}`, 'success');
  } catch (err) {
    handleFirestoreError(err, 'update', `requests/${requestId}`);
  }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

export function listenToNotifications(userId, callback) {
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  return onSnapshot(q, (snap) => {
    const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(notifs);
  }, (err) => {
    console.warn('Notifications listener error:', err);
  });
}

export async function markNotificationAsRead(notifId) {
  try {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  } catch (err) {
    console.warn(err);
  }
}

// ============================================================
// ADMIN MANAGEMENT ACTIONS
// ============================================================

/**
 * Approve pending User Request:
 * 1. Checks or creates Sub-Committee via ensureSubCommitteeExists()
 * 2. Reads existing applicant's Auth UID (from userRequests record)
 * 3. Creates users/{uid} document with active: true
 * 4. Activates username in usernames/{normalized}
 * 5. Marks userRequests/{id} approved
 * ZERO passwords handled or stored in Firestore!
 */
export async function adminApproveUserRequest(reqId, selectedSubCommitteeName, submitBtn) {
  if (submitBtn) submitBtn.disabled = true;
  try {
    const snap = await getDoc(doc(db, 'userRequests', reqId));
    if (!snap.exists()) throw new Error('Registration request not found');
    const reqData = snap.data();

    const subcName = (selectedSubCommitteeName || reqData.committeeName || 'General').trim();
    const subCommittee = await ensureSubCommitteeExists(subcName);

    const uid = reqData.uid;
    const email = reqData.email1;
    const username = reqData.username || reqData.committeeName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const usernameNormalized = normalizeUsername(username);

    // Save User profile in users/{uid}
    await setDoc(doc(db, 'users', uid), {
      username,
      usernameNormalized,
      name: reqData.chairman || reqData.committeeName,
      email,
      email2: reqData.email2 || '',
      role: 'user',
      subCommitteeId: subCommittee.id,
      subCommitteeName: subCommittee.name,
      chairman: reqData.chairman || '',
      convenor: reqData.convenor || '',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Activate username record
    await setDoc(doc(db, 'usernames', usernameNormalized), {
      username,
      usernameNormalized,
      email,
      uid,
      status: 'active',
      updatedAt: new Date().toISOString()
    });

    // Mark userRequest as approved
    await updateDoc(doc(db, 'userRequests', reqId), {
      status: 'approved',
      assignedSubCommitteeId: subCommittee.id,
      assignedSubCommitteeName: subCommittee.name,
      processedAt: new Date().toISOString(),
      processedBy: currentUserProfile?.name || 'Admin'
    });

    // Also activate in emails collection
    await setDoc(doc(db, 'emails', getEmailDocId(email)), {
      email,
      uid,
      status: 'active',
      updatedAt: new Date().toISOString()
    });

    await logActivity('User Approved', `Approved user @${username} (${email}) for ${subCommittee.name}`);
    showToast(`Approved account for @${username}!`, 'success');
  } catch (err) {
    showToast(err.message || 'Approval failed', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Reject pending User Request
export async function adminRejectUserRequest(reqId) {
  try {
    const snap = await getDoc(doc(db, 'userRequests', reqId));
    if (snap.exists()) {
      const data = snap.data();
      if (data.usernameNormalized) {
        await deleteDoc(doc(db, 'usernames', data.usernameNormalized)).catch(() => {});
      }
      if (data.email1) {
        await deleteDoc(doc(db, 'emails', getEmailDocId(data.email1))).catch(() => {});
      }
    }
    await updateDoc(doc(db, 'userRequests', reqId), {
      status: 'rejected',
      processedAt: new Date().toISOString(),
      processedBy: currentUserProfile?.name || 'Admin'
    });
    await logActivity('User Request Rejected', `Rejected user request ${reqId}`);
    showToast('Application marked as rejected', 'info');
  } catch (err) {
    handleFirestoreError(err, 'update', `userRequests/${reqId}`);
  }
}

// Approve pending Designer Request
export async function adminApproveDesignerRequest(reqId, submitBtn) {
  if (submitBtn) submitBtn.disabled = true;
  try {
    const snap = await getDoc(doc(db, 'designerRequests', reqId));
    if (!snap.exists()) throw new Error('Request not found');
    const data = snap.data();
    const uid = data.uid;
    const username = (data.username || '').trim();
    const usernameNormalized = data.usernameNormalized || normalizeUsername(username);

    await setDoc(doc(db, 'users', uid), {
      name: data.name,
      username: username,
      usernameNormalized: usernameNormalized,
      email: data.email,
      contactNumber: data.contactNumber || '',
      role: 'designer',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await setDoc(doc(db, 'designers', uid), {
      name: data.name,
      username: username,
      usernameNormalized: usernameNormalized,
      email: data.email,
      contactNumber: data.contactNumber || '',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (usernameNormalized) {
      await setDoc(doc(db, 'usernames', usernameNormalized), {
        username: username,
        usernameNormalized: usernameNormalized,
        email: data.email,
        uid: uid,
        status: 'active',
        updatedAt: new Date().toISOString()
      });
    }

    if (data.email) {
      await setDoc(doc(db, 'emails', getEmailDocId(data.email)), {
        email: data.email,
        uid: uid,
        status: 'active',
        updatedAt: new Date().toISOString()
      });
    }

    await updateDoc(doc(db, 'designerRequests', reqId), {
      status: 'approved',
      processedAt: new Date().toISOString(),
      processedBy: currentUserProfile?.name || 'Admin'
    });

    await logActivity('Designer Approved', `Approved designer ${data.name} (@${username}) (${data.email})`);
    showToast(`Approved designer ${data.name}!`, 'success');
  } catch (err) {
    showToast(err.message || 'Designer approval failed', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Reject pending Designer Request
export async function adminRejectDesignerRequest(reqId) {
  try {
    const snap = await getDoc(doc(db, 'designerRequests', reqId));
    if (snap.exists()) {
      const data = snap.data();
      if (data.usernameNormalized) {
        await deleteDoc(doc(db, 'usernames', data.usernameNormalized)).catch(() => {});
      }
      if (data.email) {
        await deleteDoc(doc(db, 'emails', getEmailDocId(data.email))).catch(() => {});
      }
    }
    await updateDoc(doc(db, 'designerRequests', reqId), {
      status: 'rejected',
      processedAt: new Date().toISOString(),
      processedBy: currentUserProfile?.name || 'Admin'
    });
    await logActivity('Designer Request Rejected', `Rejected designer request ${reqId}`);
    showToast('Designer request rejected', 'info');
  } catch (err) {
    handleFirestoreError(err, 'update', `designerRequests/${reqId}`);
  }
}

// Admin Direct Create User/Designer/Monitor
export async function adminCreateAccount(data, submitBtn) {
  if (submitBtn) submitBtn.disabled = true;
  try {
    const { name, username, email, password, role, subCommitteeId, subCommitteeName, committeeId, committeeName, inheritedSubCommittees, inheritedSubCommitteeIds, contactNumber } = data;

    if (!name || !name.trim()) {
      throw new Error('Please enter a full name.');
    }

    let normUsername = '';
    if (role === 'user' || role === 'designer' || username) {
      const uVal = validateUsernameFormat(username);
      if (!uVal.valid) {
        throw new Error(uVal.error);
      }
      normUsername = normalizeUsername(username);
      const isAvail = await isUsernameAvailable(normUsername);
      if (!isAvail) throw new Error('Username already exists');
    }

    const eVal = validateEmailFormat(email);
    if (!eVal.valid) {
      throw new Error(eVal.error);
    }
    const isMailAvail = await isEmailAvailable(email.trim());
    if (!isMailAvail) throw new Error('Email already exists');

    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    let newUid;
    try {
      newUid = await adminCreateUserAccount(email.trim(), password);
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-in-use') {
        throw new Error('Email already exists');
      }
      throw authErr;
    }

    const userProfile = {
      name: name.trim(),
      email: email.trim(),
      username: username ? username.trim() : '',
      usernameNormalized: normUsername,
      role: role || 'user',
      subCommitteeId: subCommitteeId || '',
      subCommitteeName: subCommitteeName || '',
      committeeId: committeeId || '',
      committeeName: committeeName || '',
      inheritedSubCommittees: inheritedSubCommittees || [],
      inheritedSubCommitteeIds: inheritedSubCommitteeIds || [],
      contactNumber: contactNumber || '',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc(doc(db, 'users', newUid), userProfile);

    if (normUsername) {
      await setDoc(doc(db, 'usernames', normUsername), {
        username: username.trim(),
        usernameNormalized: normUsername,
        email: email.trim(),
        uid: newUid,
        status: 'active',
        createdAt: new Date().toISOString()
      });
    }

    await setDoc(doc(db, 'emails', getEmailDocId(email)), {
      email: email.trim(),
      uid: newUid,
      status: 'active',
      createdAt: new Date().toISOString()
    });

    if (role === 'designer') {
      await setDoc(doc(db, 'designers', newUid), {
        name: name.trim(),
        username: username ? username.trim() : '',
        usernameNormalized: normUsername,
        email: email.trim(),
        contactNumber: contactNumber || '',
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await logActivity('Account Created', `Admin created ${role} account for ${name} (${email})`);
    showToast(`Successfully created ${role} account!`, 'success');
    closeModal('add-user-modal');
  } catch (err) {
    showToast(err.message || 'Failed to create user', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Admin assigns username to existing user without one
export async function adminAssignUsername(userId, rawUsername) {
  const uVal = validateUsernameFormat(rawUsername);
  if (!uVal.valid) {
    throw new Error(uVal.error);
  }
  const norm = normalizeUsername(rawUsername);
  const isAvail = await isUsernameAvailable(norm, userId);
  if (!isAvail) throw new Error('Username already exists');

  const userSnap = await getDoc(doc(db, 'users', userId));
  if (!userSnap.exists()) throw new Error('User not found');
  const userData = userSnap.data();

  // If user already had a different normalized username, clean it up
  if (userData.usernameNormalized && userData.usernameNormalized !== norm) {
    await deleteDoc(doc(db, 'usernames', userData.usernameNormalized)).catch(() => {});
  }

  await updateDoc(doc(db, 'users', userId), {
    username: rawUsername.trim(),
    usernameNormalized: norm,
    updatedAt: new Date().toISOString()
  });

  // If user is a designer, also update designers collection
  if (userData.role === 'designer') {
    await updateDoc(doc(db, 'designers', userId), {
      username: rawUsername.trim(),
      usernameNormalized: norm,
      updatedAt: new Date().toISOString()
    }).catch(() => {});
  }

  await setDoc(doc(db, 'usernames', norm), {
    username: rawUsername.trim(),
    usernameNormalized: norm,
    email: userData.email,
    uid: userId,
    status: 'active'
  });

  await logActivity('Username Assigned', `Admin assigned @${rawUsername} to user ${userData.email}`);
  showToast(`Username @${rawUsername} assigned successfully!`, 'success');
}

// Admin assigns Committee and Sub-Committees to user
export async function adminAssignCommitteeAndSubCommittees(userId, assignment) {
  try {
    const updateData = {
      committeeId: assignment.committeeId || '',
      committeeName: assignment.committeeName || '',
      subCommitteeId: assignment.subCommitteeId || '',
      subCommitteeName: assignment.subCommitteeName || '',
      inheritedSubCommittees: assignment.inheritedSubCommittees || [],
      inheritedSubCommitteeIds: assignment.inheritedSubCommitteeIds || [],
      updatedAt: new Date().toISOString()
    };
    await updateDoc(doc(db, 'users', userId), updateData);
    const target = assignment.committeeName || assignment.subCommitteeName || 'None';
    await logActivity('Committee Assigned', `Assigned user ${userId} to ${target}`);
    showToast(target !== 'None' ? `Assigned to ${target}` : 'Committee assignment cleared', 'success');
  } catch (err) {
    handleFirestoreError(err, 'update', `users/${userId}`);
  }
}

// Admin assigns Sub-Committee to user (backward compatible)
export async function adminAssignSubCommittee(userId, subCommitteeId, subCommitteeName) {
  return adminAssignCommitteeAndSubCommittees(userId, {
    subCommitteeId: subCommitteeId || '',
    subCommitteeName: subCommitteeName || '',
    committeeId: '',
    committeeName: subCommitteeName || '',
    inheritedSubCommittees: [],
    inheritedSubCommitteeIds: []
  });
}

// Toggle User Active Status
export async function toggleUserActive(userId, currentActive) {
  try {
    await updateDoc(doc(db, 'users', userId), {
      active: !currentActive,
      updatedAt: new Date().toISOString()
    });
    await logActivity('User Status Changed', `User ${userId} active set to ${!currentActive}`);
    showToast(`User ${!currentActive ? 'enabled' : 'disabled'}`, 'success');
  } catch (err) {
    handleFirestoreError(err, 'update', `users/${userId}`);
  }
}

// Admin Assigns / Overrides Designer on Request
export async function adminOverrideDesigner(requestId, designerId, designerName) {
  try {
    await updateDoc(doc(db, 'requests', requestId), {
      designerId,
      designerName,
      assignmentType: 'admin_assigned',
      assignedByAdmin: true,
      status: 'Assigned',
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserProfile?.name || 'Admin'
    });

    await addDoc(collection(db, 'notifications'), {
      userId: designerId,
      title: 'New Request Assigned',
      message: `Request ${requestId} assigned to you by Administrator.`,
      requestId,
      type: 'assignment',
      read: false,
      createdAt: new Date().toISOString()
    });

    await logActivity('Designer Assigned', `Admin assigned designer ${designerName} to ${requestId}`, requestId);
    showToast(`Designer assigned to ${designerName}`, 'success');
    closeModal('admin-request-modal');
  } catch (err) {
    handleFirestoreError(err, 'update', `requests/${requestId}`);
  }
}

export const adminAssignDesigner = adminOverrideDesigner;

// Sub-Committee Management
export async function adminSaveSubCommittee(id, data) {
  try {
    const payload = {
      name: data.name.trim(),
      normalizedName: data.name.trim().toLowerCase(),
      parentCommittee: (data.parentCommittee || '').trim(),
      description: (data.description || '').trim(),
      defaultDesignerId: data.defaultDesignerId || '',
      defaultDesignerName: data.defaultDesignerName || '',
      active: data.active !== false,
      updatedAt: new Date().toISOString()
    };

    if (id) {
      await updateDoc(doc(db, 'subCommittees', id), payload);
      showToast('Sub-Committee updated', 'success');
    } else {
      payload.createdAt = new Date().toISOString();
      const newDoc = await addDoc(collection(db, 'subCommittees'), payload);
      id = newDoc.id;
      showToast('Sub-Committee created', 'success');
    }

    if (data.defaultDesignerId) {
      await setDoc(doc(db, 'designerAssignments', id), {
        committeeId: id,
        committeeName: data.name.trim(),
        designerId: data.defaultDesignerId,
        designerName: data.defaultDesignerName || '',
        updatedAt: new Date().toISOString(),
        updatedBy: currentUserProfile?.name || 'Admin'
      });
    }

    await logActivity('Sub-Committee Saved', `Saved sub-committee ${data.name}`);
    closeModal('subcommittee-modal');
  } catch (err) {
    handleFirestoreError(err, 'write', 'subCommittees');
  }
}

// Class Union Management (Preserved for collaboration)
export async function adminSaveClassUnion(id, data) {
  try {
    const payload = {
      name: data.name.trim(),
      description: (data.description || '').trim(),
      active: data.active !== false,
      updatedAt: new Date().toISOString()
    };
    if (id) {
      await updateDoc(doc(db, 'classUnions', id), payload);
      showToast('Class Union updated', 'success');
    } else {
      payload.createdAt = new Date().toISOString();
      await addDoc(collection(db, 'classUnions'), payload);
      showToast('Class Union created', 'success');
    }
    await logActivity('Class Union Saved', `Saved class union ${data.name}`);
    closeModal('classunion-modal');
  } catch (err) {
    handleFirestoreError(err, 'write', 'classUnions');
  }
}

// One-Click Bootstrap Sample Sub-Committees & Class Unions
export async function bootstrapSampleData() {
  try {
    showToast('Bootstrapping system defaults...', 'info');

    const sampleCommittees = [
      { name: 'Arabic Wing', description: 'Arabic language, literature and symposiums' },
      { name: 'English Wing', description: 'English literary society, debates and newsletters' },
      { name: 'Urdu Wing', description: 'Urdu poetry, cultural evenings and magazines' },
      { name: 'Media & IT Wing', description: 'Digital media, photography and social designs' },
      { name: 'Arts & Culture', description: 'Fine arts, drama, stage and cultural fest' }
    ];

    for (const c of sampleCommittees) {
      await ensureSubCommitteeExists(c.name);
    }

    const sampleClasses = [
      { name: 'Class Union 2024', description: 'Senior Year Class Union' },
      { name: 'Class Union 2025', description: 'Junior Year Class Union' },
      { name: 'Class Union 2026', description: 'Sophomore Class Union' },
      { name: 'Freshman Council 2027', description: 'First Year Students Council' }
    ];

    for (const cu of sampleClasses) {
      const snap = await getDocs(query(collection(db, 'classUnions'), where('name', '==', cu.name)));
      if (snap.empty) {
        await addDoc(collection(db, 'classUnions'), {
          ...cu,
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    }

    await logActivity('Initial Setup', 'Admin initialized default Sub-Committees and Class Unions');
    showToast('Standard Sub-Committees and Class Unions ready!', 'success');
  } catch (err) {
    showToast(err.message || 'Seeding failed', 'error');
  }
}

// ============================================================
// BACKUP & EXPORT
// ============================================================

export function exportToCsv(filename, rows) {
  if (!rows || !rows.length) {
    showToast('No records available to export', 'error');
    return;
  }
  const keys = Object.keys(rows[0]).filter(k => !k.toLowerCase().includes('password'));
  const csvContent = [
    keys.join(','),
    ...rows.map(row => keys.map(k => {
      let cell = row[k] === null || row[k] === undefined ? '' : row[k];
      if (typeof cell === 'object') cell = JSON.stringify(cell);
      cell = String(cell).replace(/"/g, '""');
      if (cell.search(/("|,|\n)/g) >= 0) cell = `"${cell}"`;
      return cell;
    }).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Exported ${filename}.csv`, 'success');
}

export async function exportFullJsonBackup() {
  try {
    showToast('Preparing complete JSON backup...', 'info');
    const backupData = {};
    const collectionsToBackup = [
      'users',
      'usernames',
      'designers',
      'requests',
      'subCommittees',
      'classUnions',
      'designerAssignments',
      'activityLogs',
      'settings'
    ];

    for (const colName of collectionsToBackup) {
      const snap = await getDocs(collection(db, colName));
      backupData[colName] = snap.docs.map(d => {
        const data = d.data();
        delete data.password;
        return { id: d.id, ...data };
      });
    }

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `union_design_hub_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Complete JSON backup downloaded successfully!', 'success');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
}
