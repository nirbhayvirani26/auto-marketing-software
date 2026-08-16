"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddPhotoIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import StarIcon from "@mui/icons-material/StarRounded";
import StarBorderIcon from "@mui/icons-material/StarBorderRounded";
import PersonAddIcon from "@mui/icons-material/PersonAddAlt1Outlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesomeOutlined";

import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";
import { useConfirm } from "@/components/ConfirmProvider";

type Avatar = {
  _id: string;
  name: string;
  description?: string;
  gender?: string;
  ageRange?: string;
  skinTone?: string;
  hair?: string;
  bodyType?: string;
  persona?: string;
  language?: string;
  wardrobeNotes?: string;
  isDefault?: boolean;
  photoUrls: string[];
  primaryPhotoUrl?: string | null;
  generatedViews?: Array<{ key: string; label: string; url: string }>;
};

type ViewOption = { key: string; label: string; purpose: string };
type GeneratedView = { key: string; label: string; purpose?: string; url: string };

type Uploaded = { id: string; previewUrl: string; filename: string };

export default function AvatarsPage() {
  const confirm = useConfirm();
  const [avatars, setAvatars] = React.useState<Avatar[]>([]);

  // --- generated views ---
  const [viewsFor, setViewsFor] = React.useState<Avatar | null>(null);
  const [viewOptions, setViewOptions] = React.useState<ViewOption[]>([]);
  const [generated, setGenerated] = React.useState<GeneratedView[]>([]);
  const [pickedViews, setPickedViews] = React.useState<string[]>([]);
  const [direction, setDirection] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [viewError, setViewError] = React.useState<string | null>(null);
  const [viewNotice, setViewNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const [photos, setPhotos] = React.useState<Uploaded[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    description: "",
    gender: "unspecified",
    ageRange: "",
    persona: "friendly, confident, warm",
    language: "en",
    wardrobeNotes: "",
  });

  const fileInput = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(() => {
    apiFetch<Avatar[]>("/api/avatars")
      .then(setAvatars)
      .catch((e) => setError((e as Error).message));
  }, []);

  React.useEffect(load, [load]);

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      for (const file of Array.from(files)) body.append("files", file);
      body.append("role", "avatar");

      const res = await fetch("/api/uploads", { method: "POST", body });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) throw new Error(payload?.error ?? "Upload fail");

      setPhotos((prev) => [...prev, ...(payload.data.files as Uploaded[])].slice(0, 5));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save() {
    if (!form.name || photos.length === 0) {
      setError("A name and at least one photo are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ describeError?: string }>("/api/avatars", {
        method: "POST",
        json: {
          ...form,
          photoIds: photos.map((p) => p.id),
          description: form.description || undefined,
          ageRange: form.ageRange || undefined,
          wardrobeNotes: form.wardrobeNotes || undefined,
          autoDescribe: true,
        },
      });

      setNotice(
        res.describeError
          ? `The avatar was created, but the AI could not describe it (${res.describeError}) — you can write the description yourself.`
          : "Avatar banyo — have reels ma aa chehro dekhashe",
      );
      setOpen(false);
      setPhotos([]);
      setForm({
        name: "",
        description: "",
        gender: "unspecified",
        ageRange: "",
        persona: "friendly, confident, warm",
        language: "en",
        wardrobeNotes: "",
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(id: string) {
    try {
      await apiFetch("/api/avatars", { method: "PATCH", json: { id, isDefault: true } });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (
      !(await confirm({
        title: "Delete this avatar?",
        message:
          "Its reference photos and generated views go with it. Reels already made are unaffected.",
      }))
    ) {
      return;
    }
    try {
      await apiFetch(`/api/avatars?id=${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /* ---- Generated views ---- */

  async function openViews(avatar: Avatar) {
    setViewsFor(avatar);
    setViewError(null);
    setViewNotice(null);
    setDirection("");
    setGenerated([]);
    setPickedViews([]);
    try {
      const data = await apiFetch<{ available: ViewOption[]; generated: GeneratedView[] }>(
        `/api/avatars/${avatar._id}/views`,
      );
      setViewOptions(data.available);
      setGenerated(data.generated);
      // Default to everything that has not been made yet.
      const done = new Set(data.generated.map((view) => view.key));
      setPickedViews(data.available.filter((v) => !done.has(v.key)).map((v) => v.key));
    } catch (problem) {
      setViewError((problem as Error).message);
    }
  }

  async function generateViews() {
    if (!viewsFor || pickedViews.length === 0) return;
    setGenerating(true);
    setViewError(null);
    setViewNotice(null);
    try {
      const result = await apiFetch<{
        created: Array<{ key: string; label: string; url: string }>;
        failed: Array<{ label: string; reason: string }>;
      }>(`/api/avatars/${viewsFor._id}/views`, {
        method: "POST",
        json: { views: pickedViews, direction: direction || undefined },
      });

      setViewNotice(
        `${result.created.length} view(s) generated${
          result.failed.length ? `, ${result.failed.length} failed` : ""
        }.`,
      );
      if (result.failed.length) {
        setViewError(result.failed.map((f) => `${f.label}: ${f.reason}`).join("\n"));
      }

      const fresh = await apiFetch<{ generated: GeneratedView[] }>(
        `/api/avatars/${viewsFor._id}/views`,
      );
      setGenerated(fresh.generated);
      setPickedViews([]);
      load();
    } catch (problem) {
      setViewError((problem as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Avatars"
        subtitle="Give the reels a face. Upload photos once and the same person appears in every reel you make."
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Alert severity="info">
        <Typography variant="body2">
          An avatar is the person who appears in your reels — you, your model,
          or an AI-generated face. Upload two or three clear photos once (facing
          the camera, from a few angles) and the same face and look are kept in
          every reel.
          When the product is clothing, the avatar is shown <strong>wearing</strong> it.
        </Typography>
      </Alert>

      <Box>
        <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setOpen(true)}>
          New avatar
        </Button>
      </Box>

      <Grid container spacing={2}>
        {avatars.length === 0 && (
          <Grid size={12}>
            <Card>
              <CardContent sx={{ textAlign: "center", py: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  No avatars yet. Reels work without one too — built from your
                  product photos alone.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}

        {avatars.map((avatar) => (
          <Grid key={avatar._id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              {avatar.primaryPhotoUrl && (
                <Box
                  component="img"
                  src={avatar.primaryPhotoUrl}
                  alt={avatar.name}
                  sx={{
                    width: "100%",
                    height: 240,
                    objectFit: "cover",
                    bgcolor: "action.hover",
                    display: "block",
                  }}
                />
              )}
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
                    {avatar.name}
                  </Typography>
                  <IconButton size="small" onClick={() => makeDefault(avatar._id)}>
                    {avatar.isDefault ? (
                      <StarIcon color="warning" fontSize="small" />
                    ) : (
                      <StarBorderIcon fontSize="small" />
                    )}
                  </IconButton>
                  <IconButton size="small" onClick={() => remove(avatar._id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>

                <Stack direction="row" spacing={0.5} sx={{ my: 1 }} flexWrap="wrap" useFlexGap>
                  {avatar.gender && avatar.gender !== "unspecified" && (
                    <Chip size="small" label={avatar.gender} />
                  )}
                  {avatar.ageRange && <Chip size="small" label={avatar.ageRange} />}
                  {avatar.language && <Chip size="small" variant="outlined" label={avatar.language} />}
                  <Chip size="small" variant="outlined" label={`${avatar.photoUrls.length} photo`} />
                </Stack>

                <Typography variant="body2" color="text.secondary">
                  {(avatar.description ?? "").slice(0, 160)}
                </Typography>

                <Button
                  fullWidth
                  size="small"
                  variant="outlined"
                  startIcon={<AutoAwesomeIcon />}
                  sx={{ mt: 2 }}
                  onClick={() => openViews(avatar)}
                >
                  {avatar.generatedViews?.length
                    ? `Views (${avatar.generatedViews.length})`
                    : "Generate views"}
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* ---- New avatar ---- */}
      <Dialog open={open} onClose={() => !saving && setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New avatar</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept="image/*"
              onChange={(e) => uploadPhotos(e.target.files)}
            />

            <Box
              onClick={() => fileInput.current?.click()}
              sx={{
                border: "2px dashed",
                borderColor: "divider",
                borderRadius: 2,
                p: 3,
                textAlign: "center",
                cursor: "pointer",
                "&:hover": { borderColor: "primary.main" },
              }}
            >
              {uploading ? (
                <CircularProgress size={26} />
              ) : (
                <>
                  <AddPhotoIcon color="primary" sx={{ fontSize: 32 }} />
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Upload 2-3 photos with the face clearly visible
                  </Typography>
                </>
              )}
            </Box>

            {photos.length > 0 && (
              <Stack direction="row" spacing={1}>
                {photos.map((photo) => (
                  <Box
                    key={photo.id}
                    component="img"
                    src={photo.previewUrl}
                    alt={photo.filename}
                    sx={{ width: 72, height: 72, objectFit: "cover", borderRadius: 1.5 }}
                  />
                ))}
              </Stack>
            )}

            <TextField
              label="Naam"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
              size="small"
            />

            <TextField
              label="Varnan (khali chhodo to AI photo joine bhari deshe)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              multiline
              rows={2}
              fullWidth
              size="small"
            />

            <Stack direction="row" spacing={2}>
              <TextField
                select
                label="Gender"
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
                size="small"
                fullWidth
              >
                <MenuItem value="unspecified">Prefer not to say</MenuItem>
                <MenuItem value="female">Female</MenuItem>
                <MenuItem value="male">Male</MenuItem>
                <MenuItem value="non-binary">Non-binary</MenuItem>
              </TextField>
              <TextField
                label="Umar"
                value={form.ageRange}
                onChange={(e) => setForm({ ...form, ageRange: e.target.value })}
                placeholder="24-30"
                size="small"
                fullWidth
              />
              <TextField
                select
                label="Bhasha"
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
                size="small"
                fullWidth
              >
                <MenuItem value="en">English</MenuItem>
                <MenuItem value="hinglish">Hinglish</MenuItem>
                <MenuItem value="hi">हिन्दी</MenuItem>
                <MenuItem value="gu">ગુજરાતી</MenuItem>
              </TextField>
            </Stack>

            <TextField
              label="Bolvani rit"
              value={form.persona}
              onChange={(e) => setForm({ ...form, persona: e.target.value })}
              fullWidth
              size="small"
            />

            <TextField
              label="Kaya prakar na kapda / look"
              value={form.wardrobeNotes}
              onChange={(e) => setForm({ ...form, wardrobeNotes: e.target.value })}
              placeholder="minimal, neutral colours, gold jewellery"
              fullWidth
              size="small"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)} disabled={saving}>
            Rehva do
          </Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={saving || !form.name || photos.length === 0}
            startIcon={saving ? <CircularProgress size={16} /> : undefined}
          >
            {saving ? "Saving…" : "Create avatar"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Generated views ---- */}
      <Dialog
        open={Boolean(viewsFor)}
        onClose={() => !generating && setViewsFor(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{viewsFor?.name} — generated views</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              Every view is generated from this avatar&apos;s reference photos, so
              it stays the same person. Use them for full-body try-on shots, side
              and back angles, and close-ups when a scene needs a face.
            </Alert>

            {viewError && (
              <Alert severity="error" sx={{ whiteSpace: "pre-line" }} onClose={() => setViewError(null)}>
                {viewError}
              </Alert>
            )}
            {viewNotice && (
              <Alert severity="success" onClose={() => setViewNotice(null)}>
                {viewNotice}
              </Alert>
            )}

            {generated.length > 0 && (
              <>
                <Typography variant="subtitle2">Already generated</Typography>
                <Grid container spacing={1}>
                  {generated.map((view) => (
                    <Grid size={{ xs: 6, sm: 4, md: 3 }} key={view.key}>
                      <Box
                        component="img"
                        src={view.url}
                        alt={view.label}
                        sx={{
                          width: "100%",
                          aspectRatio: "3/4",
                          objectFit: "cover",
                          borderRadius: 2,
                          bgcolor: "action.hover",
                        }}
                      />
                      <Typography variant="caption" display="block" noWrap>
                        {view.label}
                      </Typography>
                    </Grid>
                  ))}
                </Grid>
              </>
            )}

            <Typography variant="subtitle2">Generate</Typography>
            <Stack>
              {viewOptions.map((option) => (
                <FormControlLabel
                  key={option.key}
                  control={
                    <Checkbox
                      checked={pickedViews.includes(option.key)}
                      onChange={(event) =>
                        setPickedViews((current) =>
                          event.target.checked
                            ? [...current, option.key]
                            : current.filter((key) => key !== option.key),
                        )
                      }
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{option.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.purpose}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </Stack>

            <TextField
              label="Extra direction (optional)"
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              placeholder="e.g. wearing a navy saree, outdoors in daylight"
              fullWidth
            />

            <Typography variant="caption" color="text.secondary">
              This needs an image model that reads reference photos — Nano Banana
              (GEMINI_API_KEY) or gpt-image-1. Each view takes a few seconds.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewsFor(null)} disabled={generating}>
            Close
          </Button>
          <Button
            variant="contained"
            onClick={generateViews}
            disabled={generating || pickedViews.length === 0}
            startIcon={generating ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
          >
            {generating ? "Generating…" : `Generate ${pickedViews.length} view(s)`}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
