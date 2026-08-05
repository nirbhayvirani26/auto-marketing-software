# Auto Marketing Software

AI thi social media post generate karo, schedule karo, ane **Facebook Page** +
**Instagram Business** par auto publish karo — badhu ek admin panel mathi.

**Stack:** Next.js 15 (App Router) · TypeScript · MUI 7 (dark + light theme) ·
MongoDB (local, Mongoose) · Anthropic Claude (content generation) · n8n
(workflow automation) · Meta Graph API (publishing)

---

## 0. Roj chalavva mate (already setup thai gayelu che)

```bash
npm run mongo     # terminal 1 — MongoDB
npm run dev       # terminal 2 — app
```

Pachi <http://localhost:3000/login> → `admin@example.com` / `Admin@12345`

Fakt **`ANTHROPIC_API_KEY`** `.env` ma nakhvani baaki che (AI generation mate).

---

## 1. Setup (nava machine par)

```bash
# 1. Dependencies
npm install

# 2. Env file banavo
cp .env.example .env        # Windows: copy .env.example .env

# 3. .env ma aa 3 value bharo (baki optional che):
#    MONGODB_URI      -> mongodb://127.0.0.1:27017/auto_marketing
#    JWT_SECRET       -> koi pan 32+ character no random string
#    ANTHROPIC_API_KEY-> console.anthropic.com mathi

# 4. MongoDB local chalu karo, pachi admin user banavo
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
| Instagram publish fail | Image URL public https hovu joiye; `localhost` nahi chale |

## 9. Security notes

- Access token DB ma `select: false` che — API response ma kadi nathi aavtu.
- `/admin/*` middleware thi protect thayelu che; API routes potano JWT check kare che.
- `/api/cron/dispatch` ane `/api/webhooks/n8n` shared secret header mange che
  (session nahi), jethi machine-to-machine call thai sake.
- Production ma `.env` na secrets badlo ane HTTPS par chalavo (cookie `secure`
  flag `NODE_ENV=production` ma aapoaap on thai jay che).
