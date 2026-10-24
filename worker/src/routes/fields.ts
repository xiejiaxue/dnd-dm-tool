import { nonEmptyText } from "../http";
import type { RoomAccess } from "../repository";

export function roomSummary(access: RoomAccess): {
  id: string;
  slug: string;
  name: string;
  role: string;
  status: string;
  campaignName: string;
  updatedAt: number;
  templateId?: string;
} {
  return {
    id: access.roomId,
    slug: access.roomSlug,
    name: access.roomName,
    role: access.role,
    status: access.roomStatus,
    campaignName: access.campaignName,
    updatedAt: Date.now(),
    // Lets the table show only the adventure module's own reference tabs.
    ...(access.templateId ? { templateId: access.templateId } : {}),
  };
}

export function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : nonEmptyText(value, label);
}
