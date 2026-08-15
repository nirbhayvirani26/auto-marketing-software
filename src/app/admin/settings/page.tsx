"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  Link as MuiLink,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import PageHeader from "@/components/PageHeader";
import { useColorMode } from "@/theme/ThemeRegistry";
import { apiFetch } from "@/lib/client";

function Code({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="pre"
      sx={{
        p: 2,
        borderRadius: 2,
        overflowX: "auto",
        fontSize: 13,
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

type Health = {
  detail: {
    appUrl: string;
    storage: { engine: string; location: string };
  };
};

export default function SettingsPage() {
  const { mode, toggleMode } = useColorMode();
  const [health, setHealth] = React.useState<Health | null>(null);

  React.useEffect(() => {
    apiFetch<Health>("/api/health").then(setHealth).catch(() => setHealth(null));
  }, []);

  const appUrl = health?.detail.appUrl ?? "http://localhost:3000";

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Settings"
        subtitle="Appearance, where your data lives, and how the outside world connects to this app."
      />

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Appearance
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <FormControlLabel
            control={<Switch checked={mode === "dark"} onChange={toggleMode} />}
            label="Dark mode"
          />
          <Typography variant="caption" color="text.secondary" display="block">
            Saved in this browser and applied to every page.
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Data and storage
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" sx={{ mb: 2 }}>
            This app runs on a local database: every collection is a JSON file in
            a folder next to the source code. There is no database server to
            install and nothing to configure. Copy the project folder and the
            content comes with it.
          </Typography>

          <Code>{health?.detail.storage.location ?? "data/"}</Code>

          <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>
            What you will find in there:
          </Typography>
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography variant="body2">
              • <code>users.json</code>, <code>brands.json</code>,{" "}
              <code>posts.json</code> … one file per collection
            </Typography>
            <Typography variant="body2">
              • <code>.session-secret</code> — the generated key that signs sign-in
              cookies
            </Typography>
            <Typography variant="body2">
              • Uploaded images and rendered reels live separately, in{" "}
              <code>storage/</code>
            </Typography>
          </Stack>

          <Alert severity="warning">
            The data folder holds password hashes and Page access tokens, so it is
            excluded from git. When you share the project, whoever receives it
            gets a fresh workspace: the first sign-in creates the owner account
            from <code>SEED_ADMIN_EMAIL</code> and <code>SEED_ADMIN_PASSWORD</code>.
            To reset everything, delete the folder and run <code>npm run seed</code>.
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Scheduler
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" sx={{ mb: 2 }}>
            Scheduled posts and automations only run while this endpoint is called
            once a minute:
          </Typography>
          <Code>{`curl -X POST ${appUrl}/api/cron/dispatch \\
  -H "x-cron-secret: <CRON_SECRET>"`}</Code>
          <Typography variant="body2" sx={{ mt: 2 }}>
            In n8n: a <strong>Schedule Trigger</strong> (every minute) into an{" "}
            <strong>HTTP Request</strong> node (POST, with the{" "}
            <code>x-cron-secret</code> header). On Windows, a Task Scheduler entry
            works just as well.
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            n8n integration
          </Typography>
          <Divider sx={{ mb: 2 }} />

          <Typography variant="subtitle2" gutterBottom>
            1. This app to n8n (outbound events)
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            The app POSTs to <code>N8N_WEBHOOK_URL</code>. The events are{" "}
            <code>post.created</code>, <code>post.scheduled</code>,{" "}
            <code>post.published</code>, <code>post.failed</code> and{" "}
            <code>automation.completed</code>.
          </Typography>
          <Code>{`{
  "event": "post.published",
  "sentAt": "2026-08-01T09:30:00.000Z",
  "payload": { "postId": "...", "platform": "instagram", "permalink": "..." }
}`}</Code>

          <Typography variant="subtitle2" sx={{ mt: 3 }} gutterBottom>
            2. n8n to this app (inbound commands)
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            n8n can call <code>POST /api/webhooks/n8n</code> with an{" "}
            <code>x-n8n-secret</code> header:
          </Typography>
          <Code>{`// Write a post with AI and publish it
{ "event": "post.generate", "accountId": "<id>",
  "topic": "Monsoon sale", "publish": true }

// Run an automation
{ "event": "automation.run", "automationId": "<id>" }

// Publish an existing draft
{ "event": "post.publish", "postId": "<id>" }`}</Code>

          <Alert severity="info" sx={{ mt: 2 }}>
            Ready-made workflows ship with the project in the <code>n8n/</code>{" "}
            folder — import them with <strong>Import from File</strong>.
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Meta (Facebook and Instagram) setup
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Stack spacing={1.5}>
            <Typography variant="body2">
              1. Create an app at{" "}
              <MuiLink
                href="https://developers.facebook.com/apps"
                target="_blank"
                rel="noreferrer"
              >
                developers.facebook.com
              </MuiLink>{" "}
              and add the <strong>Facebook Login</strong> and{" "}
              <strong>Instagram Graph API</strong> products.
            </Typography>
            <Typography variant="body2">
              2. Request these permissions: <code>pages_manage_posts</code>,{" "}
              <code>pages_read_engagement</code>, <code>instagram_basic</code> and{" "}
              <code>instagram_content_publish</code>.
            </Typography>
            <Typography variant="body2">
              3. Add this redirect URI to Facebook Login → Settings → Valid OAuth
              Redirect URIs: <code>{appUrl}/api/oauth/meta/callback</code>
            </Typography>
            <Typography variant="body2">
              4. Put the App ID and App Secret in <code>.env</code>, then use{" "}
              <strong>Connect with Facebook</strong> on the Social Accounts page.
            </Typography>
            <Alert severity="warning">
              The Instagram Content Publishing API requires a{" "}
              <strong>public https URL</strong> for your media — a localhost path
              will not work. Host the file on Cloudinary, S3 or a tunnel and use
              that URL.
            </Alert>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
