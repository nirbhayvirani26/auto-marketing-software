"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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

import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";

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
};

type Uploaded = { id: string; previewUrl: string; filename: string };

export default function AvatarsPage() {
  const [avatars, setAvatars] = React.useState<Avatar[]>([]);
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
      setError("Naam ane ochho ek photo joiye");
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
          ? `Avatar banyo, pan AI varnan na kadhi shakyu (${res.describeError}) — jate lakhi shako cho.`
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
    if (!confirm("Aa avatar kaadhi naakhvo che?")) return;
    try {
      await apiFetch(`/api/avatars?id=${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Avatars"
        subtitle="Tamaro potano chehro reels ma — ek j vaar photo aapo, pachi dareak reel ma e j vyakti dekhashe"
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
          Avatar etle reel ma dekhaati vyakti — tame, tamaro model, ke AI e
          banavelo chehro. Ek vaar 2-3 saaf photo aapo (samu joto chehro, alag
          alag angle), pachi AI dareak reel ma e j chehro ane e j look rakhse.
          Product apparel hoy to avatar e product <strong>pehri ne</strong> dekhashe.
        </Typography>
      </Alert>

      <Box>
        <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setOpen(true)}>
          Navo avatar banavo
        </Button>
      </Box>

      <Grid container spacing={2}>
        {avatars.length === 0 && (
          <Grid size={12}>
            <Card>
              <CardContent sx={{ textAlign: "center", py: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  Have sudhi koi avatar nathi. Avatar vagar pan reels bane che —
                  fakt product ni image thi.
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
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* ---- Navo avatar ---- */}
      <Dialog open={open} onClose={() => !saving && setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Navo avatar</DialogTitle>
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
                    2-3 photo mukho (chehro saaf dekhato hoy)
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
                <MenuItem value="unspecified">Kaho nahi</MenuItem>
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
            {saving ? "Save karie chie…" : "Avatar banavo"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
