import type { SvgIconComponent } from "@mui/icons-material";

import DashboardIcon from "@mui/icons-material/SpaceDashboardOutlined";
import RocketIcon from "@mui/icons-material/RocketLaunchOutlined";
import MovieIcon from "@mui/icons-material/MovieCreationOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesomeOutlined";
import LanguageIcon from "@mui/icons-material/LanguageOutlined";
import ArticleIcon from "@mui/icons-material/ArticleOutlined";
import ShoppingBagIcon from "@mui/icons-material/ShoppingBagOutlined";
import FaceIcon from "@mui/icons-material/Face3Outlined";
import CampaignIcon from "@mui/icons-material/CampaignOutlined";
import BoltIcon from "@mui/icons-material/BoltOutlined";
import ChatIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import GroupsIcon from "@mui/icons-material/GroupsOutlined";
import HubIcon from "@mui/icons-material/HubOutlined";
import StorefrontIcon from "@mui/icons-material/StorefrontOutlined";
import HistoryIcon from "@mui/icons-material/HistoryOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";

export type NavItem = {
  href: string;
  label: string;
  icon: SvgIconComponent;
  /** Short line shown in the tooltip and on the dashboard shortcut cards. */
  hint: string;
  /** Match only this exact path rather than everything beneath it. */
  exact?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

/**
 * The admin sidebar, grouped the way the work actually flows: look at what is
 * happening, make something, schedule it, connect the accounts it publishes
 * to, and configure the workspace.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      {
        href: "/admin",
        label: "Dashboard",
        icon: DashboardIcon,
        hint: "Everything at a glance",
        exact: true,
      },
      {
        href: "/admin/setup",
        label: "Setup",
        icon: RocketIcon,
        hint: "Check which services are ready",
      },
    ],
  },
  {
    title: "Create",
    items: [
      {
        href: "/admin/create",
        label: "Create New",
        icon: AutoAwesomeIcon,
        hint: "Upload a photo, or pick a product — get a post",
      },
      {
        href: "/admin/studio",
        label: "Reel Studio",
        icon: MovieIcon,
        hint: "Turn a product photo into a finished reel",
      },
      {
        href: "/admin/posts",
        label: "Posts",
        icon: ArticleIcon,
        hint: "Write, schedule and publish",
      },
      {
        href: "/admin/products",
        label: "Products",
        icon: ShoppingBagIcon,
        hint: "Paste a link, get the details",
      },
      {
        href: "/admin/avatars",
        label: "Avatars",
        icon: FaceIcon,
        hint: "The face that appears in your reels",
      },
    ],
  },
  {
    title: "Automate",
    items: [
      {
        href: "/admin/campaigns",
        label: "Campaigns",
        icon: CampaignIcon,
        hint: "Brand voice, keywords and goals",
      },
      {
        href: "/admin/automations",
        label: "Automations",
        icon: BoltIcon,
        hint: "Post on a schedule, hands free",
      },
      {
        href: "/admin/dm-rules",
        label: "Auto DM & Replies",
        icon: ChatIcon,
        hint: "Answer comments and send the link",
      },
    ],
  },
  {
    title: "Connect",
    items: [
      {
        href: "/admin/websites",
        label: "Connected Stores",
        icon: LanguageIcon,
        hint: "Import every product from your shop",
      },
      {
        href: "/admin/accounts",
        label: "Social Accounts",
        icon: GroupsIcon,
        hint: "Instagram and Facebook",
      },
      {
        href: "/admin/integrations",
        label: "Integrations & API",
        icon: HubIcon,
        hint: "API tokens, n8n and webhooks",
      },
    ],
  },
  {
    title: "Workspace",
    items: [
      {
        href: "/admin/brands",
        label: "Brands",
        icon: StorefrontIcon,
        hint: "One workspace per brand",
      },
      {
        href: "/admin/logs",
        label: "Activity Log",
        icon: HistoryIcon,
        hint: "Everything the app has done",
      },
      {
        href: "/admin/settings",
        label: "Settings",
        icon: SettingsIcon,
        hint: "Keys, storage and appearance",
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/** The nav entry matching a pathname — used for the page title and breadcrumb. */
export function navItemForPath(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ALL_NAV_ITEMS) {
    const matches = item.exact ? pathname === item.href : pathname.startsWith(item.href);
    if (!matches) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best;
}
