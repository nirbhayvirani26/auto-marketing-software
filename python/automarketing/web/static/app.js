/* Auto Marketing — UI. Koi framework nathi, fakt saado JavaScript. */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );

/* ---------------- API ---------------- */

async function api(path, options = {}) {
  const { json, ...rest } = options;
  const response = await fetch(path, {
    ...rest,
    headers: json ? { "content-type": "application/json", ...(rest.headers || {}) } : rest.headers,
    body: json ? JSON.stringify(json) : rest.body,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* jawab JSON ma nathi */
  }

  if (!response.ok || !payload?.ok) {
    throw new Error(errorMessage(payload, response.status));
  }
  return payload.data;
}

/**
 * Server be alag aakar ma error aape che:
 *   aapno    → {ok: false, error: "samjay evu vakya"}
 *   FastAPI  → {detail: [{loc: [...], msg: "..."}]}   ← body kharab hoy tyare (422)
 *
 * Bijo aakar na sambhaliye to user ne fakt "Request fail thayu (422)" dekhay
 * che ane kai j khabar padti nathi ke su khotu che. Etle banne kadhie chie.
 */
function errorMessage(payload, status) {
  if (payload?.error) return payload.error;

  const detail = payload?.detail;
  if (typeof detail === "string") return detail;

  if (Array.isArray(detail) && detail.length) {
    const lines = detail.slice(0, 3).map((d) => {
      // loc = ["body", "product_ids", 0] — "body" kaadhi ne baki batavo.
      const where = (d.loc || []).slice(1).join(".") || "body";
      return `${where}: ${d.msg || "kharab value"}`;
    });
    return `Server e aa vigat na sweekari (${status}):\n${lines.join("\n")}`;
  }

  return `Request fail thayu (${status})`;
}

function banner(message, kind = "info") {
  const box = $("banner");
  box.innerHTML = "";
  if (!message) return;
  const node = el("div", `alert ${kind}`, esc(message));
  node.onclick = () => node.remove();
  box.appendChild(node);
  if (kind === "ok") setTimeout(() => node.remove(), 6000);
}

/* ---------------- tabs ---------------- */

/**
 * Tab badlo ane URL ma pan lakho (#products jevu).
 *
 * Hash ma lakhvathi tab bookmark thai shake che, refresh karo to e j
 * tab pacho khule che, ane link share pan kari shakay.
 */
function showTab(name) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (!tab) return;

  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  document.querySelectorAll(".page").forEach((p) =>
    p.classList.toggle("active", p.id === `page-${name}`),
  );

  if (location.hash.slice(1) !== name) {
    history.replaceState(null, "", `#${name}`);
  }

  TAB_LOADERS[name]?.();
}

$("tabs").addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (!tab) return;
  showTab(tab.dataset.tab);
});

window.addEventListener("hashchange", () => {
  const name = location.hash.slice(1);
  if (name) showTab(name);
});

/**
 * Tab khule tyare kayu function chalavvu.
 *
 * ⚠️ Badha arrow function ma lapetela che JAANI JOINE. `loadProducts` ane
 * `loadDmRules` BIJI file (products-dm.js) ma che je AA file pachi load
 * thay che — sidhu naam lakhie to ahiya j ReferenceError aave. Arrow
 * function ma naam tyare j jovay che jyare tab kharekhar khule che.
 */
const TAB_LOADERS = {
  reels: () => loadReels(),
  posts: () => loadPosts(),
  accounts: () => loadAccounts(),
  avatars: () => loadAvatars(),
  products: () => loadProducts(),
  autodm: () => loadDmRules(),
  setup: () => loadStatus(),
};

// Page khule tyare URL no hash jue — #products hoy to e tab kholo.
//
// ⚠️ `DOMContentLoaded` ni raah jovi J pade che. `loadProducts` ane
// `loadDmRules` BIJI file (products-dm.js) ma che je AA file PACHI load
// thay che. Ahiya turant chalavie to e functions hju hoy j nahi ane
// ReferenceError aave — tab khule pan KHALI dekhay.
document.addEventListener("DOMContentLoaded", () => {
  const name = location.hash.slice(1);
  if (name && document.querySelector(`.tab[data-tab="${name}"]`)) showTab(name);
});

