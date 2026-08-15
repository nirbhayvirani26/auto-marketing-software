"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/ErrorOutline";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import DownloadIcon from "@mui/icons-material/DownloadOutlined";

import { apiFetch } from "@/lib/client";

/* ------------------------------------------------------------------ *
 *  Types — mirrors GET /api/create/job/[id]
 * ------------------------------------------------------------------ */

type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type ContentStep = {
  key: string;
  label: string;
  detail?: string;
  status: StepStatus;
  provider?: string;
  ms?: number;
  note?: string;
  error?: string;
  output?: Record<string, unknown>;
};

export type ContentJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  currentStep: { key: string; label: string; note?: string } | null;
  steps: ContentStep[];
  error?: string;
  warnings: string[];
  postImageUrl: string | null;
  reelUrl: string | null;
  reelPreviewUrl: string | null;
  reelThumbnailUrl: string | null;
  reelDuration?: number;
  postIds: string[];
  ms?: number;
};

/* ------------------------------------------------------------------ *
 *  Small pieces
 * ------------------------------------------------------------------ */

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircleIcon color="success" fontSize="small" />;
  if (status === "failed") return <ErrorIcon color="error" fontSize="small" />;
  if (status === "skipped") return <RemoveCircleIcon color="disabled" fontSize="small" />;
  if (status === "running") return <CircularProgress size={17} />;
  return <RadioButtonUncheckedIcon sx={{ color: "text.disabled" }} fontSize="small" />;
}

