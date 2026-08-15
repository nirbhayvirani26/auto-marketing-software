"use client";

import * as React from "react";
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import PageHeader from "@/components/PageHeader";
import StatusChip from "@/components/StatusChip";
import { apiFetch } from "@/lib/client";

type Account = { _id: string; displayName: string; platform: string };
type Campaign = {
  _id: string;
  name: string;
  description?: string;
  status: string;
  keywords: string[];
  hashtags: string[];
  accounts: Account[];
  createdAt: string;
};

const EMPTY = {
  name: "",
  description: "",
  brandVoice: "friendly, professional",
  targetAudience: "",
  keywords: "",
  hashtags: "",
  callToAction: "",
  accounts: [] as string[],
  status: "draft",
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    Promise.all([
      apiFetch<Campaign[]>("/api/campaigns"),
      apiFetch<Account[]>("/api/accounts"),
    ])
      .then(([c, a]) => {
        setCampaigns(c);
        setAccounts(a);
      })
      .catch((e) => setError(e.message));
  }, []);

  React.useEffect(load, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/campaigns", {
        method: "POST",
        json: {
          ...form,
          keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
          hashtags: form.hashtags
            .split(",")
            .map((h) => h.trim().replace(/^#/, ""))
            .filter(Boolean),
        },
      });
      setOpen(false);
      setForm(EMPTY);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this campaign?")) return;
    try {
      await apiFetch(`/api/campaigns/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Campaigns"
        subtitle="A group of brand voice, keywords and accounts. The AI uses it as context for everything it writes."
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpen(true)}
          >
            New campaign
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Accounts</TableCell>
                <TableCell>Keywords</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No campaigns yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {campaigns.map((campaign) => (
                <TableRow key={campaign._id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">{campaign.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {campaign.description}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {campaign.accounts?.map((a) => a.displayName).join(", ") || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {campaign.keywords?.join(", ") || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip status={campaign.status} />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(campaign._id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Navu campaign</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Campaign name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
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
              placeholder="friendly, professional, witty…"
              fullWidth
            />
            <TextField
              label="Target audience"
              value={form.targetAudience}
              onChange={(e) =>
                setForm({ ...form, targetAudience: e.target.value })
              }
              placeholder="e.g. 25-40 age, small business owners in Gujarat"
              fullWidth
            />
            <TextField
              label="Keywords (comma separated)"
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              fullWidth
            />
            <TextField
              label="Default hashtags (comma separated)"
              value={form.hashtags}
              onChange={(e) => setForm({ ...form, hashtags: e.target.value })}
              fullWidth
            />
            <TextField
              label="Call to action"
              value={form.callToAction}
              onChange={(e) => setForm({ ...form, callToAction: e.target.value })}
              placeholder="Book yours today"
              fullWidth
            />
            <TextField
              select
              label="Accounts"
              value={form.accounts}
              onChange={(e) =>
                setForm({
                  ...form,
                  accounts:
                    typeof e.target.value === "string"
                      ? e.target.value.split(",")
                      : (e.target.value as unknown as string[]),
                })
              }
              slotProps={{ select: { multiple: true } }}
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
              label="Status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              fullWidth
            >
              {["draft", "active", "paused", "completed"].map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Save thai rahyu…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