/* ---------------- state ---------------- */

const state = {
  images: [],
  reference: null,
  job: null,
  accounts: [],
  avatars: [],
  poll: null,
  copyTab: "instagram",
};

/* ---------------- upload ---------------- */

async function uploadFiles(files, role) {
  if (!files?.length) return [];
  const body = new FormData();
  for (const file of files) body.append("files", file);
  body.append("role", role);

  const response = await fetch("/api/uploads", { method: "POST", body });
  const payload = await response.json();
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Upload fail");
  if (payload.data.errors?.length) banner(payload.data.errors.join("\n"), "warn");
  return payload.data.files;
}

const drop = $("drop");
drop.onclick = () => $("fileInput").click();
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add("over");
};
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = async (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  await addImages(e.dataTransfer.files);
};
$("fileInput").onchange = (e) => addImages(e.target.files);

async function addImages(files) {
  try {
    drop.innerHTML = '<div class="drop-inner"><span class="spinner"></span> Upload thai rahyu che…</div>';
    const uploaded = await uploadFiles(files, "product");
    state.images.push(...uploaded);
    state.images = state.images.slice(0, 20);
    renderThumbs();
  } catch (error) {
    banner(error.message, "error");
  } finally {
    drop.innerHTML =
      '<div class="drop-inner"><div class="big-icon">🖼</div><div>Image ahiya khenchi ne mukho, ke click karo</div></div>';
    $("fileInput").value = "";
  }
}

function renderThumbs() {
  const box = $("thumbs");
  box.innerHTML = "";
  state.images.forEach((image, index) => {
    const node = el("div", "thumb");
    node.innerHTML = `<img src="${image.preview_url}" alt=""><span class="n">${index + 1}</span>`;
    const remove = el("button", "x", "×");
    remove.onclick = () => {
      state.images.splice(index, 1);
      renderThumbs();
    };
    node.appendChild(remove);
    box.appendChild(node);
  });
  $("generateBtn").disabled = state.images.length === 0;
}

$("refInput").onchange = async (event) => {
  try {
    const [file] = await uploadFiles(event.target.files, "reference");
    state.reference = file || null;
    $("refName").textContent = file ? `Reference: ${file.filename}` : "";
  } catch (error) {
    banner(error.message, "error");
  }
};

$("duration").oninput = (e) => ($("durLabel").textContent = e.target.value);

/* ---------------- generate ---------------- */

$("generateBtn").onclick = async () => {
  if (!state.images.length) return banner("Pehla product ni image upload karo", "warn");

  $("generateBtn").disabled = true;
  $("generateBtn").innerHTML = '<span class="spinner"></span> Shuru karie chie…';
  banner("");

  try {
    const images = state.images.length;
    const avatarId = $("avatarSelect").value;

    const result = await api("/api/studio/generate", {
      method: "POST",
      json: {
        image_asset_ids: state.images.map((i) => i.id),
        // Ghana product hoy to "multi" j joiye — avatar to andar na
        // scenes ma tya pan vaparay che.
        mode: state.reference ? "reference" : images > 1 ? "multi" : avatarId ? "tryon" : "single",
        avatar_id: avatarId || null,
        reference_video_asset_id: state.reference?.id || null,
        target_duration: Number($("duration").value),
        language: $("language").value,
        hint: $("hint").value,
        price: $("price").value,
        product_url: $("productUrl").value,
        voiceover: $("voiceover").checked,
      },
    });

    banner(result.message, "ok");
    startPolling(result.job_id);
  } catch (error) {
    banner(error.message, "error");
    $("generateBtn").disabled = false;
    $("generateBtn").textContent = "Reel banavo";
  }
};

function startPolling(jobId) {
  clearInterval(state.poll);
  state.poll = setInterval(() => poll(jobId), 3000);
  poll(jobId);
}