function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Tooltip title={copied ? "Copied" : title}>
      <IconButton
        size="small"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function TagList({ tags, limit = 40 }: { tags: string[]; limit?: number }) {
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {tags.slice(0, limit).map((tag) => (
        <Chip key={tag} size="small" variant="outlined" label={tag} />
      ))}
    </Stack>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

/* ------------------------------------------------------------------ *
 *  What each step produced
 * ------------------------------------------------------------------ */

function StepOutput({ step }: { step: ContentStep }) {
  // Each step stores a different shape, so it arrives untyped and is narrowed
  // per case below.
  const output = step.output as Record<string, any> | undefined;
  if (!output) return null;

  switch (step.key) {
    case "understand":
      return (
        <Stack spacing={1.5}>
          <Field label="Product">
            <Typography variant="body2">{String(output.productName ?? "")}</Typography>
          </Field>
          {Array.isArray(output.colors) && output.colors.length > 0 && (
            <Field label="Colours">
              <TagList tags={output.colors} />
            </Field>
          )}
          {Array.isArray(output.materials) && output.materials.length > 0 && (
            <Field label="Materials">
              <TagList tags={output.materials} />
            </Field>
          )}
          {output.audience && (
            <Field label="Who buys it">
              <Typography variant="body2">{String(output.audience)}</Typography>
            </Field>
          )}
          {Array.isArray(output.sellingPoints) && output.sellingPoints.length > 0 && (
            <Field label="Why people buy it">
              <Stack component="ul" sx={{ pl: 2, m: 0 }}>
                {output.sellingPoints.map((point: string) => (
                  <Typography component="li" variant="body2" key={point}>
                    {point}
                  </Typography>
                ))}
              </Stack>
            </Field>
          )}
        </Stack>
      );

    case "trends":
      return (
        <Stack spacing={1.5}>
          {Array.isArray(output.keywords) && (
            <Field label="What people are searching for">
              <TagList tags={output.keywords} />
            </Field>
          )}
          {Array.isArray(output.hashtags) && (
            <Field label={`Hashtag ladder (${output.hashtags.length})`}>
              <TagList tags={output.hashtags.map((tag: string) => `#${tag}`)} />
              <Box sx={{ mt: 1 }}>
                <CopyButton
                  text={output.hashtags.map((tag: string) => `#${tag}`).join(" ")}
                  title="Copy all hashtags"
                />
              </Box>
            </Field>
          )}
          {Array.isArray(output.rising) && output.rising.length > 0 && (
            <Field label="Trending today">
              <TagList tags={output.rising} />
            </Field>
          )}
        </Stack>
      );

    case "script":
      return (
        <Stack spacing={1.5}>
          <Field label="The idea">
            <Typography variant="body2">{String(output.concept ?? "")}</Typography>
          </Field>
          <Field label="Image prompt — what Nano Banana was told to render">
            <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: 12 }}>
              {String(output.imagePrompt ?? "")}
            </Typography>
          </Field>
          {output.storyText && (
            <Field label="Story version">
              <Typography variant="body2">{String(output.storyText)}</Typography>
            </Field>
          )}
          {Array.isArray(output.beats) && (
            <Field label={`Shot list — one prompt per clip (${output.beats.length})`}>
              <Stack spacing={1}>
                {output.beats.map(
                  (beat: { index: number; purpose: string; prompt: string; onScreenText: string }) => (
                    <Box
                      key={beat.index}
                      sx={{ p: 1.25, bgcolor: "action.hover", borderRadius: 1.5 }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                        <Chip size="small" label={`${beat.index + 1}`} />
                        <Chip size="small" variant="outlined" label={beat.purpose} />
                        {beat.onScreenText && (
                          <Typography variant="caption" color="text.secondary">
                            text: “{beat.onScreenText}”
                          </Typography>
                        )}
                      </Stack>
                      <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: 12 }}>
                        {beat.prompt}
                      </Typography>
                    </Box>
                  ),
                )}
              </Stack>
            </Field>
          )}
        </Stack>
      );

    case "image":
      return output.url ? (
        <Stack spacing={1}>
          <Box
            component="img"
            src={String(output.url)}
            alt="Generated post image"
            sx={{ maxWidth: 300, width: "100%", borderRadius: 2, display: "block" }}
          />
        </Stack>
      ) : null;

    case "copy":
      return (
        <Stack spacing={2}>
          {Object.entries(output).map(([platform, value]) => {
            const copy = value as {
              caption: string;
              description: string;
              hashtags: string[];
              firstComment: string;
              score: number;
              grade: string;
              suggestions: string[];
            };
            return (
              <Box key={platform}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <Chip size="small" label={platform} />
                  <Chip
                    size="small"
                    color={copy.score >= 85 ? "success" : copy.score >= 70 ? "warning" : "default"}
                    label={`ranking ${copy.score}/100 · ${copy.grade}`}
                  />
                  <CopyButton
                    text={`${copy.caption}\n\n${copy.hashtags.map((t) => `#${t}`).join(" ")}`}
                    title="Copy caption and hashtags"
                  />
                </Stack>

                <Typography
                  variant="body2"
                  sx={{ whiteSpace: "pre-line", p: 1.5, bgcolor: "action.hover", borderRadius: 1.5 }}
                >
                  {copy.caption}
                </Typography>

                {copy.description && (
                  <Box sx={{ mt: 1 }}>
                    <Field label="Description (for search)">
                      <Typography variant="body2">{copy.description}</Typography>
                    </Field>
                  </Box>
                )}

                {copy.hashtags?.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Field label={`Hashtags (${copy.hashtags.length})`}>
                      <TagList tags={copy.hashtags.map((t) => `#${t}`)} />
                    </Field>
                  </Box>
                )}

                {copy.suggestions?.length > 0 && (
                  <Alert severity="info" sx={{ mt: 1, py: 0.25 }}>
                    <Typography variant="caption">
                      To score higher: {copy.suggestions.join(" · ")}
                    </Typography>
                  </Alert>
                )}
              </Box>
            );
          })}
        </Stack>
      );

    case "video":
      return Array.isArray(output.clips) ? (
        <Stack spacing={1}>
          {output.clips.map((clip: { index: number; purpose: string; prompt: string }) => (
            <Box key={clip.index} sx={{ p: 1.25, bgcolor: "action.hover", borderRadius: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
                <Chip size="small" label={`clip ${clip.index + 1}`} />
                <Chip size="small" variant="outlined" label={clip.purpose} />
              </Stack>
              <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: 12 }}>
                {clip.prompt}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : null;

    case "assemble":
      return (
        <Stack spacing={1}>
          {output.music != null && (
            <Field label="Music">
              <Typography variant="body2">{String(output.music)}</Typography>
            </Field>
          )}
          {output.instagramAudio != null && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              <Typography variant="caption">
                {String(
                  (output.instagramAudio as { howTo?: string }).howTo ??
                    "After publishing you can swap in a trending sound inside Instagram.",
                )}
              </Typography>
            </Alert>
          )}
        </Stack>
      );

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 *  One step row
 * ------------------------------------------------------------------ */

function StepRow({ step }: { step: ContentStep }) {
  const [open, setOpen] = React.useState(false);
  const hasOutput = Boolean(step.output);

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="flex-start"
        sx={{
          py: 1.25,
          px: 1,
          cursor: hasOutput ? "pointer" : "default",
          "&:hover": hasOutput ? { bgcolor: "action.hover" } : {},
          borderRadius: 1,
        }}
        onClick={() => hasOutput && setOpen((value) => !value)}
      >
        <Box sx={{ pt: 0.25 }}>
          <StatusIcon status={step.status} />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography
              variant="body2"
              fontWeight={step.status === "running" ? 700 : 500}
              color={step.status === "pending" ? "text.disabled" : "text.primary"}
            >
              {step.label}
            </Typography>
            {step.provider && (
              <Chip size="small" variant="outlined" label={step.provider} sx={{ height: 20 }} />
            )}
            {step.ms != null && step.ms > 0 && (
              <Typography variant="caption" color="text.secondary">
                {(step.ms / 1000).toFixed(1)}s
              </Typography>
            )}
          </Stack>

          {step.detail && step.status === "pending" && (
            <Typography variant="caption" color="text.disabled" display="block">
              {step.detail}
            </Typography>
          )}
          {step.note && (
            <Typography variant="caption" color="text.secondary" display="block">
              {step.note}
            </Typography>
          )}
          {step.error && (
            <Typography variant="caption" color="error" display="block">
              {step.error}
            </Typography>
          )}
        </Box>

        {hasOutput && (
          <ExpandMoreIcon
            fontSize="small"
            sx={{
              color: "text.secondary",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform .2s",
            }}
          />
        )}
      </Stack>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 5, pr: 2, pb: 2 }}>
          <StepOutput step={step} />
        </Box>
      </Collapse>
    </Box>
  );
}

