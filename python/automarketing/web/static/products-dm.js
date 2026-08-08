/* ================================================================ *
 *  PRODUCT LINKS — image nahi, website ni link
 *
 *  `app.js` na j helpers ($, el, esc, api, banner, startPolling)
 *  vaparie chie — aa file eni PACHI load thay che.
 * ================================================================ */

const picked = new Set();

async function loadProducts() {
  const list = $("productList");
  if (!list) return;
  list.innerHTML = '<p class="muted">Lavie chie…</p>';

  try {
    const products = await api("/api/products");
    if (!products.length) {
      list.innerHTML =
        '<p class="muted">Hju koi product nathi. Dabi baju link paste karo.</p>';
      refreshPicked();
      return;
    }

    list.innerHTML = "";
    for (const p of products) {
      const row = el("div", "product-row");
      const thumb = p.image_urls[0]
        ? `<img src="${esc(p.image_urls[0])}" alt="">`
        : '<div class="noimg">?</div>';
      const warn =
        p.image_count === 0
          ? '<span class="warn-inline">image na madi — aa ni reel nahi bane</span>'
          : "";

      row.innerHTML = `
        <label class="check" style="margin:0">
          <input type="checkbox" data-id="${esc(p.id)}" ${picked.has(p.id) ? "checked" : ""}>
        </label>
        ${thumb}
        <div class="product-main">
          <b>${esc(p.title || "—")}</b>
          <span class="muted">${esc(p.price_text || "kimat nathi madi")} · ${p.image_count} image · ${esc(p.site_name || "")}</span>
          ${warn}
        </div>
        <button class="ghost small" data-del="${esc(p.id)}">✕</button>`;
      list.append(row);
    }

    list.querySelectorAll("input[data-id]").forEach((box) => {
      box.addEventListener("change", () => {
        if (box.checked) picked.add(box.dataset.id);
        else picked.delete(box.dataset.id);
        refreshPicked();
      });
    });

    list.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Aa product kaadhi naakhvu?")) return;
        await api(`/api/products/${btn.dataset.del}`, { method: "DELETE" });
        picked.delete(btn.dataset.del);
        loadProducts();
      });
    });

    refreshPicked();
  } catch (error) {
    list.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  }
}

function refreshPicked() {
  const card = $("reelFromProductCard");
  if (!card) return;
  card.style.display = picked.size ? "" : "none";

  const info = $("pickedInfo");
  if (info) {
    info.textContent =
      picked.size === 1
        ? "1 product — ek product ni reel banse."
        : `${picked.size} product — badha ni EK collection reel banse.`;
  }
}

$("addLinksBtn")?.addEventListener("click", async () => {
  const links = $("productLinks").value.trim();
  const out = $("linkResult");

  if (!links) {
    out.innerHTML = '<p class="error">Pehla link paste karo.</p>';
    return;
  }

  const button = $("addLinksBtn");
  button.disabled = true;
  button.textContent = "Vigat lavie chie… (thodi var lage che)";
  out.innerHTML = "";

  try {
    const result = await api("/api/products", { method: "POST", json: { links } });

    // "added" ane "existing" alag batavva j joiye. Fakt kul aankdo batavie
    // to user ne khabar j na pade ke link kharekhar navi hati ke pehle thi
    // hati — ane e j vakhate e fari fari add karva mande che.
    const added = result.added ?? result.products.length;
    const existing = result.existing ?? 0;

    const parts = [];
    if (added) parts.push(`${added} product add thaya ✓`);
    if (existing) parts.push(`${existing} pehle thi hata`);

    let html = `<p class="${added ? "ok" : "warn"}">${parts.join(" · ") || "Kai navu na madyu"}</p>`;

    // Server na message ma ghani var 2-3 line hoy che ("429 — 1 minute rah
    // joine try karo" jevu). Ene kaapi naakhie to kaam ni vaat j jati rahe.
    if (result.warning) html += `<p class="warn">${esc(result.warning).replace(/\n/g, "<br>")}</p>`;
    for (const f of result.failures || []) {
      html +=
        `<p class="error"><b>${esc(f.url.slice(0, 60))}</b><br>` +
        `${esc(f.error).replace(/\n/g, "<br>")}</p>`;
    }
    out.innerHTML = html;

    // Kaink fail thayu hoy to link box saaf NA karo — user ene sudhari ne
    // fari try kari shake. Badhu chalyu hoy to j saaf karo.
    if (!(result.failures || []).length) $("productLinks").value = "";
    loadProducts();
  } catch (error) {
    out.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Product add karo";
  }
});

$("pDuration")?.addEventListener("input", (event) => {
  $("pDurLabel").textContent = event.target.value;
});