async function poll(jobId) {
  try {
    const job = await api(`/api/studio/jobs/${jobId}`);
    state.job = job;
    renderJob(job);

    if (job.status === "done" || job.status === "failed") {
      clearInterval(state.poll);
      $("generateBtn").disabled = false;
      $("generateBtn").textContent = "Reel banavo";
      if (job.status === "done") {
        banner("Reel taiyar che 🎬", "ok");
        $("publishCard").classList.remove("hidden");
        loadAccounts();
      } else {
        banner(job.error || "Reel na banyu", "error");
      }
    }
  } catch (error) {
    /* ek poll chuki gayo to vandho nahi */
  }
}

const STEP_ICON = { done: "✓", failed: "✗", running: "…", skipped: "–", pending: "·" };

function renderJob(job) {
  const box = $("result");
  const running = job.status === "queued" || job.status === "running";

  let html = "";

  if (running) {
    html += `
      <div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
          <span class="spinner"></span>
          <b>${esc(job.current_step?.label || "Shuru thai rahyu che…")}</b>
          <span style="flex:1"></span>
          <span class="muted">${job.progress}%</span>
        </div>
        <div class="bar"><i style="width:${job.progress}%"></i></div>
        ${job.current_step?.note ? `<div class="muted small" style="margin-top:6px">${esc(job.current_step.note)}</div>` : ""}
      </div>`;
  }

  if (job.status === "failed") {
    html += `<div class="alert error"><b>Reel na banyu</b><br>${esc(job.error)}</div>`;
  }

  if (job.steps?.length) {
    html += '<div class="steps">';
    for (const step of job.steps) {
      html += `
        <div class="step ${step.status}">
          <span class="ic">${STEP_ICON[step.status] || "·"}</span>
          <span class="lb">${esc(step.label)}</span>
          <span class="nt">${esc(step.error || step.note || "")}</span>
          ${step.provider ? `<span class="chip">${esc(step.provider)}</span>` : ""}
          ${step.ms ? `<span class="muted small">${(step.ms / 1000).toFixed(1)}s</span>` : ""}
        </div>`;
    }
    html += "</div>";
  }

  if (job.warnings?.length) {
    html += `<div class="alert warn" style="margin-top:12px">${job.warnings.map(esc).join("<br>")}</div>`;
  }

  if (job.status === "done") {
    html += renderResult(job);
  }

  box.innerHTML = html;

  box.querySelectorAll(".subtab").forEach((tab) => {
    tab.onclick = () => {
      state.copyTab = tab.dataset.sub;
      renderJob(state.job);
    };
  });
}

