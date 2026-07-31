"use client";

import * as React from "react";
import {
  Alert,
  Avatar,
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
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";

type Brand = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  brandVoice?: string;
  targetAudience?: string;
  website?: string;
  logoUrl?: string;
  color?: string;
  accountCount: number;
};

const EMPTY = {
  name: "",
  description: "",
  brandVoice: "friendly, professional",
  targetAudience: "",
  website: "",
  logoUrl: "",
  color: "#5B5BD6",
};

const PALETTE = [
  "#5B5BD6",
  "#00B8A9",
  "#D98324",
  "#D64545",
  "#2E9E5B",
  "#3A86C8",
  "#8B5CF6",
  "#EC4899",
];

export default function BrandsPage() {
  const [brands, setBrands] = React.useState<Brand[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    apiFetch<{ brands: Brand[]; activeBrandId: string | null }>("/api/brands")
      .then((data) => {
        setBrands(data.brands);
        setActiveId(data.activeBrandId);
      })
      .catch((e) => setError(e.message));
  }, []);

  React.useEffect(load, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/brands", { method: "POST", json: form });
      setOpen(false);
      setForm(EMPTY);
      setNotice(`"${form.name}" brand banyu`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/api/brands/${id}`, {
        method: "PATCH",
        json: { makeActive: true },
      });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function handleDelete(brand: Brand) {
    const typed = prompt(
      `Aa brand ane ena BADHA accounts, posts, campaigns, automations ane DM rules delete thai jashe.\n\nConfirm karva brand nu naam lakho:`,
    );
    if (typed !== brand.name) {
      if (typed !== null) setError("Naam match na thayu — kai delete na thayu");
      return;
    }
    setBusy(brand._id);
    try {
      await apiFetch(
        `/api/brands/${brand._id}?confirm=${encodeURIComponent(brand.name)}`,
        { method: "DELETE" },
      );
      setNotice(`"${brand.name}" delete thayu`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Brands"
        subtitle="Dareak brand na potana accounts, posts ane DM rules — uper thi switch karo"
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpen(true)}
          >
            Navu brand
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Grid container spacing={2}>
        {brands.map((brand) => {
          const isActive = brand._id === activeId;
          return (
            <Grid key={brand._id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card
                sx={{
                  height: "100%",
                  borderColor: isActive ? "primary.main" : undefined,
                  borderWidth: isActive ? 2 : 1,
                }}
              >
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    <Avatar
                      src={brand.logoUrl}
                      sx={{
                        width: 44,
                        height: 44,
                        bgcolor: brand.color ?? "primary.main",
                      }}
                    >
                      {brand.name.charAt(0).toUpperCase()}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="subtitle1" noWrap>
                          {brand.name}
                        </Typography>
                        {isActive && (
                          <Chip
                            size="small"
                            color="primary"
                            icon={<CheckCircleIcon />}
                            label="active"
                          />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {brand.accountCount} social accounts
                      </Typography>
                      {brand.description && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 1 }}
                        >
                          {brand.description}
                        </Typography>
                      )}
                    </Box>
                  </Stack>

                  <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                    {!isActive && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleActivate(brand._id)}
                        disabled={busy === brand._id}
                        startIcon={
                          busy === brand._id ? (
                            <CircularProgress size={14} />
                          ) : undefined
                        }
                      >
                        Switch karo
                      </Button>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Tooltip title="Delete brand">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => handleDelete(brand)}
                          disabled={busy === brand._id}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Navu brand banavo</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Brand name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Sparkle Home Services"
              fullWidth
              autoFocus
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              multiline
              minRows={2}
              fullWidth
            />
            <TextField
              label="Brand voice"
              value={form.brandVoice}
              onChange={(e) => setForm({ ...form, brandVoice: e.target.value })}
              helperText="AI aa voice ma badha posts lakhse"
              fullWidth
            />
            <TextField
              label="Target audience"
              value={form.targetAudience}
              onChange={(e) =>
                setForm({ ...form, targetAudience: e.target.value })
              }
              fullWidth
            />
            <TextField
              label="Website"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              fullWidth
            />
            <TextField
              label="Logo URL"
              value={form.logoUrl}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              fullWidth
            />
            <Box>
              <Typography variant="caption" color="text.secondary">
                Brand color
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                {PALETTE.map((color) => (
                  <Box
                    key={color}
                    onClick={() => setForm({ ...form, color })}
                    sx={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      bgcolor: color,
                      cursor: "pointer",
                      outline: form.color === color ? "3px solid" : "none",
                      outlineColor: "text.primary",
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !form.name}
          >
            {saving ? "Save thai rahyu…" : "Brand banavo"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
