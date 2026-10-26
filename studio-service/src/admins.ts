import { randomUUID } from "node:crypto";
import { SiteManagerError } from "../../backend/src/site-manager/core.ts";
import type { StudioIdentity } from "./grants.ts";

type Member = { sub: string; email: string; addedAt: number };
type Invite = { id: string; email: string; issuer: string; expiresAt: number };
export type AdminState = {
  version: number;
  members: Member[];
  invites: Invite[];
};
export type AdminStore = {
  read(): Promise<AdminState | null>;
  write(expected: number | null, state: AdminState): Promise<boolean>;
};
export const memoryAdminStore = (): AdminStore & {
  holds(sub: string, version: number): boolean;
} => {
  let state: AdminState | null = null;
  return {
    holds(sub, version) {
      return (
        state?.version === version && state.members.some((member) => member.sub === sub)
      );
    },
    async read() {
      return structuredClone(state);
    },
    async write(expected, next) {
      if ((state?.version ?? null) !== expected) return false;
      state = structuredClone(next);
      return true;
    },
  };
};
const fail = (status: number, message: string): never => {
  throw new SiteManagerError(
    status,
    status === 403 ? "forbidden" : "invalid_request",
    message
  );
};
const emailOf = (value: unknown) =>
  typeof value === "string" &&
  value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? value.trim().toLowerCase()
    : null;

/** A bounded, versioned studio roster makes last-admin protection atomic.
 * Bootstrap is a one-time conditional create, never a fallback authorization.
 * No GSI or warm-process membership cache is trusted for authorization.
 */
export const createAdminService = (
  store: AdminStore,
  bootstrap: ReadonlySet<string>,
  send?: (message: {
    to: string;
    acceptUrl: string;
    label: string;
  }) => Promise<void>,
  now = Date.now
) => {
  const requireMember = (
    state: AdminState | null,
    identity: StudioIdentity
  ) => {
    if (!state?.members.some((m) => m.sub === identity.sub))
      fail(403, "This account is not a studio administrator.");
  };
  const mutate = async (change: (state: AdminState | null) => AdminState) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const state = await store.read();
      const next = change(state);
      next.version = (state?.version ?? 0) + 1;
      if (await store.write(state?.version ?? null, next)) return next;
    }
    return fail(409, "Access changed at the same time. Refresh and try again.");
  };
  return {
    async authorize(identity: StudioIdentity) {
      const state = await store.read();
      requireMember(state, identity);
      return state!.version;
    },
    async status(identity: StudioIdentity) {
      const state = await store.read();
      const admin = !!state?.members.some((m) => m.sub === identity.sub);
      return {
        admin,
        canSetup: !state && bootstrap.has(identity.sub),
        members: admin ? state!.members : [],
        invites: admin ? state!.invites.filter((i) => i.expiresAt > now()) : [],
      };
    },
    async setup(identity: StudioIdentity) {
      if (
        !bootstrap.has(identity.sub) ||
        !identity.emailVerified ||
        !emailOf(identity.email)
      )
        fail(
          403,
          "Only a designated owner with a verified email can set up this site."
        );
      await mutate((state) => {
        if (state)
          return fail(
            409,
            "This site is already set up. Ask an administrator for an invitation."
          );
        if (bootstrap.size > 100)
          return fail(400, "Too many initial administrators.");
        return {
          version: 0,
          members: [...bootstrap].map((sub) => ({
            sub,
            email: sub === identity.sub ? emailOf(identity.email)! : "",
            addedAt: now(),
          })),
          invites: [],
        };
      });
      return { ok: true };
    },
    async invite(identity: StudioIdentity, value: unknown) {
      const email = emailOf(value);
      if (!email) return fail(400, "Enter a valid email address.");
      const invite = {
        id: randomUUID(),
        email,
        issuer: identity.sub,
        expiresAt: now() + 7 * 86400000,
      };
      await mutate((state) => {
        requireMember(state, identity);
        const invites = state!.invites.filter(
          (i) => i.expiresAt > now() && i.email !== email
        );
        if (invites.length >= 100)
          return fail(
            409,
            "Cancel an outstanding invitation before sending another."
          );
        return { ...state!, invites: [...invites, invite] };
      });
      const acceptUrl = `https://777records777.studio/admin?adminInvite=${invite.id}`;
      let mailed = false;
      if (send) {
        try {
          await send({
            to: email,
            acceptUrl,
            label: "Studio administrator (publishing access is separate)",
          });
          mailed = true;
        } catch {
          /* Link remains available to the issuer. */
        }
      }
      return { acceptUrl, mailed };
    },
    async accept(identity: StudioIdentity, id: unknown) {
      await mutate((state) => {
        const invite = state?.invites.find(
          (i) => i.id === id && i.expiresAt > now()
        );
        if (!invite || !state!.members.some((m) => m.sub === invite.issuer))
          return fail(
            400,
            "This invitation expired, was cancelled, or has already been used."
          );
        if (!identity.emailVerified || emailOf(identity.email) !== invite.email)
          return fail(
            403,
            "Sign in with the verified email this invitation was sent to."
          );
        const members = state!.members.filter((m) => m.sub !== identity.sub);
        if (members.length >= 100)
          return fail(409, "This studio has reached its administrator limit.");
        return {
          ...state!,
          members: [
            ...members,
            { sub: identity.sub, email: invite.email, addedAt: now() },
          ],
          invites: state!.invites.filter((i) => i.id !== id),
        };
      });
      return { ok: true };
    },
    async remove(identity: StudioIdentity, sub: unknown) {
      await mutate((state) => {
        requireMember(state, identity);
        const members = state!.members.filter((m) => m.sub !== sub);
        if (!members.length)
          return fail(
            409,
            "Keep at least one administrator. Invite another before removing yourself."
          );
        return {
          ...state!,
          members,
          invites: state!.invites.filter((i) => i.issuer !== sub),
        };
      });
      return { ok: true };
    },
    async cancel(identity: StudioIdentity, id: unknown) {
      await mutate((state) => {
        requireMember(state, identity);
        return {
          ...state!,
          invites: state!.invites.filter((i) => i.id !== id),
        };
      });
      return { ok: true };
    },
  };
};
