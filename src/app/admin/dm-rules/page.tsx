"use client";

import * as React from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
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
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
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
  IconButton,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import ScienceIcon from "@mui/icons-material/ScienceOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import FacebookIcon from "@mui/icons-material/Facebook";
import InstagramIcon from "@mui/icons-material/Instagram";
import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";

type Account = { _id: string; displayName: string; platform: string };
type Rule = {
  _id: string;
  name: string;
  keywords: string[];
  matchType: string;
  publicReply: boolean;
  publicReplyText?: string;
  sendDm: boolean;
  dmText?: string;
  dmLinkUrl?: string;
  useAi: boolean;
  enabled: boolean;
  onlyOncePerUser: boolean;
  triggerCount: number;
  lastTriggeredAt?: string;
  lastError?: string;
  accounts: Account[];
};
type CommentEvent = {
  _id: string;
  platform: string;
  fromUsername?: string;
  commentText?: string;
  publicReplied: boolean;
  dmSent: boolean;
  error?: string;
  createdAt: string;
  account?: { displayName: string };
};

const EMPTY = {
  name: "",
  accounts: [] as string[],
  keywords: "",
  matchType: "any",
  caseSensitive: false,
  publicReply: true,
  publicReplyText: "",
  sendDm: true,
  dmText: "",
  dmLinkUrl: "",
  dmLinkTitle: "",
  useAi: false,
  aiInstruction: "",
  onlyOncePerUser: true,
  enabled: true,
};

