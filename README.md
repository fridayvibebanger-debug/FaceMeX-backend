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
