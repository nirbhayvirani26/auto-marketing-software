"""
Badhu setting ek j jagya e.

`.env` be jagya thi vanchay che, aa kram ma:

  1. project root nu `.env`   (tamara Meta ID/Secret tya pehle thi che)
  2. `python/.env`            (aa Python app na potana setting — uper vale)

Etle tamare Meta ni vigat fari lakhvani jarur nathi.

DHYAN: badhu getter thi vanchie chie, module load thay tyare nahi. Etle
test ma ke chalu app ma env badlo to turant asar thay che.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# python/automarketing/config.py  →  python/  →  project root
PYTHON_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = PYTHON_DIR.parent


def load_env() -> None:
    """Banne `.env` vanche. Ek var call thay etle basi."""
    root_env = PROJECT_ROOT / ".env"
    if root_env.exists():
        load_dotenv(root_env, override=False)

    python_env = PYTHON_DIR / ".env"
    if python_env.exists():
        # override=True — Python app nu setting uper rahe.
        load_dotenv(python_env, override=True)


load_env()


def env(name: str, default: str = "") -> str:
    """
    Env vanche.

    `or default` jaani joine — `.env` ma `KEY=` (khali) hoy tyare pan default
    lagu padvu joiye. Khali string ne "set thayelu" ganvu e sauthi common
    bhool che.
    """
    return (os.environ.get(name) or default).strip()


def env_int(name: str, default: int) -> int:
    try:
        return int(env(name) or default)
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    try:
        return float(env(name) or default)
    except ValueError:
        return default


def env_bool(name: str, default: bool) -> bool:
    value = env(name).lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


# ------------------------------------------------------------------ #
#  Paths
# ------------------------------------------------------------------ #


def storage_dir() -> Path:
    path = Path(env("STORAGE_DIR") or (PYTHON_DIR / "storage"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def media_dir() -> Path:
    path = Path(env("MEDIA_DIR") or (storage_dir() / "media"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def work_dir() -> Path:
    path = storage_dir() / "work"
    path.mkdir(parents=True, exist_ok=True)
    return path


def music_dir() -> Path:
    path = Path(env("MUSIC_DIR") or (storage_dir() / "music"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def fonts_dir() -> Path:
    path = PYTHON_DIR / "assets" / "fonts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def vendor_dir() -> Path:
    path = PYTHON_DIR / "vendor"
    path.mkdir(parents=True, exist_ok=True)
    return path


# ------------------------------------------------------------------ #
#  App
# ------------------------------------------------------------------ #


class Settings:
    """
    Property tarike rakhyu che — value dar vakhate taaji vanchay che.
    (Module load vakhate freeze thai jaay to test ma bhool thay.)
    """

    # ---- App ----
    @property
    def app_url(self) -> str:
        return env("PY_APP_URL") or env("APP_URL", "http://localhost:8000")

    @property
    def host(self) -> str:
        # 0.0.0.0 = badha network interface par sambhalo.
        # `127.0.0.1` rakhie to ketlik Windows/VPN/firewall na setup ma
        # browser pahonchi shakto nathi, ane phone par thi to kadi nahi.
        # Aa local tool che etle 0.0.0.0 barabar che.
        return env("PY_HOST", "0.0.0.0")  # noqa: S104

    @property
    def port(self) -> int:
        return env_int("PY_PORT", 8000)

    @property
    def secret_key(self) -> str:
        # JWT_SECRET root .env ma pehle thi che — e j vaparie chie.
        return env("PY_SECRET_KEY") or env("JWT_SECRET") or "change-me-please-32-chars-minimum"

    @property
    def debug(self) -> bool:
        return env_bool("PY_DEBUG", False)

    @property
    def api_key(self) -> str:
        """
        Machine-to-machine key (n8n, cron, script).
        `X-API-Key` header ma aa moklo. Khali hoy to header valo rasto
        band rahe che — fakt browser cookie j chale.
        """
        return env("PY_API_KEY")

    # ---- MongoDB ----
    @property
    def mongodb_uri(self) -> str:
        return env("MONGODB_URI", "mongodb://127.0.0.1:27017")

    @property
    def mongodb_db(self) -> str:
        # TS app na data sathe bhelsel na thay etle alag database.
        return env("PY_MONGODB_DB", "auto_marketing_py")

    # ---- Seed admin ----
    @property
    def seed_email(self) -> str:
        return env("SEED_ADMIN_EMAIL", "admin@example.com")

    @property
    def seed_password(self) -> str:
        return env("SEED_ADMIN_PASSWORD", "Admin@12345")

    @property
    def seed_name(self) -> str:
        return env("SEED_ADMIN_NAME", "Admin")

    # ---- AI (badha FREE) ----
    @property
    def groq_key(self) -> str:
        return env("GROQ_API_KEY")

    @property
    def groq_model(self) -> str:
        return env("GROQ_MODEL", "llama-3.3-70b-versatile")

    @property
    def groq_vision_model(self) -> str:
        # Groq pase atyare koi vision model nathi — default khali j rakhvu.
        # Bhavishya ma aave to .env ma naam nakhi devu, code badalvu nahi.
        return env("GROQ_VISION_MODEL")

    @property
    def gemini_key(self) -> str:
        return env("GEMINI_API_KEY") or env("GOOGLE_API_KEY")

    @property
    def gemini_model(self) -> str:
        # `-latest` alias ne free tier mota bhage male che; fixed-version
        # models (gemini-2.0-flash) ketlik key par "limit: 0" aape che.
        return env("GEMINI_MODEL", "gemini-flash-latest")

    @property
    def gemini_vision_model(self) -> str:
        return env("GEMINI_VISION_MODEL", "gemini-flash-latest")

    @property
    def gemini_image_model(self) -> str:
        return env("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")

    @property
    def openrouter_key(self) -> str:
        return env("OPENROUTER_API_KEY")

    @property
    def openrouter_model(self) -> str:
        return env("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")

    @property
    def openrouter_vision_model(self) -> str:
        return env(
            "OPENROUTER_VISION_MODEL",
            "meta-llama/llama-3.2-11b-vision-instruct:free",
        )

    @property
    def ollama_host(self) -> str:
        return env("OLLAMA_HOST", "http://127.0.0.1:11434")

    @property
    def ollama_model(self) -> str:
        return env("OLLAMA_MODEL")

    @property
    def preferred_text_provider(self) -> str:
        return env("AI_PROVIDER").lower()

    @property
    def preferred_vision_provider(self) -> str:
        return env("VISION_PROVIDER").lower()

    # ---- OpenAI (ChatGPT ni image API) ----
    @property
    def openai_key(self) -> str:
        return env("OPENAI_API_KEY")

    @property
    def openai_base_url(self) -> str:
        return env("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

    @property
    def openai_image_model(self) -> str:
        return env("OPENAI_IMAGE_MODEL", "gpt-image-1")

    @property
    def openai_image_quality(self) -> str:
        return env("OPENAI_IMAGE_QUALITY", "high")

    @property
    def preferred_image_provider(self) -> str:
        return env("IMAGE_PROVIDER").lower()

    # ---- AI video (Google Flow nu "Omni") ----
    @property
    def omni_model(self) -> str:
        return env("OMNI_MODEL", "gemini-omni-flash-preview")

    @property
    def ai_video_enabled(self) -> bool:
        return env_bool("AI_VIDEO_ENABLED", True) and bool(self.gemini_key)

    @property
    def ai_video_max_clips(self) -> int:
        """
        Ek reel ma ketla AI clip.

        Dareak clip ~1-2 minute lage che ane paid pan che, etle aakha reel
        na badha scene video karva no arth nathi — 2-3 sauthi agatya na
        shot j video hoy e sauthi saru pariman aape che.
        """
        return max(0, min(8, env_int("AI_VIDEO_MAX_CLIPS", 2)))

    @property
    def preferred_video_provider(self) -> str:
        return env("VIDEO_PROVIDER").lower()

    # ---- Media hosting (key vagar na hosts pehla) ----
    @property
    def public_media_base_url(self) -> str:
        return env("PUBLIC_MEDIA_BASE_URL").rstrip("/")

    @property
    def cloudinary_cloud(self) -> str:
        return env("CLOUDINARY_CLOUD_NAME")

    @property
    def cloudinary_preset(self) -> str:
        return env("CLOUDINARY_UPLOAD_PRESET")

    @property
    def allow_anon_hosts(self) -> bool:
        return env_bool("MEDIA_ALLOW_ANON_HOSTS", True)

    @property
    def preferred_host(self) -> str:
        return env("MEDIA_HOST").lower()

    # ---- Music ----
    @property
    def jamendo_client_id(self) -> str:
        return env("JAMENDO_CLIENT_ID")

    # ---- Voiceover ----
    @property
    def voiceover_enabled(self) -> bool:
        return env_bool("VOICEOVER_ENABLED", True)

    @property
    def voiceover_voice(self) -> str:
        return env("VOICEOVER_VOICE", "female")

    @property
    def tts_provider(self) -> str:
        return env("TTS_PROVIDER").lower()

    # ---- Video ----
    @property
    def ffmpeg_path(self) -> str:
        return env("FFMPEG_PATH")

    @property
    def font_path(self) -> str:
        return env("FONT_PATH")

    @property
    def render_concurrency(self) -> int:
        return max(1, env_int("RENDER_CONCURRENCY", 3))

    @property
    def reel_max_concurrent(self) -> int:
        return max(1, env_int("REEL_MAX_CONCURRENT", 2))

    @property
    def reel_watermark(self) -> str:
        return env("REEL_WATERMARK")

    # ---- Meta (tamara root .env mathi j) ----
    @property
    def meta_app_id(self) -> str:
        return env("META_APP_ID")

    @property
    def meta_app_secret(self) -> str:
        return env("META_APP_SECRET")

    @property
    def meta_graph_version(self) -> str:
        return env("META_GRAPH_VERSION", "v21.0")

    @property
    def meta_redirect_uri(self) -> str:
        return f"{self.app_url}/api/oauth/meta/callback"

    # ---- Market ----
    @property
    def market(self) -> str:
        return env("DEFAULT_MARKET", "India")

    @property
    def trends_geo(self) -> str:
        return env("TRENDS_GEO", "IN")

    @property
    def timezone_offset_minutes(self) -> int:
        return env_int("AUDIENCE_TZ_OFFSET", 330)

    # ---- Cron ----
    @property
    def cron_secret(self) -> str:
        return env("CRON_SECRET")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
