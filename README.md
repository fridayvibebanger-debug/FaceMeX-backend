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
