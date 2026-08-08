"""
JSON Schema — AI no jawab barabar kaya shape ma aavvo joiye.

Alag file ma etle rakhya che ke aa j "contract" che. Aa badle to aakha
app ma su badlashe e ek j jagya e dekhay che.
"""

from __future__ import annotations

# ------------------------------------------------------------------ #
#  Product ni vigat (page nu HTML vanchvathi)
# ------------------------------------------------------------------ #

#: Scraper na regex fail thay tyare Gemini page vanchine aa bhare che.
#: Regex ne `<meta property="og:title">` jevu chokkas markup joiye che —
#: e na hoy (React store, alag theme, javascript thi bharatu page) to kai
#: nathi maltu. AI page ne MANUSHY ni jem vanche che, etle tya pan kaam kare.
PRODUCT_FROM_PAGE = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "The product's own name, as a shopper would say it. Do NOT include the store name, tagline or category. Empty string if this page is not a single product page."},
        "description": {"type": "string", "description": "Two or three sentences describing this product, taken from the page. Never invent details that are not on the page."},
        "price": {"type": "number", "description": "The current selling price as a plain number, no currency symbol and no thousands separator. Use the discounted/sale price if both are shown. Use 0 if no price is visible."},
        "currency": {"type": "string", "description": "ISO code of the price: INR, USD, EUR, GBP. Empty string if not visible."},
        "brand": {"type": "string", "description": "Brand or seller name. Empty string if not visible."},
        "images": {"type": "array", "items": {"type": "string"}, "description": "Image URLs of THIS PRODUCT ONLY, best first, max 8. Copy the URLs exactly as they appear. Skip logos, icons, payment badges, banners, and photos of other products."},
        "isProductPage": {"type": "boolean", "description": "True only if this is a page for ONE specific product. False for a category listing, a search page, the home page, a 404, or a login wall."},
        "notProductReason": {"type": "string", "description": "If isProductPage is false, one short sentence saying what this page actually is. Empty string otherwise."},
    },
    "required": ["title", "description", "price", "currency", "brand", "images", "isProductPage", "notProductReason"],
}


# ------------------------------------------------------------------ #
#  Product ni samajan (image jovathi)
# ------------------------------------------------------------------ #

PRODUCT_BRIEF = {
    "type": "object",
    "properties": {
        "productName": {"type": "string", "description": "Short sellable product name, 2-6 words."},
        "category": {"type": "string", "description": "Broad category e.g. Apparel, Footwear, Jewellery, Home Decor, Electronics, Beauty."},
        "subCategory": {"type": "string", "description": "Specific type e.g. Anarkali kurti, running shoes, hoop earrings."},
        "isApparel": {"type": "boolean", "description": "True if this is clothing/footwear/an accessory a person wears."},
        "apparelType": {"type": "string", "description": "If apparel: top, dress, saree, kurti, jeans, jacket, shoes, bag, watch. Else empty string."},

        "colors": {"type": "array", "items": {"type": "string"}, "description": "Dominant colours, plain words."},
        "materials": {"type": "array", "items": {"type": "string"}, "description": "Visible materials/fabrics. Only what you can actually see."},
        "patterns": {"type": "array", "items": {"type": "string"}, "description": "Prints or patterns: floral, solid, striped, embroidered."},
        "style": {"type": "string", "description": "Aesthetic in a few words, e.g. minimal streetwear, festive ethnic."},
        "occasions": {"type": "array", "items": {"type": "string"}, "description": "Where someone would use or wear it."},
        "seasons": {"type": "array", "items": {"type": "string"}},

        "targetGender": {"type": "string", "enum": ["women", "men", "unisex", "kids", "unknown"]},
        "targetAgeRange": {"type": "string", "description": "e.g. 18-28"},
        "targetAudience": {"type": "string", "description": "One sentence describing the ideal buyer."},

        "keyFeatures": {"type": "array", "items": {"type": "string"}, "description": "Concrete visible features. No invented specs."},
        "sellingPoints": {"type": "array", "items": {"type": "string"}, "description": "Why someone buys this, benefit-first."},
        "emotionalHooks": {"type": "array", "items": {"type": "string"}, "description": "Feelings or desires to open a reel with."},
        "objections": {"type": "array", "items": {"type": "string"}, "description": "Doubts a buyer may have, to answer in the caption."},

        "suggestedPriceBand": {"type": "string", "description": "Rough perceived price band with currency, clearly a guess."},
        "positioning": {"type": "string", "description": "budget / mid-market / premium / luxury, plus one line why."},

        "visualDescription": {"type": "string", "description": "Detailed factual description of the image: subject, framing, background, lighting, colours."},
        "sceneSuggestions": {"type": "array", "items": {"type": "string"}, "description": "5 short reel scene ideas that would sell this product."},

        "searchKeywords": {"type": "array", "items": {"type": "string"}, "description": "15 phrases real people type when searching to BUY this."},
        "seedHashtags": {"type": "array", "items": {"type": "string"}, "description": "20 relevant hashtags without the # symbol, mixing broad and niche."},

        "imageQuality": {
            "type": "object",
            "properties": {
                "score": {"type": "number", "description": "0-10 how usable this is as a marketing image."},
                "issues": {"type": "array", "items": {"type": "string"}, "description": "Problems: blurry, cluttered background, bad lighting, watermark."},
            },
            "required": ["score", "issues"],
        },

        "confidence": {"type": "number", "description": "0-1 how confident you are overall."},
        "language": {"type": "string", "description": "Best language for the audience: en, hi, gu, hinglish."},
    },
    "required": [
        "productName", "category", "subCategory", "isApparel", "apparelType",
        "colors", "materials", "patterns", "style", "occasions", "seasons",
        "targetGender", "targetAgeRange", "targetAudience",
        "keyFeatures", "sellingPoints", "emotionalHooks", "objections",
        "suggestedPriceBand", "positioning",
        "visualDescription", "sceneSuggestions",
        "searchKeywords", "seedHashtags", "imageQuality", "confidence", "language",
    ],
}


