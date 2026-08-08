"""
Product ni LINK mathi badhi vigat kadhe che.

Tame fakt link aapo — naam, kimat, varnan ane IMAGES apoaap aavi jaay che.
Pachi e images j reel pipeline ma jaay che (vision એne joine samje che).

Chaar rite try kare che, sauthi bharosalayak thi shuru:

  1. JSON-LD (schema.org/Product) — Shopify, WooCommerce, Amazon, Flipkart,
     ane lagbhag badha modern store aa aape che. Sauthi sachot.
  2. Open Graph meta tags — Facebook mate badhi site mukе che.
  3. Sadhu HTML — <title>, <meta description>, <img>.
  4. GEMINI — uper na traney khali aave tyare page ne AI vanche che.

Pehla traan mathi je made e bhegu kari daiye chie ("mixed"), etle ek jagya
e kami hoy to biji jagya thi bharai jaay.

Chotho rasto kem joiye: pehla traan REGEX che — emne `<meta property=
"og:title">` jevu chokkas markup joiye j che. Ghana store (React/Next par
banela, custom theme, javascript thi bharatu page) e markup aapta j nathi,
ane tyare user ne "product nu naam na madyu" kehvu pade che. Gemini page ne
manushy ni jem vanche che, etle tya pan kaam kare che. E fakt tyare j chale
che jyare regex khali aave — etle na to dhimu thay che, na kharch vadhe che.
"""

from __future__ import annotations

import asyncio
import html as htmllib
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

from ..errors import RetryableError, UserError
from ..pipeline.http import request_bytes

MAX_HTML_BYTES = 3 * 1024 * 1024  # 3MB — ena thi moti page ma kai nathi hotu


@dataclass
class ScrapedProduct:
    url: str
    title: str = ""
    description: str = ""
    price: Optional[float] = None
    currency: str = ""
    images: list[str] = field(default_factory=list)
    brand: str = ""
    availability: str = ""
    site_name: str = ""
    #: Kai rite malyu — debugging ane UI ma batavva mate.
    source: str = "html"

    @property
    def price_text(self) -> str:
        if self.price is None:
            return ""
        symbol = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}.get(
            self.currency.upper(), self.currency
        )
        # ₹1,299 jevu — bhaarat ma aa j rite lakhay che.
        return f"{symbol}{self.price:,.0f}" if self.price >= 1 else f"{symbol}{self.price}"

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "title": self.title,
            "description": self.description,
            "price": self.price,
            "currency": self.currency,
            "price_text": self.price_text,
            "images": self.images,
            "brand": self.brand,
            "availability": self.availability,
            "site_name": self.site_name,
            "source": self.source,
        }


# ------------------------------------------------------------------ #
#  Nana helpers
# ------------------------------------------------------------------ #