export default function DmRulesPage() {
  const [rules, setRules] = React.useState<Rule[]>([]);
  const [events, setEvents] = React.useState<CommentEvent[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [testRule, setTestRule] = React.useState<Rule | null>(null);
  const [testComment, setTestComment] = React.useState("");
  const [testResult, setTestResult] = React.useState<null | {
    matched: boolean;
    wouldPublicReply: boolean;
    wouldSendDm: boolean;
    publicReplyText?: string;
    dmText?: string;
    usesAi: boolean;
  }>(null);
  const [testing, setTesting] = React.useState(false);

  const load = React.useCallback(() => {
    Promise.all([
      apiFetch<{ rules: Rule[]; recentEvents: CommentEvent[] }>(
        "/api/comment-rules",
      ),
      apiFetch<Account[]>("/api/accounts"),
    ])
      .then(([data, accs]) => {
        setRules(data.rules);
        setEvents(data.recentEvents);
        setAccounts(accs);
      })
      .catch((e) => setError(e.message));
  }, []);

  React.useEffect(load, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/comment-rules", {
        method: "POST",
        json: {
          ...form,
          keywords: form.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        },
      });
      setOpen(false);
      setForm(EMPTY);
      setNotice("Rule banyu");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule: Rule) {
    try {
      await apiFetch(`/api/comment-rules/${rule._id}`, {
        method: "PATCH",
        json: { enabled: !rule.enabled },
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this rule?")) return;
    try {
      await apiFetch(`/api/comment-rules/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleTest() {
    if (!testRule) return;
    setTesting(true);
    try {
      const result = await apiFetch<typeof testResult>(
        `/api/comment-rules/${testRule._id}`,
        { method: "POST", json: { comment: testComment } },
      );
      setTestResult(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Auto DM & Replies"
        subtitle="When someone comments on your post, reply publicly and send them a direct message."
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpen(true)}
          >
            Navu rule
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
        <AlertTitle>This needs a Meta webhook</AlertTitle>
        Meta has to send comment updates to this app. The Settings page has the
        full setup guide. <strong>Meta requires a public https URL</strong> —
        localhost will not work, so use a tunnel such as ngrok while testing.
        <br />
        <strong>Platform limit:</strong> a direct message may be sent only once
        per comment, and only within seven days of that comment.
      </Alert>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Rule</TableCell>
                <TableCell>Keywords</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Triggers</TableCell>
                <TableCell>On</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No rules yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rules.map((rule) => (
                <TableRow key={rule._id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">{rule.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {rule.accounts?.length
                        ? rule.accounts.map((a) => a.displayName).join(", ")
                        : "badha accounts"}
                    </Typography>
                    {rule.lastError && (
                      <Typography variant="caption" color="error" display="block">
                        {rule.lastError}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {rule.keywords?.length ? (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {rule.keywords.slice(0, 4).map((keyword) => (
                          <Chip key={keyword} size="small" label={keyword} />
                        ))}
                        {rule.keywords.length > 4 && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`+${rule.keywords.length - 4}`}
                          />
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        dareak comment
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {rule.publicReply && (
                        <Chip size="small" label="reply" color="info" />
                      )}
                      {rule.sendDm && (
                        <Chip size="small" label="DM" color="secondary" />
                      )}
                      {rule.useAi && (
                        <Chip
                          size="small"
                          icon={<AutoAwesomeIcon />}
                          label="AI"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{rule.triggerCount ?? 0}</Typography>
                    {rule.lastTriggeredAt && (
                      <Typography variant="caption" color="text.secondary">
                        {new Date(rule.lastTriggeredAt).toLocaleDateString()}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={rule.enabled}
                      onChange={() => handleToggle(rule)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title="Test this rule">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setTestRule(rule);
                            setTestComment("");
                            setTestResult(null);
                          }}
                        >
                          <ScienceIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" onClick={() => handleDelete(rule._id)}>
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

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Recent comments
          </Typography>
          <Divider sx={{ mb: 1 }} />
          {events.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No comments have come in yet. They appear here once the Meta
              webhook is set up.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>From</TableCell>
                    <TableCell>Comment</TableCell>
                    <TableCell>Reply</TableCell>
                    <TableCell>DM</TableCell>
                    <TableCell>Time</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event._id}>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          {event.platform === "facebook" ? (
                            <FacebookIcon fontSize="small" color="action" />
                          ) : (
                            <InstagramIcon fontSize="small" color="action" />
                          )}
                          <Typography variant="caption">
                            {event.fromUsername ?? "—"}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">
                          {event.commentText?.slice(0, 80)}
                        </Typography>
                      </TableCell>
                      <TableCell>{event.publicReplied ? "✓" : "—"}</TableCell>
                      <TableCell>{event.dmSent ? "✓" : "—"}</TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(event.createdAt).toLocaleString()}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* ---- Navu rule ---- */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Navu auto-reply rule</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Rule name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. DM anyone who asks about price"
              fullWidth
            />

            <FormControl fullWidth>
              <InputLabel id="acc-label">Accounts (khali = badha)</InputLabel>
              <Select
                labelId="acc-label"
                multiple
                value={form.accounts}
                onChange={(e) =>
                  setForm({
                    ...form,
                    accounts:
                      typeof e.target.value === "string"
                        ? e.target.value.split(",")
                        : e.target.value,
                  })
                }
                input={<OutlinedInput label="Accounts (khali = badha)" />}
                renderValue={(ids) =>
                  accounts
                    .filter((a) => ids.includes(a._id))
                    .map((a) => a.displayName)
                    .join(", ")
                }
              >
                {accounts.map((account) => (
                  <MenuItem key={account._id} value={account._id}>
                    <Checkbox checked={form.accounts.includes(account._id)} />
                    <ListItemText
                      primary={account.displayName}
                      secondary={account.platform}
                    />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Keywords (comma separated)"
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              placeholder="price, cost, kitla, how much"
              helperText="Khali rakho to DAREAK comment par trigger thashe"
              fullWidth
            />

            <TextField
              select
              label="Match type"
              value={form.matchType}
              onChange={(e) => setForm({ ...form, matchType: e.target.value })}
              fullWidth
            >
              <MenuItem value="any">Any one keyword matches</MenuItem>
              <MenuItem value="all">All keywords must match</MenuItem>
              <MenuItem value="exact">The comment matches exactly</MenuItem>
            </TextField>

            <Divider>Su karvu</Divider>

            <FormControlLabel
              control={
                <Switch
                  checked={form.useAi}
                  onChange={(e) => setForm({ ...form, useAi: e.target.checked })}
                />
              }
              label="Write the reply with AI instead of using fixed text"
            />

            {form.useAi && (
              <TextField
                label="AI instruction"
                value={form.aiInstruction}
                onChange={(e) =>
                  setForm({ ...form, aiInstruction: e.target.value })
                }
                placeholder="If they ask about price, say the details are in their DMs and point them to the website"
                multiline
                minRows={2}
                fullWidth
              />
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={form.publicReply}
                  onChange={(e) =>
                    setForm({ ...form, publicReply: e.target.checked })
                  }
                />
              }
              label="Reply publicly under the comment"
            />
            {form.publicReply && !form.useAi && (
              <TextField
                label="Public reply text"
                value={form.publicReplyText}
                onChange={(e) =>
                  setForm({ ...form, publicReplyText: e.target.value })
                }
                placeholder="Thanks! We have sent the details to your inbox."
                multiline
                minRows={2}
                fullWidth
              />
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={form.sendDm}
                  onChange={(e) => setForm({ ...form, sendDm: e.target.checked })}
                />
              }
              label="Private DM moklo"
            />
            {form.sendDm && !form.useAi && (
              <TextField
                label="DM text"
                value={form.dmText}
                onChange={(e) => setForm({ ...form, dmText: e.target.value })}
                placeholder="Hi! Thanks for asking. Here is our price list…"
                multiline
                minRows={3}
                fullWidth
              />
            )}
            {form.sendDm && (
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Link to include in the DM (optional)"
                  value={form.dmLinkUrl}
                  onChange={(e) =>
                    setForm({ ...form, dmLinkUrl: e.target.value })
                  }
                  placeholder="https://…"
                  fullWidth
                />
                <TextField
                  label="Link title"
                  value={form.dmLinkTitle}
                  onChange={(e) =>
                    setForm({ ...form, dmLinkTitle: e.target.value })
                  }
                  placeholder="Price list"
                  sx={{ minWidth: 150 }}
                />
              </Stack>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={form.onlyOncePerUser}
                  onChange={(e) =>
                    setForm({ ...form, onlyOncePerUser: e.target.checked })
                  }
                />
              }
              label="Message each person only once"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !form.name}
          >
            {saving ? "Saving…" : "Create rule"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Rule test ---- */}
      <Dialog
        open={Boolean(testRule)}
        onClose={() => setTestRule(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Test rule — {testRule?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Type a comment and see whether this rule would trigger. Nothing is
            sent to Meta — only the matching is checked.
          </Typography>
          <TextField
            label="Comment text"
            value={testComment}
            onChange={(e) => setTestComment(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            autoFocus
          />
          {testResult && (
            <Alert
              severity={testResult.matched ? "success" : "warning"}
              sx={{ mt: 2 }}
            >
              <AlertTitle>
                {testResult.matched ? "This comment matches" : "No match"}
              </AlertTitle>
              {testResult.matched && (
                <Box>
                  {testResult.wouldPublicReply && (
                    <Typography variant="body2">
                      <strong>Public reply:</strong>{" "}
                      {testResult.usesAi
                        ? "(written by AI)"
                        : testResult.publicReplyText || "(no text set)"}
                    </Typography>
                  )}
                  {testResult.wouldSendDm && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      <strong>DM:</strong>{" "}
                      {testResult.usesAi
                        ? "(written by AI)"
                        : testResult.dmText || "(no text set)"}
                    </Typography>
                  )}
                </Box>
              )}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setTestRule(null)}>Close</Button>
          <Button
            variant="contained"
            onClick={handleTest}
            disabled={testing || !testComment}
            startIcon={testing ? <CircularProgress size={16} /> : <ScienceIcon />}
          >
            Run test
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
