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
  FormControlLabel,
  IconButton,
  Stack,
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
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import ScienceIcon from "@mui/icons-material/ScienceOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import PageHeader from "@/components/PageHeader";
import { apiFetch } from "@/lib/client";

type Token = {
  _id: string;
  name: string;
  tokenSuffix: string;
  scopes: string[];
  lastUsedAt?: string;
  useCount: number;
  createdAt: string;
};

type ToolResult = {
  tool: string;
  description: string;
  ok: boolean;
  ms: number;
  sample?: unknown;
  error?: string;
};

type SelfTest = {
  provider: string;
  model: string;
  free: boolean;
  total: number;
  passed: number;
  failed: number;
  totalMs: number;
  results: ToolResult[];
};

function Code({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="pre"
      sx={{
        p: 2,
        borderRadius: 2,
        overflowX: "auto",
        fontSize: 12.5,
        bgcolor: (theme) => (theme.palette.mode === "dark" ? "#0B0D12" : "#F1F3F8"),
        border: 1,
        borderColor: "divider",
        m: 0,
      }}
    >
      <code>{children}</code>
    </Box>
  );
}

export default function IntegrationsPage() {
  const [tokens, setTokens] = React.useState<Token[]>([]);
  const [scopes, setScopes] = React.useState<string[]>([]);
  const [tokensLocked, setTokensLocked] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", scopes: [] as string[] });
  const [saving, setSaving] = React.useState(false);
  const [newToken, setNewToken] = React.useState<string | null>(null);

  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<SelfTest | null>(null);

  const load = React.useCallback(() => {
    apiFetch<{ tokens: Token[]; availableScopes: string[] }>("/api/tokens")
      .then((data) => {
        setTokens(data.tokens);
        setScopes(data.availableScopes);
        setForm((f) => ({ ...f, scopes: data.availableScopes }));
        setTokensLocked(null);
      })
      .catch((e) => setTokensLocked(e.message));
  }, []);

  React.useEffect(load, [load]);

  async function createToken() {
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<{ token: string }>("/api/tokens", {
        method: "POST",
        json: form,
      });
      setNewToken(result.token);
      setOpen(false);
      setForm({ name: "", scopes });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Any service using it will stop working.")) return;
    try {
      await apiFetch(`/api/tokens?id=${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runSelfTest() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await apiFetch<SelfTest>("/api/ai/selftest", {
        method: "POST",
      });
      setTestResult(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  const base =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Integrations & API"
        subtitle="Connect n8n, issue API tokens, and check that every AI service really works."
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {/* ---------- AI tools test ---------- */}
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6">AI tools test</Typography>
              <Typography variant="body2" color="text.secondary">
                Runs every AI service for real and reports what works
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={testing ? <CircularProgress size={16} /> : <ScienceIcon />}
              onClick={runSelfTest}
              disabled={testing}
            >
              {testing ? "Running tests…" : "Test every AI service"}
            </Button>
          </Stack>

          {testResult && (
            <>
              <Divider sx={{ my: 2 }} />
              <Alert
                severity={testResult.failed === 0 ? "success" : "error"}
                sx={{ mb: 2 }}
              >
                <AlertTitle>
                  {testResult.passed}/{testResult.total} pass ·{" "}
                  {testResult.provider} ({testResult.model})
                  {testResult.free ? " · FREE" : ""} ·{" "}
                  {(testResult.totalMs / 1000).toFixed(1)}s
                </AlertTitle>
                {testResult.failed > 0 && "See the details below."}
              </Alert>

              <Stack spacing={1.5}>
                {testResult.results.map((result) => (
                  <Card key={result.tool} variant="outlined">
                    <CardContent sx={{ py: 1.5 }}>
                      <Stack direction="row" spacing={1.5} alignItems="flex-start">
                        {result.ok ? (
                          <CheckCircleIcon color="success" fontSize="small" />
                        ) : (
                          <CancelIcon color="error" fontSize="small" />
                        )}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="subtitle2">{result.tool}</Typography>
                            <Chip size="small" label={`${result.ms}ms`} />
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {result.description}
                          </Typography>
                          {result.error && (
                            <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                              {result.error}
                            </Typography>
                          )}
                          {result.sample != null && (
                            <Box sx={{ mt: 1 }}>
                              <Code>{JSON.stringify(result.sample, null, 2)}</Code>
                            </Box>
                          )}
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- API tokens ---------- */}
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6">API tokens</Typography>
              <Typography variant="body2" color="text.secondary">
                For connecting n8n, or any other service, to this app
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setOpen(true)}
              disabled={Boolean(tokensLocked)}
            >
              Navo token
            </Button>
          </Stack>

          {tokensLocked && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {tokensLocked}
            </Alert>
          )}

          {newToken && (
            <Alert severity="success" sx={{ mt: 2 }} onClose={() => setNewToken(null)}>
              <AlertTitle>Token created — this is the only time it is shown</AlertTitle>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box
                  component="code"
                  sx={{ fontSize: 13, wordBreak: "break-all", flex: 1 }}
                >
                  {newToken}
                </Box>
                <Tooltip title="Copy">
                  <IconButton
                    size="small"
                    onClick={() => {
                      navigator.clipboard.writeText(newToken);
                      setNotice("Token copy thayo");
                    }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Alert>
          )}

          {!tokensLocked && (
            <TableContainer sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Token</TableCell>
                    <TableCell>Scopes</TableCell>
                    <TableCell>Used</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tokens.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                        <Typography variant="body2" color="text.secondary">
                          No tokens yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {tokens.map((token) => (
                    <TableRow key={token._id} hover>
                      <TableCell>{token.name}</TableCell>
                      <TableCell>
                        <code>amk_…{token.tokenSuffix}</code>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {token.scopes.join(", ")}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">
                          {token.useCount}×
                          {token.lastUsedAt &&
                            ` · ${new Date(token.lastUsedAt).toLocaleDateString()}`}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => revoke(token._id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* ---------- n8n setup ---------- */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            n8n setup
          </Typography>
          <Divider sx={{ mb: 2 }} />

          <Typography variant="subtitle2" gutterBottom>
            1. Import the ready-made workflows
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            The <code>n8n/</code> folder holds three workflows. In n8n, choose{" "}
            <strong>Import from File</strong>:
          </Typography>
          <Stack spacing={0.5} sx={{ mb: 3 }}>
            <Typography variant="body2">
              • <code>1-scheduler.json</code> — publishes due posts every minute
            </Typography>
            <Typography variant="body2">
              • <code>2-daily-ai-post.json</code> — writes a daily AI post and sends it to Facebook and Instagram
            </Typography>
            <Typography variant="body2">
              • <code>3-comment-to-dm.json</code> — answers new comments with AI and sends a DM
            </Typography>
          </Stack>

          <Typography variant="subtitle2" gutterBottom>
            2. Add these credentials in n8n
          </Typography>
          <Code>{`AM_BASE_URL = ${base}
AM_TOKEN    = amk_...   (create one above)`}</Code>

          <Typography variant="subtitle2" sx={{ mt: 3 }} gutterBottom>
            3. Endpoints
          </Typography>
          <Code>{`# Write a post with AI and publish it to Facebook and Instagram
POST ${base}/api/v1/posts
Authorization: Bearer amk_...
{
  "topic": "Diwali sale 30% off",
  "imageUrl": "https://.../banner.jpg",
  "publish": true
}

# Write a caption only, without saving it
POST ${base}/api/v1/generate
{ "topic": "...", "platform": "instagram", "variants": 3 }

# Write an AI reply to a comment
PUT ${base}/api/v1/generate
{ "comment": "price?", "platform": "instagram" }

# List the connected accounts
GET ${base}/api/v1/accounts

# Publish a draft or a whole batch
POST ${base}/api/v1/publish
{ "batchId": "..." }

# Automation chalavo
PUT ${base}/api/v1/publish
{ "automationName": "Daily Tip" }`}</Code>
        </CardContent>
      </Card>

      {/* ---------- Navo token dialog ---------- */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Navo API token</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Token name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. n8n production"
              fullWidth
              autoFocus
            />
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Scopes
              </Typography>
              {scopes.map((scope) => (
                <FormControlLabel
                  key={scope}
                  sx={{ display: "block" }}
                  control={
                    <Checkbox
                      checked={form.scopes.includes(scope)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          scopes: e.target.checked
                            ? [...form.scopes, scope]
                            : form.scopes.filter((s) => s !== scope),
                        })
                      }
                    />
                  }
                  label={<code>{scope}</code>}
                />
              ))}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={createToken}
            disabled={saving || !form.name || form.scopes.length === 0}
          >
            {saving ? "Creating…" : "Create token"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
