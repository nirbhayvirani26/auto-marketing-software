/**
 * Voiceover — reel ma bolvano awaj.
 *
 * Aa marji nu che (VOICEOVER_ENABLED). Music valі reel pan sari chale che,
 * pan awaj hoy to watch-time vadhare che — log sambhale che etle atke che.
 *
 * Providers:
 *   gemini-tts  — free tier, 30 awaj, kudarti lage che
 *   pollinations— koi key nahi
 *   elevenlabs  — sauthi saaru, free tier 10,000 akshar/mahino
 */

import { runChain, apiFetch, FatalError, type ChainResult } from "@/lib/pipeline/chain";

export type Voiceover = {
  data: Buffer;
  mimeType: string;
  extension: string;
  provider: string;
  text: string;
};

/* ------------------------------------------------------------------ *
 *  WAV header — Gemini raw PCM aape che
 * ------------------------------------------------------------------ */

function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);           // fmt chunk size
  header.writeUInt16LE(1, 20);            // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34);           // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/* ------------------------------------------------------------------ *
 *  Gemini TTS
 * ------------------------------------------------------------------ */

const GEMINI_VOICES: Record<string, string> = {
  female: "Aoede",
  male: "Charon",
  warm: "Kore",
  bright: "Puck",
  calm: "Leda",
};

async function geminiTts(
  text: string,
  voice: string,
  signal: AbortSignal,
): Promise<Voiceover> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";

  const json = await apiFetch<{
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          inline_data?: { data?: string; mime_type?: string };
        }>;
      };
    }>;
  }>(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: GEMINI_VOICES[voice] ?? voice },
            },
          },
        },
      }),
    },
  );

  const part = json.candidates?.[0]?.content?.parts?.[0];
  const inline = part?.inlineData ?? part?.inline_data;
  const base64 = inline?.data;
  if (!base64) throw new Error("Gemini TTS e audio na aapyu");

  const mime = (inline as { mimeType?: string; mime_type?: string }).mimeType ??
    (inline as { mime_type?: string }).mime_type ?? "";

  // Gemini raw PCM aape che — WAV header lagavvu pade.
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  const raw = Buffer.from(base64, "base64");

  return {
    data: mime.includes("wav") ? raw : pcmToWav(raw, rate),
    mimeType: "audio/wav",
    extension: ".wav",
    provider: "gemini-tts",
    text,
  };
}

/* ------------------------------------------------------------------ *
 *  Pollinations — koi key nahi
 * ------------------------------------------------------------------ */

const POLLINATIONS_VOICES: Record<string, string> = {
  female: "nova",
  male: "onyx",
  warm: "shimmer",
  bright: "alloy",
  calm: "echo",
};

async function pollinationsTts(
  text: string,
  voice: string,
  signal: AbortSignal,
): Promise<Voiceover> {
  const params = new URLSearchParams({
    model: "openai-audio",
    voice: POLLINATIONS_VOICES[voice] ?? "nova",
  });

  const data = await apiFetch<Buffer>(
    `https://text.pollinations.ai/${encodeURIComponent(text.slice(0, 1500))}?${params}`,
    { expect: "buffer", signal },
  );

  if (data.length < 2000) throw new Error("Pollinations TTS e kharab jawab aapyo");

  return {
    data,
    mimeType: "audio/mpeg",
    extension: ".mp3",
    provider: "pollinations-tts",
    text,
  };
}

/* ------------------------------------------------------------------ *
 *  ElevenLabs
 * ------------------------------------------------------------------ */

async function elevenLabsTts(
  text: string,
  signal: AbortSignal,
): Promise<Voiceover> {
  const key = process.env.ELEVENLABS_API_KEY || "";
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel

  const data = await apiFetch<Buffer>(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      expect: "buffer",
      signal,
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3 },
      }),
    },
  );

  if (data.length < 2000) throw new FatalError("ElevenLabs e kharab jawab aapyo");

  return { data, mimeType: "audio/mpeg", extension: ".mp3", provider: "elevenlabs", text };
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

export function voiceoverEnabled(): boolean {
  return process.env.VOICEOVER_ENABLED !== "false";
}

export type VoiceoverOptions = {
  /** Badha scene na voiceLine ne ek saathe jodine aapo. */
  text: string;
  /** "female" | "male" | "warm" | "bright" | "calm" — ke provider nu potanu naam. */
  voice?: string;
  language?: string;
  prefer?: string;
};

export async function generateVoiceover(
  options: VoiceoverOptions,
): Promise<ChainResult<Voiceover>> {
  const text = options.text.trim();
  if (!text) throw new Error("There is no text to speak");

  const voice = options.voice || process.env.VOICEOVER_VOICE || "female";

  return runChain<Voiceover>(
    [
      {
        name: "gemini-tts",
        label: "Gemini TTS (free)",
        free: true,
        configured: () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        run: (signal) => geminiTts(text, voice, signal),
        timeoutMs: 120_000,
      },
      {
        name: "pollinations-tts",
        label: "Pollinations TTS (no key needed)",
        free: true,
        configured: () => process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
        run: (signal) => pollinationsTts(text, voice, signal),
        timeoutMs: 120_000,
      },
      {
        name: "elevenlabs",
        label: "ElevenLabs",
        free: false,
        configured: () => Boolean(process.env.ELEVENLABS_API_KEY),
        run: (signal) => elevenLabsTts(text, signal),
        timeoutMs: 120_000,
      },
    ],
    {
      label: "Voiceover",
      prefer: options.prefer ?? process.env.TTS_PROVIDER,
      retries: 1,
      backoffMs: 1500,
    },
  );
}

/** Setup page mate. */
export function voiceoverStatus() {
  return [
    {
      key: "gemini-tts",
      label: "Gemini TTS",
      free: true,
      configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      note: "Free tier, natural sounding. Speaks Hindi and Gujarati too.",
    },
    {
      key: "pollinations-tts",
      label: "Pollinations TTS",
      free: true,
      configured: process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
      note: "No key needed.",
    },
    {
      key: "elevenlabs",
      label: "ElevenLabs",
      free: false,
      configured: Boolean(process.env.ELEVENLABS_API_KEY),
      note: "Sauthi saaro awaj. Free tier 10,000 akshar/mahino.",
    },
  ];
}
