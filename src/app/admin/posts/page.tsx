"use client";

import * as React from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import SendIcon from "@mui/icons-material/SendOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import FacebookIcon from "@mui/icons-material/Facebook";
import InstagramIcon from "@mui/icons-material/Instagram";
import PageHeader from "@/components/PageHeader";
import StatusChip from "@/components/StatusChip";
import { apiFetch } from "@/lib/client";

type Platform = "facebook" | "instagram";
type Account = { _id: string; displayName: string; platform: Platform };
type Campaign = { _id: string; name: string };
type Post = {
  _id: string;
  caption: string;
  hashtags: string[];
  platform: string;
  status: string;
  mediaUrl?: string;
  scheduledAt?: string;
  publishedAt?: string;
  permalink?: string;
  error?: string;
  batchId?: string;
  account?: { displayName: string };
  createdAt: string;
};

type Generated = { caption: string; hashtags: string[]; imagePrompt: string };
type BulkResult = {
  batchId?: string;
  created: Array<{ id: string; account: string; platform: string }>;
  skipped: Array<{ account: string; reason: string }>;
};

const STATUS_TABS = ["all", "draft", "scheduled", "published", "failed"] as const;

const EMPTY_FORM = {
  accounts: [] as string[],
  campaign: "",
  topic: "",
  tone: "friendly",
  aiPlatform: "facebook" as Platform,
  caption: "",
  hashtags: "",
  mediaUrl: "",
  scheduledAt: "",
};

