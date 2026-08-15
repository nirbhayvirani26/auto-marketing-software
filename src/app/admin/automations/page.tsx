"use client";

import * as React from "react";
import {
  Alert,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlayArrowIcon from "@mui/icons-material/PlayArrowOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";

type Account = { _id: string; displayName: string; platform: string };
type Campaign = { _id: string; name: string };
type Automation = {
  _id: string;
  name: string;
  topic: string;
  frequency: string;
  timeOfDay: string;
  dayOfWeek: number;
  autoPublish: boolean;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  lastError?: string;
  campaign?: { name: string };
  accounts: Account[];
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const EMPTY = {
  name: "",
  topic: "",
  tone: "friendly",
  campaign: "",
  accounts: [] as string[],
  frequency: "daily",
  timeOfDay: "09:30",
  dayOfWeek: 1,
  autoPublish: false,
  enabled: true,

  // Reel mode
  mode: "post",
  reelSource: "library",
  reelProductCount: 1,
  reelDuration: 40,
  reelLanguage: "en",
  reelAvatar: "",
  reelVoiceover: false,
};

export default function AutomationsPage() {
  const [automations, setAutomations] = React.useState<Automation[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [avatars, setAvatars] = React.useState<Array<{ _id: string; name: string }>>([]);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    Promise.all([
      apiFetch<Automation[]>("/api/automations"),
      apiFetch<Account[]>("/api/accounts"),
      apiFetch<Campaign[]>("/api/campaigns"),
      apiFetch<Array<{ _id: string; name: string }>>("/api/avatars").catch(() => []),
    ])
      .then(([auto, acc, camp, avs]) => {
        setAutomations(auto);
        setAccounts(acc);
        setCampaigns(camp);
        setAvatars(avs);
      })
      .catch((e) => setError(e.message));
  }, []);

  React.useEffect(load, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/automations", {
        method: "POST",
        json: { ...form, campaign: form.campaign || undefined },
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

  async function handleToggle(automation: Automation) {
    try {
      await apiFetch(`/api/automations/${automation._id}`, {
        method: "PATCH",
        json: { enabled: !automation.enabled },
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleRun(id: string) {
    setBusy(id);
    setError(null);
    try {
      const result = await apiFetch<{
        created: number;
        published: number;
        errors: string[];
      }>(`/api/automations/${id}/run`, { method: "POST" });
      setNotice(
        `${result.created} post banya, ${result.published} publish thaya${
          result.errors.length ? ` · ${result.errors.length} error` : ""
        }`,
      );
      if (result.errors.length) setError(result.errors.join(" | "));
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this automation?")) return;
    try {
      await apiFetch(`/api/automations/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Automations"
        subtitle="Generate posts with AI on a schedule and, if you want, publish them straight away."
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpen(true)}
          >
            New automation
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Alert severity="info">
        Automations only run while <code>/api/cron/dispatch</code> is called every
        minute — from an n8n Schedule Trigger (recommended) or from Windows Task
        Scheduler. The Settings page has the details.
      </Alert>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Schedule</TableCell>
                <TableCell>Accounts</TableCell>
                <TableCell>Auto-publish</TableCell>
                <TableCell>Next run</TableCell>
                <TableCell>Enabled</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {automations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No automations yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {automations.map((automation) => (
                <TableRow key={automation._id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">{automation.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {automation.topic}
                    </Typography>
                    {automation.lastError && (
                      <Typography variant="caption" color="error" display="block">
                        {automation.lastError}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{automation.frequency}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {automation.frequency === "weekly"
                        ? `${DAYS[automation.dayOfWeek]} ${automation.timeOfDay}`
                        : automation.timeOfDay}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {automation.accounts?.map((a) => a.displayName).join(", ") ||
                        automation.campaign?.name ||
                        "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {automation.autoPublish ? "Ha" : "Na (draft)"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {automation.nextRunAt
                        ? new Date(automation.nextRunAt).toLocaleString()
                        : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={automation.enabled}
                      onChange={() => handleToggle(automation)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title="Run now">
                        <span>
                          <IconButton
                            size="small"
                            color="primary"
                            disabled={busy === automation._id}
                            onClick={() => handleRun(automation._id)}
                          >
                            {busy === automation._id ? (
                              <CircularProgress size={16} />
                            ) : (
                              <PlayArrowIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(automation._id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Navu automation</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Su banavvu"
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value })}
              fullWidth
            >
              <MenuItem value="post">Post — AI caption (+ image)</MenuItem>
              <MenuItem value="reel">
                Reel — build a complete reel and publish it automatically
              </MenuItem>
            </TextField>

            {form.mode === "reel" && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                <Typography variant="caption">
                  Each run takes the next product photo from your Reel Studio
                  library <strong>in turn</strong> and builds a complete reel —
                  script, music, caption and hashtags — then publishes it to both
                  Instagram and Facebook. Nothing for you to do.
                </Typography>
              </Alert>
            )}

            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
            />
            <TextField
              label={form.mode === "reel" ? "Notes about the product (optional)" : "Topic or theme"}
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              placeholder={
                form.mode === "reel"
                  ? "handblock cotton, free shipping over ₹999"
                  : "Daily tip about home fitness"
              }
              helperText={
                form.mode === "reel"
                  ? "The AI works everything out from the image; this is extra context only"
                  : "Aa AI ne dareak run par apashe"
              }
              multiline
              minRows={2}
              fullWidth
            />

            {form.mode === "reel" && (
              <>
                <Stack direction="row" spacing={2}>
                  <TextField
                    select
                    label="Products per reel"
                    value={form.reelProductCount}
                    onChange={(e) =>
                      setForm({ ...form, reelProductCount: Number(e.target.value) })
                    }
                    fullWidth
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <MenuItem key={n} value={n}>
                        {n === 1 ? "1 (single product)" : `${n} (collection reel)`}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="Lambai"
                    value={form.reelDuration}
                    onChange={(e) =>
                      setForm({ ...form, reelDuration: Number(e.target.value) })
                    }
                    fullWidth
                  >
                    {[20, 30, 40, 50, 60, 75, 90].map((n) => (
                      <MenuItem key={n} value={n}>
                        {n} second
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>

                <Stack direction="row" spacing={2}>
                  <TextField
                    select
                    label="Bhasha"
                    value={form.reelLanguage}
                    onChange={(e) => setForm({ ...form, reelLanguage: e.target.value })}
                    fullWidth
                  >
                    <MenuItem value="en">English</MenuItem>
                    <MenuItem value="hinglish">Hinglish</MenuItem>
                    <MenuItem value="hi">हिन्दी</MenuItem>
                    <MenuItem value="gu">ગુજરાતી</MenuItem>
                  </TextField>
                  <TextField
                    select
                    label="Avatar"
                    value={form.reelAvatar}
                    onChange={(e) => setForm({ ...form, reelAvatar: e.target.value })}
                    fullWidth
                  >
                    <MenuItem value="">Avatar vagar</MenuItem>
                    {avatars.map((avatar) => (
                      <MenuItem key={avatar._id} value={avatar._id}>
                        {avatar.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>

                <FormControlLabel
                  control={
                    <Switch
                      checked={form.reelVoiceover}
                      onChange={(e) =>
                        setForm({ ...form, reelVoiceover: e.target.checked })
                      }
                    />
                  }
                  label="Voiceover naakho"
                />
              </>
            )}
            <TextField
              label="Tone"
              value={form.tone}
              onChange={(e) => setForm({ ...form, tone: e.target.value })}
              fullWidth
            />
            <TextField
              select
              label="Campaign (optional)"
              value={form.campaign}
              onChange={(e) => setForm({ ...form, campaign: e.target.value })}
              helperText="The campaign's brand voice and keywords are passed to the AI"
              fullWidth
            >
              <MenuItem value="">— none —</MenuItem>
              {campaigns.map((campaign) => (
                <MenuItem key={campaign._id} value={campaign._id}>
                  {campaign.name}
                </MenuItem>
              ))}
            </TextField>
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
              helperText="Khali rakho to campaign na accounts vaparashe"
              fullWidth
            >
              {accounts.map((account) => (
                <MenuItem key={account._id} value={account._id}>
                  {account.displayName} ({account.platform})
                </MenuItem>
              ))}
            </TextField>

            <Stack direction="row" spacing={2}>
              <TextField
                select
                label="Frequency"
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                fullWidth
              >
                <MenuItem value="hourly">Hourly</MenuItem>
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
              </TextField>
              <TextField
                label="Time"
                type="time"
                value={form.timeOfDay}
                onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Stack>

            {form.frequency === "weekly" && (
              <TextField
                select
                label="Day of week"
                value={form.dayOfWeek}
                onChange={(e) =>
                  setForm({ ...form, dayOfWeek: Number(e.target.value) })
                }
                fullWidth
              >
                {DAYS.map((day, index) => (
                  <MenuItem key={day} value={index}>
                    {day}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={form.autoPublish}
                  onChange={(e) =>
                    setForm({ ...form, autoPublish: e.target.checked })
                  }
                />
              }
              label="Publish automatically (leave off to create drafts only)"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !form.name || !form.topic}
          >
            {saving ? "Save thai rahyu…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
