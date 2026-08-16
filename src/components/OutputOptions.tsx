"use client";

import * as React from "react";
import {
  Box,
  Chip,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ImageIcon from "@mui/icons-material/ImageOutlined";
import MovieIcon from "@mui/icons-material/MovieOutlined";

/**
 * What this run should produce.
 *
 * Three modes rather than a pile of switches, because the choice people
 * actually make is "I need pictures" / "I need a reel" / "give me the lot".
 * Each mode shows only its own settings — asking how many images you want
 * while you are making a video is noise.
 */

export type OutputMode = "all" | "image" | "video";

export type OutputSettings = {
  mode: OutputMode;
  imageCount: number;
  imageQuality: "standard" | "high";
  imageAspect: "1:1" | "4:5" | "9:16";
  videoCount: number;
  videoSeconds: number;
  videoAspect: "9:16" | "1:1" | "16:9";
};

export const DEFAULT_OUTPUT: OutputSettings = {
  mode: "all",
  imageCount: 1,
  imageQuality: "high",
  imageAspect: "4:5",
  videoCount: 1,
  videoSeconds: 32,
  videoAspect: "9:16",
};

const MODES: Array<{ value: OutputMode; label: string; hint: string; Icon: typeof ImageIcon }> = [
  { value: "all", label: "Everything", hint: "An image and a reel", Icon: AutoAwesomeIcon },
  { value: "image", label: "Images only", hint: "Product shots, no video", Icon: ImageIcon },
  { value: "video", label: "Video only", hint: "A reel, no feed image", Icon: MovieIcon },
];

export default function OutputOptions({
  value,
  onChange,
}: {
  value: OutputSettings;
  onChange: (next: OutputSettings) => void;
}) {
  const set = <K extends keyof OutputSettings>(key: K, next: OutputSettings[K]) =>
    onChange({ ...value, [key]: next });

  // Veo renders roughly 8-second clips, so the reel length is really a choice
  // of how many clips — worth saying, since it drives both time and cost.
  const clips = Math.max(1, Math.ceil(value.videoSeconds / 8));

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
          What should it make?
        </Typography>

        <ToggleButtonGroup
          exclusive
          fullWidth
          value={value.mode}
          onChange={(_event, next: OutputMode | null) => next && set("mode", next)}
          sx={{ "& .MuiToggleButton-root": { py: 1.25, textTransform: "none" } }}
        >
          {MODES.map(({ value: mode, label, hint, Icon }) => (
            <ToggleButton key={mode} value={mode}>
              <Stack spacing={0.25} alignItems="center" sx={{ width: "100%" }}>
                <Icon fontSize="small" />
                <Typography variant="body2" fontWeight={600}>
                  {label}
                </Typography>
                <Typography variant="caption" color="text.secondary" textAlign="center">
                  {hint}
                </Typography>
              </Stack>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* ---- Images only ---- */}
      {value.mode === "image" && (
        <Box sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5 }}>
            Image settings
          </Typography>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              select
              size="small"
              label="How many"
              value={value.imageCount}
              onChange={(event) => set("imageCount", Number(event.target.value))}
              sx={{ minWidth: 150 }}
              helperText="Each one is staged differently"
            >
              {[1, 2, 3, 4, 5, 6].map((count) => (
                <MenuItem key={count} value={count}>
                  {count} image{count === 1 ? "" : "s"}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Quality"
              value={value.imageQuality}
              onChange={(event) =>
                set("imageQuality", event.target.value as "standard" | "high")
              }
              sx={{ minWidth: 150 }}
              helperText={value.imageQuality === "high" ? "Sharper, slower" : "Faster"}
            >
              <MenuItem value="high">High — magazine quality</MenuItem>
              <MenuItem value="standard">Standard — quicker</MenuItem>
            </TextField>

            <TextField
              select
              size="small"
              label="Shape"
              value={value.imageAspect}
              onChange={(event) =>
                set("imageAspect", event.target.value as OutputSettings["imageAspect"])
              }
              sx={{ minWidth: 170 }}
              helperText="Where it will be posted"
            >
              <MenuItem value="4:5">4:5 — Instagram feed</MenuItem>
              <MenuItem value="1:1">1:1 — square</MenuItem>
              <MenuItem value="9:16">9:16 — story</MenuItem>
            </TextField>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
            Your product stays exactly as it is in every shot — only the staging,
            lighting and camera change. Each image is saved as its own draft.
          </Typography>
        </Box>
      )}

      {/* ---- Video only ---- */}
      {value.mode === "video" && (
        <Box sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5 }}>
            Video settings
          </Typography>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              select
              size="small"
              label="Length"
              value={value.videoSeconds}
              onChange={(event) => set("videoSeconds", Number(event.target.value))}
              sx={{ minWidth: 190 }}
              helperText={`${clips} clip${clips === 1 ? "" : "s"} · about a minute each`}
            >
              <MenuItem value={16}>About 16 seconds</MenuItem>
              <MenuItem value={24}>About 24 seconds</MenuItem>
              <MenuItem value={32}>About 32 seconds</MenuItem>
              <MenuItem value={40}>About 40 seconds</MenuItem>
              <MenuItem value={48}>About 48 seconds</MenuItem>
            </TextField>

            <TextField
              select
              size="small"
              label="Shape"
              value={value.videoAspect}
              onChange={(event) =>
                set("videoAspect", event.target.value as OutputSettings["videoAspect"])
              }
              sx={{ minWidth: 190 }}
              helperText="Where it will be posted"
            >
              <MenuItem value="9:16">9:16 — Reels and Stories</MenuItem>
              <MenuItem value="1:1">1:1 — square feed</MenuItem>
              <MenuItem value="16:9">16:9 — wide</MenuItem>
            </TextField>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={`${clips} AI clips`} />
            <Chip size="small" variant="outlined" label="music added" />
            <Chip size="small" variant="outlined" label="1080 wide" />
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
            No feed image is saved in this mode. One still is made internally as
            the first frame, so the reel shows your real product.
          </Typography>
        </Box>
      )}

      {/* ---- Everything ---- */}
      {value.mode === "all" && (
        <Typography variant="caption" color="text.secondary">
          One feed image and one reel, at the usual sizes. Pick a single mode
          above if you want to choose counts, quality or shape.
        </Typography>
      )}
    </Stack>
  );
}
