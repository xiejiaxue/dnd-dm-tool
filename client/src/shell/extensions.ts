import type { IconName } from '../components/Icon';
import type { ToolPage } from './navigation';

/**
 * Tools written for one adventure module. They stay out of the general tool
 * list, appear in their own rail section, and are offered inside campaigns
 * (and on lobby cards) only when the campaign uses that module.
 */
export interface ModuleExtension {
  page: ToolPage;
  /** Built-in module id the tool was written for (campaign `templateId`). */
  templateId: string;
  moduleName: string;
  /** Shown beside the rail entry in place of a tool number. */
  moduleTag: string;
  href: string;
  label: string;
  shortLabel?: string;
  eyebrow: string;
  icon: IconName;
}

export const MODULE_EXTENSIONS: ModuleExtension[] = [
  {
    page: 'tavern',
    templateId: 'waterdeep-dragon-heist',
    moduleName: '深水城龙金劫',
    moduleTag: '龙金劫',
    href: '/tavern',
    label: '酒馆经营',
    shortLabel: '酒馆',
    eyebrow: '深水城龙金劫 / TROLLSKULL TAVERN',
    icon: 'tavern',
  },
];

export function extensionsFor(templateId: string | undefined): ModuleExtension[] {
  return templateId ? MODULE_EXTENSIONS.filter(extension => extension.templateId === templateId) : [];
}

/** Opens the tool already linked to the campaign it was launched from. */
export function extensionHref(extension: ModuleExtension, campaignSlug?: string): string {
  return campaignSlug ? `${extension.href}?campaign=${encodeURIComponent(campaignSlug)}` : extension.href;
}
