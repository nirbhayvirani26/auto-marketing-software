/**
 * Font shodhvano.
 *
 * ffmpeg na drawtext ne font FILE nu path joiye che — "Arial" jevu naam
 * nahi chale. Ane Gujarati/Hindi lakhvu hoy to e script ne support karto
 * font joiye, nahi to badha akshar khali chorasa (□□□) dekhay.
 *
 * Etle ahiya kram ma shodhie chie:
 *   1. .env nu FONT_PATH (tamari pasandgi)
 *   2. project no `assets/fonts` folder (npm run fonts thi bhare che)
 *   3. system na fonts — script pramane saacho font
 */

import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";

export type TextScript = "latin" | "devanagari" | "gujarati";

/** Language code par thi kai lipi joiye e nakki kare. */
export function scriptForLanguage(language: string): TextScript {
  const value = language.toLowerCase().trim();

  // Hinglish = Hindi na shabdo, pan LATIN akshar ma ("kaise ho").
  // Aane "hi" thi shodhie to Devanagari font aavi jaay ane akshar khota
  // dekhaay — etle aa check pehla joiye.
  if (value.startsWith("hinglish") || value.startsWith("gujlish")) return "latin";

  const code = value.slice(0, 2);
  if (code === "hi" || code === "mr" || code === "ne" || code === "sa") {
    return "devanagari";
  }
  if (code === "gu") return "gujarati";
  return "latin";
}

function projectFontDir(): string {
  return path.join(process.cwd(), "assets", "fonts");
}

/** Windows / Mac / Linux na standard font folders. */
function systemFontDirs(): string[] {
  const dirs: string[] = [];

  if (process.platform === "win32") {
    dirs.push(path.join(process.env.WINDIR || "C:\\Windows", "Fonts"));
    if (process.env.LOCALAPPDATA) {
      dirs.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"));
    }
  } else if (process.platform === "darwin") {
    dirs.push("/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts");
    if (process.env.HOME) dirs.push(path.join(process.env.HOME, "Library", "Fonts"));
  } else {
    dirs.push(
      "/usr/share/fonts",
      "/usr/share/fonts/truetype",
      "/usr/local/share/fonts",
    );
    if (process.env.HOME) dirs.push(path.join(process.env.HOME, ".fonts"));
  }

  return dirs.filter((dir) => existsSync(dir));
}

/**
 * Kaya file-naam kai script mate chale che.
 * Bold pehla — reel ma patlo font vanchay nahi.
 */
const CANDIDATES: Record<TextScript, string[]> = {
  latin: [
    // Aapne jate download karela (sauthi saara dekhaay)
    "Poppins-Bold.ttf", "Poppins-SemiBold.ttf", "Inter-Bold.ttf",
    "Montserrat-Bold.ttf", "Anton-Regular.ttf",
    // Windows
    "seguibl.ttf", "segoeuib.ttf", "arialbd.ttf", "impact.ttf",
    "calibrib.ttf", "verdanab.ttf", "segoeui.ttf", "arial.ttf",
    // Mac
    "Helvetica.ttc", "Arial Bold.ttf", "Arial.ttf", "SFNSDisplay.ttf",
    // Linux
    "DejaVuSans-Bold.ttf", "NotoSans-Bold.ttf", "LiberationSans-Bold.ttf",
    "DejaVuSans.ttf", "NotoSans-Regular.ttf",
  ],
  devanagari: [
    "NotoSansDevanagari-Bold.ttf", "NotoSansDevanagari-Regular.ttf",
    "Poppins-Bold.ttf", // Poppins ma Devanagari pan che
    // Windows — Nirmala UI Hindi/Gujarati banne kare che
    "NirmalaB.ttf", "Nirmala.ttf", "mangalb.ttf", "mangal.ttf",
    // Linux
    "Lohit-Devanagari.ttf", "gargi.ttf", "Sarai.ttf",
    // Mac
    "DevanagariMT.ttc", "Kohinoor.ttc",
  ],
  gujarati: [
    "NotoSansGujarati-Bold.ttf", "NotoSansGujarati-Regular.ttf",
    // Windows
    "NirmalaB.ttf", "Nirmala.ttf", "shruti.ttf", "shrutib.ttf",
    // Linux
    "Lohit-Gujarati.ttf", "Rekha.ttf", "aakar-medium.ttf",
    // Mac
    "GujaratiMT.ttc", "GujaratiSangamMN.ttc",
  ],
};

const cache = new Map<TextScript, string>();

function findIn(dir: string, filename: string): string | null {
  const direct = path.join(dir, filename);
  if (existsSync(direct)) return direct;

  // Linux ma fonts sub-folder ma hoy che — ek level andar joi laiye.
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(dir, entry.name, filename);
      if (existsSync(nested)) return nested;
    }
  } catch {
    /* dir vanchi na shakayu */
  }
  return null;
}

/**
 * Aapelі lipi mate chale evo font file path aape.
 * Kai j na made to Error — video banavya pachi text gum thai jaay ena karta
 * pehla j kahi devu saaru.
 */
export function resolveFont(script: TextScript = "latin"): string {
  const fromEnv = process.env.FONT_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const cached = cache.get(script);
  if (cached && existsSync(cached)) return cached;

  const dirs = [projectFontDir(), ...systemFontDirs()];

  // Pehla aa lipi na khaas fonts, pachi latin (chhelle kaink to made).
  const wanted = [...CANDIDATES[script], ...(script === "latin" ? [] : CANDIDATES.latin)];

  for (const filename of wanted) {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const found = findIn(dir, filename);
      if (found) {
        cache.set(script, found);
        return found;
      }
    }
  }

  // Kai naam na malyu — folder ma je pehli .ttf hoy e lai laiye.
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const any = readdirSync(dir).find((f) => /\.(ttf|otf)$/i.test(f));
      if (any) {
        const found = path.join(dir, any);
        cache.set(script, found);
        return found;
      }
    } catch {
      /* aagal vadho */
    }
  }

  throw new Error(
    `Reel ma text lakhva mate font madyo nahi (${script}). ` +
      `\`npm run fonts\` chalavo — e Google Fonts par thi free font ${projectFontDir()} ma mukse. ` +
      `Athva .env ma FONT_PATH=<koi .ttf nu path> set karo.`,
  );
}

/** Setup page mate. */
export function fontStatus() {
  return (["latin", "devanagari", "gujarati"] as const).map((script) => {
    try {
      return { script, ok: true, path: resolveFont(script) };
    } catch (error) {
      return { script, ok: false, error: (error as Error).message };
    }
  });
}
