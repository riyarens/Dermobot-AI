# Firebase Authentication setup

This project uses Firebase Authentication with email and password. It does not configure or use Firestore.

## Connect your Firebase project

1. In your Firebase account, open the project you want Dermobot to use.
2. Open **Project settings → General → Your apps** and copy the web app configuration.
3. In `.env.local` in the project root, set these four values:

   ```text
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_APP_ID=...
   ```

4. In **Authentication → Sign-in method**, enable **Email/Password**.
5. Add your development and production hostnames under **Authentication → Settings → Authorized domains**.
6. Restart Vite after saving `.env.local`.

Firebase web configuration values identify your project and are intended for browser apps. Do not put Gemini secret keys, service account credentials, or other server secrets in `VITE_` variables.
