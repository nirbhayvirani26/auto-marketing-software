import { handle, ok, requireAuth } from "@/lib/api";
import { providerStatus } from "@/lib/ai";
import { visionStatus } from "@/lib/ai/vision";
import { imageGenStatus } from "@/lib/media/image-gen";
import { hostStatus } from "@/lib/media/hosts";
import { musicStatus } from "@/lib/trends/audio";
import { voiceoverStatus } from "@/lib/video/voiceover";
import { aiVideoStatus } from "@/lib/video/ai-video";
import { videoEngineStatus } from "@/lib/video/ffmpeg";
import { fontStatus } from "@/lib/video/fonts";
import { breakerStatus } from "@/lib/pipeline/chain";
import { runnerStatus } from "@/lib/reels/runner";

export const dynamic = "force-dynamic";

type Group = {
  key: string;
  title: string;
  /** Aa vagar reel BILKUL nahi bane. */
  required: boolean;
  ready: boolean;
  /** Kem jaruri che / na hoy to su thashe. */
  why: string;
  providers: Array<{
    key: string;
    label: string;
    free: boolean;
    configured: boolean;
    note?: string;
  }>;
};

/**
 * "Badhu barabar che ke nahi" — ek j jagya e.
 *
 * Setup page aa vaapre che. Dareak jutth ma "aa vagar su nahi chale" pan
 * lakhelu che, jethi user ne khabar pade ke kai key pehla levi.
 */
export const GET = handle(async () => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const engine = videoEngineStatus();
  const fonts = fontStatus();

  const groups: Group[] = [
    {
      key: "text",
      title: "AI — lakhan (caption, script, hashtags)",
      required: true,
      ready: providerStatus().some((p) => p.configured),
      why: "Aa vagar caption ane reel no script nahi bane. Gemini ni free key sauthi saral che.",
      providers: providerStatus().map((p) => ({
        key: p.key,
        label: p.label,
        free: p.free,
        configured: p.configured,
        note: p.model,
      })),
    },
    {
      key: "vision",
      title: "AI — image samajvi",
      required: true,
      ready: visionStatus().some((p) => p.configured),
      why: "Aa vagar 'khali image aapo' valu kaam nahi thay — product ni vigat AI kadhi nahi shake.",
      providers: visionStatus(),
    },
    {
      key: "video",
      title: "Video engine (ffmpeg)",
      required: true,
      ready: engine.ready && fonts.some((f) => f.ok),
      why: "Reel render karva mate. Aa npm package sathe j aave che — kai install karvanu nathi.",
      providers: [
        {
          key: "ffmpeg",
          label: "ffmpeg",
          free: true,
          configured: engine.ready,
          note: engine.ready ? engine.ffmpeg : engine.error,
        },
        ...fonts.map((f) => ({
          key: `font-${f.script}`,
          label: `Font — ${f.script}`,
          free: true,
          configured: f.ok,
          note: f.ok ? f.path : "`npm run fonts` chalavo",
        })),
      ],
    },
    {
      key: "hosting",
      title: "Public media hosting",
      required: true,
      ready: hostStatus().some((h) => h.configured),
      why: "Meta na server tamari file DOWNLOAD kare che — etle public https URL joiye j. localhost kyarey nahi chale.",
      providers: hostStatus().map((h) => ({
        key: h.key,
        label: h.label,
        free: h.free,
        configured: h.configured,
        note: h.note,
      })),
    },
    {
      key: "image-gen",
      title: "AI image (avatar + kapda, lifestyle shots)",
      required: false,
      ready: imageGenStatus().some((p) => p.configured),
      why: "Na hoy to pan reel banse — fakt tamari potani upload kareli image thi.",
      providers: imageGenStatus(),
    },
    {
      key: "ai-video",
      title: "AI video clip (Gemini Omni)",
      required: false,
      ready: aiVideoStatus().some((p) => p.configured),
      why: "Marji nu. Na hoy to ffmpeg still image ne halavine reel banave che — e pan saru j dekhay che. Hoy to hook jeva 1-2 shot ma kharekhar halchal aave che.",
      providers: aiVideoStatus(),
    },
    {
      key: "music",
      title: "Reel nu music",
      required: false,
      ready: musicStatus().some((p) => p.configured),
      why: "Na hoy to reel chup banse. (Note: Instagram nu trending song API thi lagavi shakatu j nathi — app publish pachi suchav aape che.)",
      providers: musicStatus(),
    },
    {
      key: "voice",
      title: "Voiceover",
      required: false,
      ready: voiceoverStatus().some((p) => p.configured),
      why: "Marji nu. Awaj hoy to watch-time vadhare thay che.",
      providers: voiceoverStatus(),
    },
    {
      key: "meta",
      title: "Instagram / Facebook connect",
      required: true,
      ready: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
      why: "Auto-post karva mate. developers.facebook.com par app banavo.",
      providers: [
        {
          key: "meta-app",
          label: "Meta App (ID + Secret)",
          free: true,
          configured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
          note: "Add the Facebook Login and Instagram Graph API products",
        },
      ],
    },
  ];

  const blocking = groups.filter((g) => g.required && !g.ready);

  return ok({
    ready: blocking.length === 0,
    blocking: blocking.map((g) => ({ key: g.key, title: g.title, why: g.why })),
    groups,
    runner: runnerStatus(),
    /** Vaar vaar fail thata providers — atyare skip thai rahya che. */
    circuitBreakers: breakerStatus(),
  });
});