def _clean(text: Any) -> str:
    if text is None:
        return ""
    value = htmllib.unescape(str(text))
    # HTML tags kaadho ane badhi jagya ek space ma badlo.
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _to_price(value: Any) -> Optional[float]:
    """
    "₹1,299.00", "1299", "Rs. 1,299" — badhethi aankdo kadhe.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None

    text = str(value)
    # Aankda, comma ane dot j rakho.
    match = re.search(r"\d[\d,]*\.?\d*", text.replace(" ", " "))
    if not match:
        return None
    try:
        price = float(match.group(0).replace(",", ""))
    except ValueError:
        return None
    return price if price > 0 else None


def _absolute(base_url: str, link: str) -> str:
    # ⚠️ HTML ma `&` `&amp;` tarike lakhelu hoy che. Unescape karya vagar
    # URL ma `?v=1&amp;width=60` rahi jaay — e URL kharekhar khota che
    # ANE aapno width-badalvano regex pan match nathi thato (`;width`
    # male, `&width` nahi). Etle SAUTHI PEHLA unescape.
    link = htmllib.unescape((link or "").strip())
    if not link or link.startswith("data:"):
        return ""
    if link.startswith("//"):
        return _upsize(f"{urlparse(base_url).scheme}:{link}")
    return _upsize(urljoin(base_url, link))


#: Store platforms image ni maap URL ma j aape che.
#: Shopify : ...?v=123&width=60      → thumbnail
#: WooCom  : ...-150x150.jpg         → thumbnail
_WIDTH_PARAM = re.compile(r"([?&])(width|w)=\d+", re.IGNORECASE)
_HEIGHT_PARAM = re.compile(r"([?&])(height|h)=\d+", re.IGNORECASE)
_WC_SIZE = re.compile(r"-(\d{2,4})x(\d{2,4})(\.(?:jpe?g|png|webp))$", re.IGNORECASE)


def _upsize(url: str) -> str:
    """
    Thumbnail nu URL ne PURA MAAP na URL ma badle.

    ⚠️ Aa nanu lage che pan bahu agatya nu che: Shopify na page par ni
    ghani image `width=60` jevi hoy che (nani preview). Reel 1080×1920 nu
    che — 60px ni image ne motu karie to sav dhundhli dekhaay.
    E j URL ma width badalvathi PURI image male che, ane reel saaf bane che.
    """
    if not url:
        return url

    # Shopify / bija CDN — width ane height na params kaadhi naakho.
    if _WIDTH_PARAM.search(url) or _HEIGHT_PARAM.search(url):
        url = _WIDTH_PARAM.sub(r"\1width=1600", url)
        url = _HEIGHT_PARAM.sub("", url)
        # `?&` ke `&&` jevu kachru rahi jaay to saaf karo.
        url = url.replace("?&", "?").replace("&&", "&").rstrip("?&")

    # WooCommerce — "shirt-150x150.jpg" → "shirt.jpg"
    url = _WC_SIZE.sub(r"\3", url)

    return url


def _meta(html: str, *names: str) -> str:
    """`<meta property="og:title" content="...">` — banne kram ma shodhe."""
    for name in names:
        escaped = re.escape(name)
        for pattern in (
            rf'<meta[^>]+(?:property|name)=["\']{escaped}["\'][^>]*?content=["\']([^"\']*)["\']',
            rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]*?(?:property|name)=["\']{escaped}["\']',
        ):
            match = re.search(pattern, html, re.IGNORECASE)
            if match and match.group(1).strip():
                return _clean(match.group(1))
    return ""


def _all_meta(html: str, *names: str) -> list[str]:
    """Ek j property vaar var hoy (dakhla: ghani og:image)."""
    out: list[str] = []
    for name in names:
        escaped = re.escape(name)
        pattern = (
            rf'<meta[^>]+(?:property|name)=["\']{escaped}["\'][^>]*?content=["\']([^"\']*)["\']'
        )
        for match in re.finditer(pattern, html, re.IGNORECASE):
            value = _clean(match.group(1))
            if value:
                out.append(value)
    return out


# ------------------------------------------------------------------ #
#  1. JSON-LD (sauthi sachot)
# ------------------------------------------------------------------ #


def _walk_for_product(node: Any, found: list[dict]) -> None:
    """JSON-LD ma Product node gme tya chhupayelu hoi shake — badhe shodho."""
    if isinstance(node, list):
        for item in node:
            _walk_for_product(item, found)
        return
    if not isinstance(node, dict):
        return

    types = node.get("@type")
    types = types if isinstance(types, list) else [types]
    if any(str(t).lower() == "product" for t in types if t):
        found.append(node)

    for value in node.values():
        if isinstance(value, (dict, list)):
            _walk_for_product(value, found)


def _from_json_ld(html: str, base_url: str) -> Optional[ScrapedProduct]:
    blocks = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.IGNORECASE | re.DOTALL,
    )

    products: list[dict] = []
    for block in blocks:
        try:
            parsed = json.loads(block.strip())
        except json.JSONDecodeError:
            # Ketlik site ma trailing comma ke HTML comment hoy che.
            cleaned = re.sub(r"<!--.*?-->", "", block, flags=re.DOTALL).strip()
            cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
            try:
                parsed = json.loads(cleaned)
            except json.JSONDecodeError:
                continue
        _walk_for_product(parsed, products)

    if not products:
        return None

    # Sauthi bharelu node vaparo — ketlik site ma ochhi vigat vala
    # duplicate node pan hoy che.
    node = max(products, key=lambda p: len(json.dumps(p)))

    # ---- images ----
    images: list[str] = []
    raw_images = node.get("image")
    for item in raw_images if isinstance(raw_images, list) else [raw_images]:
        if isinstance(item, str):
            images.append(item)
        elif isinstance(item, dict):
            images.append(str(item.get("url") or item.get("contentUrl") or ""))

    # ---- offers (kimat) ----
    price = None
    currency = ""
    availability = ""
    offers = node.get("offers")
    offer_list = offers if isinstance(offers, list) else [offers]
    for offer in offer_list:
        if not isinstance(offer, dict):
            continue
        price = price or _to_price(
            offer.get("price")
            or offer.get("lowPrice")
            or (offer.get("priceSpecification") or {}).get("price")
        )
        currency = currency or _clean(
            offer.get("priceCurrency")
            or (offer.get("priceSpecification") or {}).get("priceCurrency")
        )
        raw_stock = _clean(offer.get("availability"))
        if raw_stock:
            availability = raw_stock.rsplit("/", 1)[-1]

    brand = node.get("brand")
    if isinstance(brand, dict):
        brand = brand.get("name")

    return ScrapedProduct(
        url=base_url,
        title=_clean(node.get("name")),
        description=_clean(node.get("description")),
        price=price,
        currency=currency,
        images=[_absolute(base_url, i) for i in images if i],
        brand=_clean(brand),
        availability=availability,
        source="json-ld",
    )


# ------------------------------------------------------------------ #
#  2. Open Graph
# ------------------------------------------------------------------ #


def _from_open_graph(html: str, base_url: str) -> ScrapedProduct:
    images = _all_meta(html, "og:image", "og:image:secure_url", "twitter:image")

    return ScrapedProduct(
        url=base_url,
        title=_meta(html, "og:title", "twitter:title"),
        description=_meta(html, "og:description", "twitter:description", "description"),
        price=_to_price(
            _meta(html, "product:price:amount", "og:price:amount", "twitter:data1")
        ),
        currency=_meta(html, "product:price:currency", "og:price:currency"),
        images=[_absolute(base_url, i) for i in images if i],
        brand=_meta(html, "og:brand", "product:brand"),
        availability=_meta(html, "product:availability", "og:availability"),
        site_name=_meta(html, "og:site_name"),
        source="open-graph",
    )


# ------------------------------------------------------------------ #
#  3. Sadhu HTML (chhelli aasha)
# ------------------------------------------------------------------ #

#: Aa image kadi product ni na hoy — kaadhi naakho.
_JUNK_IMAGE = re.compile(
    r"(logo|icon|sprite|placeholder|banner|avatar|badge|payment|visa|"
    r"mastercard|paypal|loader|spinner|pixel|tracking|1x1|blank)",
    re.IGNORECASE,
)


def _from_html(html: str, base_url: str) -> ScrapedProduct:
    title = ""
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if match:
        title = _clean(match.group(1))
        # "Product naam | Store naam" — store nu naam kaadhi naakho.
        title = re.split(r"\s+[|–—-]\s+", title)[0].strip() or title

    # h1 mota bhage title karta vadhu sachot hoy che.
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
    if h1:
        h1_text = _clean(h1.group(1))
        if 3 < len(h1_text) < 200:
            title = h1_text

    # Images — src ane lazy-load na attributes banne.
    images: list[str] = []
    for match in re.finditer(
        r'<img[^>]+(?:data-src|data-original|data-lazy-src|src)=["\']([^"\']+)["\']',
        html,
        re.IGNORECASE,
    ):
        link = match.group(1)
        if _JUNK_IMAGE.search(link):
            continue
        absolute = _absolute(base_url, link)
        if absolute and absolute not in images:
            images.append(absolute)
        if len(images) >= 12:
            break

    return ScrapedProduct(
        url=base_url,
        title=title,
        description=_meta(html, "description"),
        images=images,
        source="html",
    )


# ------------------------------------------------------------------ #
#  4. Gemini — regex khali aave tyare page ne AI vanche
# ------------------------------------------------------------------ #

#: AI ne aakhu HTML aapvano koi arth nathi — 90% to <script> ane CSS hoy
#: che. Aa tags kaadhi naakhvathi page 10 gunu nanu thai jaay che ane je
#: kaam nu che (naam, kimat, varnan, image) e badhu rahi jaay che.
_STRIP_TAGS = re.compile(
    r"<(script|style|noscript|svg|iframe)\b[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)

#: AI ne moklvano vadhu ma vadhu lakhan. Free tier na context ma besе ane
#: product ni vigat page na uper na bhaag ma j hoy che.
_AI_MAX_CHARS = 24_000


def _for_ai(html: str) -> str:
    """Page ne AI vanchi shake evu nanu karo — image na URL sachvi ne."""
    text = _HTML_COMMENT.sub(" ", html)
    text = _STRIP_TAGS.sub(" ", text)

    # Tag kaadhta pehla image na URL alag kaadhi laiye — nahi to AI pase
    # image aapvanu kai rahetu j nathi.
    image_urls: list[str] = []
    for match in re.finditer(
        r'<img[^>]+(?:data-src|data-original|data-lazy-src|src)=["\']([^"\']+)["\']',
        text,
        re.IGNORECASE,
    ):
        link = htmllib.unescape(match.group(1).strip())
        if link and not link.startswith("data:") and link not in image_urls:
            image_urls.append(link)
        if len(image_urls) >= 40:
            break

    # Meta tags pan rakhie chie — tyaj kyarek kimat/naam hoy che.
    metas = re.findall(r"<meta[^>]+>", text, re.IGNORECASE)[:60]

    body = _clean(text)[:_AI_MAX_CHARS]

    return "\n".join(
        [
            "=== PAGE TEXT ===",
            body,
            "",
            "=== META TAGS ===",
            "\n".join(metas),
            "",
            "=== IMAGE URLS FOUND ON THIS PAGE ===",
            "\n".join(image_urls),
        ]
    )


async def _from_ai(html: str, base_url: str) -> Optional[ScrapedProduct]:
    """
    Gemini page vanchine product ni vigat kadhe.

    Fail thay to `None` — AI na chale e karane aakhu kaam atakvu na joiye.
    """
    # Ahiya import karie chie jethi scraper import karvathi j aakho AI
    # stack load na thai jaay (test ane script ma e nakamu vajan che).
    from ..ai.base import CompletionRequest
    from ..ai.registry import complete
    from ..ai.schemas import PRODUCT_FROM_PAGE

    try:
        result = await complete(
            CompletionRequest(
                system=(
                    "You read e-commerce product pages and pull out the facts a "
                    "shop owner would need. You only report what is actually on "
                    "the page — you never invent a price, a brand or a detail. "
                    "Return only the structured JSON requested."
                ),
                prompt=(
                    f"This is the content of {base_url}\n\n"
                    "Pull out the product details.\n"
                    "For images: copy URLs EXACTLY from the IMAGE URLS list — do not "
                    "shorten, guess or build them. Pick only photos of this product, "
                    "best first.\n"
                    "If this is not a single product page, set isProductPage to false "
                    "and say what it is.\n\n"
                    + _for_ai(html)
                ),
                schema=PRODUCT_FROM_PAGE,
                max_tokens=2000,
            )
        )
    except Exception:  # noqa: BLE001 — AI optional che, regex j mukhya rasto
        return None

    data = result.data if isinstance(result.data, dict) else {}

    if not data.get("isProductPage", True):
        reason = str(data.get("notProductReason") or "").strip()
        raise UserError(
            f"Aa product page nathi lagti — {reason or 'AI ne aa page par ek product na madyu'}. "
            "Product ni POORI link joiye (category ke search page nahi)."
        )

    title = _clean(data.get("title"))
    if not title:
        return None

    price = _to_price(data.get("price"))

    # AI kyarek URL thodo badli naakhe che. Etle je URL kharekhar page par
    # hata e j rakhie chie — banavelo URL 404 aape ane image na utare.
    raw_images = data.get("images")
    images = [
        _absolute(base_url, str(i))
        for i in (raw_images if isinstance(raw_images, list) else [])
        if isinstance(i, str) and i.strip() and not _JUNK_IMAGE.search(i)
    ]

    return ScrapedProduct(
        url=base_url,
        title=title,
        description=_clean(data.get("description")),
        price=price,
        currency=_clean(data.get("currency")).upper()[:3],
        images=[i for i in images if i][:12],
        brand=_clean(data.get("brand")),
        source="gemini",
    )


# ------------------------------------------------------------------ #
#  Bhegu karvu
# ------------------------------------------------------------------ #


def _merge(*products: Optional[ScrapedProduct]) -> ScrapedProduct:
    """
    Sauthi bharosalayak thi shuru karine khali jagya bharo.

    Dakhla: JSON-LD ma naam ane kimat che pan image nathi → OpenGraph ni
    image lai laiye. Ek jagya e kami hoy to biji jagya thi bharai jaay.
    """
    valid = [p for p in products if p is not None]
    if not valid:
        raise UserError("Aa page mathi kai vigat na madi")

    merged = ScrapedProduct(url=valid[0].url)
    used: list[str] = []

    for product in valid:
        filled = False
        for attribute in ("title", "description", "currency", "brand", "availability", "site_name"):
            if not getattr(merged, attribute) and getattr(product, attribute):
                setattr(merged, attribute, getattr(product, attribute))
                filled = True
        if merged.price is None and product.price is not None:
            merged.price = product.price
            filled = True

        for image in product.images:
            if image and image not in merged.images:
                merged.images.append(image)
                filled = True

        if filled:
            used.append(product.source)

    merged.images = merged.images[:12]
    merged.source = used[0] if len(set(used)) == 1 else "mixed"

    if not merged.site_name:
        merged.site_name = urlparse(merged.url).netloc.replace("www.", "")

    return merged


# ------------------------------------------------------------------ #
#  Public API
# ------------------------------------------------------------------ #


#: Ek domain ne ek saathe ketli request. Shopify ane bija store ek j IP
#: par thi zadapi request aave to 429 aape che — ane e barabar j che.
#: Ek j domain ni link ek pachi ek moklie to 429 aavto j nathi.
_domain_locks: dict[str, asyncio.Lock] = {}

#: Kaya domain ne chhelli request kyare mokli — be request vachhe thodu
#: antar rakhva mate.
_last_hit: dict[str, float] = {}

#: Ek j domain ni be request vachhe ochha ma ochhu aatlu antar (second).
_DOMAIN_GAP = 1.2

#: 429/5xx par ketli var fari try karvu.
_FETCH_RETRIES = 2


def _domain_lock(host: str) -> asyncio.Lock:
    lock = _domain_locks.get(host)
    if lock is None:
        lock = asyncio.Lock()
        _domain_locks[host] = lock
    return lock


async def _fetch_page(url: str, host: str) -> bytes:
    """
    Page utaare — ek domain ne sambhaline, ane 429 aave to rah joine.

    Aa function j "bije var error na aave" ne shakya banave che:

      • EK J DOMAIN NI request ek pachi ek jaay che (lock), sathe sathe nahi
      • Be request vachhe thodu antar rahe che
      • 429/5xx aave to SERVER e kahyu etli var rah jue che (`Retry-After`),
        ane e na kahyu hoy to 3s → 6s
      • chhelle pan na chale to samjay evu vaakya — HTML kachru nahi
    """
    # Cloudflare pachhal ni site (ghani Shopify store) fakt User-Agent joine
    # santosh nathi manti — e `sec-fetch-*` ane `accept-encoding` jeva header
    # pan jue che, kem ke asli browser e hamesha mokle j che. E na hoy to
    # request "bot" lage che ane 429/403 male che. Aa public product page
    # che, koi login ke paywall pachhal nathi — fakt normal browser jevo
    # request mokliye chie.
    headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9,gu;q=0.8,hi;q=0.7",
        # ⚠️ `accept-encoding` JAATE KADI NA LAKHVU. httpx pote e header
        # bhare che — fakt je compression e KHAREKHAR decode kari shake e j.
        # Aapne `br` umerie ane brotli install na hoy to site brotli ma
        # jawab aape che, httpx ene ughaadi shakto nathi, ane page kachra
        # bytes tarike aave che. (Aa bhool ek var thai chuki che.)
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
    }

    last: Exception | None = None

    async with _domain_lock(host):
        for attempt in range(_FETCH_RETRIES + 1):
            # Chhelli request pachi puratu antar na thayu hoy to rah jovi.
            gap = _DOMAIN_GAP - (time.monotonic() - _last_hit.get(host, 0.0))
            if gap > 0:
                await asyncio.sleep(gap)

            try:
                # `send_referer=False` jaani joine: `sec-fetch-site: none`
                # no matlab j "user e sidhu aa link kholi" — sathe Referer
                # mokliye to banne vaat sameli na khaay ane e j shanka
                # upjave che.
                data = await request_bytes(
                    url, timeout=45.0, headers=headers, send_referer=False
                )
                _last_hit[host] = time.monotonic()
                return data
            except RetryableError as error:
                _last_hit[host] = time.monotonic()
                last = error
                if attempt >= _FETCH_RETRIES:
                    break
                # Server e kahyu hoy e j maanvu — aapno andaj ena karta
                # kharab j hoy che.
                wait = error.retry_after if error.retry_after else 3.0 * (2**attempt)
                await asyncio.sleep(wait)
            except Exception as error:  # noqa: BLE001
                _last_hit[host] = time.monotonic()
                last = error
                break

    raise UserError(_fetch_error_message(url, host, last))


def _fetch_error_message(url: str, host: str, error: Exception | None) -> str:
    """Site kem na khuli — user ne SU KARVU e kehvu, error code nahi."""
    status = getattr(error, "status", None)
    text = str(error or "")

    if status == 429 or "429" in text:
        return (
            f"{host} e atyare vadhu request ni na paadi (429).\n"
            "Aa link pehla thi add thai gai hoy to fari add karvani jarur nathi — "
            "niche na list ma jou.\n"
            "Nahi to 1-2 minute rah joine fari try karo (site pote roke che, "
            "aa app ni bhool nathi)."
        )
    if status in (401, 403) or "403" in text:
        return (
            f"{host} e aa page kholva na didhu (403).\n"
            "Site bot ne roke che. E product ni image jate upload karo "
            "(Reel Studio tab ma) — kaam e j rite thai jashe."
        )
    if status == 404 or "404" in text:
        return f"Aa link par kai nathi (404) — link fari check karo."
    if status and status >= 500:
        return f"{host} no server atyare kharab chale che ({status}). Thodi var pachi try karo."

    return (
        f"Aa link kholi na shakai ({text[:110]}).\n"
        "Link barabar che? Site login magti nathi ne?"
    )


async def scrape_product(url: str) -> ScrapedProduct:
    """
    Product ni link mathi badhi vigat kadhe.

    Site block kare ke vigat na male to samjay evo error aape che —
    "kaink khotu thayu" nahi.
    """
    url = (url or "").strip()
    if not url:
        raise UserError("Link khali che")

    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    if not parsed.netloc:
        raise UserError(f"Aa barabar link nathi lagti: {url[:100]}")

    raw = await _fetch_page(url, parsed.netloc)

    html = raw[:MAX_HTML_BYTES].decode("utf-8", errors="replace")

    product = _merge(
        _from_json_ld(html, url),
        _from_open_graph(html, url),
        _from_html(html, url),
    )

    # ---- Regex adhuru aavyu? Have Gemini page vanche. ----
    #
    # Traney mathi ek pan khute to AI ne poochie chie:
    #   naam   — aa vagar product j nathi
    #   image  — reel image par j bane che, image vagar kai na thay
    #   kimat  — caption ma jaay che ("₹2,499 ma"), ane kimat vali caption
    #            ghani vadhu vechan kare che
    #
    # Barabar markup vali site (Shopify/WooCommerce) ma traney JSON-LD
    # mathi j mali jaay che, etle tya AI chalto j nathi — kharch ke vaar
    # vadhe nahi. E fakt tya chale che jya kharekhar jarur che.
    if not product.title or not product.images or product.price is None:
        ai_product = await _from_ai(html, url)
        if ai_product:
            # Regex je malyu e vadhu bharoso patra che (e page mathi sidhu
            # aavyu che), etle e pehla ane AI ene bhare che — ulta nahi.
            product = _merge(product, ai_product)

    if not product.title:
        raise UserError(
            f"Aa page mathi product nu naam na madyu ({parsed.netloc}). "
            "Aa product page che ne? Site login magti nathi ne? "
            "Naam jate lakhi ne pan aagal vadhi shako cho."
        )

    # 404 / "access denied" page pan HTTP 200 sathe aavi shake che. Tyare
    # title "Not Found" jevu hoy che ane image ek pan nathi hoti. Aavu
    # kachru product tarike save thai jaay to pachi reel ma e j jaay —
    # etle ahiya j pakdi laiye chie.
    if _looks_like_error_page(product):
        raise UserError(
            f"Aa link par product na madyu — page e \"{product.title[:60]}\" aapyu. "
            "Link fari check karo (product page ni pooori link joiye, "
            "category ke search page nahi)."
        )

    return product


_ERROR_TITLES = re.compile(
    r"^\s*(404|403|500|page not found|not found|error|access denied|forbidden|"
    r"oops|something went wrong|sorry|no longer available|out of stock)\b",
    re.IGNORECASE,
)


def _looks_like_error_page(product: ScrapedProduct) -> bool:
    """
    Aa product page che ke error page?

    Fakt title par thi nakki nathi karta — ketlak product nu naam kharekhar
    "Error" hoi shake. Etle title SATHE image pan na hoy tyare j error
    ganie chie.
    """
    if not _ERROR_TITLES.match(product.title):
        return False
    # Image ke kimat hoy to e kharekhar product hase.
    return not product.images and product.price is None


async def scrape_many(urls: list[str]) -> tuple[list[ScrapedProduct], list[dict]]:
    """
    Ghani link ek saathe.

    Ek link kharab hoy to BAKI NI ATKATI NATHI — je chalyu e pachu aave
    che ane je na chalyu ena karan sathe alag list ma aave che.

    Badhi link SATHE SATHE jaay che, pan `_fetch_page` na domain-lock ne
    karane EK J SITE ni link ek pachi ek j jaay che. Etle 10 link alag alag
    site ni hoy to zadapi pura thay, ane 10 link ek j site ni hoy to e site
    par bojo nathi padto (ane 429 aavto nathi).
    """
    unique: list[str] = []
    for url in urls:
        cleaned = (url or "").strip()
        if cleaned and cleaned not in unique:
            unique.append(cleaned)

    results = await asyncio.gather(
        *(scrape_product(u) for u in unique), return_exceptions=True
    )

    products: list[ScrapedProduct] = []
    failures: list[dict] = []

    for url, result in zip(unique, results):
        if isinstance(result, ScrapedProduct):
            products.append(result)
        else:
            failures.append({"url": url, "error": str(result)[:300]})

    return products, failures
