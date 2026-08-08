"use client";

import * as React from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddPhotoIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import MovieIcon from "@mui/icons-material/MovieCreationOutlined";
import SendIcon from "@mui/icons-material/SendOutlined";
import CheckIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorIcon from "@mui/icons-material/ErrorOutline";
import MusicIcon from "@mui/icons-material/MusicNoteOutlined";
import CopyIcon from "@mui/icons-material/ContentCopyOutlined";
import FacebookIcon from "@mui/icons-material/Facebook";
import InstagramIcon from "@mui/icons-material/Instagram";
import VideoFileIcon from "@mui/icons-material/VideoFileOutlined";

import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";

/* ------------------------------------------------------------------ *
 *  Types
 * ------------------------------------------------------------------ */

type UploadedFile = {
  id: string;
  filename: string;
  kind: string;
  previewUrl: string;
  width?: number;
  height?: number;
};

type Account = { _id: string; displayName: string; platform: string };
type AvatarRow = { _id: string; name: string; isDefault?: boolean; primaryPhotoUrl?: string | null };

type Step = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  provider?: string;
  ms?: number;
  note?: string;
  error?: string;
};

type Copy = {
  hook: string;
  caption: string;
  hashtags: string[];
  callToAction: string;
  description: string;
  firstComment: string;
  score: { score: number; grade: string; topFixes: string[] };
};

type Job = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  progress: number;
  currentStep: { key: string; label: string; note?: string } | null;
  steps: Step[];
  error?: string;
  duration?: number;
  videoUrl?: string | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  scenes: Array<{
    index: number;
    purpose: string;
    duration: number;
    onScreenText?: string;
    voiceLine?: string;
    imageSource?: string;
  }>;
  analysis: {
    productName?: string;
    category?: string;
    subCategory?: string;
    colors?: string[];
    materials?: string[];
    targetAudience?: string;
    sellingPoints?: string[];
    imageQuality?: { score: number; issues: string[] };
  } | null;
  trends: { keywords: string[]; hashtags: Array<{ tag: string; tier: string }>; risingTopics: string[] } | null;
  copy: { instagram: Copy; facebook: Copy } | null;
  audio: {
    track: string | null;
    mood: string;
    instagramHint: { searchTerms: string[]; howTo: string };
  } | null;
};

type PublishResult = {
  created: Array<{
    postId: string;
    account: string;
    platform: string;
    status: string;
    scheduledAt?: string;
    permalink?: string;
    error?: string;
  }>;
  skipped: Array<{ account: string; reason: string }>;
};

/* ------------------------------------------------------------------ *
 *  Page
 * ------------------------------------------------------------------ */

