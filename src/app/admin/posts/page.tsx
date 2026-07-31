"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
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
import PageHeader from "@/components/PageHeader";
import StatusChip from "@/components/StatusChip";
import { apiFetch } from "@/lib/client";

type Account = { _id: string; displayName: string; platform: "facebook" | "instagram" };
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
  account?: { displayName: string };
  createdAt: string;
};

type Generated = { caption: string; hashtags: string[]; imagePrompt: string };

const STATUS_TABS = ["all", "draft", "scheduled", "published", "failed"] as const;

export default function PostsPage() {
  const [posts, setPosts] = React.useState<Post[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [tab, setTab] = React.useState<(typeof STATUS_TABS)[number]>("all");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    account: "",
    campaign: "",
    topic: "",
    tone: "friendly",
    caption: "",
    hashtags: "",
    mediaUrl: "",
    scheduledAt: "",
  });
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

  const selectedAccount = accounts.find((a) => a._id === form.account);

  async function handleGenerate() {
    if (!selectedAccount) {
      setError("Pehla account select karo");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const result = await apiFetch<{ posts: Generated[] }>("/api/ai/generate", {
        method: "POST",
        json: {
          topic: form.topic,
          platform: selectedAccount.platform,
          tone: form.tone,
          campaignId: form.campaign || undefined,
          variants: 3,
        },
      });
      setVariants(result.posts);
      // Pehlo variant sidho form ma bhari do.
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
      await apiFetch("/api/posts", {
        method: "POST",
        json: {
          account: form.account,
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
      setForm({
        account: "",
        campaign: "",
        topic: "",
        tone: "friendly",
        caption: "",
        hashtags: "",
        mediaUrl: "",
        scheduledAt: "",
      });
      setNotice(status === "scheduled" ? "Post schedule thai gayo" : "Draft save thayo");
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
        subtitle="AI thi caption banavo, schedule karo ke sidhu publish karo"
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
                <TableCell sx={{ width: "45%" }}>Caption</TableCell>
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
                    {post.error && (
                      <Typography variant="caption" color="error">
                        {post.error}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {post.account?.displayName ?? "—"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {post.platform}
                    </Typography>
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
        <DialogTitle>Navo post banavo</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                select
                label="Account"
                value={form.account}
                onChange={(e) => setForm({ ...form, account: e.target.value })}
                fullWidth
              >
                {accounts.map((account) => (
                  <MenuItem key={account._id} value={account._id}>
                    {account.displayName} ({account.platform})
                  </MenuItem>
                ))}
              </TextField>
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
            </Stack>

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
                label="Tone"
                value={form.tone}
                onChange={(e) => setForm({ ...form, tone: e.target.value })}
                sx={{ minWidth: 160 }}
              />
              <Button
                variant="outlined"
                startIcon={
                  generating ? <CircularProgress size={16} /> : <AutoAwesomeIcon />
                }
                onClick={handleGenerate}
                disabled={generating || !form.topic || !form.account}
                sx={{ minWidth: 150 }}
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
                selectedAccount?.platform === "instagram"
                  ? "Instagram mate farjiyat — public https URL hovu joiye (localhost nahi chale)"
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
            disabled={saving || !form.caption || !form.account}
          >
            Draft save karo
          </Button>
          <Button
            variant="contained"
            onClick={() => handleSave("scheduled")}
            disabled={saving || !form.caption || !form.account || !form.scheduledAt}
          >
            Schedule karo
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
