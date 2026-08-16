"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import AddPhotoIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import MovieIcon from "@mui/icons-material/MovieOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import CollectionsIcon from "@mui/icons-material/CollectionsOutlined";

import { apiFetch } from "@/lib/client";

export type MediaItem = {
  id: string;
  kind: string;
  role: string;
  filename: string;
  duration?: number;
  url: string;
  previewUrl: string | null;
};

/* ------------------------------------------------------------------ *
 *  The library browser
 * ------------------------------------------------------------------ */

function LibraryGrid({
  kind,
  roles,
  selected,
  onToggle,
}: {
  kind: "image" | "video";
  roles: string;
  selected: string[];
  onToggle: (item: MediaItem) => void;
}) {
  const [items, setItems] = React.useState<MediaItem[] | null>(null);

  React.useEffect(() => {
    apiFetch<MediaItem[]>(`/api/media?kind=${kind}&roles=${roles}&limit=60`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [kind, roles]);

  if (!items) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 5 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 1 }}>
        Nothing here yet. Anything you upload or generate shows up in this
        library and can be reused.
      </Alert>
    );
  }

  return (
    <Grid container spacing={1} sx={{ mt: 0.5 }}>
      {items.map((item) => {
        const isSelected = selected.includes(item.id);
        return (
          <Grid size={{ xs: 4, sm: 3 }} key={item.id}>
            <Box
              onClick={() => onToggle(item)}
              sx={{
                position: "relative",
                borderRadius: 2,
                overflow: "hidden",
                cursor: "pointer",
                aspectRatio: "1",
                border: 2,
                borderColor: isSelected ? "primary.main" : "transparent",
                bgcolor: "action.hover",
              }}
            >
              {item.previewUrl ? (
                <Box
                  component="img"
                  src={item.previewUrl}
                  alt={item.filename}
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <Stack sx={{ height: "100%" }} alignItems="center" justifyContent="center">
                  <MovieIcon color="disabled" />
                  <Typography variant="caption" color="text.secondary">
                    {item.duration ? `${item.duration.toFixed(0)}s` : "video"}
                  </Typography>
                </Stack>
              )}

              {isSelected && (
                <CheckCircleIcon
                  color="primary"
                  sx={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    bgcolor: "background.paper",
                    borderRadius: "50%",
                  }}
                />
              )}

              <Chip
                size="small"
                label={item.role}
                sx={{ position: "absolute", bottom: 4, left: 4, height: 18, fontSize: 10 }}
              />
            </Box>
          </Grid>
        );
      })}
    </Grid>
  );
}

/* ------------------------------------------------------------------ *
 *  The picker
 * ------------------------------------------------------------------ */

export default function ReferencePicker({
  label,
  hint,
  kind,
  roles,
  multiple,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  kind: "image" | "video";
  /** Which roles to offer from the library. */
  roles: string;
  multiple: boolean;
  value: MediaItem[];
  onChange: (items: MediaItem[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const selectedIds = value.map((item) => item.id);

  function toggle(item: MediaItem) {
    if (selectedIds.includes(item.id)) {
      onChange(value.filter((existing) => existing.id !== item.id));
      return;
    }
    onChange(multiple ? [...value, item] : [item]);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append("files", file);
      // Uploaded here on purpose as a reference, so it is easy to find later.
      form.append("role", kind === "video" ? "reference" : "product");

      const response = await fetch("/api/uploads", { method: "POST", body: form });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error);

      const added: MediaItem[] = json.data.files.map(
        (file: { id: string; filename: string; kind: string; previewUrl: string }) => ({
          id: file.id,
          kind: file.kind,
          role: kind === "video" ? "reference" : "product",
          filename: file.filename,
          url: file.previewUrl,
          previewUrl: file.kind === "image" ? file.previewUrl : null,
        }),
      );

      onChange(multiple ? [...value, ...added] : added.slice(0, 1));
      setOpen(false);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          optional
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        {hint}
      </Typography>

      {/* ---- What is selected ---- */}
      {value.length > 0 && (
        <Grid container spacing={1} sx={{ mb: 1 }}>
          {value.map((item) => (
            <Grid size={{ xs: 4, sm: 3, md: 2 }} key={item.id}>
              <Box
                sx={{
                  position: "relative",
                  borderRadius: 2,
                  overflow: "hidden",
                  aspectRatio: "1",
                  bgcolor: "action.hover",
                }}
              >
                {item.previewUrl ? (
                  <Box
                    component="img"
                    src={item.previewUrl}
                    alt=""
                    sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <Stack sx={{ height: "100%" }} alignItems="center" justifyContent="center">
                    <MovieIcon color="disabled" />
                  </Stack>
                )}
                <IconButton
                  size="small"
                  onClick={() => onChange(value.filter((x) => x.id !== item.id))}
                  sx={{ position: "absolute", top: 2, right: 2, bgcolor: "background.paper" }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Grid>
          ))}
        </Grid>
      )}

      <Button
        size="small"
        variant="outlined"
        startIcon={kind === "video" ? <MovieIcon /> : <CollectionsIcon />}
        onClick={() => setOpen(true)}
      >
        {value.length > 0 ? "Change" : kind === "video" ? "Choose a reel" : "Choose images"}
      </Button>

      {/* ---- Dialog ---- */}
      <Dialog open={open} onClose={() => !uploading && setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{label}</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Tabs value={tab} onChange={(_event, next) => setTab(next)} variant="fullWidth">
            <Tab label="From your library" />
            <Tab label="Upload new" />
          </Tabs>

          {tab === 0 && (
            <LibraryGrid kind={kind} roles={roles} selected={selectedIds} onToggle={toggle} />
          )}

          {tab === 1 && (
            <Box sx={{ pt: 2 }}>
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple={multiple}
                accept={kind === "video" ? "video/*" : "image/*"}
                onChange={(event) => upload(event.target.files)}
              />
              <Box
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  upload(event.dataTransfer.files);
                }}
                sx={{
                  border: "2px dashed",
                  borderColor: "divider",
                  borderRadius: 2,
                  p: 4,
                  textAlign: "center",
                  cursor: "pointer",
                  "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                }}
              >
                {uploading ? (
                  <CircularProgress size={26} />
                ) : (
                  <>
                    {kind === "video" ? (
                      <MovieIcon color="primary" sx={{ fontSize: 34 }} />
                    ) : (
                      <AddPhotoIcon color="primary" sx={{ fontSize: 34 }} />
                    )}
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Drop {kind === "video" ? "a video" : "images"} here, or click to choose
                    </Typography>
                  </>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={uploading}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
