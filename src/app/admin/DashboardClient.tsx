"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/GroupsOutlined";
import CampaignIcon from "@mui/icons-material/CampaignOutlined";
import BoltIcon from "@mui/icons-material/BoltOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutline";
import ScheduleIcon from "@mui/icons-material/ScheduleOutlined";
import ErrorIcon from "@mui/icons-material/ErrorOutline";
import PageHeader from "@/components/PageHeader";
import StatusChip from "@/components/StatusChip";
import SetupChecklist from "@/components/SetupChecklist";
import { apiFetch } from "@/lib/client";
import { NAV_SECTIONS } from "@/components/nav-items";

type Stats = {
  accounts: number;
  activeCampaigns: number;
  activeAutomations: number;
  posts: {
    total: number;
    draft: number;
    scheduled: number;
    published: number;
    failed: number;
  };
  upcoming: Array<{
    _id: string;
    caption: string;
    scheduledAt: string;
    platform: string;
    account?: { displayName: string };
  }>;
  recentLogs: Array<{
    _id: string;
    level: string;
    action: string;
    message: string;
    createdAt: string;
  }>;
};

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              bgcolor: `${color}.main`,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5">{value}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {label}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** The four things people reach for most often, straight from the sidebar. */
const SHORTCUT_HREFS = [
  "/admin/studio",
  "/admin/posts",
  "/admin/accounts",
  "/admin/automations",
];

function Shortcuts() {
  const items = NAV_SECTIONS.flatMap((section) => section.items).filter((item) =>
    SHORTCUT_HREFS.includes(item.href),
  );

  return (
    <Grid container spacing={2}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Grid key={item.href} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ height: "100%" }}>
              <CardActionArea
                component={Link}
                href={item.href}
                sx={{ height: "100%", p: 2 }}
              >
                <Stack spacing={1}>
                  <Icon fontSize="small" color="primary" />
                  <Typography variant="subtitle2">{item.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.hint}
                  </Typography>
                </Stack>
              </CardActionArea>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}

export default function DashboardClient() {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    apiFetch<Stats>("/api/stats")
      .then(setStats)
      .catch((problem) => setError(problem.message));
  }, []);

  if (error) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Dashboard" />
        <Alert severity="error">
          {error}
          <Typography variant="body2" sx={{ mt: 1 }}>
            The database lives in the <code>data/</code> folder next to the source
            code. Check that the folder exists and that the app can write to it.
          </Typography>
        </Alert>
      </Stack>
    );
  }

  if (!stats) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Dashboard"
        subtitle="Everything your marketing automation is doing right now."
        action={
          <Button component={Link} href="/admin/studio" variant="contained">
            Create a reel
          </Button>
        }
      />

      <SetupChecklist />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Connected accounts"
            value={stats.accounts}
            icon={<GroupsIcon />}
            color="primary"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Active campaigns"
            value={stats.activeCampaigns}
            icon={<CampaignIcon />}
            color="secondary"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Active automations"
            value={stats.activeAutomations}
            icon={<BoltIcon />}
            color="warning"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Published posts"
            value={stats.posts.published}
            icon={<CheckCircleIcon />}
            color="success"
          />
        </Grid>
      </Grid>

      <Shortcuts />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <ScheduleIcon fontSize="small" color="info" />
                <Typography variant="h6">Scheduled next</Typography>
              </Stack>
              <Divider sx={{ mb: 1 }} />
              {stats.upcoming.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                  Nothing is scheduled yet.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {stats.upcoming.map((post) => (
                    <ListItem key={post._id} disableGutters>
                      <ListItemText
                        primary={post.caption.slice(0, 90)}
                        secondary={`${post.account?.displayName ?? post.platform} · ${new Date(
                          post.scheduledAt,
                        ).toLocaleString()}`}
                        slotProps={{ primary: { fontSize: 14 } }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <ErrorIcon fontSize="small" color="warning" />
                <Typography variant="h6">Posts by status</Typography>
              </Stack>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1.5}>
                {(["draft", "scheduled", "published", "failed"] as const).map((key) => (
                  <Stack
                    key={key}
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <StatusChip status={key} />
                    <Typography variant="subtitle2">{stats.posts[key]}</Typography>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Recent activity
          </Typography>
          <Divider sx={{ mb: 1 }} />
          {stats.recentLogs.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              Nothing has happened yet.
            </Typography>
          ) : (
            <List dense disablePadding>
              {stats.recentLogs.map((log) => (
                <ListItem key={log._id} disableGutters>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    sx={{ width: "100%" }}
                  >
                    <StatusChip status={log.level} />
                    <ListItemText
                      primary={log.message}
                      secondary={`${log.action} · ${new Date(log.createdAt).toLocaleString()}`}
                      slotProps={{ primary: { fontSize: 14 } }}
                    />
                  </Stack>
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