export default function StudioPage() {
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [images, setImages] = React.useState<UploadedFile[]>([]);
  const [reference, setReference] = React.useState<UploadedFile | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [avatars, setAvatars] = React.useState<AvatarRow[]>([]);

  const [form, setForm] = React.useState({
    avatarId: "",
    targetDuration: 40,
    language: "en",
    tone: "",
    hint: "",
    price: "",
    productUrl: "",
    voiceover: false,
  });

  const [job, setJob] = React.useState<Job | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [tab, setTab] = React.useState(0);

  const [publishForm, setPublishForm] = React.useState({
    accountIds: [] as string[],
    when: "now" as "now" | "auto" | "draft",
    hashtagsInFirstComment: true,
  });
  const [publishing, setPublishing] = React.useState(false);
  const [publishResult, setPublishResult] = React.useState<PublishResult | null>(null);

  const fileInput = React.useRef<HTMLInputElement>(null);
  const referenceInput = React.useRef<HTMLInputElement>(null);

  /* ---- Load ---- */
  React.useEffect(() => {
    Promise.all([
      apiFetch<Account[]>("/api/accounts").catch(() => []),
      apiFetch<AvatarRow[]>("/api/avatars").catch(() => []),
    ]).then(([acc, avs]) => {
      setAccounts(acc);
      setAvatars(avs);
      setPublishForm((f) => ({ ...f, accountIds: acc.map((a) => a._id) }));
      const defaultAvatar = avs.find((a) => a.isDefault) ?? avs[0];
      if (defaultAvatar) setForm((f) => ({ ...f, avatarId: defaultAvatar._id }));
    });
  }, []);

  /* ---- Job polling ---- */
  React.useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;

    const timer = setInterval(async () => {
      try {
        const next = await apiFetch<Job>(`/api/studio/jobs/${job.id}`);
        setJob(next);
        if (next.status === "done") {
          setNotice("Reel taiyar che 🎬");
        } else if (next.status === "failed") {
          setError(next.error ?? "Reel banavtaa bhool thai");
        }
      } catch {
        // Ek poll chuki jaay to vandho nahi — pachi ni try ma male jashe.
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [job]);

  /* ---- Upload ---- */
  async function upload(files: FileList | null, role: "product" | "reference") {
    if (!files?.length) return;
    setUploading(true);
    setError(null);

    try {
      const body = new FormData();
      for (const file of Array.from(files)) body.append("files", file);
      body.append("role", role);

      const res = await fetch("/api/uploads", { method: "POST", body });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) throw new Error(payload?.error ?? "Upload fail");

      const uploaded = payload.data.files as UploadedFile[];
      if (role === "reference") setReference(uploaded[0] ?? null);
      else setImages((prev) => [...prev, ...uploaded].slice(0, 20));

      if (payload.data.errors?.length) {
        setError(payload.data.errors.join("\n"));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      if (referenceInput.current) referenceInput.current.value = "";
    }
  }

  /* ---- Generate ---- */
  async function generate() {
    if (images.length === 0) {
      setError("Pehla product ni image upload karo");
      return;
    }
    setStarting(true);
    setError(null);
    setPublishResult(null);
    setJob(null);

    try {
      const res = await apiFetch<{ jobId: string; queued: boolean; message: string }>(
        "/api/studio/generate",
        {
          method: "POST",
          json: {
            imageAssetIds: images.map((i) => i.id),
            // Ghana product hoy to "multi" j joiye — avatar to andar na
            // scenes ma tya pan vaparay che.
            mode: reference
              ? "reference"
              : images.length > 1
                ? "multi"
                : form.avatarId
                  ? "tryon"
                  : "single",
            avatarId: form.avatarId || undefined,
            referenceVideoAssetId: reference?.id,
            targetDuration: form.targetDuration,
            language: form.language,
            tone: form.tone || undefined,
            hint: form.hint || undefined,
            price: form.price || undefined,
            productUrl: form.productUrl || undefined,
            voiceover: form.voiceover,
          },
        },
      );

      setNotice(res.message);
      setJob({
        id: res.jobId,
        status: "queued",
        progress: 0,
        currentStep: null,
        steps: [],
        scenes: [],
        analysis: null,
        trends: null,
        copy: null,
        audio: null,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  /* ---- Publish ---- */
  async function publish() {
    if (!job || job.status !== "done") return;
    setPublishing(true);
    setError(null);

    try {
      const res = await apiFetch<PublishResult>(
        `/api/studio/jobs/${job.id}/publish`,
        { method: "POST", json: publishForm },
      );
      setPublishResult(res);
      setNotice(
        publishForm.when === "now"
          ? `${res.created.filter((c) => c.status === "published").length} jagya e publish thai gayu`
          : `${res.created.length} post goothvai gaya`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  const busy = Boolean(job && (job.status === "queued" || job.status === "running"));

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Reel Studio"
        subtitle="Fakt product ni image aapo — AI baki badhu kare che: script, reel, music, caption, hashtags ane auto post"
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ whiteSpace: "pre-line" }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* ============ DABI BAJU — input ============ */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={3}>
            {/* --- 1. Images --- */}
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  1 · Product ni image
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Ek image = ek product ni reel. Ghani image mukho to badha
                  product ni ek j collection reel banse.
                </Typography>

                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  multiple
                  accept="image/*"
                  onChange={(e) => upload(e.target.files, "product")}
                />

                <Box
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    upload(e.dataTransfer.files, "product");
                  }}
                  sx={{
                    border: "2px dashed",
                    borderColor: "divider",
                    borderRadius: 2,
                    p: 3,
                    textAlign: "center",
                    cursor: "pointer",
                    bgcolor: "action.hover",
                    "&:hover": { borderColor: "primary.main" },
                  }}
                >
                  {uploading ? (
                    <CircularProgress size={28} />
                  ) : (
                    <>
                      <AddPhotoIcon color="primary" sx={{ fontSize: 36 }} />
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        Image ahiya khenchi ne mukho, ke click karo
                      </Typography>
                    </>
                  )}
                </Box>

                {images.length > 0 && (
                  <Grid container spacing={1} sx={{ mt: 1 }}>
                    {images.map((image, index) => (
                      <Grid key={image.id} size={4}>
                        <Box sx={{ position: "relative" }}>
                          <Box
                            component="img"
                            src={image.previewUrl}
                            alt={image.filename}
                            sx={{
                              width: "100%",
                              aspectRatio: "1",
                              objectFit: "cover",
                              borderRadius: 1.5,
                              display: "block",
                            }}
                          />
                          <Chip
                            size="small"
                            label={index + 1}
                            sx={{ position: "absolute", top: 4, left: 4, height: 20 }}
                          />
                          <IconButton
                            size="small"
                            onClick={() =>
                              setImages((prev) => prev.filter((i) => i.id !== image.id))
                            }
                            sx={{
                              position: "absolute",
                              top: 2,
                              right: 2,
                              bgcolor: "background.paper",
                              "&:hover": { bgcolor: "error.main", color: "#fff" },
                            }}
                          >
                            <DeleteIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                )}
              </CardContent>
            </Card>

            {/* --- 2. Options --- */}
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  2 · Kevi reel joiye
                </Typography>

                <Stack spacing={2.5} sx={{ mt: 2 }}>
                  <Box>
                    <Typography variant="body2" gutterBottom>
                      Lambai — {form.targetDuration} second
                    </Typography>
                    <Slider
                      value={form.targetDuration}
                      onChange={(_, value) =>
                        setForm({ ...form, targetDuration: value as number })
                      }
                      min={15}
                      max={90}
                      step={5}
                      marks={[
                        { value: 30, label: "30s" },
                        { value: 60, label: "60s" },
                        { value: 90, label: "90s" },
                      ]}
                    />
                  </Box>

                  <TextField
                    select
                    label="Avatar (marji nu)"
                    value={form.avatarId}
                    onChange={(e) => setForm({ ...form, avatarId: e.target.value })}
                    helperText="Avatar hoy to e product pehri ne reel ma dekhaay che"
                    fullWidth
                    size="small"
                  >
                    <MenuItem value="">Avatar vagar — fakt product</MenuItem>
                    {avatars.map((avatar) => (
                      <MenuItem key={avatar._id} value={avatar._id}>
                        {avatar.name}
                        {avatar.isDefault ? " (default)" : ""}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select
                    label="Bhasha"
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                    fullWidth
                    size="small"
                  >
                    <MenuItem value="en">English</MenuItem>
                    <MenuItem value="hinglish">Hinglish</MenuItem>
                    <MenuItem value="hi">हिन्दी</MenuItem>
                    <MenuItem value="gu">ગુજરાતી</MenuItem>
                  </TextField>

                  <TextField
                    label="Product vishe kaink kehvu che? (marji nu)"
                    value={form.hint}
                    onChange={(e) => setForm({ ...form, hint: e.target.value })}
                    placeholder="Dakhla tarike: pure cotton, machine washable, 6 colour ma"
                    multiline
                    rows={2}
                    fullWidth
                    size="small"
                    helperText="AI image joine j badhu kadhe che — pan tame kaho e ne vadhu maan aape"
                  />

                  <Stack direction="row" spacing={2}>
                    <TextField
                      label="Kimat"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                      placeholder="₹1,299"
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Product link"
                      value={form.productUrl}
                      onChange={(e) => setForm({ ...form, productUrl: e.target.value })}
                      placeholder="https://…"
                      size="small"
                      fullWidth
                    />
                  </Stack>

                  <FormControlLabel
                    control={
                      <Switch
                        checked={form.voiceover}
                        onChange={(e) => setForm({ ...form, voiceover: e.target.checked })}
                      />
                    }
                    label="Voiceover naakho (AI awaj)"
                  />

                  <Divider />

                  {/* Reference reel */}
                  <input
                    ref={referenceInput}
                    type="file"
                    hidden
                    accept="video/*"
                    onChange={(e) => upload(e.target.files, "reference")}
                  />
                  <Box>
                    <Typography variant="body2" gutterBottom>
                      Reference reel (marji nu)
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      Koi reel game to eni STYLE ni nakal thashe — tamara product
                      ane tamari avatar sathe. (Video download karine ahiya mukho.)
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<VideoFileIcon />}
                        onClick={() => referenceInput.current?.click()}
                      >
                        Video mukho
                      </Button>
                      {reference && (
                        <Chip
                          size="small"
                          label={reference.filename.slice(0, 24)}
                          onDelete={() => setReference(null)}
                        />
                      )}
                    </Stack>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <Button
              variant="contained"
              size="large"
              startIcon={busy || starting ? <CircularProgress size={18} /> : <MovieIcon />}
              onClick={generate}
              disabled={busy || starting || images.length === 0}
              sx={{ py: 1.5 }}
            >
              {busy ? "Banai rahyu che…" : starting ? "Shuru karie chie…" : "Reel banavo"}
            </Button>
          </Stack>
        </Grid>

        {/* ============ JAMNI BAJU — result ============ */}
        <Grid size={{ xs: 12, md: 7 }}>
          {!job && (
            <Card sx={{ height: "100%" }}>
              <CardContent sx={{ textAlign: "center", py: 10 }}>
                <MovieIcon sx={{ fontSize: 64, color: "text.disabled" }} />
                <Typography variant="h6" sx={{ mt: 2 }}>
                  Reel ahiya dekhashe
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 420, mx: "auto" }}>
                  Image mukho ane &quot;Reel banavo&quot; dabavo. AI image joine
                  product samjse, atyare je trending che e shodhse, script lakhse,
                  video banavse, music naakhse ane Instagram + Facebook mate alag
                  alag caption lakhse.
                </Typography>
              </CardContent>
            </Card>
          )}

          {job && <JobPanel job={job} tab={tab} setTab={setTab} />}

          {/* ---- Publish ---- */}
          {job?.status === "done" && (
            <Card sx={{ mt: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Publish karo
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Instagram ma je jashe e j Facebook ma pan jashe — pan dareak
                  platform mate alag caption ane alag hashtag sathe.
                </Typography>

                <Stack spacing={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="pub-acc">Accounts</InputLabel>
                    <Select
                      labelId="pub-acc"
                      multiple
                      value={publishForm.accountIds}
                      onChange={(e) =>
                        setPublishForm({
                          ...publishForm,
                          accountIds:
                            typeof e.target.value === "string"
                              ? e.target.value.split(",")
                              : e.target.value,
                        })
                      }
                      input={<OutlinedInput label="Accounts" />}
                      renderValue={(ids) =>
                        accounts
                          .filter((a) => ids.includes(a._id))
                          .map((a) => a.displayName)
                          .join(", ")
                      }
                    >
                      {accounts.length === 0 && (
                        <MenuItem disabled>Pehla Social Accounts page ma account jodo</MenuItem>
                      )}
                      {accounts.map((account) => (
                        <MenuItem key={account._id} value={account._id}>
                          <Checkbox checked={publishForm.accountIds.includes(account._id)} />
                          {account.platform === "facebook" ? (
                            <FacebookIcon fontSize="small" sx={{ mr: 1 }} />
                          ) : (
                            <InstagramIcon fontSize="small" sx={{ mr: 1 }} />
                          )}
                          <ListItemText primary={account.displayName} secondary={account.platform} />
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    select
                    label="Kyare"
                    value={publishForm.when}
                    onChange={(e) =>
                      setPublishForm({ ...publishForm, when: e.target.value as "now" })
                    }
                    size="small"
                    fullWidth
                  >
                    <MenuItem value="now">Atyare j publish karo</MenuItem>
                    <MenuItem value="auto">
                      Sauthi saara vakhate apoaap goothvo (recommended)
                    </MenuItem>
                    <MenuItem value="draft">Fakt draft banavo</MenuItem>
                  </TextField>

                  <FormControlLabel
                    control={
                      <Switch
                        checked={publishForm.hashtagsInFirstComment}
                        onChange={(e) =>
                          setPublishForm({
                            ...publishForm,
                            hashtagsInFirstComment: e.target.checked,
                          })
                        }
                      />
                    }
                    label="Hashtag pehla comment ma mukho (Instagram par saru dekhay)"
                  />

                  <Button
                    variant="contained"
                    startIcon={publishing ? <CircularProgress size={16} /> : <SendIcon />}
                    onClick={publish}
                    disabled={publishing || publishForm.accountIds.length === 0}
                  >
                    {publishing ? "Mokli rahya chie…" : "Publish karo"}
                  </Button>

                  {publishResult && (
                    <Alert severity={publishResult.created.some((c) => c.error) ? "warning" : "success"}>
                      <AlertTitle>{publishResult.created.length} post</AlertTitle>
                      {publishResult.created.map((row) => (
                        <Typography key={row.postId} variant="body2">
                          • {row.account} ({row.platform}) — {row.status}
                          {row.permalink && (
                            <>
                              {" "}
                              <a href={row.permalink} target="_blank" rel="noreferrer">
                                jovo ↗
                              </a>
                            </>
                          )}
                          {row.error && ` — ${row.error}`}
                          {row.scheduledAt &&
                            ` — ${new Date(row.scheduledAt).toLocaleString()}`}
                        </Typography>
                      ))}
                      {publishResult.skipped.map((row) => (
                        <Typography key={row.account} variant="body2" color="text.secondary">
                          ⏭ {row.account}: {row.reason}
                        </Typography>
                      ))}
                    </Alert>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>
    </Stack>
  );
}

/* ------------------------------------------------------------------ *
 *  Job panel
 * ------------------------------------------------------------------ */

function JobPanel({
  job,
  tab,
  setTab,
}: {
  job: Job;
  tab: number;
  setTab: (value: number) => void;
}) {
  return (
    <Card>
      <CardContent>
        {/* ---- Progress ---- */}
        {(job.status === "queued" || job.status === "running") && (
          <Box sx={{ mb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="subtitle1" fontWeight={600}>
                {job.currentStep?.label ?? "Shuru thai rahyu che…"}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Typography variant="body2" color="text.secondary">
                {job.progress}%
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={job.progress} sx={{ height: 8, borderRadius: 4 }} />
            {job.currentStep?.note && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                {job.currentStep.note}
              </Typography>
            )}
          </Box>
        )}

        {job.status === "failed" && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <AlertTitle>Reel na banyu</AlertTitle>
            {job.error}
          </Alert>
        )}

        {/* ---- Steps ---- */}
        {job.steps.length > 0 && (
          <Stack spacing={0.5} sx={{ mb: 3 }}>
            {job.steps.map((step) => (
              <Stack key={step.key} direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ width: 22, display: "flex", justifyContent: "center" }}>
                  {step.status === "done" && <CheckIcon color="success" sx={{ fontSize: 18 }} />}
                  {step.status === "failed" && <ErrorIcon color="error" sx={{ fontSize: 18 }} />}
                  {step.status === "running" && <CircularProgress size={14} />}
                  {step.status === "skipped" && (
                    <Typography variant="caption" color="text.disabled">
                      –
                    </Typography>
                  )}
                  {step.status === "pending" && (
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "action.disabled" }} />
                  )}
                </Box>
                <Typography
                  variant="body2"
                  color={step.status === "pending" ? "text.disabled" : "text.primary"}
                  sx={{ minWidth: 210 }}
                >
                  {step.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {step.error ?? step.note}
                </Typography>
                {step.provider && <Chip size="small" variant="outlined" label={step.provider} />}
                {step.ms != null && step.ms > 0 && (
                  <Typography variant="caption" color="text.disabled">
                    {(step.ms / 1000).toFixed(1)}s
                  </Typography>
                )}
              </Stack>
            ))}
          </Stack>
        )}

        {/* ---- Result ---- */}
        {job.status === "done" && (
          <>
            <Divider sx={{ mb: 2 }} />
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 5 }}>
                {job.previewUrl && (
                  <Box
                    component="video"
                    src={job.previewUrl}
                    poster={job.thumbnailUrl ?? undefined}
                    controls
                    playsInline
                    sx={{
                      width: "100%",
                      aspectRatio: "9/16",
                      borderRadius: 2,
                      bgcolor: "common.black",
                      display: "block",
                    }}
                  />
                )}
                <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`${job.duration?.toFixed(1)}s`} />
                  <Chip size="small" label={`${job.scenes.length} scene`} />
                  <Chip size="small" label="1080×1920" />
                </Stack>
                {job.videoUrl && (
                  <Button
                    size="small"
                    fullWidth
                    sx={{ mt: 1 }}
                    component="a"
                    href={job.videoUrl}
                    download
                  >
                    Download karo
                  </Button>
                )}
              </Grid>

              <Grid size={{ xs: 12, sm: 7 }}>
                <Tabs
                  value={tab}
                  onChange={(_, value) => setTab(value)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{ mb: 2 }}
                >
                  <Tab label="Instagram" />
                  <Tab label="Facebook" />
                  <Tab label="Hashtags" />
                  <Tab label="AI e su samjyu" />
                  <Tab label="Scenes" />
                </Tabs>

                {tab === 0 && job.copy && <CopyPanel copy={job.copy.instagram} audio={job.audio} />}
                {tab === 1 && job.copy && <CopyPanel copy={job.copy.facebook} audio={null} />}
                {tab === 2 && <HashtagPanel job={job} />}
                {tab === 3 && <AnalysisPanel job={job} />}
                {tab === 4 && <ScenePanel job={job} />}
              </Grid>
            </Grid>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 *  Tabs
 * ------------------------------------------------------------------ */

function CopyPanel({ copy, audio }: { copy: Copy; audio: Job["audio"] }) {
  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <Typography variant="overline" color="text.secondary">
            Caption
          </Typography>
          <Chip
            size="small"
            color={copy.score.score >= 85 ? "success" : copy.score.score >= 70 ? "warning" : "default"}
            label={`Ranking ${copy.score.score}/100 · ${copy.score.grade}`}
          />
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Copy karo">
            <IconButton
              size="small"
              onClick={() => navigator.clipboard.writeText(copy.caption)}
            >
              <CopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Stack>
        <Box
          sx={{
            p: 1.5,
            borderRadius: 1.5,
            bgcolor: "action.hover",
            whiteSpace: "pre-wrap",
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {copy.caption}
        </Box>
      </Box>

      {copy.score.topFixes.length > 0 && (
        <Alert severity="info" sx={{ py: 0.5 }}>
          <Typography variant="caption" fontWeight={600}>
            Vadhu sudharva mate:
          </Typography>
          {copy.score.topFixes.map((fix, index) => (
            <Typography key={index} variant="caption" display="block">
              • {fix}
            </Typography>
          ))}
        </Alert>
      )}

      {audio && (
        <Alert severity="warning" icon={<MusicIcon />}>
          <AlertTitle sx={{ fontSize: 14 }}>Trending song joito hoy to</AlertTitle>
          <Typography variant="caption" display="block" sx={{ mb: 1 }}>
            Reel ma <strong>{audio.track ?? "music nathi"}</strong> vagi rahyu che
            (copyright-free, auto-post thay che).
          </Typography>
          <Typography variant="caption" display="block">
            {audio.instagramHint?.howTo}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            {(audio.instagramHint?.searchTerms ?? []).map((term) => (
              <Chip key={term} size="small" label={term} />
            ))}
          </Stack>
        </Alert>
      )}

      <Box>
        <Typography variant="overline" color="text.secondary">
          Lambu description (Facebook / SEO)
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {copy.description}
        </Typography>
      </Box>
    </Stack>
  );
}

function HashtagPanel({ job }: { job: Job }) {
  const tiers = ["broad", "medium", "niche", "branded"] as const;
  const labels: Record<string, string> = {
    broad: "Moti (reach mate)",
    medium: "Vachli (discovery)",
    niche: "Nani (ahiya tamari post RANK thashe)",
    branded: "Tamari brand",
  };

  return (
    <Stack spacing={2}>
      <Alert severity="info" sx={{ py: 0.5 }}>
        <Typography variant="caption">
          Nana account #fashion jeva mota tag par kadi nahi dekhay. Nani tags par
          dekhay che — etle e vadhu rakhya che.
        </Typography>
      </Alert>

      {tiers.map((tier) => {
        const tags = (job.trends?.hashtags ?? []).filter((h) => h.tier === tier);
        if (tags.length === 0) return null;
        return (
          <Box key={tier}>
            <Typography variant="overline" color="text.secondary">
              {labels[tier]} · {tags.length}
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              {tags.map((tag) => (
                <Chip key={tag.tag} size="small" label={`#${tag.tag}`} />
              ))}
            </Stack>
          </Box>
        );
      })}

      {(job.trends?.keywords ?? []).length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            Log aa shabdo search kare che
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {job.trends!.keywords.slice(0, 14).map((keyword) => (
              <Chip key={keyword} size="small" variant="outlined" label={keyword} />
            ))}
          </Stack>
        </Box>
      )}

      <Button
        size="small"
        startIcon={<CopyIcon />}
        onClick={() =>
          navigator.clipboard.writeText(
            (job.trends?.hashtags ?? []).map((h) => `#${h.tag}`).join(" "),
          )
        }
      >
        Badha hashtag copy karo
      </Button>
    </Stack>
  );
}

function AnalysisPanel({ job }: { job: Job }) {
  const a = job.analysis;
  if (!a) return null;

  const rows: Array<[string, string | undefined]> = [
    ["Product", a.productName],
    ["Category", [a.category, a.subCategory].filter(Boolean).join(" → ")],
    ["Colour", a.colors?.join(", ")],
    ["Material", a.materials?.join(", ")],
    ["Kona mate", a.targetAudience],
  ];

  return (
    <Stack spacing={2}>
      {rows.map(([label, value]) =>
        value ? (
          <Box key={label}>
            <Typography variant="overline" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="body2">{value}</Typography>
          </Box>
        ) : null,
      )}

      {(a.sellingPoints ?? []).length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            Log kem kharide
          </Typography>
          {a.sellingPoints!.map((point, index) => (
            <Typography key={index} variant="body2">
              • {point}
            </Typography>
          ))}
        </Box>
      )}

      {a.imageQuality && a.imageQuality.score < 7 && (
        <Alert severity="warning" sx={{ py: 0.5 }}>
          <Typography variant="caption">
            Image ni gunvatta {a.imageQuality.score}/10 —{" "}
            {a.imageQuality.issues.join(", ")}. Sari image thi reel ghano saro banse.
          </Typography>
        </Alert>
      )}
    </Stack>
  );
}

function ScenePanel({ job }: { job: Job }) {
  return (
    <Stack spacing={1}>
      {job.scenes.map((scene) => (
        <Box
          key={scene.index}
          sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "action.hover" }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Chip size="small" label={`${scene.index + 1}`} sx={{ height: 20 }} />
            <Chip size="small" variant="outlined" label={scene.purpose} sx={{ height: 20 }} />
            <Typography variant="caption" color="text.secondary">
              {scene.duration}s
            </Typography>
            <Box sx={{ flex: 1 }} />
            {scene.imageSource && scene.imageSource !== "uploaded" && (
              <Chip size="small" color="secondary" label={scene.imageSource} sx={{ height: 20 }} />
            )}
          </Stack>
          {scene.onScreenText && (
            <Typography variant="body2" fontWeight={600}>
              &ldquo;{scene.onScreenText}&rdquo;
            </Typography>
          )}
          {scene.voiceLine && (
            <Typography variant="caption" color="text.secondary">
              🎙 {scene.voiceLine}
            </Typography>
          )}
        </Box>
      ))}
    </Stack>
  );
}
