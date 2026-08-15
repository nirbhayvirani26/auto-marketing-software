"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Card,
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
import BusinessIcon from "@mui/icons-material/BusinessOutlined";
import PeopleIcon from "@mui/icons-material/PeopleAltOutlined";
import ArticleIcon from "@mui/icons-material/ArticleOutlined";
import PaymentsIcon from "@mui/icons-material/PaymentsOutlined";
import PageHeader from "@/components/PageHeader";
import StatusChip from "@/components/StatusChip";
import { apiFetch } from "@/lib/client";

type Overview = {
  organizations: number;
  byStatus: Record<string, number>;
  users: number;
  plans: number;
  brands: number;
  accounts: number;
  postsTotal: number;
  postsThisMonth: number;
  mrr: number;
  recentOrgs: Array<{
    _id: string;
    name: string;
    status: string;
    createdAt: string;
    plan?: { name: string };
    owner?: { name: string; email: string };
  }>;
  recentLogs: Array<{
    _id: string;
    level: string;
    action: string;
    message: string;
    createdAt: string;
  }>;
};

function Stat({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: React.ReactNode;
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

export default function SuperAdminOverview() {
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    apiFetch<Overview>("/api/superadmin/overview")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <Stack spacing={2}>
        <PageHeader title="Platform Overview" />
        <Alert severity="error">{error}</Alert>
      </Stack>
    );
  }

  if (!data) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Platform Overview"
        subtitle="Badhi organizations, users ane revenue ek jagya e"
        action={
          <Button
            component={Link}
            href="/superadmin/organizations"
            variant="contained"
          >
            View organizations
          </Button>
        }
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Stat
            label="Organizations"
            value={data.organizations}
            icon={<BusinessIcon />}
            color="primary"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Stat
            label="Users"
            value={data.users}
            icon={<PeopleIcon />}
            color="secondary"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Stat
            label="Posts (aa mahine)"
            value={data.postsThisMonth}
            icon={<ArticleIcon />}
            color="warning"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Stat
            label="MRR (monthly)"
            value={`₹${data.mrr.toLocaleString("en-IN")}`}
            icon={<PaymentsIcon />}
            color="success"
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Organization status
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1.5}>
                {["trial", "active", "past_due", "suspended", "cancelled"].map(
                  (status) => (
                    <Stack
                      key={status}
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <StatusChip status={status} />
                      <Typography variant="subtitle2">
                        {data.byStatus[status] ?? 0}
                      </Typography>
                    </Stack>
                  ),
                )}
              </Stack>
              <Divider sx={{ my: 2 }} />
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Brands
                  </Typography>
                  <Typography variant="body2">{data.brands}</Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Social accounts
                  </Typography>
                  <Typography variant="body2">{data.accounts}</Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Total posts
                  </Typography>
                  <Typography variant="body2">{data.postsTotal}</Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Nava organizations
              </Typography>
              <Divider sx={{ mb: 1 }} />
              {data.recentOrgs.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                  There are no organizations yet.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {data.recentOrgs.map((org) => (
                    <ListItem
                      key={org._id}
                      disableGutters
                      secondaryAction={<StatusChip status={org.status} />}
                    >
                      <ListItemText
                        primary={org.name}
                        secondary={`${org.plan?.name ?? "—"} · ${org.owner?.email ?? "—"} · ${new Date(org.createdAt).toLocaleDateString()}`}
                        primaryTypographyProps={{ fontSize: 14 }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Platform activity
          </Typography>
          <Divider sx={{ mb: 1 }} />
          <List dense disablePadding>
            {data.recentLogs.map((log) => (
              <ListItem key={log._id} disableGutters>
                <Stack direction="row" spacing={1.5} alignItems="center" width="100%">
                  <StatusChip status={log.level} />
                  <ListItemText
                    primary={log.message}
                    secondary={`${log.action} · ${new Date(log.createdAt).toLocaleString()}`}
                    primaryTypographyProps={{ fontSize: 14 }}
                  />
                </Stack>
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>
    </Stack>
  );
}
