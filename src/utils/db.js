/**
 * ============================================================
 *  AtikMeet - Database Module (Main Process)
 *  Google Firebase Cloud Firestore Adapter
 * ============================================================
 */

const { initializeApp } = require('firebase/app');
const { 
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, 
  collection, getDocs, query, where, limit, orderBy 
} = require('firebase/firestore');
const bcrypt = require('bcryptjs');

// ── Firebase Configuration ──────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyD64hpb45ltuKtwIDn2HWlHuXHgUpa5z3U",
  authDomain: "atikmeet-cloud.firebaseapp.com",
  projectId: "atikmeet-cloud",
  storageBucket: "atikmeet-cloud.firebasestorage.app",
  messagingSenderId: "435211284956",
  appId: "1:435211284956:web:a3448e638fca3fcf4e1f19",
  measurementId: "G-SBFBZCQTN2"
};

const app = initializeApp(firebaseConfig);
const firestoreDb = getFirestore(app);

const SALT_ROUNDS = 10;
const LICENSE_PREFIX = 'ATIK';

// Seed default keys in Firestore on startup
async function seedDefaultKeys() {
  try {
    const defaultKeys = [
      {
        key: 'ATIK-DEMO-2024-FREE',
        createdAt: new Date().toISOString(),
        isActive: false,
        assignedTo: null,
        activatedAt: null,
        isShared: false
      },
      {
        key: 'ATIK-FREE-PUBLIC-2026',
        createdAt: new Date().toISOString(),
        isActive: false,
        assignedTo: null,
        activatedAt: null,
        isShared: true
      },
      {
        key: 'ATIK-ADMIN-VIP-2026',
        createdAt: new Date().toISOString(),
        isActive: false,
        assignedTo: null,
        activatedAt: null,
        isShared: false
      }
    ];

    for (const keyObj of defaultKeys) {
      const docRef = doc(firestoreDb, 'licenseKeys', keyObj.key);
      const snapshot = await getDoc(docRef);
      if (!snapshot.exists()) {
        await setDoc(docRef, keyObj);
        console.log(`[Firebase DB] Seeded default license key: ${keyObj.key}`);
      }
    }
  } catch (err) {
    console.error('[Firebase DB] Seeding default keys failed:', err.message);
  }
}

// Run seeding asynchronously
seedDefaultKeys();

// ── User Management ──────────────────────────────────────────

async function createUser({ name, email, password, role = 'user' }) {
  try {
    if (!email) return { success: false, error: 'Email is required.' };
    const docRef = doc(firestoreDb, 'users', email.toLowerCase());
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return { success: false, error: 'User with this email already exists.' };
    }

    const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);
    const newUser = {
      id: email.toLowerCase(),
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      isAdmin: role === 'admin',
      isVIP: role === 'admin' || false,
      licenseKey: null,
      licenseExpiry: null,
      createdAt: new Date().toISOString(),
      isBanned: false
    };

    await setDoc(docRef, newUser);
    return { success: true, user: { ...newUser, password: undefined } };
  } catch (error) {
    console.error('[Firebase DB] createUser error:', error.message);
    return { success: false, error: 'Failed to create user.' };
  }
}

async function loginUser(email, password) {
  try {
    if (!email || !password) return { success: false, error: 'Email and password are required.' };
    const docRef = doc(firestoreDb, 'users', email.toLowerCase());
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) {
      return { success: false, error: 'Invalid email or password.' };
    }

    const user = snapshot.data();
    if (user.isBanned) {
      return { success: false, error: 'Your account has been banned by the administrator.' };
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return { success: false, error: 'Invalid email or password.' };
    }

    return { success: true, user: { ...user, password: undefined } };
  } catch (error) {
    console.error('[Firebase DB] loginUser error:', error.message);
    return { success: false, error: 'Login failed.' };
  }
}

async function getUserById(email) {
  try {
    if (!email) return null;
    const docRef = doc(firestoreDb, 'users', email.toLowerCase());
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return snapshot.data();
    }
    return null;
  } catch (error) {
    console.error('[Firebase DB] getUserById error:', error.message);
    return null;
  }
}

async function getAllUsers() {
  try {
    const colRef = collection(firestoreDb, 'users');
    const snapshot = await getDocs(colRef);
    const users = [];
    snapshot.forEach(docSnap => {
      users.push(docSnap.data());
    });
    return users;
  } catch (error) {
    console.error('[Firebase DB] getAllUsers error:', error.message);
    return [];
  }
}

