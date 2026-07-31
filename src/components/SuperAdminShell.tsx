"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import DashboardIcon from "@mui/icons-material/SpaceDashboardOutlined";
import BusinessIcon from "@mui/icons-material/BusinessOutlined";
import PeopleIcon from "@mui/icons-material/PeopleAltOutlined";
import PaymentsIcon from "@mui/icons-material/PaymentsOutlined";
import HistoryIcon from "@mui/icons-material/HistoryOutlined";
import LogoutIcon from "@mui/icons-material/LogoutOutlined";
import ShieldIcon from "@mui/icons-material/ShieldOutlined";
import { useColorMode } from "@/theme/ThemeRegistry";

const DRAWER_WIDTH = 248;

const NAV = [
  { href: "/superadmin", label: "Overview", icon: DashboardIcon, exact: true },
  { href: "/superadmin/organizations", label: "Organizations", icon: BusinessIcon },
  { href: "/superadmin/users", label: "Users", icon: PeopleIcon },
  { href: "/superadmin/plans", label: "Plans & Pricing", icon: PaymentsIcon },
  { href: "/superadmin/logs", label: "Platform Logs", icon: HistoryIcon },
];

export default function SuperAdminShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggleMode } = useColorMode();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const drawer = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Toolbar sx={{ gap: 1.5, px: 2.5 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: 2,
            display: "grid",
            placeItems: "center",
            bgcolor: "error.main",
            color: "#fff",
          }}
        >
          <ShieldIcon fontSize="small" />
        </Box>
        <Box>
          <Typography variant="subtitle2" lineHeight={1.2}>
            Platform Admin
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Super Admin
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List sx={{ px: 1.5, py: 1.5, flex: 1 }}>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <ListItemButton
              key={item.href}
              component={Link}
              href={item.href}
              selected={active}
              onClick={() => setMobileOpen(false)}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                "&.Mui-selected": {
                  bgcolor: "error.main",
                  color: "#fff",
                  "& .MuiListItemIcon-root": { color: "inherit" },
                  "&:hover": { bgcolor: "error.dark" },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 38 }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
              />
            </ListItemButton>
          );
        })}
      </List>
      <Divider />
      <List sx={{ px: 1.5, py: 1 }}>
        <ListItemButton component={Link} href="/admin" sx={{ borderRadius: 2 }}>
          <ListItemIcon sx={{ minWidth: 38 }}>
            <DashboardIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="User panel jovo"
            primaryTypographyProps={{ fontSize: 13 }}
          />
        </ListItemButton>
        <ListItemButton onClick={handleLogout} sx={{ borderRadius: 2 }}>
          <ListItemIcon sx={{ minWidth: 38 }}>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Logout"
            primaryTypographyProps={{ fontSize: 13 }}
          />
        </ListItemButton>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <AppBar
        position="fixed"
        elevation={0}
        color="inherit"
        sx={{
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(23,26,33,0.85)"
              : "rgba(255,255,255,0.85)",
          backdropFilter: "blur(8px)",
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: "none" } }}
            edge="start"
          >
            <MenuIcon />
          </IconButton>
          <Chip size="small" color="error" label="SUPER ADMIN" />
          <Box sx={{ flex: 1 }} />
          <Tooltip title={mode === "dark" ? "Light mode" : "Dark mode"}>
            <IconButton onClick={toggleMode}>
              {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <Stack direction="row" spacing={1} alignItems="center">
            <Avatar sx={{ width: 30, height: 30, bgcolor: "error.main" }}>
              {user.name.charAt(0).toUpperCase()}
            </Avatar>
            <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" } }}>
              {user.email}
            </Typography>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              borderRight: 1,
              borderColor: "divider",
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{ flexGrow: 1, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, minWidth: 0 }}
      >
        <Toolbar />
        <Stack sx={{ p: { xs: 2, md: 3 } }} spacing={3}>
          {children}
        </Stack>
      </Box>
    </Box>
  );
}