# ------------------------------------------------------------------ #
#  Hashtag ladder
# ------------------------------------------------------------------ #

HASHTAG_LADDER = {
    "type": "object",
    "properties": {
        "keywords": {"type": "array", "items": {"type": "string"}, "description": "12 buyer-intent search phrases to weave into the caption."},
        "risingTopics": {"type": "array", "items": {"type": "string"}, "description": "Up to 5 currently-trending angles from the supplied list that this product can HONESTLY ride. Empty if none fit."},
        "broad": {"type": "array", "items": {"type": "string"}, "description": "4 huge hashtags (10M+ posts). Reach, not ranking."},
        "medium": {"type": "array", "items": {"type": "string"}, "description": "10 mid-size hashtags (100k-2M posts). The sweet spot."},
        "niche": {"type": "array", "items": {"type": "string"}, "description": "12 small, very specific hashtags (under 100k posts). This is where a small account actually ranks."},
    },
    "required": ["keywords", "risingTopics", "broad", "medium", "niche"],
}


# ------------------------------------------------------------------ #
#  Caption
# ------------------------------------------------------------------ #

SOCIAL_COPY = {
    "type": "object",
    "properties": {
        "hook": {"type": "string", "description": "First line of the caption. 30-90 characters. Must contain the primary keyword and stop the scroll. Never start with 'Introducing' or 'Check out'."},
        "body": {"type": "string", "description": "Rest of the caption WITHOUT the hook and WITHOUT hashtags. 3-6 short lines separated by newlines. Weave in 2-4 keywords naturally. Answer one buyer objection."},
        "callToAction": {"type": "string", "description": "One line asking for a comment, save, share or DM. Specific and easy to answer."},
        "description": {"type": "string", "description": "Longer keyword-rich description, 60-120 words, for Facebook and the reel description. No hashtags."},
    },
    "required": ["hook", "body", "callToAction", "description"],
}


# ------------------------------------------------------------------ #
#  Reel script
# ------------------------------------------------------------------ #

