"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Link as MuiLink,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import RefreshIcon from "@mui/icons-material/RefreshOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PageHeader from "@/components/PageHeader";
import StudioReadiness from "@/components/StudioReadiness";
import { apiFetch } from "@/lib/client";

type Check = { ok: boolean; label: string; hint?: string; optional?: boolean };

type Health = Record<string, Check> & {
  detail: {
    aiProviders: Array<{
      key: string;
      label: string;
      free: boolean;
      model: string;
      configured: boolean;
      active: boolean;
    }>;
    ollama: { up: boolean; models: string[]; error?: string };
    imageProviders: Array<{
      key: string;
      label: string;
      free: boolean;
      configured: boolean;
      note: string;
    }>;
    accounts: { facebook: number; instagram: number };
    appUrl: string;
    webhookVerifyTokenSet: boolean;
  };
};

function Code({ children }: { children: React.ReactNode }) {
  const text = String(children);
  return (
    <Box sx={{ position: "relative" }}>
      <Box
        component="pre"
        sx={{
          p: 2,
          pr: 6,
          borderRadius: 2,
          overflowX: "auto",
          fontSize: 13,
          bgcolor: (theme) => (theme.palette.mode === "dark" ? "#0B0D12" : "#F1F3F8"),
          border: 1,
          borderColor: "divider",
          m: 0,
        }}
      >
        <code>{text}</code>
      </Box>
      <Tooltip title="Copy">
        <IconButton
          size="small"
          sx={{ position: "absolute", top: 8, right: 8 }}
          onClick={() => navigator.clipboard.writeText(text)}
        >
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function Status({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircleIcon color="success" />
  ) : (
    <RadioButtonUncheckedIcon color="disabled" />
  );
}

export default function SetupPage() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    apiFetch<Health>("/api/health")
      .then(setHealth)
      .catch((e) => setError(e.message));
  }, []);

  React.useEffect(load, [load]);

  if (error) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Setup" />
        <Alert severity="error">{error}</Alert>
      </Stack>
    );
  }

  if (!health) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const d = health.detail;
  const activeStep = !health.ai.ok
    ? 0
    : !health.metaApp.ok
      ? 1
      : !health.facebook.ok
        ? 2
        : 3;

  const done = [health.database, health.ai, health.metaApp, health.facebook].filter(
    (c) => c.ok,
  ).length;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Setup"
        subtitle="Instagram ane Facebook automation chalu karva mate na steps"
        action={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>
            Check again
          </Button>
        }
      />

      <Alert severity={done === 4 ? "success" : "info"}>
        <AlertTitle>{done}/4 step puri thai</AlertTitle>
        {done === 4
          ? "Everything is ready — open the Reel Studio, add a product photo and build a reel."
          : "Work through the steps below. Press 'Check again' after each one."}
      </Alert>

      <StudioReadiness />

      <Card>
        <CardContent>
          <Stepper activeStep={activeStep} orientation="vertical">
            {/* ---------------- STEP 1 ---------------- */}
            <Step expanded>
              <StepLabel icon={<Status ok={health.ai.ok} />}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Turn on AI — free
                </Typography>
              </StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  The AI writes your captions. The simplest free option is Google
                  Gemini, and it needs no credit card.
                </Typography>

                <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
                  {d.aiProviders.map((provider) => (
                    <Chip
                      key={provider.key}
                      size="small"
                      color={provider.configured ? "success" : "default"}
                      variant={provider.configured ? "filled" : "outlined"}
                      label={`${provider.label}${provider.active ? " · active" : ""}`}
                    />
                  ))}
                </Stack>

                <Typography variant="subtitle2" gutterBottom>
                  Option A — Google Gemini (free, two minutes)
                </Typography>
                <Stack spacing={1} sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    1.{" "}
                    <MuiLink
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                    >
                      aistudio.google.com/apikey <OpenInNewIcon sx={{ fontSize: 13 }} />
                    </MuiLink>{" "}
                    and sign in with your Google account
                  </Typography>
                  <Typography variant="body2">
                    2. Press <strong>Create API key</strong> and copy it
                  </Typography>
                  <Typography variant="body2">
                    3. Put it in the project's <code>.env</code> file:
                  </Typography>
                </Stack>
                <Code>{`GEMINI_API_KEY=AIza...your-key...
AI_PROVIDER=gemini`}</Code>

                <Typography variant="subtitle2" sx={{ mt: 2 }} gutterBottom>
                  Option B — Ollama (entirely free, and works offline)
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Status:{" "}
                  {d.ollama.up ? (
                    <Chip
                      size="small"
                      color="success"
                      label={`running — ${d.ollama.models.length} models`}
                    />
                  ) : (
                    <Chip size="small" label="not running" />
                  )}
                </Typography>
                <Code>{`# 1. Install it from ollama.com
# 2. In a terminal:
ollama pull llama3.2
# 3. In .env:
OLLAMA_MODEL=llama3.2
AI_PROVIDER=ollama`}</Code>

                <Alert severity="warning" sx={{ mt: 2 }}>
                  After changing <code>.env</code> you must{" "}
                  <strong>restart the dev server</strong> (Ctrl+C, then{" "}
                  <code>npm run dev</code>).
                </Alert>
              </StepContent>
            </Step>

            {/* ---------------- STEP 2 ---------------- */}
            <Step expanded>
              <StepLabel icon={<Status ok={health.metaApp.ok} />}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Create a Meta app (required for Instagram and Facebook)
                </Typography>
              </StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Posting to Facebook and Instagram requires a Meta developer app.
                  There is no way around it.
                </Typography>

                <Stack spacing={1.25} sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    1.{" "}
                    <MuiLink
                      href="https://developers.facebook.com/apps"
                      target="_blank"
                      rel="noreferrer"
                    >
                      developers.facebook.com/apps{" "}
                      <OpenInNewIcon sx={{ fontSize: 13 }} />
                    </MuiLink>{" "}
                    → <strong>Create App</strong> → type: <strong>Business</strong>
                  </Typography>
                  <Typography variant="body2">
                    2. Add the <strong>Facebook Login</strong> product to the app
                  </Typography>
                  <Typography variant="body2">
                    3. Facebook Login → Settings → <strong>Valid OAuth Redirect URIs</strong>{" "}
                    add this <em>exact</em> URL:
                  </Typography>
                </Stack>
                <Code>{`${d.appUrl}/api/oauth/meta/callback`}</Code>

                <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>
                  4. Take the App ID and App Secret from Settings → Basic and put
                  them in <code>.env</code>:
                </Typography>
                <Code>{`META_APP_ID=your-app-id
META_APP_SECRET=your-app-secret`}</Code>

                <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>
                  5. Request these under App Review → Permissions. In Development
                  mode you can test them yourself:
                </Typography>
                <Code>{`pages_show_list
pages_manage_posts
pages_read_engagement
business_management
instagram_basic
instagram_content_publish
instagram_manage_messages   (for auto-DM)`}</Code>
              </StepContent>
            </Step>

            {/* ---------------- STEP 3 ---------------- */}
            <Step expanded>
              <StepLabel icon={<Status ok={health.facebook.ok || health.instagram.ok} />}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Connect your accounts
                </Typography>
              </StepLabel>
              <StepContent>
                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                  <Chip
                    color={d.accounts.facebook > 0 ? "success" : "default"}
                    label={`Facebook Pages: ${d.accounts.facebook}`}
                  />
                  <Chip
                    color={d.accounts.instagram > 0 ? "success" : "default"}
                    label={`Instagram: ${d.accounts.instagram}`}
                  />
                </Stack>

                <Alert severity="info" sx={{ mb: 2 }}>
                  <AlertTitle>Required for Instagram</AlertTitle>
                  Your Instagram account must be a <strong>Business</strong> or{" "}
                  <strong>Creator</strong> account, and it must be{" "}
                  <strong>linked</strong> to a Facebook Page. (In the Instagram app:
                  Settings → Account type → Switch to professional, then link the
                  Page.) A personal account cannot post through the API.
                </Alert>

                <Button
                  component={Link}
                  href="/admin/accounts"
                  variant="contained"
                  disabled={!health.metaApp.ok}
                >
                  Accounts page — Connect with Facebook
                </Button>
                {!health.metaApp.ok && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    Finish step 2 (the Meta app) first.
                  </Typography>
                )}
              </StepContent>
            </Step>

            {/* ---------------- STEP 4 ---------------- */}
            <Step expanded>
              <StepLabel icon={<Status ok={done === 4} />}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Make your first post
                </Typography>
              </StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Once everything above is ready:
                </Typography>
                <Stack spacing={1.25} sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    • <strong>Products</strong> — paste a product link and get the
                    caption, image and Instagram/Facebook post automatically
                  </Typography>
                  <Typography variant="body2">
                    • <strong>Posts</strong> — write a topic, pick several accounts,
                    schedule it
                  </Typography>
                  <Typography variant="body2">
                    • <strong>Auto DM</strong> — reply to comments automatically and
                    send the product link by direct message
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button component={Link} href="/admin/products" variant="contained">
                    Products
                  </Button>
                  <Button component={Link} href="/admin/posts" variant="outlined">
                    Posts
                  </Button>
                  <Button component={Link} href="/admin/integrations" variant="outlined">
                    Test the AI services
                  </Button>
                </Stack>
              </StepContent>
            </Step>
          </Stepper>
        </CardContent>
      </Card>

      {/* ---------- Optional: auto-DM webhook ---------- */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Optional — Auto DM webhook
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" sx={{ mb: 2 }}>
            For a direct message to go out when someone comments, Meta needs a
            webhook pointing at this app. <strong>Meta requires a public https
            URL</strong> — localhost will not work, so use a tunnel such as ngrok.
          </Typography>
          <Code>{`# 1. Start a tunnel
npx ngrok http 3000

# 2. Meta app -> Webhooks -> Page and Instagram
Callback URL : https://<ngrok-url>/api/webhooks/meta
Verify Token : (META_WEBHOOK_VERIFY_TOKEN from .env)

# 3. Subscribe to
Page      -> feed
Instagram -> comments`}</Code>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            The verify token is {d.webhookVerifyTokenSet ? "set in .env" : "not set in .env"}
          </Typography>
        </CardContent>
      </Card>

      {/* ---------- Image generation ---------- */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Image generation
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Stack spacing={1}>
            {d.imageProviders.map((provider) => (
              <Stack key={provider.key} direction="row" spacing={1.5} alignItems="center">
                <Status ok={provider.configured} />
                <Box>
                  <Typography variant="body2">{provider.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {provider.note}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
