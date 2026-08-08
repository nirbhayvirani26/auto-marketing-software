"""
Product LINK thi kaam — image upload karvani jarur nathi.

Tame website ni product link aapo:
  scraper.py — link mathi naam, kimat, varnan ane IMAGES kadhe
  store.py   — DB ma save kare ane images utaari ne media store ma mukhe

Pachi e images j reel pipeline ma jaay che — etle "image aapo" ane
"link aapo" banne rasta ek j jagya e bhega thai jaay che.
"""

from .scraper import ScrapedProduct, scrape_many, scrape_product
from .store import (
    add_links,
    delete_product,
    download_product_images,
    ensure_indexes,
    get_product,
    get_products,
    list_products,
    public_view,
    save_product,
)

__all__ = [
    "ScrapedProduct",
    "add_links",
    "delete_product",
    "download_product_images",
    "ensure_indexes",
    "get_product",
    "get_products",
    "list_products",
    "public_view",
    "save_product",
    "scrape_many",
    "scrape_product",
]
