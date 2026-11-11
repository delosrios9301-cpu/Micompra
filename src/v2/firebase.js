import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAl4V04MCm0l1D8VPY606bl2L3SaAccOOA',
  authDomain: 'mi-compra-d9717.firebaseapp.com',
  projectId: 'mi-compra-d9717',
  storageBucket: 'mi-compra-d9717.firebasestorage.app',
  messagingSenderId: '993392968752',
  appId: '1:993392968752:web:86a407dae0b0ab18ea59f5',
  measurementId: 'G-B81XYPLW5P'
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);