import { z } from 'zod';

export const roles = ['owner', 'admin', 'editor'] as const;
export type Role = (typeof roles)[number];

const email = z.email().trim().toLowerCase().max(254);
const password = z.string().min(10, 'Password must be at least 10 characters').max(200);

export const signupInput = z.object({
  email,
  password,
  name: z.string().trim().min(1).max(100),
  orgName: z.string().trim().min(1).max(100),
});
export type SignupInput = z.infer<typeof signupInput>;

export const loginInput = z.object({
  email,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginInput>;

/** Team size choices for a workspace (Settings → Account). */
export const teamSizes = ['1', '2-10', '11-50', '51-200', '201-1000', '1000+'] as const;
export type TeamSize = (typeof teamSizes)[number];

/** Workspace details. Changing the contact email is for the owner only. */
export const updateOrgInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    /** ISO 3166-1 alpha-2, e.g. "GB"; null clears it. */
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Pick a country from the list')
      .nullable(),
    teamSize: z.enum(teamSizes).nullable(),
    /** Where we send billing and account notices; null = the owner's own email. */
    contactEmail: email.nullable(),
  })
  .partial();
export type UpdateOrgInput = z.input<typeof updateOrgInput>;

export interface UserDto {
  id: string;
  email: string;
  name: string;
}

export interface OrgMembershipDto {
  id: string;
  name: string;
  role: Role;
  country: string | null;
  teamSize: TeamSize | null;
  contactEmail: string | null;
}

/** Your own profile (Settings → Profile). */
export const updateProfileInput = z.object({ name: z.string().trim().min(1).max(100) });
export type UpdateProfileInput = z.input<typeof updateProfileInput>;

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});
export type ChangePasswordInput = z.input<typeof changePasswordInput>;

export interface MeDto {
  user: UserDto;
  orgs: OrgMembershipDto[];
}

export interface MemberDto {
  userId: string;
  email: string;
  name: string;
  role: Role;
  joinedAt: string;
}
