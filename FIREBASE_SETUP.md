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

## Ingredient image transcription (Gemini)

The scanner sends the selected image to the local Dermobot API, which verifies the Firebase sign-in token and forwards the image to Gemini for transcription. After reviewing or editing the transcription, users can send the ingredient text to Gemini for a low, medium, or high potential-concern screening. The API key stays on the server. Images and ingredient text are sent to Google's Gemini API for these requests.

The screening is an AI-generated, general-purpose estimate. It is not based on product concentrations or a validated safety database and is not a medical or regulatory assessment. Ingredient risk can depend on concentration, formulation, exposure, product type, and individual sensitivity.

Set these server-side environment variables (never prefix them with `VITE_`):

```text
GEMINI_API_KEY=...
FIREBASE_PROJECT_ID=your-project-id
# Optional; primary defaults to gemini-3.8-flash
GEMINI_VISION_MODEL=gemini-3.8-flash
# Optional; overloaded primary (503) falls back to this model
GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite
```

Run the API and Vite in separate terminals from the project root:

```sh
npm run dev:api
npm run dev
```

The API listens on port 8787 by default and Vite proxies `/api` requests to it. Set `API_PORT` on the server if you need another port, and update the Vite proxy accordingly. The server validates Firebase ID tokens against the configured project before calling the vision API.

Transient Gemini 503 errors are retried with exponential backoff. If the primary model remains overloaded, the API tries `GEMINI_FALLBACK_MODEL` (defaults to `gemini-3.5-flash-lite`), which supports image input and structured output. Change either model ID in `.env.local` if needed, then restart the API.

For OCR, the API auto-rotates, enlarges, normalizes, sharpens, and compresses uploads to WebP using Sharp. Temporary processed images are written to `server/uploads/processed/` only while the OCR request runs and are deleted when it finishes. The transcription is displayed read-only; users can copy it or scan another image.