async function updateUser(email, data) {
  try {
    if (!email) return { success: false, error: 'Email is required.' };
    const docRef = doc(firestoreDb, 'users', email.toLowerCase());
    
    // Sanitize updates to prevent overwriting key internal IDs
    const updates = { ...data };
    delete updates.id;
    delete updates.email;
    if (updates.password) {
      updates.password = bcrypt.hashSync(updates.password, SALT_ROUNDS);
    }

    await updateDoc(docRef, updates);
    return { success: true };
  } catch (error) {
    console.error('[Firebase DB] updateUser error:', error.message);
    return { success: false, error: 'Failed to update user.' };
  }
}

async function deleteUser(email) {
  try {
    if (!email) return { success: false, error: 'Email is required.' };
    const user = await getUserById(email);
    if (user && user.isAdmin) {
      return { success: false, error: 'Cannot delete admin user.' };
    }
    const docRef = doc(firestoreDb, 'users', email.toLowerCase());
    await deleteDoc(docRef);
    return { success: true };
  } catch (error) {
    console.error('[Firebase DB] deleteUser error:', error.message);
    return { success: false, error: 'Failed to delete user.' };
  }
}

// ── Settings ─────────────────────────────────────────────────

async function getSettings() {
  try {
    const docRef = doc(firestoreDb, 'settings', 'system');
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return snapshot.data();
    } else {
      const defaultSettings = {
        installDate: new Date().toISOString(),
        trialDays: 7,
        adminEmail: 'atik@atikmeet.com',
        maintenanceMode: false,
        maxParticipants: 150
      };
      await setDoc(docRef, defaultSettings);
      return defaultSettings;
    }
  } catch (error) {
    console.error('[Firebase DB] getSettings error:', error.message);
    return null;
  }
}

async function updateSettings(updates) {
  try {
    const docRef = doc(firestoreDb, 'settings', 'system');
    await updateDoc(docRef, updates);
    return { success: true };
  } catch (error) {
    console.error('[Firebase DB] updateSettings error:', error.message);
    return { success: false, error: 'Failed to update settings.' };
  }
}

async function toggleUserBan(email) {
  try {
    const user = await getUserById(email);
    if (!user) return { success: false, error: 'User not found.' };
    if (user.isAdmin) return { success: false, error: 'Cannot ban admin user.' };

    const newBanState = !user.isBanned;
    await updateUser(email, { isBanned: newBanState });
    return { success: true, isBanned: newBanState };
  } catch (error) {
    console.error('[Firebase DB] toggleUserBan error:', error.message);
    return { success: false, error: 'Failed to toggle ban state.' };
  }
}

async function toggleUserRole(email) {
  try {
    const user = await getUserById(email);
    if (!user) return { success: false, error: 'User not found.' };
    if (user.email === 'admin@atikmeet.com') {
      return { success: false, error: 'Cannot change root admin role.' };
    }

    const newRole = user.role === 'admin' ? 'user' : 'admin';
    await updateUser(email, {
      role: newRole,
      isAdmin: newRole === 'admin',
      isVIP: newRole === 'admin' || user.isVIP // Admins are always VIP
    });
    return { success: true, role: newRole };
  } catch (error) {
    console.error('[Firebase DB] toggleUserRole error:', error.message);
    return { success: false, error: 'Failed to toggle user role.' };
  }
}

// ── License Management ────────────────────────────────────────

async function generateLicenseKey(durationDays = 30) {
  try {
    const generateSegment = () => Math.random().toString(36).substring(2, 6).toUpperCase();
    const key = `${LICENSE_PREFIX}-${generateSegment()}-${generateSegment()}-${generateSegment()}`;
    const newKeyObj = {
      key,
      durationDays,
      createdAt: new Date().toISOString(),
      isActive: false,
      assignedTo: null,
      activatedAt: null,
      isShared: false
    };

    const docRef = doc(firestoreDb, 'licenseKeys', key);
    await setDoc(docRef, newKeyObj);
    return key;
  } catch (error) {
    console.error('[Firebase DB] generateLicenseKey error:', error.message);
    return null;
  }
}

