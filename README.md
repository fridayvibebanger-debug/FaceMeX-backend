# FaceMe API (Express)

## Quick start

1. Copy env
```bash
cp .env.example .env
```
2. Install deps
```bash
npm install
```
3. Run dev
```bash
npm run dev
```

API runs on http://localhost:4000

## Routes
- GET /health
- GET /api/users/me
- PATCH /api/users/me
- GET /api/posts
- POST /api/posts
- POST /api/posts/:id/like
- POST /api/posts/:id/comment

Sockets: namespace `/` emits `connected` on connect.

Note: Mongo, Firebase, Stripe, Cloudinary will be added next; this scaffold uses in-memory data so it works immediately.

## Voice API

The authenticated voice endpoints are mounted at `/api/voice`:

- `GET /api/voice/providers` reports configured providers without returning credentials.
- `POST /api/voice/transcribe` accepts raw supported audio (`audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/ogg`, or WAV) up to 8 MB.
- `POST /api/voice/speak` accepts JSON `{ "text": "...", "provider": "elevenlabs" | "polly" }` and returns base64 MP3 audio. Text is limited to 2,500 characters.

Configure the `DEEPGRAM_*`, `AWS_*`, and `ELEVENLABS_*` values in Render's private environment. ElevenLabs is the default when configured; the other configured TTS provider is used as fallback. `VOICE_TTS_FALLBACK_PROVIDER` can explicitly select `elevenlabs` or `polly`.

## AI Email Assistant

The authenticated email routes are mounted at `/api/email`:

- `POST /api/email/generate` creates a structured draft; it never sends mail.
- `GET /api/email/google/connect` returns a Google authorization URL.
- `GET /api/email/google/callback` handles Google's OAuth callback.
- `GET /api/email/google/status` reports the signed-in user's connection state.
- `POST /api/email/google/disconnect` removes the user's stored Gmail tokens and attempts to revoke the Google grant.
- `POST /api/email/send` accepts only an explicitly confirmed, validated draft and a UUID idempotency key.
- `GET /api/email/send/:idempotencyKey/status` returns that signed-in user's send status without returning message content.

Gmail access tokens and refresh tokens are encrypted with AES-256-GCM before MongoDB storage. The OAuth scope is limited to `https://www.googleapis.com/auth/gmail.send`. Set the following as private Render environment variables; never expose them as `VITE_*` variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` — exactly `https://<your-render-host>/api/email/google/callback`
- `GMAIL_TOKEN_ENCRYPTION_KEY` — base64-encoded 32-byte key; generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
- Existing `MONGODB_URI`, `JWT_SECRET`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` must also be configured for persistence and authenticated requests.

### Google Cloud setup

1. In Google Cloud Console, select or create the project used for FaceMeX and enable **Gmail API**.
2. Configure the OAuth consent screen with the FaceMeX app name, support email, and required audience. Request only the Gmail send scope used by the integration; do not add inbox-reading or profile scopes. While the app is in Testing, add the Gmail accounts that will test the integration. Google may require verification before broad external use.
3. Create an OAuth client ID with application type **Web application**.
4. Add the FaceMeX web origin (for example `https://facemexsocial.com`) under **Authorized JavaScript origins**.
5. Add the exact Render `GOOGLE_REDIRECT_URI` under **Authorized redirect URIs**. It must match the value configured in Render byte-for-byte.
6. Add the generated client ID, client secret, callback URI, and encryption key to the Render service's private environment. Keep the existing MongoDB, JWT, and Supabase settings there as well, then redeploy the backend.
7. Set the frontend's existing `VITE_API_URL` to that Render service URL and deploy the frontend. No Google secret belongs in frontend build variables.
8. Sign in, open `/email-assistant`, connect Gmail, and send a test email only after reviewing and confirming the exact recipient, subject, and message.

The OAuth callback uses the first origin in `CLIENT_ORIGIN` as its frontend return origin and redirects to `/email-assistant`. Set the production origin first in Render.
