"use client";

import * as React from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddLinkIcon from "@mui/icons-material/AddLink";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import RocketIcon from "@mui/icons-material/RocketLaunchOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import FacebookIcon from "@mui/icons-material/Facebook";
import InstagramIcon from "@mui/icons-material/Instagram";
import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";

type Product = {
  _id: string;
  url: string;
  title: string;
  description?: string;
  price?: number;
  currency?: string;
  brandName?: string;
  siteName?: string;
  images: string[];
  generatedImageUrl?: string;
  scrapeSource?: string;
  scrapeError?: string;
};

type Account = { _id: string; displayName: string; platform: string };

type CampaignResult = {
  batchId?: string;
  imageUrl?: string;
  imageSource: string;
  created: Array<{
    postId: string;
    account: string;
    platform: string;
    caption: string;
    published?: boolean;
    permalink?: string;
    error?: string;
  }>;
  skipped: Array<{ account: string; reason: string }>;
};

export default function ProductsPage() {
  const [products, setProducts] = React.useState<Product[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Link add
  const [url, setUrl] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [manual, setManual] = React.useState<{ title: string } | null>(null);

  // Campaign
  const [target, setTarget] = React.useState<Product | null>(null);
  const [form, setForm] = React.useState({
    accountIds: [] as string[],
    tone: "friendly",
    imageMode: "generate",
    publish: false,
  });
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<CampaignResult | null>(null);

  const load = React.useCallback(() => {
    Promise.all([
      apiFetch<Product[]>("/api/products"),
      apiFetch<Account[]>("/api/accounts"),
    ])
      .then(([p, a]) => {
        setProducts(p);
        setAccounts(a);
        setForm((f) => ({
          ...f,
          accountIds: f.accountIds.length ? f.accountIds : a.map((x) => x._id),
        }));
      })
      .catch((e) => setError(e.message));
  }, []);

  React.useEffect(load, [load]);

  async function addProduct(title?: string) {
    setAdding(true);
    setError(null);
    try {
      const res = await apiFetch<{ product: Product; scrapeError?: string }>(
        "/api/products",
        { method: "POST", json: { url, ...(title ? { title } : {}) } },
      );
      setUrl("");
      setManual(null);
      setNotice(
        res.scrapeError
          ? `"${res.product.title}" add thayu (vigat jate bharvi padse)`
          : `"${res.product.title}" ni vigat aavi gai`,
      );
      load();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      // Scrape fail thayu — user title jate aapi shake.
      setManual({ title: "" });
    } finally {
      setAdding(false);
    }
  }

  async function runCampaign() {
    if (!target) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch<CampaignResult>("/api/products/campaign", {
        method: "POST",
        json: { productId: target._id, ...form },
      });
      setResult(res);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Aa product delete karvu che?")) return;
    try {
      await apiFetch(`/api/products?id=${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Products"
        subtitle="Product ni link paste karo — vigat, caption, image ane post badhu automatic"
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {/* ---------- Link paste ---------- */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Product ni link paste karo
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Amazon, Flipkart, Shopify, tamari potani site — koi pan product page.
            Naam, price, description ane images aapoaap aavi jashe.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Product URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              fullWidth
              onKeyDown={(e) => {
                if (e.key === "Enter" && url) addProduct();
              }}
            />
            <Button
              variant="contained"
              startIcon={adding ? <CircularProgress size={16} /> : <AddLinkIcon />}
              onClick={() => addProduct()}
              disabled={adding || !url}
              sx={{ minWidth: 180, height: 40 }}
            >
              {adding ? "Vigat lai rahyu…" : "Vigat lavo"}
            </Button>
          </Stack>

          {manual && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="warning" sx={{ mb: 1 }}>
                Aa site e vigat na aapi. Product nu naam jate lakho — baki badhu
                chalse.
              </Alert>
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Product nu naam"
                  value={manual.title}
                  onChange={(e) => setManual({ title: e.target.value })}
                  fullWidth
                />
                <Button
                  variant="outlined"
                  onClick={() => addProduct(manual.title)}
                  disabled={!manual.title}
                >
                  Save karo
                </Button>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ---------- Product list ---------- */}
      <Grid container spacing={2}>
        {products.length === 0 && (
          <Grid size={12}>
            <Card>
              <CardContent sx={{ textAlign: "center", py: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  Have sudhi koi product nathi — uper link paste karo.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}
        {products.map((product) => {
          const image = product.generatedImageUrl || product.images?.[0];
          return (
            <Grid key={product._id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                {image && (
                  <CardMedia
                    component="img"
                    height="180"
                    image={image}
                    alt={product.title}
                    sx={{ objectFit: "cover", bgcolor: "action.hover" }}
                  />
                )}
                <CardContent sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                    {product.title.slice(0, 90)}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                    {product.price != null && (
                      <Chip
                        size="small"
                        color="success"
                        label={`${product.currency ?? ""}${product.price}`}
                      />
                    )}
                    {product.siteName && (
                      <Chip size="small" variant="outlined" label={product.siteName} />
                    )}
                    {product.scrapeSource && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={product.scrapeSource}
                      />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {(product.description ?? "").slice(0, 120)}
                  </Typography>
                </CardContent>
                <Divider />
                <Stack direction="row" spacing={1} sx={{ p: 1.5 }} alignItems="center">
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<RocketIcon />}
                    onClick={() => {
                      setTarget(product);
                      setResult(null);
                    }}
                  >
                    Post banavo
                  </Button>
                  <Box sx={{ flex: 1 }} />
                  <Tooltip title="Product page kholo">
                    <IconButton
                      size="small"
                      component="a"
                      href={product.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <IconButton size="small" onClick={() => remove(product._id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* ---------- Campaign dialog ---------- */}
      <Dialog
        open={Boolean(target)}
        onClose={() => !running && setTarget(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{target?.title.slice(0, 60)} — post banavo</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              AI Facebook ane Instagram mate <strong>alag alag</strong> caption
              banavshe, image banavshe, ane caption ma product ni link mukshe.
            </Alert>

            <FormControl fullWidth>
              <InputLabel id="acc">Accounts</InputLabel>
              <Select
                labelId="acc"
                multiple
                value={form.accountIds}
                onChange={(e) =>
                  setForm({
                    ...form,
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
                  <MenuItem disabled>Pehla account connect karo</MenuItem>
                )}
                {accounts.map((account) => (
                  <MenuItem key={account._id} value={account._id}>
                    <Checkbox checked={form.accountIds.includes(account._id)} />
                    {account.platform === "facebook" ? (
                      <FacebookIcon fontSize="small" sx={{ mr: 1 }} />
                    ) : (
                      <InstagramIcon fontSize="small" sx={{ mr: 1 }} />
                    )}
                    <ListItemText
                      primary={account.displayName}
                      secondary={account.platform}
                    />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              select
              label="Image"
              value={form.imageMode}
              onChange={(e) => setForm({ ...form, imageMode: e.target.value })}
              fullWidth
            >
              <MenuItem value="generate">AI thi navi image banavo (free)</MenuItem>
              <MenuItem value="product">Product page ni image vapro</MenuItem>
            </TextField>

            <TextField
              label="Tone"
              value={form.tone}
              onChange={(e) => setForm({ ...form, tone: e.target.value })}
              fullWidth
            />

            <FormControlLabel
              control={
                <Switch
                  checked={form.publish}
                  onChange={(e) => setForm({ ...form, publish: e.target.checked })}
                />
              }
              label="Banavine turant publish karo (band rakho to draft raheshe)"
            />

            {result && (
              <Alert severity={result.skipped.length ? "warning" : "success"}>
                <AlertTitle>
                  {result.created.length} post banya · image: {result.imageSource}
                </AlertTitle>
                {result.created.map((c) => (
                  <Typography key={c.postId} variant="body2">
                    • {c.account} ({c.platform})
                    {c.published === true && " — publish thayu ✓"}
                    {c.published === false && ` — fail: ${c.error}`}
                  </Typography>
                ))}
                {result.skipped.map((s) => (
                  <Typography key={s.account} variant="body2" color="text.secondary">
                    ⏭ {s.account}: {s.reason}
                  </Typography>
                ))}
                {result.imageUrl && (
                  <Box
                    component="img"
                    src={result.imageUrl}
                    alt="generated"
                    sx={{ mt: 1, width: "100%", borderRadius: 2 }}
                  />
                )}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setTarget(null)} disabled={running}>
            Band karo
          </Button>
          <Button
            variant="contained"
            onClick={runCampaign}
            disabled={running || form.accountIds.length === 0}
            startIcon={running ? <CircularProgress size={16} /> : <RocketIcon />}
          >
            {running ? "Banai rahyu che…" : form.publish ? "Banavo + Publish" : "Draft banavo"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
