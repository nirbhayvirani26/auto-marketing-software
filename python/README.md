# Auto Marketing Software — Python edition

Product ni **image mukho** — AI baki badhu kare che: product samje, atyare je
trending che e shodhe, reel no script lakhe, **reel banave**, music naakhe,
Instagram ane Facebook mate **alag alag caption + hashtags** lakhe, ane
**auto publish** kare.

> **BADHU FREE CHE.** Ek pan paid service nathi. Ghani vastu to key vagar
> j chale che.

---

## 1. Chalu karo — 4 command

```bash
cd python

# 1. Packages (badha free/open source)
python -m pip install -r requirements.txt

# 2. ffmpeg (free static build — kai install nathi thatu)
python scripts/fetch_ffmpeg.py

# 3. Fonts (free, Google Fonts — Hindi/Gujarati sathe)
python scripts/fetch_fonts.py

# 4. App chalu karo
python run.py
```

Pachi kholo **<http://localhost:8000>** ane `.env` na
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` thi login karo.
(Account jate bani jaay che — register karvani jarur nathi.)

MongoDB chalu hovu joiye. Root folder ma `npm run mongo` che, ke tamaru
potanu `mongod`.

### Badhu barabar che ke nahi?

```bash
python scripts/probe_services.py
```

Aa dareak service ne **ek nani SACHI request** mokle che ane su khute che
e kahe che. ("Key set che" ane key **kaam kare che** — e be alag vaat che.)

---

## 2. Su su joiye che — ane su MUFT ma male che

| Kaam | Su vaparay che | Key joiye? |
|---|---|---|
| Video render | ffmpeg 7.1 (static build) | **nahi** |
| Public hosting | Catbox | **nahi** |
| Reel nu music | ccMixter (Creative Commons) | **nahi** |
| Voiceover | edge-tts (Microsoft na awaj) | **nahi** |
| Image banavvi | Pollinations | **nahi** |
| Trending keywords | Google Autocomplete + Trends | **nahi** |
| **AI lakhan + image samajvi** | Groq / Gemini / OpenRouter / Ollama | **haa — pan FREE** |
| **Instagram/Facebook post** | Meta Graph API | **haa — pan FREE** |

Fakt **be** jagya e key joiye, ane banne free che:

1. **AI** — koi pan ek:
   - [console.groq.com/keys](https://console.groq.com/keys) — free, sauthi fast
   - [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free, ane
     **aa ek key thi 4 kaam** thai jaay: lakhan + image samajvi + image banavvi
     (avatar mate!) + voiceover
   - ke **[ollama.com](https://ollama.com)** — 100% free ane **offline**,
     koi key j nahi (`ollama pull llama3.2`)

2. **Meta app** — [developers.facebook.com/apps](https://developers.facebook.com/apps),
   free. (Tamara ID/Secret root `.env` ma pehle thi che.)

---

## 3. Kai rite kaam kare che

```
   Product ni image upload karo
        │
        ├─ 1. VISION      image joine product samje che: su che, kaya
        │                 material nu, kona mate, kaya keywords
        │
        ├─ 2. TRENDS      Google Autocomplete + Google Trends + AI thi
        │                 hashtag "LADDER" (moti / vachli / NANI tags)
        │
        ├─ 3. SCRIPT      shot-by-shot plan — hook, product, benefit, CTA
        │                 pehla 3 second no hook, dar 2-3 second badlaav
        │
        ├─ 4. IMAGES      je scene mate joiye e AI banave —
        │                 avatar + tamara kapda sathe (virtual try-on)
        │
        ├─ 5. MUSIC       mood pramane Creative Commons track
        │
        ├─ 6. VOICEOVER   edge-tts — Hindi, Gujarati, Indian English
        │
        ├─ 7. RENDER      ffmpeg → 1080×1920 · 30fps · H.264 · AAC
        │                 Ken Burns, transitions, text overlay, cover
        │
        ├─ 8. CAPTION     Instagram ane Facebook mate ALAG caption.
        │                 Lakhya pachi 0-100 ma marks aape che; ochha
        │                 aave to AI ne FARI lakhavay che.
        │
        └─ 9. PUBLISH     IG Reels + FB Reels par ek saathe.
                          Hashtag pehla comment ma. Sauthi saara vakhate
                          apoaap goothvi shakay.
