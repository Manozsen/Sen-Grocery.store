// ============================================================
// firebase.js — CDN Modular Firebase v10 Initialization
// ============================================================

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyB6ReykN0Ep-sEecHKAbDR1z32IOprOZJI",
  authDomain:        "sen-grocery-webpage.firebaseapp.com",
  projectId:         "sen-grocery-webpage",
  storageBucket:     "sen-grocery-webpage.firebasestorage.app",
  messagingSenderId: "858989811683",
  appId:             "1:858989811683:web:aac52da5be99d88c2db2d6",
};

const app = initializeApp(firebaseConfig);

export const db   = getFirestore(app);
export const auth = getAuth(app);
