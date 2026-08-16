"use client";

import * as React from "react";
import {
  Alert,
  AlertTitle,
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
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SyncIcon from "@mui/icons-material/SyncOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import LanguageIcon from "@mui/icons-material/LanguageOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/SearchOutlined";

import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";
import { useConfirm } from "@/components/ConfirmProvider";

type Product = {
  url: string;
  title: string;
  imageUrl?: string;
  price?: string;
  source: string;
};

type Site = {
  id: string;
  name: string;
  url: string;
  host: string;
  platform?: string;
  productCount: number;
  lastSyncedAt?: string;
  lastSyncMs?: number;
  syncStatus: "never" | "syncing" | "ok" | "failed";
  syncError?: string;
  syncSources: string[];
};

export default function WebsitesPage() {
  const confirm = useConfirm();
  const [sites, setSites] = React.useState<Site[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [url, setUrl] = React.useState("");
  const [connecting, setConnecting] = React.useState(false);
  const [syncing, setSyncing] = React.useState<string | null>(null);

  const [browsing, setBrowsing] = React.useState<Site | null>(null);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [filter, setFilter] = React.useState("");

  const load = React.useCallback(() => {
    apiFetch<Site[]>("/api/websites")
      .then(setSites)
      .catch((problem) => setError(problem.message))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(load, [load]);

  async function connect() {
    if (!url.trim()) return;
    setConnecting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ host: string; productCount?: number }>(
        "/api/websites",
        { method: "POST", json: { url, sync: true } },
      );
      setNotice(
        `Connected ${result.host} — ${result.productCount ?? 0} products imported.`,
      );
      setUrl("");
      load();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function sync(site: Site) {
    setSyncing(site.id);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ productCount: number; syncError?: string }>(
        `/api/websites/${site.id}/sync`,
        { method: "POST" },
      );
      setNotice(
        result.syncError
          ? `${site.host}: ${result.syncError}`
          : `${site.host} — ${result.productCount} products found.`,
      );
      load();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setSyncing(null);
    }
  }

  async function disconnect(site: Site) {
    if (
      !(await confirm({
        title: `Disconnect ${site.host}?`,
        message:
          "Its imported product list is removed. You can connect it again and re-import at any time.",
        confirmLabel: "Disconnect",
      }))
    ) {
      return;
    }
    await apiFetch(`/api/websites/${site.id}`, { method: "DELETE" });
    load();
  }

  async function browse(site: Site) {
    setBrowsing(site);
    setFilter("");
    setProducts([]);
    const full = await apiFetch<{ products: Product[] }>(`/api/websites/${site.id}`);
    setProducts(full.products);
  }

  const visible = products.filter((product) =>
    product.title.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Connected Stores"
        subtitle="Point this at the website you sell on and every product is imported — link, title, image and price. Then creating a post is just picking a product."
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

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Connect a store
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter the address of your shop. Shopify stores import their whole
            catalogue in one go; other sites are read from the sitemap, and
            failing that by following the category pages. You can connect as many
            stores as you like.
          </Typography>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Website address"
              placeholder="yourstore.com"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") connect();
              }}
              fullWidth
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LanguageIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button
              variant="contained"
              onClick={connect}
              disabled={connecting || !url.trim()}
              startIcon={connecting ? <CircularProgress size={16} /> : <AddIcon />}
              sx={{ minWidth: 190 }}
            >
              {connecting ? "Importing…" : "Connect and import"}
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            Importing a large catalogue can take up to a minute.
          </Typography>
        </CardContent>
      </Card>

      {loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : sites.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <LanguageIcon sx={{ fontSize: 40, color: "text.disabled" }} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              No stores connected yet. Add one above and your products appear
              throughout the app.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          {sites.map((site) => (
            <Card key={site.id}>
              <CardContent>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                  alignItems={{ sm: "center" }}
                  justifyContent="space-between"
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {site.name}
                      </Typography>
                      {site.platform && site.platform !== "custom" && (
                        <Chip size="small" label={site.platform} variant="outlined" />
                      )}
                      <Chip
                        size="small"
                        color={
                          site.syncStatus === "ok"
                            ? "success"
                            : site.syncStatus === "failed"
                              ? "error"
                              : "default"
                        }
                        label={
                          site.syncStatus === "ok"
                            ? `${site.productCount} products`
                            : site.syncStatus === "failed"
                              ? "import failed"
                              : "not imported yet"
                        }
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {site.url}
                    </Typography>
                    {site.lastSyncedAt && (
                      <Typography variant="caption" color="text.secondary">
                        Last imported {new Date(site.lastSyncedAt).toLocaleString()}
                        {site.lastSyncMs ? ` · took ${(site.lastSyncMs / 1000).toFixed(1)}s` : ""}
                      </Typography>
                    )}
                  </Box>

                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => browse(site)}
                      disabled={site.productCount === 0}
                    >
                      View products
                    </Button>
                    <Tooltip title="Import again">
                      <span>
                        <IconButton
                          onClick={() => sync(site)}
                          disabled={syncing === site.id}
                        >
                          {syncing === site.id ? (
                            <CircularProgress size={18} />
                          ) : (
                            <SyncIcon />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Open the store">
                      <IconButton component="a" href={site.url} target="_blank" rel="noreferrer">
                        <OpenInNewIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Disconnect">
                      <IconButton color="error" onClick={() => disconnect(site)}>
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>

                {site.syncStatus === "failed" && site.syncError && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {site.syncError}
                  </Alert>
                )}

                {site.syncSources.length > 0 && (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Typography variant="caption" color="text.secondary">
                      How the products were found: {site.syncSources.join(" · ")}
                    </Typography>
                  </>
                )}

                {site.syncStatus === "ok" && site.productCount === 0 && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    <AlertTitle>Nothing was found automatically</AlertTitle>
                    The site could be read, but no product pages were recognised.
                    You can still paste product links by hand on the Products
                    page, or when creating a post.
                  </Alert>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* ---- Product browser ---- */}
      <Dialog
        open={Boolean(browsing)}
        onClose={() => setBrowsing(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{browsing?.name} — products</DialogTitle>
        <DialogContent>
          <TextField
            placeholder="Search products…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            fullWidth
            sx={{ mb: 2, mt: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />

          {products.length === 0 ? (
            <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">
                {visible.length} of {products.length}
              </Typography>
              {visible.slice(0, 100).map((product) => (
                <Stack
                  key={product.url}
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  sx={{ p: 1, border: 1, borderColor: "divider", borderRadius: 2 }}
                >
                  <Box
                    component="img"
                    src={product.imageUrl || "/favicon.ico"}
                    alt=""
                    sx={{
                      width: 44,
                      height: 44,
                      objectFit: "cover",
                      borderRadius: 1,
                      bgcolor: "action.hover",
                      flexShrink: 0,
                    }}
                  />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>
                      {product.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {product.url}
                    </Typography>
                  </Box>
                  {product.price && (
                    <Chip size="small" label={product.price} variant="outlined" />
                  )}
                  <IconButton
                    size="small"
                    component="a"
                    href={product.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              {visible.length > 100 && (
                <Typography variant="caption" color="text.secondary">
                  Showing the first 100. Use the search box to narrow it down.
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBrowsing(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
