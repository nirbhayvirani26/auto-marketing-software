# Auto Marketing Software

Upload a product photo. The AI does the rest — it reads the photo, finds what
is trending, writes a script, **builds a 30-90 second reel**, adds music, writes
**separate captions and hashtags for Instagram and Facebook**, and publishes.

**Stack:** Next.js 15 (App Router) · TypeScript · MUI 7 · **local JSON database
(no server to install)** · ffmpeg for video · Nano Banana / Gemini / Groq /
OpenRouter / Claude for AI · Omni for AI video · Meta Graph API for publishing ·
n8n (optional).

---

## Quick start

```bash
npm install
npm run fonts        # one-time: free fonts for reel text
npm run dev
```

Open <http://localhost:3000/login> and sign in:

| | |
|---|---|
| Email | `admin@example.com` |
| Password | `Admin@12345` |

That is the whole setup. There is no database to install and no connection
string to configure — the first sign-in creates the workspace for you.

To add API keys (all optional to start with): `cp .env.example .env`, fill in
what you have, and restart. The **Setup** page in the admin panel walks through
each one and tells you which is worth getting first.

---

## The database is a folder

Every collection is a JSON file in `data/`, right next to the source code:

```
data/
├── users.json
├── brands.json
├── posts.json
├── reel-jobs.json
├── media-assets.json
└── .session-secret      ← generated once, signs your sign-in cookies
```

This is deliberate. Hand someone the project folder and they can run it a
minute later: no MongoDB, no Docker, no service to keep alive. Zip it, copy it
to another machine, put it on a USB stick — the app comes with its content.

**What it means in practice**

- **Sharing the code.** `data/` is gitignored, because it holds password hashes
  and Page access tokens. Whoever clones the repo gets a fresh workspace that
  seeds itself on first sign-in. Nothing sensitive travels with the code.
- **Sharing your actual content.** Copy the `data/` and `storage/` folders
  across as well and the other machine has your brands, posts and reels too.
- **Starting over.** Delete `data/` and run `npm run seed`.
- **Backups.** Copy the folder. That is the entire procedure.
- **Reading it.** The files are formatted JSON. Open one in any editor.

The engine (`src/lib/localdb/`) implements the slice of the MongoDB query
language this app uses — filters, operators, sorting, projections, `populate()`,
unique indexes, TTL expiry, and per-field change tracking on `save()`. It has
its own test suite:

```bash
npm run test:db      # 86 checks, runs in about a second
```

---

## The Reel Studio

**`/admin/studio`** — this is where the work happens.

```
   Upload a product photo
        │
        ├─ 1. VISION      reads the photo: what it is, what it is made of,
        │                 who it is for, which keywords it can rank on
        │
        ├─ 2. TRENDS      Google Autocomplete + Google Trends + AI, combined
        │                 into a hashtag "ladder" (huge / mid / niche tags)
        │
        ├─ 3. SCRIPT      a shot-by-shot plan — hook, product, benefit, CTA.
        │                 A hook in the first 3 seconds, a change every 2-3.
        │
        ├─ 4. IMAGES      Nano Banana generates the scenes it needs —
        │                 including your avatar wearing your product
        │
        ├─ 5. MUSIC       a copyright-free track that matches the mood
        │
        ├─ 6. VOICEOVER   optional AI narration
        │
        ├─ 7. RENDER      ffmpeg → 1080×1920 · 30fps · H.264 · AAC
        │                 Ken Burns motion, transitions, text overlay, cover
        │
        ├─ 8. CAPTIONS    a different caption for Instagram and for Facebook.
        │                 Each is scored 0-100 and rewritten if it scores low.
        │
        └─ 9. PUBLISH     Instagram Reels and Facebook Reels together.
                          Hashtags in the first comment, posted at the best time.
```

### What you can build

| What you want | How |
|---|---|
| A reel for one product | Upload one photo |
| One reel for several products | Upload several — each gets its own beat |
| Your avatar wearing your product | Add 2-3 photos on the Avatars page, then it is automatic |
| A reel in the style of another | Upload that reel — its STYLE is copied, not its words |
| Instagram and Facebook together | Automatic, with a different caption and hashtag count for each |

### Nano Banana for images

Image generation runs on **Nano Banana** — Google's Gemini 2.5 Flash Image.
It is the default because it is on the free tier, it reads reference photos,
and it keeps a face consistent from scene to scene, which is what makes a
recognisable avatar possible at all.

