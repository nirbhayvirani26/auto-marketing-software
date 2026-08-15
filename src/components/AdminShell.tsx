"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AppBar,
  Avatar,
  Box,
  Breadcrumbs,
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
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CampaignIcon from "@mui/icons-material/CampaignOutlined";
import LogoutIcon from "@mui/icons-material/LogoutOutlined";
import ShieldIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import StorageIcon from "@mui/icons-material/StorageOutlined";

import { useColorMode } from "@/theme/ThemeRegistry";
import BrandSwitcher from "./BrandSwitcher";
import { NAV_SECTIONS, navItemForPath } from "./nav-items";

const DRAWER_WIDTH = 264;
const RAIL_WIDTH = 76;
const COLLAPSE_KEY = "admin.sidebar.collapsed";

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
  const [collapsed, setCollapsed] = React.useState(false);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  // Read the stored preference after mount, so the server and the first client
  // render agree and React does not report a hydration mismatch.
  React.useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const current = navItemForPath(pathname);
  const section = NAV_SECTIONS.find((group) =>
    group.items.some((item) => item.href === current?.href),
  );

  const sidebarWidth = collapsed ? RAIL_WIDTH : DRAWER_WIDTH;

  const sidebar = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Toolbar sx={{ gap: 1.5, px: collapsed ? 0 : 2.5, justifyContent: collapsed ? "center" : "flex-start" }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 2,
            display: "grid",
            placeItems: "center",
            bgcolor: "primary.main",
            color: "primary.contrastText",
          }}
        >
          <CampaignIcon fontSize="small" />
        </Box>
        {!collapsed && (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" lineHeight={1.2} noWrap>
              Auto Marketing
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              Content workspace
            </Typography>
          </Box>
        )}
      </Toolbar>

      <Divider />

      <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden", py: 1 }}>
        {NAV_SECTIONS.map((group) => (
          <Box key={group.title} sx={{ mb: 0.5 }}>
            {collapsed ? (
              <Divider sx={{ mx: 2, my: 1 }} />
            ) : (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  px: 3,
                  pt: 1.5,
                  pb: 0.5,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: "text.secondary",
                  textTransform: "uppercase",
                  fontSize: 11,
                }}
              >
                {group.title}
              </Typography>
            )}

            <List disablePadding sx={{ px: collapsed ? 1 : 1.5 }}>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);

                return (
                  <Tooltip
                    key={item.href}
                    title={collapsed ? item.label : item.hint}
                    placement="right"
                    enterDelay={collapsed ? 0 : 600}
                  >
                    <ListItemButton
                      component={Link}
                      href={item.href}
                      selected={active}
                      onClick={() => setMobileOpen(false)}
                      sx={{
                        borderRadius: 2,
                        mb: 0.25,
                        minHeight: 42,
                        justifyContent: collapsed ? "center" : "flex-start",
                        px: collapsed ? 1 : 1.5,
                        position: "relative",
                        "&.Mui-selected": {
                          bgcolor: "action.selected",
                          color: "primary.main",
                          "& .MuiListItemIcon-root": { color: "primary.main" },
                          "&:hover": { bgcolor: "action.selected" },
                          // A slim accent bar reads as "you are here" without
                          // filling the whole row with colour.
                          "&::before": {
                            content: '""',
                            position: "absolute",
                            left: 0,
                            top: 8,
                            bottom: 8,
                            width: 3,
                            borderRadius: 4,
                            bgcolor: "primary.main",
                          },
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36 }}>
                        <Icon fontSize="small" />
                      </ListItemIcon>
                      {!collapsed && (
                        <ListItemText
                          primary={item.label}
                          slotProps={{
                            primary: { fontSize: 14, fontWeight: active ? 700 : 500 },
                          }}
                        />
                      )}
                    </ListItemButton>
                  </Tooltip>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      <Divider />

      {user.role === "superadmin" && (
        <ListItemButton
          component={Link}
          href="/superadmin"
          sx={{ justifyContent: collapsed ? "center" : "flex-start", py: 1.25 }}
        >
          <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36 }}>
            <ShieldIcon fontSize="small" />
          </ListItemIcon>
          {!collapsed && (
            <ListItemText
              primary="Super Admin"
              slotProps={{ primary: { fontSize: 14, fontWeight: 600 } }}
            />
          )}
        </ListItemButton>
      )}

      {!collapsed && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2.5, py: 1.5 }}>
          <StorageIcon sx={{ fontSize: 15, color: "text.secondary" }} />
          <Typography variant="caption" color="text.secondary" noWrap>
            Local database · data/
          </Typography>
        </Stack>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <AppBar
        position="fixed"
        elevation={0}
        color="inherit"
        sx={{
          width: { md: `calc(100% - ${sidebarWidth}px)` },
          ml: { md: `${sidebarWidth}px` },
          borderBottom: 1,
          borderColor: "divider",
          backdropFilter: "blur(10px)",
          bgcolor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(23,26,33,0.8)"
              : "rgba(255,255,255,0.8)",
          transition: (theme) =>
            theme.transitions.create(["width", "margin"], { duration: 200 }),
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: "none" } }}
            edge="start"
            aria-label="Open navigation"
          >
            <MenuIcon />
          </IconButton>

          <Tooltip title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <IconButton
              onClick={toggleCollapsed}
              sx={{ display: { xs: "none", md: "inline-flex" } }}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </Tooltip>

          <Breadcrumbs
            separator="/"
            sx={{
              display: { xs: "none", sm: "flex" },
              "& .MuiBreadcrumbs-separator": { color: "text.disabled" },
            }}
          >
            {section && (
              <Typography variant="body2" color="text.secondary">
                {section.title}
              </Typography>
            )}
            <Typography variant="body2" fontWeight={600}>
              {current?.label ?? "Admin"}
            </Typography>
          </Breadcrumbs>

          <Box sx={{ flex: 1 }} />

          <BrandSwitcher />

          <Tooltip title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            <IconButton onClick={toggleMode} aria-label="Toggle colour mode">
              {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>

          <Tooltip title={user.email}>
            <IconButton onClick={(event) => setAnchorEl(event.currentTarget)}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: "secondary.main", fontSize: 15 }}>
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
            slotProps={{ paper: { sx: { minWidth: 220 } } }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{user.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {user.email}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Role: {user.role}
              </Typography>
            </Box>
            <Divider />
            <MenuItem component={Link} href="/admin/settings" onClick={() => setAnchorEl(null)}>
              Settings
            </MenuItem>
            <MenuItem onClick={handleSignOut}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: sidebarWidth }, flexShrink: { md: 0 } }}>
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
          {/* The mobile drawer is always full width, never the narrow rail. */}
          <Box sx={{ height: "100%" }}>{sidebar}</Box>
        </Drawer>

        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": {
              width: sidebarWidth,
              boxSizing: "border-box",
              borderRight: 1,
              borderColor: "divider",
              overflowX: "hidden",
              transition: (theme) => theme.transitions.create("width", { duration: 200 }),
            },
          }}
        >
          {sidebar}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${sidebarWidth}px)` },
          minWidth: 0,
          bgcolor: "background.default",
        }}
      >
        <Toolbar />
        <Stack sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }} spacing={3}>
          {children}
        </Stack>
      </Box>
    </Box>
  );
}
