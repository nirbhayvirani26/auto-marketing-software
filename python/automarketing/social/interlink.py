"""
Inter-linking — tamara potana accounts ne ek-bija sathe jodvu.

Tamare 5 account hoy to e paanchey alag alag rahe che, ane ek account no
follower ne bija account ni khabar j nathi padti. Aa file e ne jode che:

  1. CROSS-MENTION — dareak post na chhede BIJA accounts nu naam mukay
     che ("Vadhu jovu? @account2 @account3"). Follower ek account thi
     bija par jaay che.

  2. PRODUCT LINK — dareak post ma product ni link jaay che (Instagram
     ma caption ma link click nathi thato, etle "link in bio" lakhie
     chie ane DM ma sachi link moklie chie).

  3. FIRST COMMENT — hashtag ane link pehla comment ma jaay che, etle
     caption saaf rahe che.

⚠️ EK VAAT DHYAN MA: Instagram par bahu vadhu @mention karvathi post ne
   spam ganvama aave che. Etle EK post ma vadhu ma vadhu 3 account j
   mention karie chie, ane vaari fari — badha account ne vaaro male.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

#: Ek post ma aa thi vadhu account mention na karvu (spam signal).
MAX_MENTIONS = 3


@dataclass
class Account:
    """Inter-linking ne jetlu joiye etlu j."""

    id: str
    platform: str  # "instagram" | "facebook"
    handle: str  # @ vagar
    display_name: str = ""


def _mention(account: Account) -> str:
    handle = (account.handle or "").lstrip("@").strip()
    if not handle:
        return ""
    # Facebook page ne @handle thi tag karvu bharoso layak nathi (page
    # username hoy to j chale), etle tya naam j lakhie chie.
    return f"@{handle}" if account.platform == "instagram" else handle


def partners_for(
    current: Account,
    all_accounts: list[Account],
    *,
    rotation: int = 0,
    max_mentions: int = MAX_MENTIONS,
) -> list[Account]:
    """
    Aa post ma kaya accounts mention karva.

    `rotation` badalta rehvathi dar vakhate ALAG accounts ne vaaro male
    che — 5 account hoy to badha ne baari-baari thi promotion male.
    """
    others = [
        a
        for a in all_accounts
        if a.id != current.id and _mention(a)
        # E j platform na account mention karvathi j faydo thay che —
        # Instagram no follower Facebook page ne tag karine nahi male.
        and a.platform == current.platform
    ]
    if not others:
        return []

    if len(others) <= max_mentions:
        return others

    start = rotation % len(others)
    # Vartul ma firo — badha ne vaaro male.
    return [others[(start + i) % len(others)] for i in range(max_mentions)]


def build_cross_mention_line(
    current: Account,
    all_accounts: list[Account],
    *,
    rotation: int = 0,
    language: str = "en",
) -> str:
    """Post na chhede mukvani cross-mention line."""
    partners = partners_for(current, all_accounts, rotation=rotation)
    if not partners:
        return ""

    handles = " ".join(_mention(a) for a in partners if _mention(a))
    if not handles:
        return ""

    templates = {
        "en": f"More from us → {handles}",
        "hinglish": f"Aur bhi dekho → {handles}",
        "hi": f"और देखें → {handles}",
        "gu": f"વધુ જુઓ → {handles}",
    }
    return templates.get(language, templates["en"])


def build_link_line(
    product_url: str,
    *,
    platform: str,
    language: str = "en",
) -> str:
    """
    Product link ni line.

    ⚠️ Instagram na caption ma link CLICK THATI NATHI — e sadho text j
    rahe che. Etle tya "link in bio" lakhvu ane sachi link DM/bio ma
    aapvi e j ek j kaam karto rasto che. Facebook ma link click thay che,
    etle tya sachi link mukie chie.
    """
    if not product_url:
        return ""

    if platform == "facebook":
        return f"🔗 {product_url}"

    templates = {
        "en": "🔗 Link in bio — or comment LINK and I'll DM it to you",
        "hinglish": "🔗 Link bio ma che — ya LINK comment karo, DM kar dungi",
        "hi": "🔗 लिंक बायो में है — या LINK कमेंट करें, DM कर दूंगी",
        "gu": "🔗 લિંક બાયો માં છે — અથવા LINK કોમેન્ટ કરો, DM કરી દઈશ",
    }
    return templates.get(language, templates["en"])


def decorate_caption(
    caption: str,
    *,
    current: Account,
    all_accounts: list[Account],
    product_url: str = "",
    rotation: int = 0,
    language: str = "en",
    cross_mention: bool = True,
) -> str:
    """
    Caption na chhede link ane cross-mention umere.

    Caption pote AI e lakhelu hoy che — aapne fakt chhede jodie chie,
    vachhe kai chhedchhad nathi karta.
    """
    parts = [caption.strip()]

    link_line = build_link_line(product_url, platform=current.platform, language=language)
    if link_line:
        parts.append(link_line)

    if cross_mention:
        mention_line = build_cross_mention_line(
            current, all_accounts, rotation=rotation, language=language
        )
        if mention_line:
            parts.append(mention_line)

    return "\n\n".join(p for p in parts if p)


def accounts_from_docs(docs: list[dict]) -> list[Account]:
    """DB na account documents ne aa module na Account ma badle."""
    out: list[Account] = []
    for doc in docs:
        handle = (
            doc.get("username")
            or doc.get("handle")
            or doc.get("display_name")
            or ""
        )
        out.append(
            Account(
                id=str(doc.get("_id") or doc.get("id") or ""),
                platform=str(doc.get("platform") or "instagram"),
                handle=str(handle),
                display_name=str(doc.get("display_name") or handle),
            )
        )
    return out