One `GEMINI_API_KEY` covers writing, reading photos, generating images and
voiceover. Get one free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

If Nano Banana is unavailable the chain falls through to gpt-image-1, then
Pollinations (which needs no key at all).

### Omni for AI video

`AI_VIDEO_ENABLED=true` turns on **Omni** (Gemini Omni Flash) for real motion —
fabric catching the air, a model turning, the product being used.

Omni does **not** replace ffmpeg. ffmpeg builds every reel by animating stills,
which is fast, free and reliable. Omni upgrades the one or two shots that most
deserve real movement. The route is always:

```
product photo → scene image → Omni animates that exact image
```

Generating video straight from text lets the model invent its own version of
the product, and the fabric, colour and print come out wrong. Building the still
first and animating *that* keeps the product identical — the only acceptable
outcome when the video exists to sell the thing.

Omni sits on Google's **paid** tier. On a free key it returns HTTP 429 and is
skipped automatically; reels still render exactly as before.

### About Instagram's trending songs

Instagram's licensed trending audio — the tracks you see inside the app —
**cannot be attached through the Graph API**. Meta has never opened the music
catalogue. No tool can do this; it is a platform limitation, not a gap here.

So the app does two things instead:

1. **Bakes a copyright-free track into the reel** (Jamendo / Creative Commons).
   This publishes automatically with no risk of a copyright strike.
2. **After publishing, tells you which trending sound to search for** in the
   Instagram app: reel → ⋯ → Edit → Audio → search the suggested phrase →
   Trending filter → apply. Two taps, and you still get the trending-audio boost.

### Media needs a public URL

Meta downloads your file **from its own servers**, so `localhost` will never
work. Pick one:

- **Cloudinary** (recommended, 25GB free) — set `CLOUDINARY_CLOUD_NAME` and
  `CLOUDINARY_UPLOAD_PRESET`, or
- **Your own domain or an ngrok tunnel** — set `PUBLIC_MEDIA_BASE_URL`.

With neither, the app falls back to keyless anonymous hosts (Catbox, tmpfiles).
Those work, but the files are publicly readable and tmpfiles deletes after an
hour. Set `MEDIA_ALLOW_ANON_HOSTS=false` in production.

### Nothing ever gets stuck

Every external step runs through a provider chain. When one hits its rate limit,
runs out of credit, or goes down, the next one takes over:

| Job | Chain (free first) |
|---|---|
| Writing | Gemini → Groq → OpenRouter → Ollama → Claude |
| Reading photos | Gemini Vision → Groq → OpenRouter → Claude |
| Generating images | **Nano Banana** → gpt-image-1 → Pollinations → Replicate |
| Virtual try-on | IDM-VTON (Replicate) → Nano Banana |
| AI video | **Omni** |
| Music | Jamendo → ccMixter → your own mp3s |
| Voiceover | Gemini TTS → Pollinations → ElevenLabs |
| Hosting | Cloudinary → ImgBB → Catbox → tmpfiles |
| Trends | Google Autocomplete + Google Trends + AI |

Each has a per-provider timeout, exponential backoff with jitter, and a circuit
breaker (three failures means a 60-second skip). Live status is on `/admin/setup`.

**And when every provider is down**, the reel still ships. Vision falls back to
the description you typed, the script falls back to a template shot list, and
the captions are assembled from the product facts — plainer, but honest and
publishable. Nothing is ever invented.

### Set it and forget it

`/admin/automations` → **Mode: Reel**

Every day (or hour, or week) it takes the next product image from your library,
builds a complete reel — script, music, caption, hashtags — and publishes it to
Instagram and Facebook. You upload the product photos once.

> The scheduler must be running. See section 5.

---

## Testing

```bash
npm run test:db          # local database — 86 checks, ~1s
npm run test:services    # does every API key ACTUALLY work? ~60s
npm run test:render      # the video engine on its own, ~30s
npm run test:pipeline    # the full pipeline, offline, no keys needed
npm run test:e2e         # a real reel and real marketing posts, end to end
```

**`npm run test:services`** is the most useful of these. It sends one small real
request to every service. "The key is set" and "the key works" are two different
things — a key can be valid while the account is out of credit. The same checks
are a button on the Setup page.

**`npm run test:e2e`** runs the whole thing for real: it uploads product photos,
generates a reel through the actual pipeline, and writes Instagram and Facebook
posts into the database. It stops short of publishing to Meta — a test script
should never post to your real audience. It reports which provider served each
step, so when something falls back you can see exactly where.

