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
            Fari check karo
          </Button>
        }
      />

      <Alert severity={done === 4 ? "success" : "info"}>
        <AlertTitle>{done}/4 step puri thai</AlertTitle>
        {done === 4
          ? "Badhu taiyar che — Products page par link paste karo ane post banavo!"
          : "Niche na steps puri karo. Dareak step pachi 'Fari check karo' dabavo."}
      </Alert>

      <Card>
        <CardContent>
          <Stepper activeStep={activeStep} orientation="vertical">
            {/* ---------------- STEP 1 ---------------- */}
            <Step expanded>
              <StepLabel icon={<Status ok={health.ai.ok} />}>
                <Typography variant="subtitle1" fontWeight={700}>
                  AI chalu karo — FREE
                </Typography>
              </StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Post na caption AI lakhe che. Sauthi saralo free vikalp Google
                  Gemini che — credit card ni jarur nathi.
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
                  Vikalp A — Google Gemini (free, 2 minute)
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
                    kholo → Google account thi sign in
                  </Typography>
                  <Typography variant="body2">
                    2. <strong>Create API key</strong> dabavo, key copy karo
                  </Typography>
                  <Typography variant="body2">
                    3. Project na <code>.env</code> file ma aa nakho:
                  </Typography>
                </Stack>
                <Code>{`GEMINI_API_KEY=AIza...tamari-key...
AI_PROVIDER=gemini`}</Code>

                <Typography variant="subtitle2" sx={{ mt: 2 }} gutterBottom>
                  Vikalp B — Ollama (100% free, internet pan na joiye)
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Status:{" "}
                  {d.ollama.up ? (
                    <Chip
                      size="small"
                      color="success"
                      label={`chalu che — ${d.ollama.models.length} models`}
                    />
                  ) : (
                    <Chip size="small" label="chalu nathi" />
                  )}
                </Typography>
                <Code>{`# 1. ollama.com par thi install karo
# 2. terminal ma:
ollama pull llama3.2
# 3. .env ma:
OLLAMA_MODEL=llama3.2
AI_PROVIDER=ollama`}</Code>

                <Alert severity="warning" sx={{ mt: 2 }}>
                  <code>.env</code> badalya pachi <strong>dev server restart</strong>{" "}
                  karvo pade che (Ctrl+C → <code>npm run dev</code>).
                </Alert>
              </StepContent>
            </Step>

            {/* ---------------- STEP 2 ---------------- */}
            <Step expanded>
              <StepLabel icon={<Status ok={health.metaApp.ok} />}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Meta app banavo (Instagram + Facebook mate farjiyat)
                </Typography>
              </StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Facebook ane Instagram par post karva mate Meta nu developer app
                  joiye j che — aa vagar koi rite post na thai shake.
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
                    2. App ma <strong>Facebook Login</strong> product add karo
                  </Typography>
                  <Typography variant="body2">
                    3. Facebook Login → Settings → <strong>Valid OAuth Redirect URIs</strong>{" "}
                    ma aa <em>exact</em> URL nakho:
                  </Typography>
                </Stack>
                <Code>{`${d.appUrl}/api/oauth/meta/callback`}</Code>

                <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>
                  4. Settings → Basic mathi App ID ane App Secret lai{" "}
                  <code>.env</code> ma nakho:
                </Typography>
                <Code>{`META_APP_ID=tamaru-app-id
META_APP_SECRET=tamaru-app-secret`}</Code>

                <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>
                  5. App Review → Permissions ma aa magavo (Development mode ma
                  tame jate test kari shako):
                </Typography>
                <Code>{`pages_show_list
pages_manage_posts
pages_read_engagement
business_management
instagram_basic
instagram_content_publish
instagram_manage_messages   (auto-DM mate)`}</Code>
              </StepContent>
            </Step>

            {/* ---------------- STEP 3 ---------------- */}
            <Step expanded>
              <StepLabel icon={<Status ok={health.facebook.ok || health.instagram.ok} />}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Accounts jodo
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
                  <AlertTitle>Instagram mate jaruri</AlertTitle>
                  Tamaru Instagram <strong>Business</strong> ke{" "}
                  <strong>Creator</strong> account hovu joiye, ane e ek Facebook
                  Page saathe <strong>jodelu</strong> hovu joiye. (Instagram app →
                  Settings → Account type → Switch to professional; pachi Page
                  saathe link karo.) Personal IG account thi API post na thai shake.
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
                    Pehla step 2 (Meta app) puri karo.
                  </Typography>
                )}
              </StepContent>
            </Step>

            {/* ---------------- STEP 4 ---------------- */}
            <Step expanded>
              <StepLabel icon={<Status ok={done === 4} />}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Post banavo
                </Typography>
              </StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Badhu taiyar thay etle:
                </Typography>
                <Stack spacing={1.25} sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    • <strong>Products</strong> → product ni link paste karo → AI
                    caption + image + IG/FB post aapoaap
                  </Typography>
                  <Typography variant="body2">
                    • <strong>Posts</strong> → topic lakho, ghana accounts select
                    karo, schedule karo
                  </Typography>
                  <Typography variant="body2">
                    • <strong>Auto DM</strong> → comment par auto reply + product
                    link DM
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
                    AI tools test karo
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
            Comment aave tyare auto DM javu hoy to Meta ne aapno webhook aapvo
            pade. <strong>Meta ne public https URL joiye</strong> — localhost
            nahi chale, etle ngrok jevu tunnel vapro.
          </Typography>
          <Code>{`# 1. tunnel chalu karo
npx ngrok http 3000

# 2. Meta app -> Webhooks -> Page ane Instagram
Callback URL : https://<ngrok-url>/api/webhooks/meta
Verify Token : (.env no META_WEBHOOK_VERIFY_TOKEN)

# 3. Subscribe karo
Page      -> feed
Instagram -> comments`}</Code>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            Verify token .env ma {d.webhookVerifyTokenSet ? "set che ✓" : "set nathi"}
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
