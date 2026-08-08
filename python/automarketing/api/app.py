"""
FastAPI app — badhu ahiya jodaay che.

    python run.py
    → http://localhost:8000
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .. import __version__
from ..config import PYTHON_DIR, settings
from ..db import connect
from ..errors import UserError
from ..logs import log_activity, recent_logs
from ..pipeline.http import close_client
from ..reels.runner import reap_stuck_jobs
from ..publisher import publish_post
from .auth import COOKIE_NAME, SESSION_DAYS, authenticate, create_token, ensure_seed_user
from .deps import current_brand, current_user, error_message, fail, ok
from .routes_accounts import router as accounts_router
from .routes_dm import router as dm_router
from .routes_products import router as products_router
from .routes_studio import router as studio_router
from .routes_system import router as system_router

WEB_DIR = PYTHON_DIR / "automarketing" / "web"
templates = Jinja2Templates(directory=str(WEB_DIR / "templates"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App chalu thay tyare DB jodo ane admin user banavo."""
    try:
        await connect()
        await ensure_seed_user()
        print(f"  ✓ MongoDB: {settings.mongodb_db}")
    except Exception as error:  # noqa: BLE001
        # DB na chale to pan app chalu thavu joiye — setup page ma
        # spashta batavay che ke su khute che.
        print(f"  ✗ MongoDB: {error}")
        print("    `mongod` chalu karo, pachi page refresh karo.")

    scheduler = asyncio.create_task(_scheduler_loop())
    try:
        yield
    finally:
        scheduler.cancel()
        await close_client()


async def _scheduler_loop() -> None:
    """
    Dar minute: due posts publish karo ane atkela reel job saaf karo.

    Alag cron ni jarur nathi — app potej sambhale che.
    """

    from ..db import posts as posts_collection

    await asyncio.sleep(10)  # app ubhu thay eni raah

    while True:
        try:
            from datetime import datetime, timezone

            await connect()
            due = [
                doc
                async for doc in posts_collection()
                .find(
                    {
                        "status": "scheduled",
                        "scheduled_at": {"$ne": None, "$lte": datetime.now(timezone.utc)},
                    }
                )
                .limit(25)
            ]
            for post in due:
                await publish_post(post["_id"])

            reaped = await reap_stuck_jobs()

            # "Set karo ane bhuli jao" — roj nu reel.
            from ..reels.automation import run_all_due

            started = await run_all_due()

            if due or reaped or started:
                await log_activity(
                    action="scheduler.tick",
                    message=(
                        f"{len(due)} post publish, {reaped} atkela reel saaf, "
                        f"{started} navu reel shuru"
                    ),
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — scheduler kadi marvo na joiye
            pass

        await asyncio.sleep(60)


app = FastAPI(
    title="Auto Marketing Software",
    version=__version__,
    lifespan=lifespan,
    docs_url="/api/docs",
)

app.include_router(studio_router)
app.include_router(accounts_router)
app.include_router(system_router)
app.include_router(products_router)
app.include_router(dm_router)

static_dir = WEB_DIR / "static"
static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


# ------------------------------------------------------------------ #
#  Error handling — hamesha samjay evo jawab
# ------------------------------------------------------------------ #


@app.exception_handler(Exception)
async def handle_error(request: Request, error: Exception):
    message, status_code = error_message(error)
    if request.url.path.startswith("/api/"):
        return JSONResponse({"ok": False, "error": message}, status_code=status_code)
    return HTMLResponse(f"<pre>{message}</pre>", status_code=status_code)


# ------------------------------------------------------------------ #
#  Pages
# ------------------------------------------------------------------ #


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    from .auth import read_token

    if not read_token(request.cookies.get(COOKIE_NAME, "")):
        return RedirectResponse("/login", status_code=302)

    return templates.TemplateResponse(
        request, "app.html", {"version": __version__, "app_url": settings.app_url}
    )


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, error: str = ""):
    return templates.TemplateResponse(
        request,
        "login.html",
        {"error": error, "hint_email": settings.seed_email, "version": __version__},
    )


