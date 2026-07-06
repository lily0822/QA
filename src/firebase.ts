import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyBGxFJzUtBp_OoK_7-zoLAj_3vRZgmBbH8',
  authDomain: 'qa-food-465bd.firebaseapp.com',
  projectId: 'qa-food-465bd',
  storageBucket: 'qa-food-465bd.firebasestorage.app',
  messagingSenderId: '392699108790',
  appId: '1:392699108790:web:890937be1502fb37d47517',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