export default function PostsPage() {
  const [posts, setPosts] = React.useState<Post[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [tab, setTab] = React.useState<(typeof STATUS_TABS)[number]>("all");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<React.ReactNode>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [generating, setGenerating] = React.useState(false);
  const [variants, setVariants] = React.useState<Generated[]>([]);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    Promise.all([
      apiFetch<Post[]>(`/api/posts${tab === "all" ? "" : `?status=${tab}`}`),
      apiFetch<Account[]>("/api/accounts"),
      apiFetch<Campaign[]>("/api/campaigns"),
    ])
      .then(([p, a, c]) => {
        setPosts(p);
        setAccounts(a);
        setCampaigns(c);
      })
      .catch((e) => setError(e.message));
  }, [tab]);

  React.useEffect(load, [load]);

  const selected = accounts.filter((a) => form.accounts.includes(a._id));
  const hasInstagram = selected.some((a) => a.platform === "instagram");
  const igNeedsImage = hasInstagram && !form.mediaUrl;

  /** Account select thay tyare AI platform aapoaap set thay. */
  function handleAccountsChange(ids: string[]) {
    const picked = accounts.filter((a) => ids.includes(a._id));
    const platforms = new Set(picked.map((a) => a.platform));
    setForm((f) => ({
      ...f,
      accounts: ids,
      aiPlatform:
        platforms.size === 1
          ? (platforms.values().next().value as Platform)
          : f.aiPlatform,
    }));
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await apiFetch<{ posts: Generated[] }>("/api/ai/generate", {
        method: "POST",
        json: {
          topic: form.topic,
          platform: form.aiPlatform,
          tone: form.tone,
          campaignId: form.campaign || undefined,
          variants: 3,
        },
      });
      setVariants(result.posts);
      const first = result.posts[0];
      if (first) {
        setForm((f) => ({
          ...f,
          caption: first.caption,
          hashtags: first.hashtags.join(", "),
        }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(status: "draft" | "scheduled") {
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<BulkResult>("/api/posts", {
        method: "POST",
        json: {
          accounts: form.accounts,
          campaign: form.campaign || undefined,
          caption: form.caption,
          hashtags: form.hashtags
            .split(",")
            .map((h) => h.trim().replace(/^#/, ""))
            .filter(Boolean),
          mediaUrl: form.mediaUrl || undefined,
          prompt: form.topic || undefined,
          status,
          scheduledAt:
            status === "scheduled" && form.scheduledAt
              ? new Date(form.scheduledAt).toISOString()
              : undefined,
          generatedByAI: variants.length > 0,
        },
      });

      setOpen(false);
      setVariants([]);
      setForm(EMPTY_FORM);
      setNotice(
        <>
          <AlertTitle>
            {result.created.length} account par{" "}
            {status === "scheduled" ? "schedule thayu" : "draft banyu"}
          </AlertTitle>
          {result.created.map((entry) => entry.account).join(", ")}
          {result.skipped.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <strong>Skip thaya:</strong>{" "}
              {result.skipped
                .map((entry) => `${entry.account} (${entry.reason})`)
                .join(", ")}
            </Box>
          )}
        </>,
      );
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(id: string) {
    setBusy(id);
    setError(null);
    try {
      await apiFetch(`/api/posts/${id}/publish`, { method: "POST" });
      setNotice("Post publish thai gayo!");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Ek batch na badha pending posts ne ek saathe publish kare. */
  async function handlePublishBatch(batchId: string) {
    setBusy(batchId);
    setError(null);
    try {
      const batch = await apiFetch<Post[]>(`/api/posts?batchId=${batchId}`);
      const pending = batch.filter((p) => p.status !== "published");
      const results = await Promise.allSettled(
        pending.map((p) =>
          apiFetch(`/api/posts/${p._id}/publish`, { method: "POST" }),
        ),
      );
      const okCount = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      setNotice(`${okCount} publish thaya${failed ? `, ${failed} fail` : ""}`);
      if (failed) {
        setError(
          results
            .filter((r): r is PromiseRejectedResult => r.status === "rejected")
            .map((r) => (r.reason as Error).message)
            .join(" | "),
        );
      }
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Aa post delete karvo che?")) return;
    try {
      await apiFetch(`/api/posts/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Posts"
        subtitle="Ek caption, ghana accounts — AI thi banavo ane ek saathe publish karo"
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpen(true)}
          >
            Navo post
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          sx={{ px: 1, borderBottom: 1, borderColor: "divider" }}
        >
          {STATUS_TABS.map((status) => (
            <Tab key={status} value={status} label={status} />
          ))}
        </Tabs>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "42%" }}>Caption</TableCell>
                <TableCell>Account</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Schedule</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {posts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      Aa filter ma koi post nathi.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {posts.map((post) => (
                <TableRow key={post._id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {post.caption.slice(0, 160)}
                      {post.caption.length > 160 ? "…" : ""}
                    </Typography>
                    {post.batchId && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label="multi-account"
                        sx={{ mt: 0.5, height: 20, fontSize: 11 }}
                      />
                    )}
                    {post.error && (
                      <Typography variant="caption" color="error" display="block">
                        {post.error}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {post.platform === "facebook" ? (
                        <FacebookIcon fontSize="small" color="action" />
                      ) : (
                        <InstagramIcon fontSize="small" color="action" />
                      )}
                      <Typography variant="body2">
                        {post.account?.displayName ?? "—"}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <StatusChip status={post.status} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {post.publishedAt
                        ? new Date(post.publishedAt).toLocaleString()
                        : post.scheduledAt
                          ? new Date(post.scheduledAt).toLocaleString()
                          : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {post.permalink && (
                        <Tooltip title="Live post jovo">
                          <IconButton
                            size="small"
                            component="a"
                            href={post.permalink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {post.batchId && post.status !== "published" && (
                        <Tooltip title="Aa batch na badha accounts par publish karo">
                          <span>
                            <Button
                              size="small"
                              disabled={busy === post.batchId}
                              onClick={() => handlePublishBatch(post.batchId!)}
                            >
                              {busy === post.batchId ? (
                                <CircularProgress size={14} />
                              ) : (
                                "Batch"
                              )}
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                      {post.status !== "published" && (
                        <Tooltip title="Have j publish karo">
                          <span>
                            <IconButton
                              size="small"
                              color="primary"
                              disabled={busy === post._id}
                              onClick={() => handlePublish(post._id)}
                            >
                              {busy === post._id ? (
                                <CircularProgress size={16} />
                              ) : (
                                <SendIcon fontSize="small" />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => handleDelete(post._id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Navo post — ek ke ghana accounts par</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel id="accounts-label">Accounts (ghana select karo)</InputLabel>
              <Select
                labelId="accounts-label"
                multiple
                value={form.accounts}
                onChange={(e) =>
                  handleAccountsChange(
                    typeof e.target.value === "string"
                      ? e.target.value.split(",")
                      : e.target.value,
                  )
                }
                input={<OutlinedInput label="Accounts (ghana select karo)" />}
                renderValue={(ids) => (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {accounts
                      .filter((a) => ids.includes(a._id))
                      .map((a) => (
                        <Chip
                          key={a._id}
                          size="small"
                          label={a.displayName}
                          icon={
                            a.platform === "facebook" ? (
                              <FacebookIcon />
                            ) : (
                              <InstagramIcon />
                            )
                          }
                        />
                      ))}
                  </Stack>
                )}
              >
                {accounts.length === 0 && (
                  <MenuItem disabled>
                    Pehla Accounts page ma account connect karo
                  </MenuItem>
                )}
                {accounts.map((account) => (
                  <MenuItem key={account._id} value={account._id}>
                    <Checkbox checked={form.accounts.includes(account._id)} />
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
              label="Campaign (optional)"
              value={form.campaign}
              onChange={(e) => setForm({ ...form, campaign: e.target.value })}
              fullWidth
            >
              <MenuItem value="">— koi nahi —</MenuItem>
              {campaigns.map((campaign) => (
                <MenuItem key={campaign._id} value={campaign._id}>
                  {campaign.name}
                </MenuItem>
              ))}
            </TextField>

            {igNeedsImage && (
              <Alert severity="warning">
                Instagram account select karyu che — niche <strong>Image URL</strong>{" "}
                nakho, nahi to fakt Facebook accounts par j post jashe.
              </Alert>
            )}

            <Divider>AI thi generate karo</Divider>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Topic / idea"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="e.g. Diwali offer — 30% off on all packages"
                fullWidth
              />
              <TextField
                select
                label="Optimize for"
                value={form.aiPlatform}
                onChange={(e) =>
                  setForm({ ...form, aiPlatform: e.target.value as Platform })
                }
                sx={{ minWidth: 150 }}
                helperText="Caption style"
              >
                <MenuItem value="facebook">Facebook</MenuItem>
                <MenuItem value="instagram">Instagram</MenuItem>
              </TextField>
              <TextField
                label="Tone"
                value={form.tone}
                onChange={(e) => setForm({ ...form, tone: e.target.value })}
                sx={{ minWidth: 140 }}
              />
              <Button
                variant="outlined"
                startIcon={
                  generating ? <CircularProgress size={16} /> : <AutoAwesomeIcon />
                }
                onClick={handleGenerate}
                disabled={generating || !form.topic}
                sx={{ minWidth: 140, height: 40 }}
              >
                Generate
              </Button>
            </Stack>

            {variants.length > 1 && (
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  {variants.length} variants — click karine select karo
                </Typography>
                <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 1 }}>
                  {variants.map((variant, index) => (
                    <Card
                      key={index}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          caption: variant.caption,
                          hashtags: variant.hashtags.join(", "),
                        }))
                      }
                      sx={{
                        p: 1.5,
                        minWidth: 240,
                        cursor: "pointer",
                        borderColor:
                          form.caption === variant.caption
                            ? "primary.main"
                            : undefined,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        Variant {index + 1}
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {variant.caption.slice(0, 130)}…
                      </Typography>
                    </Card>
                  ))}
                </Stack>
              </Stack>
            )}

            <TextField
              label="Caption"
              value={form.caption}
              onChange={(e) => setForm({ ...form, caption: e.target.value })}
              multiline
              minRows={5}
              fullWidth
            />
            <TextField
              label="Hashtags (comma separated)"
              value={form.hashtags}
              onChange={(e) => setForm({ ...form, hashtags: e.target.value })}
              fullWidth
            />
            <TextField
              label="Image URL"
              value={form.mediaUrl}
              onChange={(e) => setForm({ ...form, mediaUrl: e.target.value })}
              helperText={
                hasInstagram
                  ? "Instagram mate farjiyat — public https URL (localhost nahi chale)"
                  : "Optional — image saathe post karva mate"
              }
              fullWidth
            />
            <TextField
              label="Schedule at"
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Khali rakho to fakt draft save thashe"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Box sx={{ flex: 1 }} />
          <Button
            onClick={() => handleSave("draft")}
            disabled={saving || !form.caption || form.accounts.length === 0}
          >
            Draft save karo ({form.accounts.length})
          </Button>
          <Button
            variant="contained"
            onClick={() => handleSave("scheduled")}
            disabled={
              saving ||
              !form.caption ||
              form.accounts.length === 0 ||
              !form.scheduledAt
            }
          >
            Schedule karo ({form.accounts.length})
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