---

## 1. Setup on a new machine

```bash
# 1. Dependencies
npm install

# 2. Fonts for reel text (one time)
npm run fonts

# 3. Start
npm run dev
```

That is enough to sign in and look around. To make it publish, create `.env`:

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

and fill in, in order of importance:

| Key | Why | Where |
|---|---|---|
| `GEMINI_API_KEY` | Writing, vision, **Nano Banana** images, voiceover — one key, four jobs | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free) |
| `CLOUDINARY_*` | Without a public URL, nothing can be published to Meta | [cloudinary.com](https://cloudinary.com) (25GB free) |
| `META_APP_ID` / `META_APP_SECRET` | Instagram and Facebook publishing | [developers.facebook.com/apps](https://developers.facebook.com/apps) |

`.env` is gitignored. Never commit it.

---

## 2. Folder structure

```
auto-marketing-software/
├── data/                           # THE DATABASE — one JSON file per collection
├── storage/                        # uploads, rendered reels, temp render files
├── src/
│   ├── app/
│   │   ├── admin/                  # ---- ADMIN PANEL (protected) ----
│   │   │   ├── layout.tsx          # sidebar + top bar shell
│   │   │   ├── page.tsx            # Dashboard
│   │   │   ├── setup/              # guided setup and service checks
│   │   │   ├── studio/             # Reel Studio
│   │   │   ├── posts/              # write, schedule, publish
│   │   │   ├── products/           # paste a link, get the details
│   │   │   ├── avatars/            # the face in your reels
│   │   │   ├── campaigns/          # brand voice and keyword groups
│   │   │   ├── automations/        # recurring AI posting
│   │   │   ├── dm-rules/           # auto reply and auto DM
│   │   │   ├── accounts/           # connect Facebook and Instagram
│   │   │   ├── brands/             # one workspace per brand
│   │   │   ├── integrations/       # API tokens and n8n
│   │   │   ├── logs/               # audit trail
│   │   │   └── settings/           # storage, scheduler, Meta setup
│   │   └── api/                    # ---- REST API ----
│   ├── components/                 # AdminShell, PageHeader, nav, status chips
│   ├── lib/
│   │   ├── localdb/                # ★ the local database engine
│   │   │   ├── object-id.ts        #   MongoDB-compatible ids
│   │   │   ├── schema.ts           #   types, defaults, validation, indexes
│   │   │   ├── query-engine.ts     #   filters, operators, sorting, updates
│   │   │   ├── model.ts            #   Model, Query, documents, populate
│   │   │   ├── storage.ts          #   JSON files, atomic writes
│   │   │   └── serialize.ts        #   Date and ObjectId round-tripping
│   │   ├── db.ts                   # bootstrap (just makes sure data/ exists)
│   │   ├── bootstrap.ts            # first-run seeding
│   │   ├── ai/                     # provider chain: gemini, groq, claude, …
│   │   ├── media/image-gen.ts      # Nano Banana, gpt-image-1, try-on
│   │   ├── video/ai-video.ts       # Omni
│   │   ├── video/render.ts         # ffmpeg reel rendering
│   │   ├── reels/                  # the reel pipeline
│   │   ├── seo/                    # caption writing and scoring
│   │   ├── trends/                 # keywords, hashtags, music
│   │   └── pipeline/chain.ts       # timeouts, retries, circuit breaker
│   ├── models/                     # schemas for the local database
│   └── middleware.ts               # protects /admin
├── scripts/
│   ├── seed.mts                    # owner account (+ --demo sample data)
│   ├── test-localdb.ts             # database test suite
│   ├── test-e2e.ts                 # end-to-end reel and post generation
│   ├── selftest.ts                 # offline pipeline test
│   └── probe-services.ts           # does every service really work?
└── .env.example
```

---

## 3. How it fits together

```
        ┌─────────────┐   captions   ┌──────────────┐
        │ Admin panel │ ───────────► │  AI chain    │
        └──────┬──────┘              └──────────────┘
               │ save
               ▼
        ┌─────────────┐
        │  data/*.json│  posts (draft / scheduled / published)
        └──────┬──────┘
               │  is scheduledAt in the past?
               ▼
   ┌───────────────────────┐   POST   ┌──────────────────┐
   │ /api/cron/dispatch    │ ───────► │ Meta Graph API   │
   │ (called every minute) │          │ FB Page / IG     │
   └───────────┬───────────┘          └──────────────────┘
               │ event
               ▼
        ┌─────────────┐
        │    n8n      │  Slack alerts, sheet logs, whatever you need
        └─────────────┘
```

---

## 4. Meta (Facebook + Instagram) setup

### Option A — "Connect with Facebook" (recommended)

One click brings in all your Pages and the Instagram Business accounts linked to
them. No Page IDs or tokens to copy by hand.

1. Create an app at <https://developers.facebook.com/apps> (type: **Business**).
2. Add the **Facebook Login** product.
3. Facebook Login → Settings → **Valid OAuth Redirect URIs** → add this *exact* URL:
   ```
   http://localhost:3000/api/oauth/meta/callback
   ```
4. Copy **App ID** and **App Secret** from Settings → Basic into `.env`:
   ```
   META_APP_ID=...
   META_APP_SECRET=...
   ```
5. Restart the dev server → Admin → **Social Accounts** →
   **Connect with Facebook** → grant permission → a picker appears asking which
   accounts to connect.

Permissions requested: `pages_show_list`, `pages_manage_posts`,
`pages_read_engagement`, `business_management`, `instagram_basic`,
`instagram_content_publish`.

> While the app is in **Development mode**, only people with an admin,
> developer or tester role can sign in. Everyone else needs App Review.

### Option B — manual (no Meta app)

Accounts page → **Manual**. From the Graph API Explorer:

- `GET /me/accounts` → **Page ID** and **Page access token**
- `GET /{page-id}?fields=instagram_business_account` → **IG User ID**

> The Instagram Content Publishing API requires a **public https image URL**.
> A localhost path will not work — host the image on Cloudinary, S3 or similar.
> Facebook can post without an image.

---

## 5. Start the scheduler

Scheduled posts and automations only run while `/api/cron/dispatch` is called.

**Option A — n8n (recommended):** import
`n8n/auto-marketing-workflow.json`. Its Schedule Trigger (every minute) and
HTTP Request node are already set up.

**Option B — manual or Task Scheduler:**

```bash
curl -X POST http://localhost:3000/api/cron/dispatch \
  -H "x-cron-secret: <CRON_SECRET>"
```

---

## 6. n8n integration

### Local setup — two commands

```bash
npm install -g n8n     # once
npm run n8n            # terminal 2 — data lives in .n8n-data/
npm run n8n:setup      # terminal 3 — connects it to this app
```

`npm run n8n:setup` creates an API token and saves it to `.env`, creates the n8n
owner account, imports the three workflows in `n8n/*.json` with the secrets
filled in, and activates them. Then open <http://localhost:5678>.

### App → n8n (outbound events)

The app POSTs to `N8N_WEBHOOK_URL`:

| Event | When |
|---|---|
| `post.created` | a new draft was made |
| `post.scheduled` | a post was scheduled |
| `post.published` | it went live |
| `post.failed` | publishing failed |
| `automation.completed` | an automation run finished |

```json
{
  "event": "post.published",
  "sentAt": "2026-08-01T09:30:00.000Z",
  "payload": { "postId": "…", "platform": "instagram", "permalink": "…" }
}
```

### n8n → App (inbound commands)

`POST /api/webhooks/n8n` with the header `x-n8n-secret: <N8N_WEBHOOK_SECRET>`:

```jsonc
// Write a post with AI and publish it straight away
{ "event": "post.generate", "accountId": "<id>", "topic": "Monsoon sale", "publish": true }

// Run an automation
{ "event": "automation.run", "automationId": "<id>" }

// Publish an existing draft
{ "event": "post.publish", "postId": "<id>" }
```

---

## 7. API reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Sign in (sets a JWT cookie) |
| POST | `/api/auth/logout` | Sign out |
| GET/POST | `/api/accounts` | List social accounts, or add one manually |
| PATCH/DELETE | `/api/accounts/[id]` | Update or remove |
| GET | `/api/oauth/meta/start` | Begin the Facebook OAuth flow |
| GET | `/api/oauth/meta/callback` | Where Facebook returns to |
| GET/POST | `/api/oauth/meta/pending` | Review and connect the accounts found |
| GET/POST | `/api/campaigns` | Campaigns |
| GET/POST | `/api/posts` | Posts (`?status=`, `?platform=`, `?batchId=`) — pass `accounts[]` to post to several at once |
| PATCH/DELETE | `/api/posts/[id]` | Edit or delete a draft |
| POST | `/api/posts/[id]/publish` | Publish now |
| POST | `/api/ai/generate` | Captions and hashtags from AI |
| POST | `/api/studio/generate` | Start a reel job |
| GET | `/api/studio/jobs/[id]` | Reel progress |
| GET/POST | `/api/automations` | Automations |
| POST | `/api/automations/[id]/run` | Run now |
| GET | `/api/stats` | Dashboard numbers |
| GET | `/api/health` | Setup checklist and storage location |
| GET | `/api/logs` | Activity log |
| POST | `/api/cron/dispatch` | Scheduler tick *(cron secret)* |
| POST | `/api/webhooks/n8n` | n8n commands *(n8n secret)* |

Every response is `{ "ok": true, "data": … }` or `{ "ok": false, "error": "…" }`.

### Posting to several accounts at once

```jsonc
POST /api/posts
{
  "accounts": ["<fb-id>", "<ig-id>", "<fb-id-2>"],
  "caption": "Diwali offer — 30% off!",
  "hashtags": ["diwali", "sale"],
  "mediaUrl": "https://example.com/banner.jpg",
  "status": "scheduled",
  "scheduledAt": "2026-08-05T09:30:00.000Z"
}
```

Each account gets its own Post document with its own status and permalink, all
sharing one `batchId`. One failure never blocks the others, and the response
reports per-account results:

```jsonc
{
  "ok": true,
  "data": {
    "batchId": "5f1c…",
    "created": [ { "id": "…", "account": "My Page", "platform": "facebook" } ],
    "skipped": [ { "account": "@mybrand", "reason": "Instagram requires a public image URL" } ]
  }
}
```

In the UI these carry a **multi-account** chip, and the **Batch** button
publishes every pending post in the group together.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Sign-in says "Incorrect email or password" | Run `npm run seed` — it resets the owner password |
| "No AI provider key is set" | Open `/admin/setup`. The one that matters most is `GEMINI_API_KEY` (free) |
| "Your prepayment credits are depleted" | The Gemini account is out of credit. Reels still build — vision, script and captions fall back to templates. Top up, or add a Groq key |
| "Invalid OAuth access token" | The Page access token on the Accounts page is wrong or expired |
| Instagram publishing fails | The media URL must be public https. `localhost` will not work |
| Every page suddenly returns 500 | Do not run `next build` while `next dev` is running — it corrupts `.next`. Stop dev, delete `.next`, run `npm run dev` |
| Want to start completely fresh | Delete `data/` and `storage/`, then `npm run seed` |

### Reel Studio

| Problem | Fix |
|---|---|
| `EACCES: permission denied, scandir ...\Temp\...` on build | Next's build scans the system TEMP folder and trips over another app's lock file. `npm run build` avoids this by using a temp folder inside the project. Running `npx next build` directly will hit it |
| "No provider is configured" | Open `/admin/setup` to see which key is missing |
| Instagram reel fails — "Media ID is not available" | The video URL is not public. Set `CLOUDINARY_*` or `PUBLIC_MEDIA_BASE_URL` |
| Reel text shows as boxes (□□□) | Run `npm run fonts`. It fetches Hindi and Gujarati fonts too |
| Reels take a long time | Raise `RENDER_CONCURRENCY` (3-4 depending on CPU) and lower `targetDuration`. A 40-second reel averages 2-4 minutes |
| A job is stuck at "running" | The server restarted. The cron runs every minute and marks it failed after 25 minutes; then press Generate again |
| No music was found | Set `JAMENDO_CLIENT_ID` (free), or drop your own mp3 files into `storage/music/` |
| The avatar's face changes between scenes | Set `GEMINI_API_KEY` — Nano Banana reads the reference photos. For even better results add `REPLICATE_API_TOKEN` (the try-on model) |

---

## 9. Security notes

- Access tokens are stored with `select: false` and are never returned by the API.
- `/admin/*` is protected by middleware; API routes verify their own JWT.
- `/api/cron/dispatch` and `/api/webhooks/n8n` take a shared-secret header rather
  than a session, so machine-to-machine calls work.
- The sign-in key is generated per installation into `data/.session-secret` —
  no placeholder secret is ever baked into shared source code.
- `data/` and `.env` are both gitignored. Rotate any key that has previously
  been committed.
- In production, change the secrets in `.env` and serve over HTTPS. The cookie's
  `secure` flag turns on automatically when `NODE_ENV=production`.
