import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdminService, memoryAdminStore } from "../src/admins.ts";
import { dynamoAdminStore } from "../src/admin-store.ts";
import { dynamoGrantStore } from "../src/aws.ts";
import { createStudioService, memoryGrantStore } from "../src/grants.ts";
import { handle } from "../src/handler.ts";
import { clearStudioJwks, readStudioSigningKey } from "../src/index.ts";
const owner = {
  sub: "owner",
  email: "owner@example.test",
  emailVerified: true,
};
const other = {
  sub: "other",
  email: "other@example.test",
  emailVerified: true,
};
const id = (url: string) => new URL(url).searchParams.get("adminInvite")!;

test("setup is restricted, atomic and never restores revoked bootstrap owners", async () => {
  const store = memoryAdminStore();
  const people = createAdminService(store, new Set([owner.sub, other.sub]));
  await assert.rejects(
    people.setup({ ...owner, sub: "stranger" }),
    /designated owner/
  );
  await assert.rejects(
    people.setup({ ...owner, emailVerified: false }),
    /verified email/
  );
  const results = await Promise.allSettled([
    people.setup(owner),
    people.setup(other),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await people.remove(owner, other.sub);
  const restarted = createAdminService(store, new Set([owner.sub, other.sub]));
  await assert.rejects(
    restarted.authorize(other),
    /not a studio administrator/
  );
  await assert.rejects(restarted.setup(other), /already set up/);
});
test("recipient verification, one-use and expiry are enforced", async () => {
  let now = 100;
  const people = createAdminService(
    memoryAdminStore(),
    new Set([owner.sub]),
    undefined,
    () => now
  );
  await people.setup(owner);
  const link = await people.invite(owner, other.email);
  await assert.rejects(
    people.accept(owner, id(link.acceptUrl)),
    /verified email/
  );
  await assert.rejects(
    people.accept({ ...other, emailVerified: false }, id(link.acceptUrl)),
    /verified email/
  );
  await people.accept(other, id(link.acceptUrl));
  await people.authorize(other);
  await assert.rejects(
    people.accept(other, id(link.acceptUrl)),
    /already been used/
  );
  const expired = await people.invite(owner, "late@example.test");
  now += 8 * 86400000;
  await assert.rejects(
    people.accept(
      { ...other, email: "late@example.test" },
      id(expired.acceptUrl)
    ),
    /expired/
  );
});
test("two concurrent self-removals leave exactly one administrator", async () => {
  const people = createAdminService(
    memoryAdminStore(),
    new Set([owner.sub, other.sub])
  );
  await people.setup(owner);
  const results = await Promise.allSettled([
    people.remove(owner, owner.sub),
    people.remove(other, other.sub),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const statuses = await Promise.all([
    people.status(owner),
    people.status(other),
  ]);
  assert.equal(statuses.filter((s) => s.admin).length, 1);
  assert.equal(statuses.find((s) => s.admin)!.members.length, 1);
});
test("removing an issuer cancels outstanding invitations; membership is never cached", async () => {
  const people = createAdminService(
    memoryAdminStore(),
    new Set([owner.sub, other.sub])
  );
  await people.setup(owner);
  const link = await people.invite(other, "third@example.test");
  await people.remove(owner, other.sub);
  await assert.rejects(
    people.invite(other, "fourth@example.test"),
    /not a studio administrator/
  );
  await assert.rejects(
    people.accept(
      { ...other, sub: "third", email: "third@example.test" },
      id(link.acceptUrl)
    ),
    /cancelled/
  );
  assert.deepEqual((await people.status(other)).members, []);
});
test("cancelling or replacing an invitation invalidates its old link", async () => {
  const people = createAdminService(memoryAdminStore(), new Set([owner.sub]));
  await people.setup(owner);
  const first = await people.invite(owner, other.email);
  const second = await people.invite(owner, other.email);
  await assert.rejects(people.accept(other, id(first.acceptUrl)));
  await people.cancel(owner, id(second.acceptUrl));
  await assert.rejects(people.accept(other, id(second.acceptUrl)));
});
test("removal wins if it lands after publishing authorization and before the invitation is stored", async () => {
  const roster = memoryAdminStore();
  const people = createAdminService(roster, new Set([owner.sub, other.sub]));
  await people.setup(owner);
  const inner = memoryGrantStore(roster);
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  let proceed: () => void = () => {};
  const resume = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const store = {
    ...inner,
    async putInvite(invite: Parameters<typeof inner.putInvite>[0], admin?: Parameters<typeof inner.putInvite>[1]) {
      release();
      await resume;
      return inner.putInvite(invite, admin);
    },
  };
  const service = createStudioService({
    admins: new Set([owner.sub, other.sub]),
    authorizeAdmin: (identity) => people.authorize(identity),
    store,
    manifests: {
      async read() {
        return null;
      },
      async write() {
        return { etag: "test" };
      },
    },
    storage: {
      async issueUpload() {
        throw new Error("unused");
      },
      async inspectUpload() {
        return null;
      },
    },
    receiptSecret: "test-only-secret-with-at-least-32-characters",
  });
  const pending = service.createInvite(other, {
    destinationId: "viz-sounds",
    recipientEmail: "viz@example.test",
  });
  await opened;
  await people.remove(owner, other.sub);
  proceed();
  await assert.rejects(pending, /not a studio administrator/);
});
test("dynamic membership gates publishing administration without creating publishing rights", async () => {
  const people = createAdminService(
    memoryAdminStore(),
    new Set([owner.sub, other.sub])
  );
  await people.setup(owner);
  const service = createStudioService({
    admins: new Set([owner.sub, other.sub]),
    authorizeAdmin: people.authorize,
    store: memoryGrantStore(),
    manifests: {
      async read() {
        return null;
      },
      async write() {
        return { etag: "test" };
      },
    },
    storage: {
      async issueUpload() {
        throw new Error("unused");
      },
      async inspectUpload() {
        return null;
      },
    },
    receiptSecret: "test-only-secret-with-at-least-32-characters",
  });
  assert.deepEqual(await service.listOwn(owner), []);
  await service.list(other);
  await people.remove(owner, other.sub);
  await assert.rejects(service.list(other), /not a studio administrator/);
  await assert.rejects(
    service.createInvite(other, {
      destinationId: "viz-sounds",
      recipientEmail: other.email,
    }),
    /not a studio administrator/
  );
});
test("Dynamo membership uses strong reads and conditional version writes", async () => {
  const commands: any[] = [];
  let conflict = false;
  const client = {
    async send(command: any) {
      commands.push(command.input);
      if (conflict) {
        const error = new Error("conflict");
        error.name = "ConditionalCheckFailedException";
        throw error;
      }
      return {};
    },
  };
  const store = dynamoAdminStore("test", client as any);
  await store.read();
  assert.equal(commands[0].ConsistentRead, true);
  const state = { version: 1, members: [], invites: [] };
  assert.equal(await store.write(null, state), true);
  assert.equal(commands[1].ConditionExpression, "attribute_not_exists(pk)");
  await store.write(1, { ...state, version: 2 });
  assert.equal(commands[2].ExpressionAttributeValues[":expected"], 1);
  assert.equal(commands[2].ConditionExpression, "#version = :expected");
  conflict = true;
  assert.equal(await store.write(1, state), false);
});

test("a publishing invitation records the administrator only in the same roster check as the write", async () => {
  const commands: Array<{ name: string; input: any }> = [];
  const client = {
    async send(command: { constructor: { name: string }; input: any }) {
      commands.push({ name: command.constructor.name, input: command.input });
      return {};
    },
  };
  const store = dynamoGrantStore("Grants", client as any);
  await store.putInvite(
    {
      id: "11111111-1111-4111-8111-111111111111",
      destinationId: "viz-sounds",
      recipientEmail: "viz@example.test",
      expiresAt: 1,
      consumedAt: null,
    },
    { sub: other.sub, version: 3 }
  );
  const check = commands[0].input.TransactItems[0].ConditionCheck;
  assert.equal(check.Key.pk, "admin-roster");
  assert.match(check.ConditionExpression, /contains\(#subs, :sub\)/);
  assert.equal(check.ExpressionAttributeValues[":version"], 3);
  assert.equal(check.ExpressionAttributeValues[":sub"], other.sub);
});

test("unknown signing keys share one key-set fetch", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ keys: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    clearStudioJwks();
    await assert.rejects(readStudioSigningKey("kid-a", 1_000), /not valid/);
    await assert.rejects(readStudioSigningKey("kid-b", 1_000), /not valid/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    clearStudioJwks();
  }
});

test("HTTP admin setup and invitations require identity and never grant publishing", async () => {
  const people = createAdminService(memoryAdminStore(), new Set([owner.sub]));
  const service = createStudioService({
    admins: new Set(),
    authorizeAdmin: people.authorize,
    store: memoryGrantStore(),
    manifests: {
      async read() {
        return null;
      },
      async write() {
        return { etag: "test" };
      },
    },
    storage: {
      async issueUpload() {
        throw new Error("unused");
      },
      async inspectUpload() {
        return null;
      },
    },
    receiptSecret: "test-only-secret-with-at-least-32-characters",
  });
  const call = (identity: typeof owner, path: string, body?: object) =>
    handle(
      new Request(`https://service.test${path}`, {
        method: body ? "POST" : "GET",
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      {
        service,
        people,
        allowedOrigins: [],
        verifyIdentity: async () => identity,
      }
    );
  assert.equal((await call(other, "/people/setup", {})).status, 403);
  assert.equal((await call(owner, "/people/setup", {})).status, 200);
  assert.equal(
    (await call(other, "/people/invite", { email: other.email })).status,
    403
  );
  const response = await call(owner, "/people/invite", { email: other.email });
  const invitation = await response.json();
  assert.equal(response.status, 201);
  assert.equal(
    (
      await call(other, "/people/accept", {
        inviteId: id(invitation.acceptUrl),
      })
    ).status,
    200
  );
  assert.equal((await call(other, "/admin/grants")).status, 200);
  assert.deepEqual(await (await call(other, "/me/grants")).json(), {
    grants: [],
  });
  assert.equal(
    (await call(owner, "/people/remove", { sub: other.sub })).status,
    200
  );
  assert.equal((await call(other, "/admin/grants")).status, 403);
});
