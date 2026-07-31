"use client";

import {
  Alert,
  Box,
  Card,
  CardContent,
  Divider,
  Link as MuiLink,
  Stack,
  Typography,
} from "@mui/material";
import PageHeader from "@/components/PageHeader";
import { useColorMode } from "@/theme/ThemeRegistry";
import { FormControlLabel, Switch } from "@mui/material";

function Code({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="pre"
      sx={{
        p: 2,
        borderRadius: 2,
        overflowX: "auto",
        fontSize: 13,
        bgcolor: (theme) =>
          theme.palette.mode === "dark" ? "#0B0D12" : "#F1F3F8",
        border: 1,
        borderColor: "divider",
        m: 0,
      }}
    >
      <code>{children}</code>
    </Box>
  );
}

export default function SettingsPage() {
  const { mode, toggleMode } = useColorMode();

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Settings"
        subtitle="Appearance ane integration setup"
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
            Choice browser ma save thay che ane badha pages par lagu pade che.
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            MongoDB (local)
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" sx={{ mb: 2 }}>
            App <code>MONGODB_URI</code> vaapre che. Local MongoDB chalu karo,
            pachi admin user seed karo:
          </Typography>
          <Code>{`# .env
MONGODB_URI=mongodb://127.0.0.1:27017/auto_marketing

# admin user banavo
npm run seed`}</Code>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Scheduler (cron)
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" sx={{ mb: 2 }}>
            Scheduled posts ane automations chalava mate aa endpoint ne har
            minute call karo:
          </Typography>
          <Code>{`curl -X POST http://localhost:3000/api/cron/dispatch \\
  -H "x-cron-secret: <CRON_SECRET>"`}</Code>
          <Typography variant="body2" sx={{ mt: 2 }}>
            n8n ma: <strong>Schedule Trigger</strong> (every minute) →{" "}
            <strong>HTTP Request</strong> node (POST, header{" "}
            <code>x-cron-secret</code>).
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
            1. App → n8n (outbound events)
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            App <code>N8N_WEBHOOK_URL</code> par POST kare che. Events:{" "}
            <code>post.created</code>, <code>post.scheduled</code>,{" "}
            <code>post.published</code>, <code>post.failed</code>,{" "}
            <code>automation.completed</code>.
          </Typography>
          <Code>{`{
  "event": "post.published",
  "sentAt": "2026-08-01T09:30:00.000Z",
  "payload": { "postId": "...", "platform": "instagram", "permalink": "..." }
}`}</Code>

          <Typography variant="subtitle2" sx={{ mt: 3 }} gutterBottom>
            2. n8n → App (inbound commands)
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            n8n <code>POST /api/webhooks/n8n</code> ne call kari sake, header{" "}
            <code>x-n8n-secret</code> saathe:
          </Typography>
          <Code>{`// AI thi post banavo ane publish karo
{ "event": "post.generate", "accountId": "<id>",
  "topic": "Monsoon sale", "publish": true }

// koi automation chalavo
{ "event": "automation.run", "automationId": "<id>" }

// koi draft post publish karo
{ "event": "post.publish", "postId": "<id>" }`}</Code>

          <Alert severity="info" sx={{ mt: 2 }}>
            Ready-made n8n workflow repo ma che:{" "}
            <code>n8n/auto-marketing-workflow.json</code> — n8n ma Import from
            File karine vapro.
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Meta (Facebook + Instagram) setup
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Stack spacing={1.5}>
            <Typography variant="body2">
              1. <MuiLink href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">
                developers.facebook.com
              </MuiLink>{" "}
              par app banavo ane <strong>Facebook Login</strong> +{" "}
              <strong>Instagram Graph API</strong> product add karo.
            </Typography>
            <Typography variant="body2">
              2. Permissions joiye: <code>pages_manage_posts</code>,{" "}
              <code>pages_read_engagement</code>,{" "}
              <code>instagram_basic</code>,{" "}
              <code>instagram_content_publish</code>.
            </Typography>
            <Typography variant="body2">
              3. Graph API Explorer ma <code>/me/accounts</code> thi Page ID +
              Page access token lo. Instagram mate Page na{" "}
              <code>instagram_business_account</code> field mathi IG User ID lo.
            </Typography>
            <Typography variant="body2">
              4. Ae value Accounts page ma add karo.
            </Typography>
            <Alert severity="warning">
              Instagram Content Publishing API ne <strong>public https image
              URL</strong> joiye j che — localhost path nahi chale. Image
              Cloudinary/S3 jeva host par mukine e URL vapro.
            </Alert>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
