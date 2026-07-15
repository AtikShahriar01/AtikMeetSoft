// AtikMeet - Firebase Initialization layer
const firebaseConfig = {
  apiKey: "AIzaSyD64hpb45ltuKtwIDn2HWlHuXHgUpa5z3U",
  authDomain: "atikmeet-cloud.firebaseapp.com",
  projectId: "atikmeet-cloud",
  storageBucket: "atikmeet-cloud.firebasestorage.app",
  messagingSenderId: "435211284956",
  appId: "1:435211284956:web:a3448e638fca3fcf4e1f19",
  measurementId: "G-SBFBZCQTN2"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const firestoreDb = firebase.firestore();
const firebaseAuth = firebase.auth();