REEL_PLAN = {
    "type": "object",
    "properties": {
        "concept": {"type": "string", "description": "One line describing the creative idea of this reel."},
        "coverText": {"type": "string", "description": "3-6 words for the reel cover. Readable at thumbnail size."},
        "captionSeed": {"type": "string", "description": "One line hook for the caption under the reel."},
        "musicMood": {"type": "string", "enum": ["upbeat", "chill", "cinematic", "luxury", "festive", "energetic", "romantic", "hiphop"]},
        "scenes": {
            "type": "array",
            "description": "The shot list, in order.",
            "items": {
                "type": "object",
                "properties": {
                    "purpose": {"type": "string", "enum": ["hook", "reveal", "detail", "benefit", "lifestyle", "proof", "offer", "cta"]},
                    "durationSeconds": {"type": "number", "description": "Between 2 and 6. The first scene must be 2 to 3.5."},
                    "onScreenText": {"type": "string", "description": "Text burned onto the video. MAX 8 words. Empty string for a clean shot."},
                    "voiceLine": {"type": "string", "description": "One spoken sentence for the voiceover, max 18 words. Empty for a silent beat."},
                    "imageStrategy": {"type": "string", "enum": ["uploaded", "generate", "tryon"], "description": "'uploaded' = the seller's real product photo (prefer this for the product itself). 'generate' = AI lifestyle/background shot. 'tryon' = the avatar wearing the product."},
                    "uploadedImageIndex": {"type": "number", "description": "Which uploaded photo, 0-based. Use -1 when strategy is not 'uploaded'."},
                    "imagePrompt": {"type": "string", "description": "For 'generate'/'tryon': detailed image prompt. Setting, lighting, camera angle, mood. Never describe text or logos."},
                    "motionStrategy": {"type": "string", "enum": ["still", "video"], "description": "'still' = the photo is animated with a slow camera move. 'video' = a real AI-generated moving clip. Video costs money and takes minutes, so mark AT MOST 2 scenes as 'video' — only where real movement genuinely sells the product (fabric flowing, the model walking or turning, the product being used). Everything else must be 'still'."},
                    "videoPrompt": {"type": "string", "description": "Only when motionStrategy is 'video': describe the MOVEMENT in one or two sentences — what moves, and how the camera moves. Do not re-describe the product, it is already fixed by the reference image. Empty string for 'still'."},
                    "motion": {"type": "string", "enum": ["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "none"]},
                    "transition": {"type": "string", "enum": ["fade", "slideleft", "slideright", "slideup", "wipeleft", "circleopen", "dissolve", "smoothleft", "none"]},
                },
                "required": ["purpose", "durationSeconds", "onScreenText", "voiceLine", "imageStrategy", "uploadedImageIndex", "imagePrompt", "motionStrategy", "videoPrompt", "motion", "transition"],
            },
        },
    },
    "required": ["concept", "coverText", "captionSeed", "musicMood", "scenes"],
}


# ------------------------------------------------------------------ #
#  Reference reel ni style
# ------------------------------------------------------------------ #

FRAME_READING = {
    "type": "object",
    "properties": {
        "descriptions": {"type": "array", "items": {"type": "string"}, "description": "One short line per frame, in order: shot type, what the subject does, whether text is on screen."},
        "mood": {"type": "string"},
        "colorGrade": {"type": "string", "description": "warm, cool, high contrast, film grain, bright and clean."},
        "hasOnScreenText": {"type": "boolean"},
        "cameraWork": {"type": "string", "description": "handheld, locked off, slow push in, quick whip pans."},
    },
    "required": ["descriptions", "mood", "colorGrade", "hasOnScreenText", "cameraWork"],
}

REFERENCE_STYLE = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "Two sentences on what this reel does and why it works."},
        "shotTypes": {"type": "array", "items": {"type": "string"}},
        "textStyle": {"type": "string", "description": "How on-screen text is used: placement, size, word count."},
        "hookStyle": {"type": "string", "description": "What the first 3 seconds do to stop the scroll."},
        "mood": {"type": "string"},
        "structure": {"type": "array", "items": {"type": "string"}, "description": "Beat-by-beat structure, one short line per beat."},
    },
    "required": ["summary", "shotTypes", "textStyle", "hookStyle", "mood", "structure"],
}


# ------------------------------------------------------------------ #
#  Avatar nu varnan
# ------------------------------------------------------------------ #

AVATAR_DESCRIPTION = {
    "type": "object",
    "properties": {
        "description": {"type": "string", "description": "Two sentences describing this person's appearance for an image model: face shape, hair, skin tone, build, general style. Neutral and factual."},
        "gender": {"type": "string", "enum": ["female", "male", "non-binary", "unspecified"]},
        "ageRange": {"type": "string", "description": "e.g. 24-30"},
        "skinTone": {"type": "string"},
        "hair": {"type": "string", "description": "Length, texture, colour."},
        "bodyType": {"type": "string"},
    },
    "required": ["description", "gender", "ageRange", "skinTone", "hair", "bodyType"],
}