$("productReelBtn")?.addEventListener("click", async () => {
  const button = $("productReelBtn");
  button.disabled = true;
  button.textContent = "Shuru karie chie…";

  try {
    const result = await api("/api/products/reel", {
      method: "POST",
      json: {
        product_ids: [...picked],
        target_duration: Number($("pDuration").value),
        language: $("pLanguage").value,
        voiceover: $("pVoiceover").checked,
      },
    });

    banner(
      `Reel banavvanu shuru thayu (${result.image_count} image) — progress niche dekhashe.`,
      "ok",
    );

    // Studio tab par lai jao — tya progress ane result dekhay che.
    document.querySelector('.tab[data-tab="studio"]').click();
    startPolling(result.job_id);
  } catch (error) {
    banner(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Aa product ni reel banavo";
  }
});

/* ================================================================ *
 *  AUTO DM
 * ================================================================ */

async function loadDmRules() {
  const list = $("dmRuleList");
  if (!list) return;
  list.innerHTML = '<p class="muted">Lavie chie…</p>';

  try {
    const { rules } = await api("/api/dm-rules");
    if (!rules.length) {
      list.innerHTML = '<p class="muted">Hju koi rule nathi.</p>';
      return;
    }

    list.innerHTML = "";
    for (const rule of rules) {
      const row = el("div", "rule-row");
      const words = rule.keywords?.length
        ? esc(rule.keywords.join(", "))
        : "BADHA comment par";
      const actions = [
        rule.reply_publicly ? "jaher jawab" : "",
        rule.send_dm ? "DM" : "",
      ]
        .filter(Boolean)
        .join(" + ");

      row.innerHTML = `
        <div>
          <b>${esc(rule.name)}</b> ${rule.enabled ? "" : '<span class="muted">(band)</span>'}
          <span class="muted">${words} · ${actions}</span>
        </div>
        <button class="ghost small" data-del="${esc(rule._id)}">✕</button>`;
      list.append(row);
    }

    list.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api(`/api/dm-rules/${btn.dataset.del}`, { method: "DELETE" });
        loadDmRules();
      });
    });
  } catch (error) {
    list.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  }
}

$("saveDmBtn")?.addEventListener("click", async () => {
  try {
    await api("/api/dm-rules", {
      method: "POST",
      json: {
        name: $("dmName").value.trim() || "Auto DM",
        keywords: $("dmKeywords")
          .value.split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        instruction: $("dmInstruction").value.trim(),
        reply_publicly: $("dmPublic").checked,
        send_dm: $("dmSend").checked,
        enabled: true,
      },
    });
    banner("Rule save thayu ✓", "ok");
    loadDmRules();
  } catch (error) {
    banner(error.message, "error");
  }
});

$("testDmBtn")?.addEventListener("click", async () => {
  const out = $("dmTestResult");
  const button = $("testDmBtn");
  button.disabled = true;
  out.innerHTML = '<p class="muted">AI jawab lakhe che…</p>';

  try {
    const result = await api("/api/dm-rules/test", {
      method: "POST",
      json: { comment: $("dmTest").value.trim() || "price?" },
    });

    if (!result.matched) {
      out.innerHTML = `<p class="warn">${esc(result.message)}</p>`;
      return;
    }

    const parts = [`<p class="ok">Rule besyo: <b>${esc(result.rule)}</b></p>`];
    if (result.public_reply) {
      parts.push(
        `<p class="muted">Jaher jawab:</p><div class="quote">${esc(result.public_reply)}</div>`,
      );
    }
    if (result.dm) {
      parts.push(`<p class="muted">DM:</p><div class="quote">${esc(result.dm)}</div>`);
    }
    parts.push(`<p class="hint">${esc(result.note)}</p>`);
    out.innerHTML = parts.join("");
  } catch (error) {
    out.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  } finally {
    button.disabled = false;
  }
});

/* ---------------- AI pack: image + video ek saathe ---------------- */

$("aiPackBtn")?.addEventListener("click", async () => {
  const button = $("aiPackBtn");
  const out = $("aiPackResult");

  button.disabled = true;
  button.textContent = "AI kaam kare che… (2-3 minute)";
  out.innerHTML = '<p class="muted">Background banave che ane product mukhe che…</p>';

  try {
    const result = await api("/api/products/ai-pack", {
      method: "POST",
      json: {
        product_ids: [...picked],
        image_count: Number($("aiImageCount").value),
        make_video: true,
        video_duration: Number($("pDuration").value),
        language: $("pLanguage").value,
        voiceover: $("pVoiceover").checked,
      },
    });

    const parts = [`<p class="ok">${result.image_count} image banya ✓</p>`];

    if (result.images.length) {
      parts.push('<div class="thumbs">');
      for (const image of result.images) {
        parts.push(
          `<a class="thumb" href="${esc(image.preview_url)}" download title="${esc(image.backdrop || "")}">` +
            `<img src="${esc(image.preview_url)}" alt=""></a>`,
        );
      }
      parts.push("</div>");
      parts.push('<p class="hint">Image par click karo = download</p>');
    }

    for (const w of result.warnings || []) {
      parts.push(`<p class="warn">${esc(w)}</p>`);
    }

    if (result.video_job_id) {
      parts.push('<p class="muted">Video banavvanu shuru thayu…</p>');
    }
    out.innerHTML = parts.join("");

    if (result.video_job_id) {
      banner("Images taiyar. Video banai rahyu che — progress niche.", "ok");
      document.querySelector('.tab[data-tab="studio"]').click();
      startPolling(result.video_job_id);
    }
  } catch (error) {
    out.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "AI thi image + video banavo";
  }
});
