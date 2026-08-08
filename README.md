# Auto Marketing Software

Product ni **image mukho** — AI baki badhu kare che: product samje, atyare je
trending che e shodhe, reel no script lakhe, **30-90 second no reel banave**,
music naakhe, Instagram ane Facebook mate **alag alag caption + hashtags** lakhe,
ane **auto publish** kare.

**Stack:** Next.js 15 (App Router) · TypeScript · MUI 7 · MongoDB (Mongoose) ·
ffmpeg (video render) · Gemini / Groq / OpenRouter / Claude (AI, fallback chain) ·
Meta Graph API (Instagram + Facebook publishing) · n8n (optional automation)

> ### 🐍 Python version pan che — `python/` folder ma
>
> **E j feature, pan 100% FREE stack par.** Ghani vastu to KEY VAGAR j
> chale che: ffmpeg (render), Catbox (hosting), ccMixter (music),
> **edge-tts** (voiceover — Hindi ane Gujarati sathe), Pollinations
> (image), Google Trends (keywords). Fakt AI ane Meta mate key joiye,
> ane e banne pan free che (Groq / Gemini / **Ollama offline**).
>
> ```bash
> cd python
> pip install -r requirements.txt
> python scripts/fetch_ffmpeg.py && python scripts/fetch_fonts.py
> python run.py          # → http://localhost:8000
> ```
>
> Puri vigat: [`python/README.md`](python/README.md)

---

## 🎬 Reel Studio — mukhya feature

**`/admin/studio`** — ahiya badhu thay che.

### Kevi rite kaam kare che

```
   Product ni image upload karo
        │
        ├─ 1. VISION      image joine product samje che: su che, kaya
        │                 material nu, kona mate, kaya keywords
        │
        ├─ 2. TRENDS      Google Autocomplete + Google Trends + AI thi
        │                 hashtag "ladder" (moti / vachli / NANI tags)
        │
        ├─ 3. SCRIPT      shot-by-shot plan — hook, product, benefit, CTA
        │                 pehla 3 second no hook, dar 2-3 second e badlaav
        │
        ├─ 4. IMAGES      je scene mate joiye e AI banave —
        │                 avatar + tamara kapda sathe (virtual try-on)
        │
        ├─ 5. MUSIC       mood pramane copyright-free track
        │
        ├─ 6. VOICEOVER   (marji nu) AI awaj
        │
        ├─ 7. RENDER      ffmpeg → 1080×1920 · 30fps · H.264 · AAC
        │                 Ken Burns, transitions, text overlay, cover image
        │
        ├─ 8. CAPTION     Instagram ane Facebook mate ALAG caption.
        │                 Lakhya pachi 0-100 ma marks aape che, ochha
        │                 aave to AI ne fari lakhavay che.
        │
        └─ 9. PUBLISH     IG Reels + FB Reels par ek saathe.
                          Hashtag pehla comment ma. Sauthi saara vakhate
                          apoaap goothvi shakay.
```

### Su su bane che

| Su joiye che | Kai rite |
|---|---|
| **Ek product ni reel** | Ek image mukho |
| **Ghana product ni ek j reel** | Ghani image mukho — dareak ne potano beat male che |
| **Tamari avatar product pehri ne** | Avatars page ma 2-3 photo aapo, pachi automatic |
| **Koi bija jevi reel** | E reel ni file upload karo — eni STYLE ni nakal thashe (words nahi) |
| **Instagram ma je jaay e Facebook ma pan** | Automatic — pan alag caption ane alag hashtag count sathe |

### ⚠️ Trending song vishe — saachi vaat

Instagram nu **licensed trending song** (je app ma Reels banavta vakhate dekhay
che) **Graph API thi lagavi shakatu NATHI**. Meta e music catalog API ma kholyu
j nathi — aa koi pan tool kari shakatu nathi, ane aa aapna code ni kami nathi.

Etle app be vastu kare che:

1. **Reel ni andar copyright-free music bake kare che** (Jamendo / Creative
   Commons) — aa 100% auto-post thay che ane copyright strike no dar nathi.
2. **Publish pachi batave che ke IG app ma kayo trending sound shodhvo** —
   reel → ⋯ → Edit → Audio → suggest karela shabd search karo → Trending
   filter → sound lagavo. Be tap nu kaam, ane tyare IG no trending-audio
   boost pan male che.

### ⚠️ Public URL joiye j che

Meta na server **tamari file download kare che**. Etle `localhost` kyarey nahi
chale. Ek karo:

- **Cloudinary** (recommended, free 25GB) — `CLOUDINARY_CLOUD_NAME` +
  `CLOUDINARY_UPLOAD_PRESET`, athva
