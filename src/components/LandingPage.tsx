"use client";

import * as React from "react";
import Link from "next/link";
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Grid,
  IconButton,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import CampaignIcon from "@mui/icons-material/CampaignOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ScheduleIcon from "@mui/icons-material/ScheduleOutlined";
import ChatIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import GroupsIcon from "@mui/icons-material/GroupsOutlined";
import HubIcon from "@mui/icons-material/HubOutlined";
import StorefrontIcon from "@mui/icons-material/StorefrontOutlined";
import CheckIcon from "@mui/icons-material/Check";
import { useColorMode } from "@/theme/ThemeRegistry";

export type PublicPlan = {
  _id: string;
  key: string;
  name: string;
  description?: string;
  priceMonthly: number;
  priceYearly: number;
  highlights?: string[];
  popular?: boolean;
};

const FEATURES = [
  {
    icon: AutoAwesomeIcon,
    title: "Posts written by AI",
    body: "Give it a topic and it writes captions and hashtags in a different style for Facebook and for Instagram — several variants at once.",
  },
  {
    icon: GroupsIcon,
    title: "Ghana accounts, ek click",
    body: "Pick one caption and send it to every Facebook Page and Instagram account at once. Each one reports its own status.",
  },
  {
    icon: ScheduleIcon,
    title: "Schedule and auto publish",
    body: "Set a time and the scheduler publishes when it arrives. If something fails, the error is shown against the post.",
  },
  {
    icon: ChatIcon,
    title: "Comment par auto DM",
    body: "When someone comments 'price?', they get a public reply and a direct message with your link. You choose the keywords.",
  },
  {
    icon: StorefrontIcon,
    title: "Ghana brands",
    body: "A separate workspace for every client or brand — its own accounts, posts and rules. Switch from the top bar.",
  },
  {
    icon: HubIcon,
    title: "n8n automation",
    body: "Connect n8n with an API token. Create a post, publish it, or run an automation from any workflow you already have.",
  },
];

