"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  AlertTitle,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddPhotoIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import RocketIcon from "@mui/icons-material/RocketLaunchOutlined";
import StorefrontIcon from "@mui/icons-material/StorefrontOutlined";

import PageHeader from "@/components/PageHeader";
import ContentJobPanel, { type ContentJob } from "@/components/ContentJobPanel";
import ReferencePicker, { type MediaItem } from "@/components/ReferencePicker";
import OutputOptions, {
  DEFAULT_OUTPUT,
  type OutputSettings,
} from "@/components/OutputOptions";
import { apiFetch } from "@/lib/client";

/* ------------------------------------------------------------------ *
 *  Types
 * ------------------------------------------------------------------ */

type Uploaded = { id: string; previewUrl: string; filename: string };
type Account = { _id: string; displayName: string; platform: string };
type AvatarOption = { _id: string; name: string; generatedViews?: unknown[] };
type Site = { id: string; name: string; host: string; productCount: number };
type SiteProduct = { url: string; title: string; imageUrl?: string; price?: string };

/* ------------------------------------------------------------------ *
 *  Shared bits
 * ------------------------------------------------------------------ */

/**
 * Account and platform pickers.
 *
 * Both are optional by design — you can build a whole library of drafts before
 * ever connecting Instagram or Facebook, and nothing here blocks on that.
 */
function Destination({
  accounts,
  selectedAccounts,
  setSelectedAccounts,
  platforms,
  setPlatforms,
}: {
  accounts: Account[];
  selectedAccounts: string[];
  setSelectedAccounts: (value: string[]) => void;
  platforms: string[];
  setPlatforms: (value: string[]) => void;
}) {
  return (
    <Stack spacing={2}>
      <Divider textAlign="left">
        <Typography variant="caption" color="text.secondary">
          Where it goes — both optional
        </Typography>
      </Divider>

      <FormControl fullWidth>
        <InputLabel id="platforms">Platforms (optional)</InputLabel>
        <Select
          labelId="platforms"
          multiple
          value={platforms}
          onChange={(event) =>
            setPlatforms(
              typeof event.target.value === "string"
                ? event.target.value.split(",")
                : event.target.value,
            )
          }
          input={<OutlinedInput label="Platforms (optional)" />}
          renderValue={(selected) => (selected as string[]).join(", ")}
        >
          <MenuItem value="instagram">Instagram</MenuItem>
          <MenuItem value="facebook">Facebook</MenuItem>
        </Select>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel id="accounts">Accounts (optional)</InputLabel>
        <Select
          labelId="accounts"
          multiple
          value={selectedAccounts}
          onChange={(event) =>
            setSelectedAccounts(
              typeof event.target.value === "string"
                ? event.target.value.split(",")
                : event.target.value,
            )
          }
          input={<OutlinedInput label="Accounts (optional)" />}
          renderValue={(selected) =>
            accounts
              .filter((account) => (selected as string[]).includes(account._id))
              .map((account) => account.displayName)
              .join(", ")
          }
        >
          {accounts.length === 0 ? (
            <MenuItem disabled>No accounts connected yet</MenuItem>
          ) : (
            accounts.map((account) => (
              <MenuItem key={account._id} value={account._id}>
                {account.displayName} · {account.platform}
              </MenuItem>
            ))
          )}
        </Select>
      </FormControl>

      <Typography variant="caption" color="text.secondary">
        Leave both empty and a draft is written for Instagram and Facebook, ready
        to publish once an account is connected.
      </Typography>
    </Stack>
  );
}

function AvatarPicker({
  avatars,
  value,
  onChange,
}: {
  avatars: AvatarOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      select
      label="Avatar (optional)"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      helperText="Choose a face to appear in the post. Without one, the product photo carries it."
      fullWidth
    >
      <MenuItem value="">No avatar — product only</MenuItem>
      {avatars.map((avatar) => (
        <MenuItem key={avatar._id} value={avatar._id}>
          {avatar.name}
          {avatar.generatedViews?.length
            ? ` · ${avatar.generatedViews.length} views`
            : ""}
        </MenuItem>
      ))}
    </TextField>
  );
}

/* ------------------------------------------------------------------ *
 *  Page
 * ------------------------------------------------------------------ */