async function activateLicense(email, key) {
  try {
    if (!email || !key) return { success: false, error: 'Email and key are required.' };
    const keyDocRef = doc(firestoreDb, 'licenseKeys', key.toUpperCase());
    const keySnapshot = await getDoc(keyDocRef);
    if (!keySnapshot.exists()) {
      return { success: false, error: 'Invalid license key.' };
    }

    const license = keySnapshot.data();
    if (license.isActive && !license.isShared) {
      return { success: false, error: 'License key has already been used.' };
    }

    const user = await getUserById(email);
    if (!user) return { success: false, error: 'User not found.' };

    const durationDays = license.durationDays;
    let expiryDate = null;
    if (durationDays !== 'lifetime') {
      const days = parseInt(durationDays) || 30;
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
      expiryDate = expiry.toISOString();
    } else {
      expiryDate = 'lifetime';
    }

    // Update User Profile
    await updateUser(email, {
      isVIP: true,
      licenseKey: key,
      licenseExpiry: expiryDate
    });

    // Update License State (if not public/shared key)
    if (!license.isShared) {
      await updateDoc(keyDocRef, {
        isActive: true,
        assignedTo: email.toLowerCase(),
        activatedAt: new Date().toISOString()
      });
    }

    return { success: true, expiryDate };
  } catch (error) {
    console.error('[Firebase DB] activateLicense error:', error.message);
    return { success: false, error: 'Failed to activate license.' };
  }
}

async function deactivateLicense(email) {
  try {
    if (!email) return { success: false, error: 'Email is required.' };
    const user = await getUserById(email);
    if (!user) return { success: false, error: 'User not found.' };

    const key = user.licenseKey;
    await updateUser(email, {
      isVIP: user.role === 'admin', // Admins retain VIP
      licenseKey: null,
      licenseExpiry: null
    });

    if (key) {
      const keyDocRef = doc(firestoreDb, 'licenseKeys', key.toUpperCase());
      const keySnapshot = await getDoc(keyDocRef);
      if (keySnapshot.exists()) {
        const license = keySnapshot.data();
        if (!license.isShared) {
          await updateDoc(keyDocRef, {
            isActive: false,
            assignedTo: null,
            activatedAt: null
          });
        }
      }
    }
    return { success: true };
  } catch (error) {
    console.error('[Firebase DB] deactivateLicense error:', error.message);
    return { success: false, error: 'Failed to deactivate license.' };
  }
}

async function getTrialDaysRemaining() {
  try {
    const settings = await getSettings();
    if (!settings || !settings.installDate) return 0;
    const installTime = new Date(settings.installDate).getTime();
    const nowTime = new Date().getTime();
    const diffDays = (nowTime - installTime) / (1000 * 60 * 60 * 24);
    const remaining = (settings.trialDays || 7) - diffDays;
    return Math.max(0, Math.ceil(remaining));
  } catch (error) {
    console.error('[Firebase DB] getTrialDaysRemaining error:', error.message);
    return 0;
  }
}

async function isTrialExpired() {
  const remaining = await getTrialDaysRemaining();
  return remaining <= 0;
}

async function setInstallDate() {
  try {
    const settings = await getSettings();
    if (settings && !settings.installDate) {
      await updateSettings({ installDate: new Date().toISOString() });
    }
  } catch (error) {
    console.error('[Firebase DB] setInstallDate error:', error.message);
  }
}

// ── Meeting Management ────────────────────────────────────────

async function createMeeting({ id, title, hostId, hostName, type = 'instant' }) {
  try {
    const newMeeting = {
      id,
      title: title || `Meeting with ${hostName}`,
      hostId: hostId.toLowerCase(),
      hostName,
      type,
      isActive: true,
      startedAt: new Date().toISOString(),
      participants: []
    };

    const docRef = doc(firestoreDb, 'meetings', id);
    await setDoc(docRef, newMeeting);
    return { success: true, meeting: newMeeting };
  } catch (error) {
    console.error('[Firebase DB] createMeeting error:', error.message);
    return { success: false, error: 'Failed to create meeting.' };
  }
}

async function getMeeting(meetingId) {
  try {
    if (!meetingId) return null;
    const docRef = doc(firestoreDb, 'meetings', meetingId);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return snapshot.data();
    }
    return null;
  } catch (error) {
    console.error('[Firebase DB] getMeeting error:', error.message);
    return null;
  }
}

async function updateMeeting(meetingId, updates) {
  try {
    if (!meetingId) return { success: false, error: 'Meeting ID is required.' };
    const docRef = doc(firestoreDb, 'meetings', meetingId);
    await updateDoc(docRef, updates);
    return { success: true };
  } catch (error) {
    console.error('[Firebase DB] updateMeeting error:', error.message);
    return { success: false, error: 'Failed to update meeting.' };
  }
}