```

### Su su bane che

| Su joiye che | Kai rite |
|---|---|
| **Ek product ni reel** | Ek image mukho |
| **Ghana product ni ek j reel** | Ghani image mukho — dareak ne potano beat |
| **Tamari avatar product pehri ne** | Avatars tab ma 2-3 photo aapo, pachi automatic |
| **Koi bija jevi reel** | E reel ni file upload karo — eni STYLE ni nakal thashe |
| **IG ma je jaay e FB ma pan** | Automatic — pan alag caption ane alag hashtag count |

---

## 3b. Roj aapoaap reel — "set karo ane bhuli jao"

n8n ni jarur NATHI. App potej sambhale che.

```bash
curl -X POST http://localhost:8000/api/studio/automation   -H "x-api-key: $PY_API_KEY" -H "content-type: application/json"   -d '{"enabled":true,"hour":11,"minute":0,"products_per_reel":1,
       "duration":30,"language":"en","publish_when":"now"}'
```

Roj savare 11 vage (tamara audience na timezone ma) product images ma thi
**VAARO pramane** ek lai ne aakhi reel banse ane Instagram + Facebook par
mukai jashe. Dar vakhate ALAG product jaay che.

Turant test karvu hoy to:

```bash
curl -X POST http://localhost:8000/api/studio/automation/run-now   -H "x-api-key: $PY_API_KEY"
```

| Setting | Matlab |
|---|---|
| `products_per_reel` | 1 = ek product ni reel · 3+ = collection reel |
| `publish_when` | `now` (turant) · `auto` (sauthi saara vakhate) · `draft` |
| `account_ids` | khali = badha connected account |

`PY_API_KEY` `python/.env` ma che (jate bani jaay che).

---

## 4. ⚠️ Traan saachi vaat

### 1. Instagram nu trending song API thi lagavi shakatu NATHI

Meta e music catalog API ma kholyu j nathi — **koi pan tool** aa kari
shakatu nathi, ane aa aa app ni kami nathi.

Etle app be vastu kare che:
- Reel ni andar **Creative Commons music bake** kare che → 100% auto-post
  thay che ane copyright strike no dar nathi
- Publish pachi batave che ke **IG app ma kayo trending sound shodhvo** →
  reel → ⋯ → Edit → Audio → suggest karela shabd search karo → Trending
  filter → sound lagavo. Be tap, ane tyare IG no trending-audio boost pan male.

### 2. Meta ne PUBLIC https URL joiye

Meta na server **tamari file download kare che**. `localhost` kyarey nahi
chale. App aa apoaap sambhale che (Catbox par upload kari de che), pan
sauthi saru ane fast:

```bash
ngrok http 8000
# pachi .env ma: PUBLIC_MEDIA_BASE_URL=https://abcd-12-34.ngrok-free.app
```

### 3. Reference reel ni STYLE ni nakal thay che, shabdo ni nahi

Copyright no bhang na thay etle jaani joine. Shot count, pacing, hook
style ane mood ni nakal thay che — words nahi.

---

## 5. Multi-API pipeline — kaam kyarey atkatu nathi

Dareak bahar na kaam mate provider ni **chain** che. Ek ni free limit lage,
key khute, ke service down thay to **bijo apoaap** chalu thai jaay che:

| Kaam | Chain |
|---|---|
| Lakhan | Groq → Gemini → OpenRouter → Ollama |
| Image samajvi | Gemini → Groq → OpenRouter → Ollama(llava) |
| Image banavvi | Gemini Image → Pollinations |
| Music | ccMixter → Jamendo → tamari mp3 |
| Voiceover | edge-tts → Gemini TTS |
| Hosting | potanu URL → Catbox → Cloudinary → tmpfiles |
| Trends | Google Autocomplete + Google Trends + AI |

Sathe: per-provider **timeout**, exponential backoff + jitter **retry**, ane
**circuit breaker** (3 var fail thay to 60 second skip).

Ane sauthi agatya nu — **AI nu koi pan pagalu fail thay to pipeline atkatu
nathi**. Image na bani → tamari potani image vaparay. Music na madyu → chup
reel. Voiceover na banyo → fakt music. **Chhelle reel to bane j che.**

---

## 6. Test

```bash
python scripts/probe_services.py       # badhi service kharekhar chale che?
python scripts/test_render.py          # fakt video engine (~1 minute)
python scripts/selftest.py             # 10 round offline test
python scripts/selftest.py 3 pipeline  # + KHAREKHAR ek reel banave
```

`selftest.py 3 pipeline` sauthi kaam nu che — e vision ne stub kari ne
**baaki AAKHO rasto** kharekhar chalave che: script → images → music →
voiceover → render → public URL → caption.

---

## 7. Folder structure

```
python/
  run.py                    # app chalu karo
  requirements.txt
  automarketing/
    config.py               # badhu setting ek jagya e
    errors.py               # RetryableError vs FatalError
    logs.py
    publisher.py            # ek post ne publish karvanu
    pipeline/
      chain.py              # multi-API runner (retry, timeout, breaker)
      http.py               # shared HTTP client
    ai/
      base.py               # provider no interface
      openai_compat.py      # Groq, OpenRouter (ek j format)
      gemini_provider.py
      ollama_provider.py
      registry.py           # chain no kram
      vision.py             # image → product ni samajan
      schemas.py            # AI na jawab na shape
    media/
      images.py             # Pillow — resize, crop, EXIF
      hosts.py              # Catbox / Cloudinary / tmpfiles
      store.py              # disk + DB + public URL
      imagegen.py           # Pollinations / Gemini Image / try-on
    trends/
      keywords.py           # Google Autocomplete + Trends + hashtag ladder
      audio.py              # ccMixter / Jamendo + IG audio suchav
    seo/
      ranking.py            # caption score, best-time-to-post
      copy.py               # caption lakhe → tapase → fari lakhe
    video/
      ffmpeg.py             # binary shodhvi + chalavvi
      fonts.py              # lipi pramane font
      render.py             # scenes → 1080x1920 mp4
      voiceover.py          # edge-tts
    reels/
      plan.py               # AI shot list
      generate.py           # AAKHO pipeline
      reference.py          # reference reel ni style
      publish.py            # badha account par mokalvanu
      runner.py             # background job
      jobs.py               # progress tracking
    social/
      graph.py              # Meta Graph API
      publish.py            # IG/FB reel, image, carousel, story
      oauth.py              # Connect with Facebook
    db/mongo.py
    api/                    # FastAPI routes
    web/                    # UI (Jinja + saado JS)
  scripts/
    fetch_ffmpeg.py
    fetch_fonts.py
    probe_services.py
    test_render.py
    selftest.py