export default function CreatePage() {
  const [tab, setTab] = React.useState(0);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [avatars, setAvatars] = React.useState<AvatarOption[]>([]);
  const [sites, setSites] = React.useState<Site[]>([]);

  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(null);

  // References — shared by both tabs. Images steer the look; a reel supplies
  // the pacing and shot language to match.
  const [refImages, setRefImages] = React.useState<MediaItem[]>([]);
  const [refVideo, setRefVideo] = React.useState<MediaItem[]>([]);

  // What this run produces, and the settings for whichever mode is chosen.
  const [output, setOutput] = React.useState<OutputSettings>(DEFAULT_OUTPUT);

  // --- shared destination state ---
  const [selectedAccounts, setSelectedAccounts] = React.useState<string[]>([]);
  const [platforms, setPlatforms] = React.useState<string[]>([]);
  const [avatarId, setAvatarId] = React.useState("");

  // --- section 1: photo + name ---
  const [uploads, setUploads] = React.useState<Uploaded[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [name, setName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [productUrl, setProductUrl] = React.useState("");
  const fileInput = React.useRef<HTMLInputElement>(null);

  // --- section 2: pick from a connected store ---
  const [siteId, setSiteId] = React.useState("");
  const [siteProducts, setSiteProducts] = React.useState<SiteProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = React.useState(false);
  const [chosen, setChosen] = React.useState<SiteProduct | null>(null);
  const [manualUrl, setManualUrl] = React.useState("");
  const [manualName, setManualName] = React.useState("");

  React.useEffect(() => {
    apiFetch<Account[]>("/api/accounts").then(setAccounts).catch(() => setAccounts([]));
    apiFetch<AvatarOption[]>("/api/avatars").then(setAvatars).catch(() => setAvatars([]));
    apiFetch<Site[]>("/api/websites").then(setSites).catch(() => setSites([]));
  }, []);

  /* ---- store products ---- */
  React.useEffect(() => {
    if (!siteId) {
      setSiteProducts([]);
      return;
    }
    setLoadingProducts(true);
    setChosen(null);
    apiFetch<{ products: SiteProduct[] }>(`/api/websites/${siteId}`)
      .then((site) => setSiteProducts(site.products))
      .catch(() => setSiteProducts([]))
      .finally(() => setLoadingProducts(false));
  }, [siteId]);

  /* ---- upload ---- */
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append("files", file);
      const response = await fetch("/api/uploads", { method: "POST", body: form });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error);
      setUploads((current) => [...current, ...json.data.files]);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setUploading(false);
    }
  }

  /* ---- submit ---- */
  async function create(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setJobId(null);
    try {
      const started = await apiFetch<{ jobId: string }>("/api/create/job", {
        method: "POST",
        json: {
          accountIds: selectedAccounts,
          platforms,
          avatarId: avatarId || undefined,
          referenceImageIds: refImages.map((item) => item.id),
          referenceVideoId: refVideo[0]?.id,
          outputMode: output.mode,
          imageCount: output.imageCount,
          imageQuality: output.imageQuality,
          imageAspect: output.imageAspect,
          videoCount: output.videoCount,
          videoSeconds: output.videoSeconds,
          videoAspect: output.videoAspect,
          ...payload,
        },
      });
      setJobId(started.jobId);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const handleDone = React.useCallback((job: ContentJob) => {
    if (job.status === "failed" && job.error) setError(job.error);
  }, []);

  const canSubmitPhotos = uploads.length > 0 || productUrl.trim().length > 0;
  const canSubmitProduct = Boolean(chosen) || manualUrl.trim().length > 0;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Create New"
        subtitle="Two ways to make a marketing post: upload a photo, or pick something from a store you have connected."
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card>
        <Tabs
          value={tab}
          onChange={(_event, value) => {
            setTab(value);
            setJobId(null);
          }}
          variant="fullWidth"
          sx={{ borderBottom: 1, borderColor: "divider" }}
        >
          <Tab icon={<AddPhotoIcon />} iconPosition="start" label="Upload a photo" />
          <Tab icon={<StorefrontIcon />} iconPosition="start" label="Pick from a store" />
        </Tabs>

        <CardContent>
          {/* ================= SECTION 1 ================= */}
          {tab === 0 && (
            <Stack spacing={2.5}>
              <Typography variant="body2" color="text.secondary">
                Upload the product photo and give it a name. Everything else —
                caption, hashtags, the whole post — is written for you.
              </Typography>

              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
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
                  <CircularProgress size={28} />
                ) : (
                  <>
                    <AddPhotoIcon color="primary" sx={{ fontSize: 36 }} />
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Drop a photo here, or click to choose
                    </Typography>
                  </>
                )}
              </Box>

              {uploads.length > 0 && (
                <Grid container spacing={1}>
                  {uploads.map((file) => (
                    <Grid size={{ xs: 4, sm: 3, md: 2 }} key={file.id}>
                      <Box sx={{ position: "relative" }}>
                        <Box
                          component="img"
                          src={file.previewUrl}
                          alt=""
                          sx={{
                            width: "100%",
                            aspectRatio: "1",
                            objectFit: "cover",
                            borderRadius: 2,
                          }}
                        />
                        <IconButton
                          size="small"
                          onClick={() =>
                            setUploads((current) =>
                              current.filter((item) => item.id !== file.id),
                            )
                          }
                          sx={{
                            position: "absolute",
                            top: 2,
                            right: 2,
                            bgcolor: "background.paper",
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              )}

              <TextField
                label="Product name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Navy blue cotton kurta"
                helperText="The single biggest thing you can do to improve the caption."
                fullWidth
              />

              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Product link (optional)"
                  value={productUrl}
                  onChange={(event) => setProductUrl(event.target.value)}
                  placeholder="https://yourstore.com/products/…"
                  fullWidth
                />
                <TextField
                  label="Price (optional)"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="₹1,299"
                  sx={{ minWidth: 160 }}
                />
              </Stack>

              <TextField
                label="Anything else about it (optional)"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Material, occasion, who it is for…"
                multiline
                rows={2}
                fullWidth
              />

              <OutputOptions value={output} onChange={setOutput} />

              <Divider textAlign="left">
                <Typography variant="caption" color="text.secondary">
                  References — teach it the look you want
                </Typography>
              </Divider>

              <ReferencePicker
                label="Reference images"
                hint="Photos that show the styling, mood or framing you want. Your product stays exactly as it is — these only steer how the shot feels."
                kind="image"
                roles="product,generated,reference,keyframe"
                multiple
                value={refImages}
                onChange={setRefImages}
              />

              <ReferencePicker
                label="Reference reel"
                hint="A reel whose style you like. Its pacing, shot types and opening are matched — never its words, its product or its claims."
                kind="video"
                roles="reference,reel"
                multiple={false}
                value={refVideo}
                onChange={setRefVideo}
              />

              <AvatarPicker avatars={avatars} value={avatarId} onChange={setAvatarId} />

              <Destination
                accounts={accounts}
                selectedAccounts={selectedAccounts}
                setSelectedAccounts={setSelectedAccounts}
                platforms={platforms}
                setPlatforms={setPlatforms}
              />

              <Button
                variant="contained"
                size="large"
                startIcon={busy ? <CircularProgress size={18} /> : <RocketIcon />}
                disabled={busy || !canSubmitPhotos}
                onClick={() =>
                  create({
                    imageAssetIds: uploads.map((file) => file.id),
                    productName: name,
                    notes,
                    price,
                    productUrl,
                  })
                }
              >
                {busy
                  ? "Starting…"
                  : output.mode === "image"
                    ? `Generate ${output.imageCount} image${output.imageCount === 1 ? "" : "s"}`
                    : output.mode === "video"
                      ? "Generate reel"
                      : "Generate post and reel"}
              </Button>
            </Stack>
          )}

          {/* ================= SECTION 2 ================= */}
          {tab === 1 && (
            <Stack spacing={2.5}>
              <Typography variant="body2" color="text.secondary">
                Pick a product from a store you have connected and the post is
                built from its real title, image and price.
              </Typography>

              {sites.length === 0 ? (
                <Alert severity="info">
                  <AlertTitle>No stores connected yet</AlertTitle>
                  Connect your shop once and every product becomes available here.
                  <Box sx={{ mt: 1 }}>
                    <Button
                      component={Link}
                      href="/admin/websites"
                      size="small"
                      variant="outlined"
                    >
                      Connect a store
                    </Button>
                  </Box>
                </Alert>
              ) : (
                <TextField
                  select
                  label="Store"
                  value={siteId}
                  onChange={(event) => setSiteId(event.target.value)}
                  fullWidth
                >
                  <MenuItem value="">Choose a store…</MenuItem>
                  {sites.map((site) => (
                    <MenuItem key={site.id} value={site.id}>
                      {site.name} · {site.productCount} products
                    </MenuItem>
                  ))}
                </TextField>
              )}

              {loadingProducts && (
                <Box sx={{ display: "grid", placeItems: "center", py: 3 }}>
                  <CircularProgress size={24} />
                </Box>
              )}

              {siteId && !loadingProducts && siteProducts.length > 0 && (
                <Autocomplete
                  options={siteProducts}
                  getOptionLabel={(option) => option.title}
                  value={chosen}
                  onChange={(_event, value) => setChosen(value)}
                  isOptionEqualToValue={(option, value) => option.url === value.url}
                  renderInput={(params) => (
                    <TextField {...params} label="Product" placeholder="Search your catalogue…" />
                  )}
                  renderOption={(props, option) => {
                    const { key, ...rest } = props as { key: string };
                    return (
                      <Box
                        component="li"
                        key={key}
                        {...rest}
                        sx={{ display: "flex", gap: 1.5, alignItems: "center" }}
                      >
                        {option.imageUrl && (
                          <Box
                            component="img"
                            src={option.imageUrl}
                            alt=""
                            sx={{ width: 36, height: 36, objectFit: "cover", borderRadius: 1 }}
                          />
                        )}
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {option.title}
                          </Typography>
                          {option.price && (
                            <Typography variant="caption" color="text.secondary">
                              {option.price}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    );
                  }}
                />
              )}

              {siteId && !loadingProducts && siteProducts.length === 0 && (
                <Alert severity="warning">
                  No products were imported from this store. Paste the product
                  link by hand below, or re-import from the Connected Stores page.
                </Alert>
              )}

              <Divider textAlign="left">
                <Typography variant="caption" color="text.secondary">
                  Or enter it by hand
                </Typography>
              </Divider>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Product link"
                  value={manualUrl}
                  onChange={(event) => setManualUrl(event.target.value)}
                  placeholder="https://…"
                  fullWidth
                />
                <TextField
                  label="Product name"
                  value={manualName}
                  onChange={(event) => setManualName(event.target.value)}
                  fullWidth
                />
              </Stack>

              <OutputOptions value={output} onChange={setOutput} />

              <Divider textAlign="left">
                <Typography variant="caption" color="text.secondary">
                  References — teach it the look you want
                </Typography>
              </Divider>

              <ReferencePicker
                label="Reference images"
                hint="Photos that show the styling, mood or framing you want. Your product stays exactly as it is — these only steer how the shot feels."
                kind="image"
                roles="product,generated,reference,keyframe"
                multiple
                value={refImages}
                onChange={setRefImages}
              />

              <ReferencePicker
                label="Reference reel"
                hint="A reel whose style you like. Its pacing, shot types and opening are matched — never its words, its product or its claims."
                kind="video"
                roles="reference,reel"
                multiple={false}
                value={refVideo}
                onChange={setRefVideo}
              />

              <AvatarPicker avatars={avatars} value={avatarId} onChange={setAvatarId} />

              <Destination
                accounts={accounts}
                selectedAccounts={selectedAccounts}
                setSelectedAccounts={setSelectedAccounts}
                platforms={platforms}
                setPlatforms={setPlatforms}
              />

              <Button
                variant="contained"
                size="large"
                startIcon={busy ? <CircularProgress size={18} /> : <RocketIcon />}
                disabled={busy || !canSubmitProduct}
                onClick={() =>
                  create({
                    productUrl: chosen?.url ?? manualUrl,
                    productName: chosen?.title ?? manualName,
                    productImageUrl: chosen?.imageUrl,
                    price: chosen?.price,
                  })
                }
              >
                {busy
                  ? "Starting…"
                  : output.mode === "image"
                    ? `Generate ${output.imageCount} image${output.imageCount === 1 ? "" : "s"}`
                    : output.mode === "video"
                      ? "Generate reel"
                      : "Generate post and reel"}
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>

      {jobId && <ContentJobPanel jobId={jobId} onDone={handleDone} />}
    </Stack>
  );
}