@app.post("/login")
async def login_submit(
    email: str = Form(...),
    password: str = Form(...),
    #: Login pachi kya lai javu. Dakhla: "/#products".
    #: Koi deep link par jai ne login magay tyare user ne PACHO e j jagya e
    #: laavvo — nahi to e fari shodhvu pade.
    next: str = Form(""),
):
    try:
        user = await authenticate(email, password)
    except UserError as error:
        from urllib.parse import quote

        return RedirectResponse(f"/login?error={quote(str(error))}", status_code=302)

    # ⚠️ FAKT aapni j ssite par lai javu — bahar nu URL svikarie to
    # koi "login karo" kahine phishing site par mokali shake.
    target = next if next.startswith("/") and not next.startswith("//") else "/"

    response = RedirectResponse(target, status_code=302)
    response.set_cookie(
        COOKIE_NAME,
        create_token(user),
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
    )
    return response


@app.get("/logout")
async def logout():
    response = RedirectResponse("/login", status_code=302)
    response.delete_cookie(COOKIE_NAME)
    return response


# ------------------------------------------------------------------ #
#  Nana API
# ------------------------------------------------------------------ #


@app.get("/api/me")
async def me(user: dict = Depends(current_user), brand: dict = Depends(current_brand)):
    return ok(
        {
            "user": {"id": str(user["_id"]), "email": user.get("email"), "name": user.get("name")},
            "brand": {
                "id": str(brand["_id"]),
                "name": brand.get("name"),
                "brand_voice": brand.get("brand_voice"),
            },
        }
    )


@app.post("/api/brand")
async def update_brand(
    request: Request,
    user: dict = Depends(current_user),
    brand: dict = Depends(current_brand),
):
    """Brand nu naam ane voice — reel ni bhasha ane tone par asar kare che."""
    from ..db import brands as brands_collection

    body = await request.json()
    changes = {
        key: str(body.get(key) or "")[:300]
        for key in ("name", "brand_voice", "target_audience")
        if key in body
    }
    if changes:
        await brands_collection().update_one({"_id": brand["_id"]}, {"$set": changes})
    return ok({"updated": True})


@app.get("/api/logs")
async def logs(limit: int = 100, brand: dict = Depends(current_brand)):
    return ok(await recent_logs(brand_id=str(brand["_id"]), limit=limit))


@app.get("/api/posts")
async def list_posts(limit: int = 50, brand: dict = Depends(current_brand)):
    from ..db import accounts as accounts_collection
    from ..db import posts as posts_collection

    await connect()
    rows = [
        doc
        async for doc in posts_collection()
        .find({"brand_id": str(brand["_id"])})
        .sort("created_at", -1)
        .limit(min(limit, 200))
    ]

    names: dict[str, str] = {}
    async for account in accounts_collection().find({"brand_id": str(brand["_id"])}):
        names[str(account["_id"])] = account.get("display_name", "")

    return ok(
        [
            {
                "id": str(post["_id"]),
                "platform": post.get("platform"),
                "post_type": post.get("post_type"),
                "account": names.get(str(post.get("account_id")), "—"),
                "caption": (post.get("caption") or "")[:200],
                "status": post.get("status"),
                "permalink": post.get("permalink"),
                "error": post.get("error"),
                "scheduled_at": post.get("scheduled_at"),
                "published_at": post.get("published_at"),
                "seo_score": (post.get("seo") or {}).get("score"),
                "thumbnail_url": post.get("thumbnail_url"),
                "created_at": post.get("created_at"),
            }
            for post in rows
        ]
    )


@app.post("/api/posts/{post_id}/publish")
async def publish_one(post_id: str, brand: dict = Depends(current_brand)):
    result = await publish_post(post_id)
    if not result.get("ok"):
        return fail(result.get("error") or "Publish fail", 502)
    return ok(result)


@app.get("/api/health")
async def health():
    from ..db import is_reachable

    return ok({"ok": True, "version": __version__, "db": await is_reachable()})