async function endMeeting(meetingId) {
  try {
    return await updateMeeting(meetingId, {
      isActive: false,
      endedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Firebase DB] endMeeting error:', error.message);
    return { success: false, error: 'Failed to end meeting.' };
  }
}

async function deleteMeeting(meetingId) {
  try {
    if (!meetingId) return { success: false, error: 'Meeting ID is required.' };
    const docRef = doc(firestoreDb, 'meetings', meetingId);
    await deleteDoc(docRef);
    return { success: true };
  } catch (error) {
    console.error('[Firebase DB] deleteMeeting error:', error.message);
    return { success: false, error: 'Failed to delete meeting.' };
  }
}

async function getAllMeetings() {
  try {
    const colRef = collection(firestoreDb, 'meetings');
    const snapshot = await getDocs(colRef);
    const meetings = [];
    snapshot.forEach(docSnap => {
      meetings.push(docSnap.data());
    });
    return meetings;
  } catch (error) {
    console.error('[Firebase DB] getAllMeetings error:', error.message);
    return [];
  }
}

async function getActiveMeetings() {
  try {
    const colRef = collection(firestoreDb, 'meetings');
    const q = query(colRef, where('isActive', '==', true));
    const snapshot = await getDocs(q);
    const meetings = [];
    snapshot.forEach(docSnap => {
      meetings.push(docSnap.data());
    });
    return meetings;
  } catch (error) {
    console.error('[Firebase DB] getActiveMeetings error:', error.message);
    return [];
  }
}

async function getUserMeetings(userId) {
  try {
    if (!userId) return [];
    const lowerUserId = userId.toLowerCase();
    const colRef = collection(firestoreDb, 'meetings');
    
    // Query where user is host
    const q1 = query(colRef, where('hostId', '==', lowerUserId));
    const snap1 = await getDocs(q1);
    
    const meetingsMap = new Map();
    snap1.forEach(docSnap => {
      meetingsMap.set(docSnap.id, docSnap.data());
    });

    // Also fetch all meetings and check if userId is in participants list
    // (Firestore doesn't support complex nested array-contains easily in standard query here without index)
    const allSnap = await getDocs(colRef);
    allSnap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.participants && data.participants.some(p => p.userId && p.userId.toLowerCase() === lowerUserId)) {
        meetingsMap.set(docSnap.id, data);
      }
    });

    const meetings = Array.from(meetingsMap.values());
    meetings.sort((a, b) => new Date(b.startedAt || b.createdAt) - new Date(a.startedAt || a.createdAt));
    return meetings;
  } catch (error) {
    console.error('[Firebase DB] getUserMeetings error:', error.message);
    return [];
  }
}

// ── Statistics ───────────────────────────────────────────────

async function getStats() {
  try {
    const users = await getAllUsers();
    const meetings = await getAllMeetings();
    
    const colRefKeys = collection(firestoreDb, 'licenseKeys');
    const snapKeys = await getDocs(colRefKeys);
    let totalKeys = 0;
    let activeKeys = 0;
    snapKeys.forEach(docSnap => {
      totalKeys++;
      if (docSnap.data().isActive) activeKeys++;
    });

    const liveMeetings = meetings.filter(m => m.isActive).length;

    return {
      totalUsers: users.length,
      totalMeetings: meetings.length,
      liveMeetings,
      totalKeys,
      activeKeys
    };
  } catch (error) {
    console.error('[Firebase DB] getStats error:', error.message);
    return {
      totalUsers: 0,
      totalMeetings: 0,
      liveMeetings: 0,
      totalKeys: 0,
      activeKeys: 0
    };
  }
}

module.exports = {
  firestoreDb, // Expose for signaling or settings
  createUser,
  loginUser,
  getUserById,
  getAllUsers,
  updateUser,
  deleteUser,
  getSettings,
  updateSettings,
  toggleUserBan,
  toggleUserRole,
  generateLicenseKey,
  activateLicense,
  deactivateLicense,
  getTrialDaysRemaining,
  isTrialExpired,
  setInstallDate,
  createMeeting,
  getMeeting,
  updateMeeting,
  endMeeting,
  getAllMeetings,
  getActiveMeetings,
  getUserMeetings,
  deleteMeeting,
  getStats,
};