function renderResult(job) {
  const ig = job.copy?.instagram;
  const fb = job.copy?.facebook;
  const copy = state.copyTab === "facebook" ? fb : ig;
  const audio = job.audio;

  const tiers = { broad: "Moti (reach)", medium: "Vachli (discovery)", niche: "Nani (ahiya RANK thashe)", branded: "Brand" };

  let tags = "";
  for (const [tier, label] of Object.entries(tiers)) {
    const list = (job.trends?.hashtags || []).filter((h) => h.tier === tier);
    if (!list.length) continue;
    tags += `<div style="margin-bottom:8px"><div class="muted small">${label} · ${list.length}</div>
      <div class="chips">${list.map((h) => `<span class="chip">#${esc(h.tag)}</span>`).join("")}</div></div>`;
  }

  const scoreClass = (s) => (s >= 85 ? "ok" : s >= 70 ? "warn" : "bad");

  return `
    <hr>
    <div class="result-grid">
      <div>
        <video class="reel" src="${job.preview_url}" poster="${job.thumbnail_url || ""}" controls playsinline></video>
        <div class="chips">
          <span class="chip">${(job.duration || 0).toFixed(1)}s</span>
          <span class="chip">${job.scenes?.length || 0} scene</span>
          <span class="chip">1080×1920</span>
        </div>
        <a class="primary block" style="text-align:center;text-decoration:none"
           href="/api/studio/jobs/${job.id}/download">⬇ BADHU DOWNLOAD KARO (ZIP)</a>
        <span class="hint" style="text-align:center;display:block;margin-bottom:10px">
          Video + images + caption + hashtags — badhu ek saathe
        </span>
        <a class="ghost block" style="text-align:center" href="${job.preview_url}" download>Fakt video download karo</a>
      </div>

      <div>
        <div class="subtabs">
          <button class="subtab ${state.copyTab === "instagram" ? "active" : ""}" data-sub="instagram">Instagram</button>
          <button class="subtab ${state.copyTab === "facebook" ? "active" : ""}" data-sub="facebook">Facebook</button>
          <button class="subtab ${state.copyTab === "tags" ? "active" : ""}" data-sub="tags">Hashtags</button>
        </div>

        ${
          state.copyTab === "tags"
            ? `<div class="alert info small">Nanu account #fashion jeva mota tag par kadi nahi dekhay. NANI tags par dekhay che — etle e vadhu rakhya che.</div>${tags}`
            : `
          <div class="chips">
            <span class="chip ${scoreClass(copy?.score?.score || 0)}">Ranking ${copy?.score?.score ?? "?"}/100 · ${esc(copy?.score?.grade || "")}</span>
            ${copy?.revisions ? `<span class="chip">${copy.revisions}× fari lakhyu</span>` : ""}
          </div>
          <pre class="caption">${esc(copy?.caption || "")}</pre>
          ${
            copy?.score?.top_fixes?.length
              ? `<div class="alert info small"><b>Vadhu sudharva mate:</b><br>${copy.score.top_fixes.map((f) => "• " + esc(f)).join("<br>")}</div>`
              : ""
          }
          ${
            state.copyTab === "instagram" && audio
              ? `<div class="alert warn small">
                   <b>🎵 Trending song joito hoy to</b><br>
                   Reel ma <b>${esc(audio.track || "music nathi")}</b> vagi rahyu che (copyright-free, auto-post thay che).<br><br>
                   ${esc(audio.instagram_hint?.how_to || "")}
                   <div class="chips" style="margin-top:8px">${(audio.instagram_hint?.search_terms || []).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
                 </div>`
              : ""
          }
          <div class="muted small"><b>Lambu description:</b><br>${esc(copy?.description || "")}</div>
        `
        }
      </div>
    </div>`;
}

/* ---------------- publish ---------------- */

$("publishBtn").onclick = async () => {
  if (!state.job) return;
  const picked = [...document.querySelectorAll("#accountPicker input:checked")].map((i) => i.value);
  if (!picked.length) return banner("Ochha ma ochho ek account pasand karo", "warn");

  $("publishBtn").disabled = true;
  $("publishBtn").innerHTML = '<span class="spinner"></span> Mokli rahya chie…';

  try {
    const result = await api(`/api/studio/jobs/${state.job.id}/publish`, {
      method: "POST",
      json: {
        account_ids: picked,
        when: $("when").value,
        hashtags_in_first_comment: $("firstComment").checked,
      },
    });

    const rows = result.created
      .map(
        (r) =>
          `• ${esc(r.account)} (${esc(r.platform)}) — ${esc(r.status)}` +
          (r.permalink ? ` <a href="${r.permalink}" target="_blank">jovo ↗</a>` : "") +
          (r.error ? ` — ${esc(r.error)}` : ""),
      )
      .join("<br>");

    const bad = result.created.some((r) => r.error);
    $("publishResult").innerHTML = `<div class="alert ${bad ? "warn" : "ok"}"><b>${result.created.length} post</b><br>${rows}</div>`;
    loadPosts();
  } catch (error) {
    $("publishResult").innerHTML = `<div class="alert error">${esc(error.message)}</div>`;
  } finally {
    $("publishBtn").disabled = false;
    $("publishBtn").textContent = "Publish karo";
  }
};

/* ---------------- accounts ---------------- */

async function loadAccounts() {
  try {
    state.accounts = await api("/api/accounts");
  } catch {
    state.accounts = [];
  }

  const icon = (p) => (p === "instagram" ? "📷" : "📘");

  $("accountList").innerHTML = state.accounts.length
    ? state.accounts
        .map(
          (a) => `<div class="list-item">
            <span>${icon(a.platform)}</span>
            <div style="flex:1"><b>${esc(a.display_name)}</b><br>
              <span class="muted small">${esc(a.platform)} · ${esc(a.status)}</span></div>
          </div>`,
        )
        .join("")
    : '<p class="muted">Ek pan account jodayelu nathi.</p>';

  $("accountPicker").innerHTML = state.accounts.length
    ? state.accounts
        .map(
          (a) =>
            `<label><input type="checkbox" value="${a.id}" checked> ${icon(a.platform)} ${esc(a.display_name)} <span class="muted small">${esc(a.platform)}</span></label>`,
        )
        .join("")
    : '<p class="muted small">Pehla Accounts tab ma javo ane Facebook jodo.</p>';

  try {
    const help = await api("/api/oauth/meta/help");
    $("metaHelp").innerHTML =
      help.steps.map((s, i) => `${i + 1}. ${esc(s)}`).join("<br>") +
      `<br><br><b>Redirect URI:</b> <code>${esc(help.redirect_uri)}</code>`;
  } catch {
    /* optional */
  }
}

/* ---------------- avatars ---------------- */

async function loadAvatars() {
  try {
    state.avatars = await api("/api/avatars");
  } catch {
    state.avatars = [];
  }

  const select = $("avatarSelect");
  select.innerHTML = '<option value="">Avatar vagar — fakt product</option>';
  for (const avatar of state.avatars) {
    select.innerHTML += `<option value="${avatar.id}" ${avatar.is_default ? "selected" : ""}>${esc(avatar.name)}${avatar.is_default ? " (default)" : ""}</option>`;
  }

  $("avatarList").innerHTML = state.avatars
    .map(
      (a) => `<div class="thumb" title="${esc(a.description || "")}">
        ${a.primary_photo_url ? `<img src="${a.primary_photo_url}" alt="">` : ""}
        <span class="n">${esc(a.name)}</span></div>`,
    )
    .join("");
}

$("avatarSaveBtn").onclick = async () => {
  const name = $("avatarName").value.trim();
  const files = $("avatarPhotos").files;
  if (!name || !files.length) return banner("Naam ane ochho ek photo joiye", "warn");

  $("avatarSaveBtn").disabled = true;
  try {
    const photos = await uploadFiles(files, "avatar");
    const result = await api("/api/avatars", {
      method: "POST",
      json: { name, photo_ids: photos.map((p) => p.id), auto_describe: true },
    });
    banner(
      result.describe_error
        ? `Avatar banyo, pan AI varnan na kadhi shakyu (${result.describe_error})`
        : "Avatar banyo — have reels ma aa chehro dekhashe",
      result.describe_error ? "warn" : "ok",
    );
    $("avatarName").value = "";
    $("avatarPhotos").value = "";
    loadAvatars();
  } catch (error) {
    banner(error.message, "error");
  } finally {
    $("avatarSaveBtn").disabled = false;
  }
};

/* ---------------- reels + posts ---------------- */

async function loadReels() {
  try {
    const data = await api("/api/studio/jobs");
    $("reelList").innerHTML = data.jobs.length
      ? data.jobs
          .map(
            (j) => `<div class="list-item">
              ${j.thumbnail_url ? `<img src="${j.thumbnail_url}" alt="">` : '<div style="width:54px"></div>'}
              <div style="flex:1">
                <b>${esc(j.product_name)}</b>
                <div class="muted small">${esc(j.status)} · ${j.scene_count} scene · ${(j.duration || 0).toFixed(1)}s · ${j.post_count} post</div>
                ${j.error ? `<div class="muted small" style="color:var(--bad)">${esc(j.error)}</div>` : ""}
              </div>
              ${j.preview_url ? `<a class="ghost" href="${j.preview_url}" target="_blank">jovo</a>` : ""}
            </div>`,
          )
          .join("")
      : '<p class="muted">Have sudhi koi reel nathi.</p>';
  } catch (error) {
    $("reelList").innerHTML = `<div class="alert error">${esc(error.message)}</div>`;
  }
}

async function loadPosts() {
  try {
    const posts = await api("/api/posts");
    $("postList").innerHTML = posts.length
      ? `<table><tr><th>Caption</th><th>Account</th><th>Status</th><th>Ranking</th><th></th></tr>` +
        posts
          .map(
            (p) => `<tr>
              <td>${esc(p.caption).slice(0, 90)}…</td>
              <td>${esc(p.account)}<br><span class="muted small">${esc(p.platform)} · ${esc(p.post_type)}</span></td>
              <td>${esc(p.status)}${p.error ? `<br><span class="muted small" style="color:var(--bad)">${esc(p.error)}</span>` : ""}</td>
              <td>${p.seo_score ?? "—"}</td>
              <td>${p.permalink ? `<a href="${p.permalink}" target="_blank">↗</a>` : ""}</td>
            </tr>`,
          )
          .join("") +
        "</table>"
      : '<p class="muted">Have sudhi koi post nathi.</p>';
  } catch (error) {
    $("postList").innerHTML = `<div class="alert error">${esc(error.message)}</div>`;
  }
}

/* ---------------- setup ---------------- */

async function loadStatus() {
  try {
    const status = await api("/api/system/status");

    let html = "";
    if (status.blocking.length) {
      html += `<div class="alert warn"><b>Aa vagar reel nahi bane</b><br>${status.blocking
        .map((b) => `• <b>${esc(b.title)}</b> — ${esc(b.why)}`)
        .join("<br>")}</div>`;
    } else {
      html += '<div class="alert ok">Badhu jaruri taiyar che ✓</div>';
    }

    if (status.no_ai_help) {
      html += `<div class="alert info small">${esc(status.no_ai_help)}</div>`;
    }

    for (const group of status.groups) {
      html += `<div style="margin:14px 0">
        <b>${group.ready ? "✓" : group.required ? "⚠" : "○"} ${esc(group.title)}</b>
        ${group.required ? "" : '<span class="chip">marji nu</span>'}
        <div class="muted small">${esc(group.why)}</div>
        <div class="chips">${group.providers
          .map(
            (p) =>
              `<span class="chip ${p.configured ? "ok" : ""}" title="${esc(p.note || "")}">${esc(p.label)}${p.free ? " · free" : ""}</span>`,
          )
          .join("")}</div>
      </div>`;
    }

    $("statusList").innerHTML = html;
  } catch (error) {
    $("statusList").innerHTML = `<div class="alert error">${esc(error.message)}</div>`;
  }
}

$("probeBtn").onclick = async () => {
  $("probeBtn").disabled = true;
  $("probeBtn").innerHTML = '<span class="spinner"></span> Test chali rahyu che…';
  $("probeResult").innerHTML = "";

  try {
    const probe = await api("/api/system/probe", { method: "POST" });

    let html = `<div class="alert ${probe.ready ? "ok" : "error"}"><b>${probe.passed} pass · ${probe.failed} fail</b><br>`;
    html += probe.ready
      ? "Badhu kaam kare che — Reel Studio ma javo ane image mukho."
      : probe.blocking
          .map(
            (b) =>
              `• <b>${esc(b.label)}</b> — ${esc(b.error)}${b.fix ? `<br><i>Upay: ${esc(b.fix)}</i>` : ""}`,
          )
          .join("<br>");
    html += "</div>";

    html += probe.results
      .map(
        (r) => `<div class="step">
          <span class="ic">${r.ok ? "✓" : r.required ? "✗" : "⚠"}</span>
          <span class="lb">${esc(r.label)}</span>
          <span class="nt">${esc(r.detail || r.error || "")}</span>
          <span class="muted small">${(r.ms / 1000).toFixed(1)}s</span>
        </div>`,
      )
      .join("");

    $("probeResult").innerHTML = html;
  } catch (error) {
    $("probeResult").innerHTML = `<div class="alert error">${esc(error.message)}</div>`;
  } finally {
    $("probeBtn").disabled = false;
    $("probeBtn").textContent = "Badhu kharekhar chale che? — test karo";
  }
};

/* ---------------- boot ---------------- */

(function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get("connected") === "ok") {
    banner(`${params.get("count")} account jodai gaya ✓`, "ok");
    history.replaceState({}, "", "/");
  } else if (params.get("connected") === "error") {
    banner(params.get("message") || "Account na jodai shakyu", "error");
    history.replaceState({}, "", "/");
  }

  loadAvatars();
  loadAccounts();
  renderThumbs();
})();
