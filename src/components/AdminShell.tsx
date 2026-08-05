"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AppBar,
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import DashboardIcon from "@mui/icons-material/SpaceDashboardOutlined";
import GroupsIcon from "@mui/icons-material/GroupsOutlined";
import ArticleIcon from "@mui/icons-material/ArticleOutlined";
import CampaignIcon from "@mui/icons-material/CampaignOutlined";
import BoltIcon from "@mui/icons-material/BoltOutlined";
import HistoryIcon from "@mui/icons-material/HistoryOutlined";
import StorefrontIcon from "@mui/icons-material/StorefrontOutlined";
import ChatIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import HubIcon from "@mui/icons-material/HubOutlined";
import ShoppingBagIcon from "@mui/icons-material/ShoppingBagOutlined";
import RocketIcon from "@mui/icons-material/RocketLaunchOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import LogoutIcon from "@mui/icons-material/LogoutOutlined";
import { useColorMode } from "@/theme/ThemeRegistry";
import BrandSwitcher from "./BrandSwitcher";

const DRAWER_WIDTH = 248;

const NAV = [
  { href: "/admin", label: "Dashboard", icon: DashboardIcon, exact: true },
  { href: "/admin/setup", label: "Setup", icon: RocketIcon },
  { href: "/admin/brands", label: "Brands", icon: StorefrontIcon },
  { href: "/admin/accounts", label: "Social Accounts", icon: GroupsIcon },
  { href: "/admin/campaigns", label: "Campaigns", icon: CampaignIcon },
  { href: "/admin/products", label: "Products", icon: ShoppingBagIcon },
  { href: "/admin/posts", label: "Posts", icon: ArticleIcon },
  { href: "/admin/automations", label: "Automations", icon: BoltIcon },
  { href: "/admin/dm-rules", label: "Auto DM & Replies", icon: ChatIcon },
  { href: "/admin/integrations", label: "Integrations & API", icon: HubIcon },
  { href: "/admin/logs", label: "Activity Logs", icon: HistoryIcon },
  { href: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

export default function AdminShell({
  user,
  children,
}: {
  user: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggleMode } = useColorMode();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

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
            bgcolor: "primary.main",
            color: "primary.contrastText",
          }}
        >
          <CampaignIcon fontSize="small" />
        </Box>
        <Box>
          <Typography variant="subtitle2" lineHeight={1.2}>
            Auto Marketing
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Admin Panel
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
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  "& .MuiListItemIcon-root": { color: "inherit" },
                  "&:hover": { bgcolor: "primary.dark" },
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
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          v0.1.0 · Next.js + MUI + MongoDB
        </Typography>
      </Box>
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
          backdropFilter: "blur(8px)",
          bgcolor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(23,26,33,0.75)"
              : "rgba(255,255,255,0.75)",
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
          <BrandSwitcher />
          <Box sx={{ flex: 1 }} />
          <Tooltip title={mode === "dark" ? "Light mode" : "Dark mode"}>
            <IconButton onClick={toggleMode}>
              {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title={user.email}>
            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: "secondary.main" }}>
                {user.name.charAt(0).toUpperCase()}
              </Avatar>
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{user.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {user.email} · {user.role}
              </Typography>
            </Box>
            <Divider />
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}
      >
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
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          minWidth: 0,
        }}
      >
        <Toolbar />
        <Stack sx={{ p: { xs: 2, md: 3 } }} spacing={3}>
          {children}
        </Stack>
      </Box>
    </Box>
  );
}