export default function LandingPage({ plans }: { plans: PublicPlan[] }) {
  const { mode, toggleMode } = useColorMode();
  const [yearly, setYearly] = React.useState(false);

  return (
    <Box>
      <AppBar
        position="sticky"
        elevation={0}
        color="inherit"
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(14,16,21,0.8)"
              : "rgba(246,247,251,0.8)",
          backdropFilter: "blur(10px)",
        }}
      >
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ gap: 2 }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flex: 1 }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 2,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "primary.main",
                  color: "#fff",
                }}
              >
                <CampaignIcon fontSize="small" />
              </Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Auto Marketing
              </Typography>
            </Stack>

            <Button href="#features" sx={{ display: { xs: "none", md: "inline-flex" } }}>
              Features
            </Button>
            <Button href="#pricing" sx={{ display: { xs: "none", md: "inline-flex" } }}>
              Pricing
            </Button>
            <IconButton onClick={toggleMode} size="small">
              {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
            <Button component={Link} href="/login">
              Login
            </Button>
            <Button component={Link} href="/register" variant="contained">
              Start for free
            </Button>
          </Toolbar>
        </Container>
      </AppBar>

      {/* ---------- Hero ---------- */}
      <Box
        sx={{
          background: (theme) =>
            theme.palette.mode === "dark"
              ? "radial-gradient(1000px 500px at 50% -10%, rgba(91,91,214,0.28), transparent 65%)"
              : "radial-gradient(1000px 500px at 50% -10%, rgba(91,91,214,0.18), transparent 65%)",
        }}
      >
        <Container maxWidth="md" sx={{ py: { xs: 8, md: 14 }, textAlign: "center" }}>
          <Chip
            label="AI + automation for Facebook & Instagram"
            color="primary"
            variant="outlined"
            sx={{ mb: 3 }}
          />
          <Typography
            variant="h2"
            sx={{
              fontWeight: 800,
              letterSpacing: "-0.03em",
              fontSize: { xs: 34, sm: 46, md: 56 },
              lineHeight: 1.1,
            }}
          >
            Your social media,
            <br />
            on autopilot.
          </Typography>
          <Typography
            variant="h6"
            color="text.secondary"
            sx={{ mt: 3, fontWeight: 400, maxWidth: 620, mx: "auto" }}
          >
            Write posts with AI, schedule them across many accounts at once, and
            message everyone who comments — from a single dashboard.
          </Typography>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            justifyContent="center"
            sx={{ mt: 5 }}
          >
            <Button component={Link} href="/register" variant="contained" size="large">
              14 divas free trial
            </Button>
            <Button href="#pricing" variant="outlined" size="large">
              See plans
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
            No credit card required
          </Typography>
        </Container>
      </Box>

      {/* ---------- Features ---------- */}
      <Container maxWidth="lg" sx={{ py: { xs: 8, md: 12 } }} id="features">
        <Box sx={{ textAlign: "center", mb: 6 }}>
          <Typography variant="h4" fontWeight={700}>
            Badhu ek jagya e
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            From writing the post to answering the customer
          </Typography>
        </Box>

        <Grid container spacing={3}>
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Grid key={feature.title} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card sx={{ height: "100%" }}>
                  <CardContent sx={{ p: 3 }}>
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: 2,
                        display: "grid",
                        placeItems: "center",
                        bgcolor: "primary.main",
                        color: "#fff",
                        mb: 2,
                      }}
                    >
                      <Icon />
                    </Box>
                    <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                      {feature.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {feature.body}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Container>

      {/* ---------- Pricing ---------- */}
      <Box sx={{ bgcolor: "background.paper", borderTop: 1, borderBottom: 1, borderColor: "divider" }}>
        <Container maxWidth="lg" sx={{ py: { xs: 8, md: 12 } }} id="pricing">
          <Box sx={{ textAlign: "center", mb: 5 }}>
            <Typography variant="h4" fontWeight={700}>
              Simple pricing
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              From a single shop to a full agency
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 3 }}>
              <Button
                variant={yearly ? "outlined" : "contained"}
                size="small"
                onClick={() => setYearly(false)}
              >
                Monthly
              </Button>
              <Button
                variant={yearly ? "contained" : "outlined"}
                size="small"
                onClick={() => setYearly(true)}
              >
                Yearly (2 mahina free)
              </Button>
            </Stack>
          </Box>

          {plans.length === 0 ? (
            <Typography align="center" color="text.secondary">
              Plans could not be loaded — check that the app can read its data folder.
            </Typography>
          ) : (
            <Grid container spacing={3} justifyContent="center">
              {plans.map((plan) => (
                <Grid key={plan._id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card
                    sx={{
                      height: "100%",
                      position: "relative",
                      borderWidth: plan.popular ? 2 : 1,
                      borderColor: plan.popular ? "primary.main" : undefined,
                    }}
                  >
                    {plan.popular && (
                      <Chip
                        color="primary"
                        label="Sauthi popular"
                        size="small"
                        sx={{ position: "absolute", top: 16, right: 16 }}
                      />
                    )}
                    <CardContent sx={{ p: 3 }}>
                      <Typography variant="h6" fontWeight={700}>
                        {plan.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>
                        {plan.description}
                      </Typography>

                      <Typography variant="h4" fontWeight={800} sx={{ mt: 2 }}>
                        ₹
                        {(yearly
                          ? Math.round(plan.priceYearly / 12)
                          : plan.priceMonthly
                        ).toLocaleString("en-IN")}
                        <Typography component="span" variant="body2" color="text.secondary">
                          {" "}/mahino
                        </Typography>
                      </Typography>
                      {yearly && (
                        <Typography variant="caption" color="text.secondary">
                          ₹{plan.priceYearly.toLocaleString("en-IN")} varshe
                        </Typography>
                      )}

                      <Button
                        component={Link}
                        href={`/register?plan=${plan.key}`}
                        variant={plan.popular ? "contained" : "outlined"}
                        fullWidth
                        sx={{ mt: 3 }}
                      >
                        Get started
                      </Button>

                      <Divider sx={{ my: 3 }} />
                      <Stack spacing={1.25}>
                        {(plan.highlights ?? []).map((item) => (
                          <Stack key={item} direction="row" spacing={1.25} alignItems="flex-start">
                            <CheckIcon fontSize="small" color="success" sx={{ mt: 0.2 }} />
                            <Typography variant="body2">{item}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </Container>
      </Box>

      {/* ---------- Footer ---------- */}
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems="center"
          spacing={2}
        >
          <Typography variant="body2" color="text.secondary">
            © {new Date().getFullYear()} Auto Marketing
          </Typography>
          <Stack direction="row" spacing={2}>
            <Button component={Link} href="/login" size="small">
              Login
            </Button>
            <Button component={Link} href="/register" size="small">
              Register
            </Button>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