- **Potanu domain / ngrok tunnel** — `PUBLIC_MEDIA_BASE_URL=https://...`

Ek pan na hoy to app key-vagar na anonymous host (Catbox / tmpfiles) par
padi jaay che — chalе che, pan file bahar public rahe che ane tmpfiles ni
file 1 kalak pachi khatam thai jaay che. Production ma
`MEDIA_ALLOW_ANON_HOSTS=false` karo.

### Multi-API pipeline — kaam kyarey atkatu nathi

Dareak bahar na kaam mate provider ni **chain** che. Ek ni free limit lage,
key khute, ke service down thay to **bijo apoaap** chalu thai jaay che:

| Kaam | Chain (free pehla) |
|---|---|
| Lakhan | Gemini → Groq → OpenRouter → Ollama → Claude |
| Image samajvi | Gemini Vision → Groq → OpenRouter → Claude |
| Image banavvi | Gemini Image → Pollinations → Replicate |
| Virtual try-on | IDM-VTON (Replicate) → Gemini Image |
| Music | Jamendo → ccMixter → tamari mp3 |
| Voiceover | Gemini TTS → Pollinations → ElevenLabs |
| Hosting | Cloudinary → ImgBB → Catbox → tmpfiles |
| Trends | Google Autocomplete + Google Trends + AI |

Sathe: per-provider timeout, exponential backoff + jitter retry, ane
**circuit breaker** (3 var fail thay to 60 second skip). Halat
`/admin/setup` par dekhay che.

### Set karo ane bhuli jao — reel automation

`/admin/automations` → **Su banavvu: Reel**

Dar divase (ke kalake/athvadiye) Reel Studio ma upload kareli product images
ma thi **vaari fari** ek lai ne aakhi reel banse — script, music, caption,
hashtags badhu — ane Instagram + Facebook banne par jate mukai jashe.
Tamare fakt product ni images ek var upload karvani.

> Cron chalu hovo joiye — jovo section 5.

### Test karo

```bash
npm run test:services        # badhi API/service KHAREKHAR chale che? (30 sec)
npm run test:render          # fakt video engine (30 sec)
npm run test:pipeline        # 10 round × 195 test — offline, koi key vagar
npm run test:pipeline -- 10 live   # uper nu + kharekhar AI ne puchhe
```

`npm run test:services` sauthi kaam nu che — e dareak service ne **ek nani
sachi request** mokle che. "Key set che" ane "key kaam kare che" e be alag
vaat che (dakhla tarike key barabar hoy pan credit khatam hoy). Ej test
admin panel ma **Setup page par button** tarike pan che.

---

## 0. Roj chalavva mate (already setup thai gayelu che)

```bash
npm run mongo     # terminal 1 — MongoDB
npm run dev       # terminal 2 — app
```

Pachi <http://localhost:3000/login> → `admin@example.com` / `Admin@12345`

Badhu barabar che ke nahi e ek command ma joi lo:

```bash
npm run test:services
```

---

## 1. Setup (nava machine par)

```bash
# 1. Dependencies
npm install

# 2. Env file banavo
cp .env.example .env        # Windows: copy .env.example .env

# 3. Reel na text mate free fonts (ek j var)
npm run fonts

# 4. .env ma aa bharo:
#    MONGODB_URI      -> mongodb://127.0.0.1:27017/auto_marketing
#    JWT_SECRET       -> koi pan 32+ character no random string
#    GEMINI_API_KEY   -> aistudio.google.com/apikey  (FREE, sauthi jaruri —
#                        ek j key thi lakhan + image samajvi + image banavvi
#                        + voiceover — chaarey kaam thai jaay che)
#    CLOUDINARY_*     -> cloudinary.com (FREE 25GB) — aa vagar Instagram/
#                        Facebook par post NAHI thay (Meta ne public URL joiye)
#    META_APP_ID/SECRET -> developers.facebook.com/apps

# 5. MongoDB local chalu karo, pachi admin user banavo
npm run seed
#    ...athva sample campaign + automation saathe:
npm run seed -- --demo

# 5. App chalu karo
npm run dev
```

Have <http://localhost:3000/login> khollo ane `.env` na `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` thi login karo.

Dashboard par **Setup checklist** banner dekhaashe je batavse ke su configure
baaki che (AI key, access token, etc.). Badhu thai jay pachi e aapoaap chupai
jaay che.

### MongoDB kevi rite chalavvu

Aa machine par MongoDB 8.0 portable `D:\mongodb` ma install thai gayelu che
(installer ke Docker ni jarur nathi). Chalavva:

```bash
npm run mongo          # foreground ma chale, band karva Ctrl+C
```

Data `D:\mongodb\data` ma save thay che. Biji machine par `MONGO_HOME` env var
thi path badli shako.

Baiji rite: [Community Server installer](https://www.mongodb.com/try/download/community)
(service tarike chale) athva Docker:
`docker run -d -p 27017:27017 --name mongo mongo:7`

---

## 2. Folder structure

```
auto-marketing-software/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # root layout + theme provider
│   │   ├── page.tsx                # / -> /admin ke /login
│   │   ├── login/page.tsx          # login screen
│   │   ├── admin/                  # ---- ADMIN PANEL (protected) ----
│   │   │   ├── layout.tsx          # sidebar + topbar shell
│   │   │   ├── page.tsx            # Dashboard
│   │   │   ├── DashboardClient.tsx
│   │   │   ├── accounts/           # FB/IG accounts connect karo
│   │   │   ├── campaigns/          # brand voice + keywords group
│   │   │   ├── posts/              # AI generate, schedule, publish
│   │   │   ├── automations/        # recurring AI posting rules
│   │   │   ├── logs/               # activity audit trail
│   │   │   └── settings/           # setup guides + theme toggle
│   │   └── api/                    # ---- REST API ----
│   │       ├── auth/{login,logout,me}
│   │       ├── accounts/[id]
│   │       ├── campaigns/[id]
│   │       ├── posts/[id]/publish
│   │       ├── automations/[id]/run
│   │       ├── ai/generate         # Claude thi caption banave
│   │       ├── stats               # dashboard numbers
│   │       ├── logs
│   │       ├── cron/dispatch       # scheduler tick (secret protected)
│   │       └── webhooks/n8n        # n8n -> app commands
│   ├── components/                 # AdminShell, PageHeader, StatusChip
│   ├── lib/
│   │   ├── env.ts                  # centralised env access
│   │   ├── db.ts                   # mongoose connection (cached)
│   │   ├── auth.ts                 # JWT sign/verify + cookie
│   │   ├── api.ts                  # route handler helpers
│   │   ├── client.ts               # browser fetch wrapper
│   │   ├── ai.ts                   # Claude content generation
│   │   ├── social.ts               # Meta Graph API calls
│   │   ├── publisher.ts            # ek post publish karvanu logic
│   │   ├── automation-runner.ts    # automation execute + next-run math
│   │   └── n8n.ts                  # outbound events + inbound auth
│   ├── models/                     # Mongoose schemas
│   │   ├── User.ts  SocialAccount.ts  Campaign.ts
│   │   ├── Post.ts  Automation.ts     ActivityLog.ts
│   ├── theme/
│   │   ├── theme.ts                # MUI palette (light + dark)
│   │   └── ThemeRegistry.tsx       # provider + color mode context
│   └── middleware.ts               # /admin routes protect kare
├── scripts/
│   ├── seed.mts                    # admin user (+ --demo sample data)
│   └── mongo.mjs                   # local MongoDB chalu kare
├── n8n/auto-marketing-workflow.json# ready-made n8n workflow
└── .env.example
```

---

## 3. Kaam kevi rite kare che

```
        ┌─────────────┐   AI caption   ┌────────────┐
        │ Admin panel │ ─────────────► │  Claude    │
        └──────┬──────┘                └────────────┘
               │ save
               ▼
        ┌─────────────┐
        │  MongoDB    │  posts (draft / scheduled / published)
        └──────┬──────┘
               │  scheduledAt vity gayu?
               ▼
   ┌───────────────────────┐   POST   ┌──────────────────┐
   │ /api/cron/dispatch    │ ───────► │ Meta Graph API   │
   │ (n8n har minute call) │          │ FB Page / IG     │
   └───────────┬───────────┘          └──────────────────┘
               │ event
               ▼
        ┌─────────────┐
        │    n8n      │  Slack alert, sheet log, jem joiye tem
        └─────────────┘
```

---

## 4. Meta (Facebook + Instagram) setup

### Option A — "Connect with Facebook" (recommended)

Ek j click ma tamara badha Pages ane tema jodayela Instagram Business accounts
aavi jashe — Page ID ke token hathe nakhva nahi pade.

1. <https://developers.facebook.com/apps> par app banavo (type: **Business**).
2. **Facebook Login** product add karo.
3. Facebook Login → Settings → **Valid OAuth Redirect URIs** ma aa *exact* URL nakho:
   ```
   http://localhost:3000/api/oauth/meta/callback
   ```
4. Settings → Basic mathi **App ID** ane **App Secret** lai `.env` ma nakho:
   ```
   META_APP_ID=...
   META_APP_SECRET=...
   ```
5. Dev server restart karo → Admin → **Social Accounts** →
   **Connect with Facebook** dabavo → Facebook par permission aapo →
   pacha aavo tyare "kaya accounts connect karva" nu picker khulse.

App je permissions mange che: `pages_show_list`, `pages_manage_posts`,
`pages_read_engagement`, `business_management`, `instagram_basic`,
`instagram_content_publish`.

> App **Development mode** ma hoy tyare fakt app na admin / developer / tester
> role vada log j login kari shake. Baki na users mate App Review joiye.

### Option B — Manual (Meta app vagar)

Accounts page → **Manual** button. Graph API Explorer mathi:

- `GET /me/accounts` → **Page ID** ane **Page access token**
- `GET /{page-id}?fields=instagram_business_account` → **IG User ID**

> ⚠️ Instagram Content Publishing API ne **public https image URL** joiye j
> che. `localhost` path nahi chale — Cloudinary / S3 / imgur jeva host par
> image mukine e URL vapro. Facebook mate image optional che.

---

## 5. Scheduler chalu karo

Scheduled post ane automation tyare j chale jyare `/api/cron/dispatch` call thay.

**Option A — n8n (recommended):**
`n8n/auto-marketing-workflow.json` ne n8n ma **Import from File** karo. Ema
Schedule Trigger (every minute) → HTTP Request node already set che.

**Option B — manual / Task Scheduler:**

```bash
curl -X POST http://localhost:3000/api/cron/dispatch \
  -H "x-cron-secret: <CRON_SECRET>"
```

---

## 6. n8n integration

### Local setup — 2 command

```bash
# ek j vaar: n8n install karo
npm install -g n8n

# terminal 3 — n8n chalu karo (data .n8n-data/ ma rahe che)
npm run n8n

# terminal 4 — app saathe jodo (token banave, workflows import + activate kare)
npm run n8n:setup
```

`npm run n8n:setup` aa badhu jate kare che:

1. App ma login karine **API token** banave ane `.env` ma `N8N_API_TOKEN` save kare
2. n8n ma **owner account** banave (`.env` na `SEED_ADMIN_*` thi)
3. `n8n/*.json` na **3 workflows import** kare — token ane secrets bharine
4. Workflows **activate** kare

Pachi <http://localhost:5678> kholo — badhu taiyar hashe.

> n8n no badho data project ni andar `.n8n-data/` ma rahe che (gitignored),
> etle restart thay to pan workflows ane credentials jata nathi.

### App → n8n (outbound events)

App `N8N_WEBHOOK_URL` par POST kare che:

| Event | Kyare |
|---|---|
| `post.created` | navo draft banyo |
| `post.scheduled` | post schedule thayo |
| `post.published` | live thai gayo |
| `post.failed` | publish fail thayu |
| `automation.completed` | automation run puru thayu |

```json
{
  "event": "post.published",
  "sentAt": "2026-08-01T09:30:00.000Z",
  "payload": { "postId": "…", "platform": "instagram", "permalink": "…" }
}
```

### n8n → App (inbound commands)

`POST /api/webhooks/n8n` with header `x-n8n-secret: <N8N_WEBHOOK_SECRET>`:

```jsonc
// AI thi post banavo ane sidho publish karo
{ "event": "post.generate", "accountId": "<id>", "topic": "Monsoon sale", "publish": true }

// koi automation chalavo
{ "event": "automation.run", "automationId": "<id>" }

// koi draft publish karo
{ "event": "post.publish", "postId": "<id>" }
```

---

## 7. API reference

| Method | Path | Kaam |
|---|---|---|
| POST | `/api/auth/login` | Login (JWT cookie set kare) |
| POST | `/api/auth/logout` | Logout |
| GET/POST | `/api/accounts` | Social accounts list / manual add |
| PATCH/DELETE | `/api/accounts/[id]` | Update / delete |
| GET | `/api/oauth/meta/start` | Facebook OAuth shuru karo |
| GET | `/api/oauth/meta/callback` | Facebook pacho ahiya mokle |
| GET/POST | `/api/oauth/meta/pending` | Malela accounts jovo / connect karo |
| GET/POST | `/api/campaigns` | Campaigns |
| GET/POST | `/api/posts` | Posts (`?status=`, `?platform=`, `?batchId=`) — POST ma `accounts[]` aapo to badha par ek saathe |
| PATCH/DELETE | `/api/posts/[id]` | Edit / delete draft |
| POST | `/api/posts/[id]/publish` | Have j publish karo |
| POST | `/api/ai/generate` | Claude thi caption + hashtags |
| GET/POST | `/api/automations` | Automations |
| POST | `/api/automations/[id]/run` | Run now |
| GET | `/api/stats` | Dashboard numbers |
| GET | `/api/health` | Setup checklist (su configure thayu che) |
| GET | `/api/logs` | Activity logs |
| POST | `/api/cron/dispatch` | Scheduler tick *(cron secret)* |
| POST | `/api/webhooks/n8n` | n8n commands *(n8n secret)* |

Badha response no shape: `{ "ok": true, "data": … }` athva
`{ "ok": false, "error": "…" }`.

### Ek saathe ghana accounts par post

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

Dareak account mate alag Post document bane che (potano status ane permalink),
pan badha ek `batchId` thi jodayela rahe che. Ek account fail thay to biju
atkatu nathi — response ma per-account result pacho aave che:

```jsonc
{
  "ok": true,
  "data": {
    "batchId": "5f1c…",
    "created": [ { "id": "…", "account": "My Page", "platform": "facebook" } ],
    "skipped": [ { "account": "@mybrand", "reason": "Instagram mate public image URL farjiyat che" } ]
  }
}
```

UI ma multi-account post ne **multi-account** chip lagelo hoy che, ane
**Batch** button thi tena badha pending posts ek saathe publish thai jay che.

---

## 8. Troubleshooting

| Problem | Upay |
|---|---|
| `ECONNREFUSED 127.0.0.1:27017` | MongoDB band che → `npm run mongo` |
| Login "Email ke password khoto che" | `npm run seed` fari chalavo (password reset kari de che) |
| AI generate par "Missing ANTHROPIC_API_KEY" | `.env` ma key nakho, pachi dev server restart karo |
| "Invalid OAuth access token" | Accounts page ma Page access token khoto/expire thayelo che |
| Badha page achanak 500 aape | `next dev` chalu hoy tyare `next build` na chalavo — e `.next` bagade che. Fix: dev band karo → `.next` folder delete karo → `npm run dev` |
| Instagram publish fail | Image/video URL public https hovu joiye; `localhost` nahi chale |

### Reel Studio

| Problem | Upay |
|---|---|
| Build par `EACCES: permission denied, scandir ...\Temp\...` | Next build system na TEMP ne scan kare che ane tya koi bija app ni lock file hoy to atki jaay che. `npm run build` aa fix kari de che (project ni andar potano temp vaapre che). Sidhu `npx next build` chalavta hoy to aa aavse. |
| "Ek pan provider configure nathi" | `/admin/setup` khollo — tya dekhashe ke KAI key khute che. Sauthi jaruri: `GEMINI_API_KEY` (free). |
| Instagram par reel fail — "Media ID is not available" | Video no URL public nathi. `CLOUDINARY_*` naakho ke `PUBLIC_MEDIA_BASE_URL` set karo. |
| Reel ma text na dekhay / chorasa (□□□) dekhay | `npm run fonts` chalavo. Hindi/Gujarati mate e j font laave che. |
| Reel banta bahu var lage | `RENDER_CONCURRENCY` vadharo (CPU pramane 3-4), ane `targetDuration` ghatado. Sarerash: 40s ni reel ~2-4 minute. |
| Job "running" ma atki gayo | Server restart thayo hase. Cron dar minute chale che ane 25 minute pachi ene "failed" kari de che — pachi fari Generate dabavo. |
| Music na madyu | `JAMENDO_CLIENT_ID` naakho (free), athva `storage/music/` ma potani mp3 mukho. |
| "Instagram trending song kem nathi lagtu?" | Meta e e API kholelu j nathi — koi tool na kari shake. App reel ma copyright-free music naakhe che ane publish pachi IG app ma trending sound kai rite lagavvo e batave che (2 tap). |
| Avatar no chehro dareak scene ma badlai jaay | `GEMINI_API_KEY` naakho — Gemini 2.5 Flash Image reference photo samje che. Vadhu saacha result mate `REPLICATE_API_TOKEN` (try-on model). |

## 9. Security notes

- Access token DB ma `select: false` che — API response ma kadi nathi aavtu.
- `/admin/*` middleware thi protect thayelu che; API routes potano JWT check kare che.
- `/api/cron/dispatch` ane `/api/webhooks/n8n` shared secret header mange che
  (session nahi), jethi machine-to-machine call thai sake.
- Production ma `.env` na secrets badlo ane HTTPS par chalavo (cookie `secure`
  flag `NODE_ENV=production` ma aapoaap on thai jay che).