/* ------------------------------------------------------------------ *
 *  The panel
 * ------------------------------------------------------------------ */

export default function ContentJobPanel({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone?: (job: ContentJob) => void;
}) {
  const [job, setJob] = React.useState<ContentJob | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const notified = React.useRef(false);

  React.useEffect(() => {
    let alive = true;
    notified.current = false;

    async function poll() {
      try {
        const next = await apiFetch<ContentJob>(`/api/create/job/${jobId}`);
        if (!alive) return;
        setJob(next);

        if (next.status === "done" || next.status === "failed") {
          if (!notified.current) {
            notified.current = true;
            onDone?.(next);
          }
          return;
        }
      } catch (problem) {
        // A missed poll is harmless; the next one picks it up.
        if (alive) setError((problem as Error).message);
      }
      if (alive) setTimeout(poll, 3000);
    }

    poll();
    return () => {
      alive = false;
    };
  }, [jobId, onDone]);

  if (error && !job) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!job) {
    return (
      <Card>
        <CardContent sx={{ display: "grid", placeItems: "center", py: 5 }}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Starting…
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const finished = job.status === "done" || job.status === "failed";

  return (
    <Card>
      <CardContent>
        {/* ---- Header ---- */}
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">
              {job.status === "done"
                ? "Your post is ready"
                : job.status === "failed"
                  ? "The run could not finish"
                  : (job.currentStep?.label ?? "Working…")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {job.status === "done"
                ? `Finished in ${((job.ms ?? 0) / 1000).toFixed(0)}s · ${job.postIds.length} drafts saved`
                : job.status === "failed"
                  ? (job.error ?? "")
                  : (job.currentStep?.note ??
                    "This takes a few minutes — the video is the slow part.")}
            </Typography>
          </Box>
          <Typography variant="h6" color="text.secondary">
            {job.progress}%
          </Typography>
        </Stack>

        <LinearProgress
          variant="determinate"
          value={job.progress}
          color={job.status === "failed" ? "error" : "primary"}
          sx={{ height: 8, borderRadius: 4, mb: 2 }}
        />

        {/* ---- Steps ---- */}
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2 }}>
          {job.steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          Click any finished step to see exactly what the AI produced.
        </Typography>

        {/* ---- Warnings ---- */}
        {job.warnings.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            <AlertTitle>Worth knowing</AlertTitle>
            <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.5}>
              {job.warnings.map((warning) => (
                <Typography component="li" variant="body2" key={warning}>
                  {warning}
                </Typography>
              ))}
            </Stack>
          </Alert>
        )}

        {/* ---- Results ---- */}
        {finished && (job.postImageUrl || job.reelUrl) && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              What you got
            </Typography>

            <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
              {job.postImageUrl && (
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Feed image
                  </Typography>
                  <Box
                    component="img"
                    src={job.postImageUrl}
                    alt="Post"
                    sx={{ width: "100%", borderRadius: 2, display: "block" }}
                  />
                  <Button
                    size="small"
                    startIcon={<DownloadIcon />}
                    component="a"
                    href={job.postImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    sx={{ mt: 1 }}
                  >
                    Open image
                  </Button>
                </Box>
              )}

              {job.reelPreviewUrl && (
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Reel{job.reelDuration ? ` · ${job.reelDuration.toFixed(0)}s` : ""}
                  </Typography>
                  <Box
                    component="video"
                    src={job.reelPreviewUrl}
                    poster={job.reelThumbnailUrl ?? undefined}
                    controls
                    playsInline
                    sx={{ width: "100%", borderRadius: 2, display: "block", bgcolor: "#000" }}
                  />
                  <Button
                    size="small"
                    startIcon={<DownloadIcon />}
                    component="a"
                    href={job.reelPreviewUrl}
                    download
                    sx={{ mt: 1 }}
                  >
                    Download reel
                  </Button>
                </Box>
              )}
            </Stack>

            <Button
              component={Link}
              href="/admin/posts"
              variant="contained"
              sx={{ mt: 3 }}
            >
              Open in Posts
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