```

---

## 8. Troubleshooting

| Problem | Upay |
|---|---|
| `UnicodeEncodeError` Windows par | Fix thai gayelu che — badhi script `_console.py` vaapre che. Tamari potani script ma `sys.stdout.reconfigure(encoding="utf-8")` naakho. |
| "Ek pan AI provider ni key set nathi" | `console.groq.com/keys` ke `aistudio.google.com/apikey` — banne free. Ke `ollama pull llama3.2` (offline). |
| Reel ma text na dekhay / chorasa (□□□) | `python scripts/fetch_fonts.py` chalavo. |
| Scene vachhe transition nathi | Junu ffmpeg che. `python scripts/fetch_ffmpeg.py` chalavo. |
| Instagram "Media ID is not available" | Video nu URL public nathi. `ngrok http 8000` → `PUBLIC_MEDIA_BASE_URL`. |
| Meta: "Error validating application" | App ID ke Secret khoto/juno che. developers.facebook.com par check karo. |
| Reel banta bahu var lage | `RENDER_CONCURRENCY` vadharo, ane lambai ghatado. 20s ni reel ~2 minute. |
| Job "running" ma atki gayo | Server restart thayo hase. 25 minute pachi app jate "failed" kari de che. |
| edge-tts 403 aape | `pip install -U edge-tts` — Microsoft token scheme badle che, junu version fail thay. |
| Gemini `limit: 0` (429) | Aa rate limit NATHI — Google e AA MODEL nu free tier aa key ne aapyu j nathi. App jate bija model par jaay che. Kai j na chale to `aistudio.google.com/apikey` par **NAVA PROJECT ma navi key** banavo. |
| Gemini khali jawab aape | Nava flash models "thinking" models che — vichar pan `maxOutputTokens` ma thi gane che. App e jagya vadhari didhi che (fix thai gayelu che). |
| Gemini image (avatar+kapda) na bane | `gemini-2.5-flash-image` ne badhi key par free tier nathi maltu. Reel to bane j che — tamari potani image thi. |
| Ollama "connection failed" | `ollama serve` chalavo. |

---

## 9. TS version sathe farak

Root folder ma **TypeScript (Next.js)** version pan che — e j feature.
Fer aa:

| | TypeScript | Python |
|---|---|---|
| Voiceover | Gemini TTS / ElevenLabs | **edge-tts** (koi key nahi, vadhu saru) |
| Virtual try-on | IDM-VTON (paid) + Gemini | Gemini (free) |
| UI | MUI (bhari, sunder) | Saado JS (halku, fast) |
| Multi-brand / plans | Che | Ek brand (saral) |
| Setup | `npm install` | `pip install` |

Banne ek j MongoDB server vaapre che pan **alag database**, etle ek bija
ne aado nathi aavtu.
